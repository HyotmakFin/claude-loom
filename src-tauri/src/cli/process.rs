//! 子进程生命周期与双向 NDJSON 管道。

use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{Arc, Mutex as StdMutex},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{oneshot, Mutex},
};

use super::{locate, ndjson};

/// 前端订阅的唯一事件名，payload 为 [`CliEvent`]。
pub const EVENT: &str = "loom://cli";

/// stop 时先关闭 stdin 让 CLI 自行退出，超过该时长再强杀进程树。
const GRACE: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOptions {
    pub cwd: PathBuf,
    pub resume: Option<String>,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub plugin_dirs: Vec<PathBuf>,
    /// 额外注入的环境变量（BYOK：ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY …）
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// 需要从继承环境中移除的变量（例如切换 BYOK 时去掉 ANTHROPIC_AUTH_TOKEN）
    #[serde(default)]
    pub env_remove: Vec<String>,
    #[serde(default)]
    pub partial_messages: bool,
    pub cli_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum CliEvent {
    Spawned { run_id: String, pid: Option<u32>, cli_path: String },
    Message { run_id: String, msg: Value },
    ParseError { run_id: String, text: String },
    Stderr { run_id: String, text: String },
    Exit { run_id: String, code: Option<i32>, killed: bool },
}

struct Run {
    stdin: Mutex<Option<ChildStdin>>,
    stop_tx: StdMutex<Option<oneshot::Sender<()>>>,
    pid: Option<u32>,
}

impl Run {
    async fn write(&self, msg: &Value) -> Result<(), String> {
        let mut line = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
        line.push(b'\n');
        let mut guard = self.stdin.lock().await;
        let stdin = guard.as_mut().ok_or("CLI 的 stdin 已关闭")?;
        stdin
            .write_all(&line)
            .await
            .map_err(|e| format!("写入 stdin 失败：{e}"))?;
        stdin.flush().await.map_err(|e| format!("写入 stdin 失败：{e}"))
    }
}

#[derive(Default)]
pub struct CliRegistry {
    runs: StdMutex<HashMap<String, Arc<Run>>>,
}

impl CliRegistry {
    fn get(&self, run_id: &str) -> Result<Arc<Run>, String> {
        self.runs
            .lock()
            .unwrap()
            .get(run_id)
            .cloned()
            .ok_or_else(|| format!("运行实例不存在或已退出：{run_id}"))
    }

    pub async fn start(&self, app: AppHandle, opts: StartOptions) -> Result<String, String> {
        let cli = locate::locate(opts.cli_path.as_deref())?;
        if !opts.cwd.is_dir() {
            return Err(format!("工作目录不存在：{}", opts.cwd.display()));
        }

        let mut cmd = Command::new(&cli);
        cmd.args([
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            // 权限请求以 control_request{subtype:"can_use_tool"} 的形式出现在 stdout
            "--permission-prompt-tool",
            "stdio",
        ]);
        if opts.partial_messages {
            cmd.arg("--include-partial-messages");
        }
        if let Some(id) = &opts.resume {
            cmd.arg("--resume").arg(id);
        }
        if let Some(m) = &opts.model {
            cmd.arg("--model").arg(m);
        }
        if let Some(m) = &opts.permission_mode {
            cmd.arg("--permission-mode").arg(m);
        }
        for dir in &opts.plugin_dirs {
            cmd.arg("--plugin-dir").arg(dir);
        }

        cmd.current_dir(&opts.cwd)
            .env("PATH", locate::search_path())
            // 若 Loom 本身是从 Claude Code 的终端里启动的，避免子进程误判为嵌套会话
            .env_remove("CLAUDECODE");
        for key in &opts.env_remove {
            cmd.env_remove(key);
        }
        cmd.envs(&opts.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(unix)]
        cmd.process_group(0); // 独立进程组，便于连同工具子进程一起结束
        #[cfg(windows)]
        cmd.creation_flags(locate::CREATE_NO_WINDOW);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("启动 {} 失败：{e}", cli.display()))?;
        let pid = child.id();
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().ok_or("无法获取 CLI stdout")?;
        let stderr = child.stderr.take().ok_or("无法获取 CLI stderr")?;

        let run_id = uuid::Uuid::new_v4().to_string();
        let (stop_tx, stop_rx) = oneshot::channel();
        let run = Arc::new(Run {
            stdin: Mutex::new(stdin),
            stop_tx: StdMutex::new(Some(stop_tx)),
            pid,
        });
        self.runs.lock().unwrap().insert(run_id.clone(), run.clone());

        emit(
            &app,
            CliEvent::Spawned {
                run_id: run_id.clone(),
                pid,
                cli_path: cli.display().to_string(),
            },
        );

        let stdout_task = tauri::async_runtime::spawn(read_stdout(
            app.clone(),
            run_id.clone(),
            run.clone(),
            stdout,
        ));
        tauri::async_runtime::spawn(read_stderr(app.clone(), run_id.clone(), stderr));
        tauri::async_runtime::spawn(supervise(app, run_id.clone(), run, child, stop_rx, stdout_task));

        Ok(run_id)
    }

    pub async fn send(&self, run_id: &str, msg: &Value) -> Result<(), String> {
        self.get(run_id)?.write(msg).await
    }

    pub fn stop(&self, run_id: &str) -> Result<(), String> {
        let run = self.get(run_id)?;
        if let Some(tx) = run.stop_tx.lock().unwrap().take() {
            let _ = tx.send(());
        }
        Ok(())
    }

    /// 应用退出时同步调用：直接结束所有进程树。
    pub fn shutdown(&self) {
        let runs: Vec<Arc<Run>> = self.runs.lock().unwrap().drain().map(|(_, r)| r).collect();
        for run in runs {
            if let Some(pid) = run.pid {
                kill_tree_sync(pid);
            }
        }
    }
}

