//! 定位 `claude` 可执行文件，并构造子进程使用的 PATH。
//!
//! - macOS 从 Finder/Dock 启动的 GUI 应用拿不到 shell 里的 PATH，所以额外读取一次
//!   登录 shell 的 PATH，再补充若干常见安装目录。这里只用于"查找"，注入给子进程的
//!   环境变量一律通过 `Command::env` 设置，不依赖 shell 展开。
//! - Windows 上 CLI 可能是 `claude.exe`（原生安装器）或 `claude.cmd`（npm 全局安装），
//!   按顺序显式查找，避免误命中 npm 生成的无扩展名 sh 脚本。

use std::{
    collections::HashSet,
    env,
    ffi::OsString,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::OnceLock,
};

use serde::Serialize;

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
const CANDIDATES: &[&str] = &["claude.exe", "claude.cmd", "claude.bat"];
#[cfg(not(windows))]
const CANDIDATES: &[&str] = &["claude"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInfo {
    pub path: PathBuf,
    pub version: Option<String>,
}

static SEARCH_PATH: OnceLock<OsString> = OnceLock::new();

/// 子进程使用的 PATH：进程 PATH ∪ 登录 shell PATH ∪ 常见安装目录（去重、保序）。
pub fn search_path() -> &'static OsString {
    SEARCH_PATH.get_or_init(build_search_path)
}

fn build_search_path() -> OsString {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(p) = env::var_os("PATH") {
        dirs.extend(env::split_paths(&p));
    }
    #[cfg(unix)]
    if let Some(p) = login_shell_path() {
        dirs.extend(env::split_paths(&p));
    }
    dirs.extend(well_known_dirs());

    let mut seen = HashSet::new();
    dirs.retain(|d| !d.as_os_str().is_empty() && seen.insert(d.clone()));
    env::join_paths(dirs).unwrap_or_else(|_| env::var_os("PATH").unwrap_or_default())
}

fn well_known_dirs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(home) = dirs::home_dir() {
        v.push(home.join(".local").join("bin"));
        v.push(home.join(".claude").join("local"));
        v.push(home.join(".npm-global").join("bin"));
        v.push(home.join(".bun").join("bin"));
        v.push(home.join(".volta").join("bin"));
    }
    #[cfg(target_os = "macos")]
    {
        v.push(PathBuf::from("/opt/homebrew/bin"));
        v.push(PathBuf::from("/usr/local/bin"));
    }
    #[cfg(target_os = "linux")]
    {
        v.push(PathBuf::from("/usr/local/bin"));
    }
    #[cfg(windows)]
    {
        if let Some(appdata) = env::var_os("APPDATA") {
            v.push(PathBuf::from(appdata).join("npm"));
        }
    }
    v
}

/// 读取登录 shell 的 PATH（3 秒超时，失败即放弃）。
#[cfg(unix)]
fn login_shell_path() -> Option<OsString> {
    use std::{
        io::Read,
        time::{Duration, Instant},
    };

    const MARK: &str = "__LOOM_PATH__";
    let shell = env::var_os("SHELL").unwrap_or_else(|| OsString::from("/bin/sh"));
    let mut child = Command::new(&shell)
        .arg("-l")
        .arg("-c")
        .arg(format!("printf '{MARK}%s' \"$PATH\""))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    // 登录脚本可能往 stdout 打印杂项，只取标记之后的内容
    out.rsplit_once(MARK).map(|(_, p)| OsString::from(p.trim()))
}

/// 查找顺序：显式指定 → `LOOM_CLAUDE_PATH` → PATH 搜索。
pub fn locate(explicit: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(p) = explicit {
        return if p.is_file() {
            Ok(p.to_path_buf())
        } else {
            Err(format!("指定的 claude 路径不存在：{}", p.display()))
        };
    }
    if let Some(p) = env::var_os("LOOM_CLAUDE_PATH").map(PathBuf::from) {
        if p.is_file() {
            return Ok(p);
        }
    }
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for name in CANDIDATES {
        if let Ok(p) = which::which_in(name, Some(search_path()), &cwd) {
            return Ok(p);
        }
    }
    Err("未在 PATH 中找到 `claude`。请先安装 Claude Code CLI，或设置环境变量 LOOM_CLAUDE_PATH。".into())
}

/// `claude --version`，失败返回 None。阻塞调用，请在 spawn_blocking 中使用。
pub fn version(path: &Path) -> Option<String> {
    let mut cmd = Command::new(path);
    cmd.arg("--version")
        .env("PATH", search_path())
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}