fn emit(app: &AppHandle, ev: CliEvent) {
    let _ = app.emit(EVENT, ev);
}

/// 等待进程退出（或收到 stop 信号），清理并发出 Exit 事件。
async fn supervise(
    app: AppHandle,
    run_id: String,
    run: Arc<Run>,
    mut child: Child,
    stop_rx: oneshot::Receiver<()>,
    stdout_task: tauri::async_runtime::JoinHandle<()>,
) {
    let mut killed = false;
    let status = tokio::select! {
        s = child.wait() => s,
        _ = stop_rx => {
            // 关闭 stdin：stream-json 模式下 CLI 读到 EOF 会自行收尾退出
            run.stdin.lock().await.take();
            match tokio::time::timeout(GRACE, child.wait()).await {
                Ok(s) => s,
                Err(_) => {
                    killed = true;
                    if let Some(pid) = run.pid {
                        kill_tree_sync(pid);
                    }
                    let _ = child.kill().await;
                    child.wait().await
                }
            }
        }
    };

    // 先把 stdout 剩余的行发完，再宣告退出；工具的孙进程可能持有管道，所以设超时
    let _ = tokio::time::timeout(Duration::from_secs(2), stdout_task).await;

    app.state::<CliRegistry>().runs.lock().unwrap().remove(&run_id);
    emit(
        &app,
        CliEvent::Exit {
            run_id,
            code: status.ok().and_then(|s| s.code()),
            killed,
        },
    );
}

async fn read_stdout(app: AppHandle, run_id: String, run: Arc<Run>, stdout: impl AsyncRead + Unpin) {
    let mut reader = BufReader::with_capacity(64 * 1024, stdout);
    let mut buf = Vec::with_capacity(8 * 1024);
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) => break,
            Ok(_) => {
                let Some(line) = ndjson::trim_line(&buf) else { continue };
                match serde_json::from_str::<Value>(&line) {
                    Ok(msg) => {
                        if let Some(reply) = auto_reply(&msg) {
                            let _ = run.write(&reply).await;
                        }
                        emit(&app, CliEvent::Message { run_id: run_id.clone(), msg });
                    }
                    Err(_) => emit(
                        &app,
                        CliEvent::ParseError { run_id: run_id.clone(), text: line.into_owned() },
                    ),
                }
            }
            Err(e) => {
                emit(&app, CliEvent::Stderr { run_id: run_id.clone(), text: format!("[loom] 读取 stdout 失败：{e}") });
                break;
            }
        }
    }
}

async fn read_stderr(app: AppHandle, run_id: String, stderr: impl AsyncRead + Unpin) {
    let mut reader = BufReader::new(stderr);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                if let Some(line) = ndjson::trim_line(&buf) {
                    emit(&app, CliEvent::Stderr { run_id: run_id.clone(), text: line.into_owned() });
                }
            }
        }
    }
}

/// Loom 只处理 `can_use_tool`；其余 control_request（hook_callback、mcp_message 等，
/// 只有注册过才会出现）直接回 error，防止 CLI 卡死等待。
fn auto_reply(msg: &Value) -> Option<Value> {
    if msg.get("type")?.as_str()? != "control_request" {
        return None;
    }
    let subtype = msg.pointer("/request/subtype").and_then(Value::as_str).unwrap_or("");
    if subtype == "can_use_tool" {
        return None;
    }
    let request_id = msg.get("request_id")?.clone();
    Some(json!({
        "type": "control_response",
        "response": {
            "subtype": "error",
            "request_id": request_id,
            "error": format!("Loom does not handle control request '{subtype}'"),
        }
    }))
}

#[cfg(unix)]
fn kill_tree_sync(pid: u32) {
    // process_group(0) 使 pgid == pid
    unsafe {
        libc::killpg(pid as libc::pid_t, libc::SIGKILL);
    }
}

#[cfg(windows)]
fn kill_tree_sync(pid: u32) {
    use std::os::windows::process::CommandExt;
    // claude.cmd 经由 cmd.exe 启动 node，只杀 cmd.exe 会留下孤儿进程，必须 /T 杀整棵树
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(locate::CREATE_NO_WINDOW)
        .status();
}

#[cfg(test)]
mod tests {
    use super::auto_reply;
    use serde_json::json;

    #[test]
    fn leaves_permission_requests_to_frontend() {
        let m = json!({"type":"control_request","request_id":"1","request":{"subtype":"can_use_tool"}});
        assert!(auto_reply(&m).is_none());
    }

    #[test]
    fn rejects_unknown_control_requests() {
        let m = json!({"type":"control_request","request_id":"7","request":{"subtype":"hook_callback"}});
        let r = auto_reply(&m).unwrap();
        assert_eq!(r["response"]["subtype"], "error");
        assert_eq!(r["response"]["request_id"], "7");
    }

    #[test]
    fn ignores_regular_messages() {
        assert!(auto_reply(&json!({"type":"assistant"})).is_none());
    }
}
