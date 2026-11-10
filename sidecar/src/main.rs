//! Headless JSON-RPC sidecar for the Electron shell.
//! Requests:  {"id": 1, "cmd": "session_list", "args": {...}}
//! Responses: {"id": 1, "ok": true, "data": ...}
//! Events:    {"event": "loom://cli", "payload": {...}}
#[path = "../backend/src/config.rs"]
mod config;
#[path = "../backend/src/git.rs"]
mod git;
#[path = "../backend/src/byok.rs"]
mod byok;
#[path = "../backend/src/models.rs"]
mod models;
#[path = "../backend/src/paths.rs"]
mod paths;
#[path = "../backend/src/platform.rs"]
mod platform;
#[path = "../backend/src/preview.rs"]
mod preview;
#[path = "../backend/src/plugins.rs"]
mod plugins;
#[path = "../backend/src/sessions/mod.rs"]
mod sessions;
#[path = "../backend/src/skills/mod.rs"]
mod skills;
#[path = "../backend/src/cli/mod.rs"]
mod cli;

use std::{
    io::{BufWriter, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};

struct Writer {
    out: Mutex<BufWriter<std::io::Stdout>>,
}

impl Writer {
    fn new() -> Self {
        Self {
            out: Mutex::new(BufWriter::new(std::io::stdout())),
        }
    }

    fn line(&self, value: &Value) {
        let mut out = self.out.lock().unwrap();
        let _ = serde_json::to_writer(&mut *out, value);
        let _ = out.write_all(b"\n");
        let _ = out.flush();
    }
}

fn string(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("missing argument: {key}"))
}

fn opt_string(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(Value::as_str).map(str::to_string)
}

fn path_arg(args: &Value, key: &str) -> Result<PathBuf, String> {
    Ok(PathBuf::from(string(args, key)?))
}

fn json<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

async fn dispatch(
    app: &AppHandle,
    registry: &Arc<cli::CliRegistry>,
    cmd: &str,
    args: Value,
) -> Result<Value, String> {
    let state = || -> State<'_, cli::CliRegistry> { State::new(registry.clone()) };
    match cmd {
        // CLI
        "cli_locate" => {
            let cli_path = args
                .get("cliPath")
                .and_then(Value::as_str)
                .map(PathBuf::from);
            json(cli::commands::cli_locate(cli_path).await?)
        }
        "cli_start" => {
            let options: cli::StartOptions = serde_json::from_value(
                args.get("options").cloned().ok_or("missing argument: options")?,
            )
            .map_err(|e| format!("invalid options: {e}"))?;
            // Claude Code 的 settings.json env 优先于进程 env；先合并写入再启动
            byok::apply(&options.env, &options.env_remove)
                .map_err(|e| format!("写入 Claude settings.json 失败：{e}"))?;
            json(cli::commands::cli_start(app.clone(), state(), options).await?)
        }
        "cli_send" => {
            let run_id = string(&args, "runId")?;
            let message = args.get("message").cloned().unwrap_or(Value::Null);
            json(cli::commands::cli_send(state(), run_id, message).await?)
        }
        "cli_stop" => {
            let run_id = string(&args, "runId")?;
            json(cli::commands::cli_stop(state(), run_id)?)
        }

        // app / platform
        "app_info" => json(paths::app_info(app.clone())?),
        "system_fonts" => json(platform::system_fonts().await),

        // config
        "config_get" => json(config::config_get(app.clone())?),
        "config_save" => {
            let cfg: config::LoomConfig = serde_json::from_value(
                args.get("config").cloned().ok_or("missing argument: config")?,
            )
            .map_err(|e| format!("invalid config: {e}"))?;
            json(config::config_save(app.clone(), cfg)?)
        }

        // sessions
        "session_list" => {
            let query = opt_string(&args, "query");
            let include_archived = args.get("includeArchived").and_then(Value::as_bool);
            json(
                sessions::commands::session_list(app.clone(), query, include_archived).await?,
            )
        }
        "session_messages" => {
            let id = string(&args, "sessionId")?;
            json(sessions::commands::session_messages(app.clone(), id).await?)
        }
        "session_delete" => {
            let id = string(&args, "sessionId")?;
            json(sessions::commands::session_delete(app.clone(), id).await?)
        }
        "session_set_flag" => {
            let id = string(&args, "sessionId")?;
            let pinned = args.get("pinned").and_then(Value::as_bool);
            let archived = args.get("archived").and_then(Value::as_bool);
            json(sessions::commands::session_set_flag(app.clone(), id, pinned, archived)?)
        }
        "session_fork" => {
            let id = string(&args, "sessionId")?;
            let upto = string(&args, "uptoUuid")?;
            json(sessions::commands::session_fork(app.clone(), id, upto).await?)
        }
        "session_delete_message" => {
            let id = string(&args, "sessionId")?;
            let uuid = string(&args, "uuid")?;
            json(sessions::commands::session_delete_message(app.clone(), id, uuid).await?)
        }

        // skills
        "skills_list" => json(skills::commands::skills_list().await?),
        "skill_doc" => {
            let dir = path_arg(&args, "dir")?;
            json(skills::commands::skill_doc(dir).await?)
        }
        "skill_save" => {
            let dir = path_arg(&args, "dir")?;
            let name = string(&args, "name")?;
            let description = string(&args, "description")?;
            let body = string(&args, "body")?;
            json(skills::commands::skill_save(dir, name, description, body).await?)
        }
        "skill_toggle" => {
            let dir = path_arg(&args, "dir")?;
            let enabled = args.get("enabled").and_then(Value::as_bool).unwrap_or(false);
            json(skills::commands::skill_toggle(dir, enabled).await?)
        }
        "skill_create" => {
            let name = string(&args, "name")?;
            let description = string(&args, "description")?;
            json(skills::commands::skill_create(name, description).await?)
        }

        // plugins
        "plugins_list" => json(plugins::plugins_list(app.clone())?),
        "plugin_add_dir" => {
            let path = path_arg(&args, "path")?;
            json(plugins::plugin_add_dir(app.clone(), path)?)
        }
        "plugin_remove_dir" => {
            let path = path_arg(&args, "path")?;
            json(plugins::plugin_remove_dir(app.clone(), path)?)
        }
        "plugin_toggle" => {
            let path = path_arg(&args, "path")?;
            let enabled = args.get("enabled").and_then(Value::as_bool).unwrap_or(false);
            json(plugins::plugin_toggle(app.clone(), path, enabled)?)
        }

        // BYOK 模型列表
        "models_list" => {
            let base = string(&args, "baseUrl")?;
            let key = opt_string(&args, "apiKey").unwrap_or_default();
            json(models::fetch(&base, &key).await?)
        }

        // git
        "git_info" => {
            let path = path_arg(&args, "path")?;
            json(git::info(&path)?)
        }

        // preview
        "preview_file" => {
            let path = path_arg(&args, "path")?;
            json(preview::preview_file(path).await?)
        }

        other => Err(format!("unknown command: {other}")),
    }
}

#[tokio::main]
async fn main() {
    let config_dir = std::env::var_os("LOOM_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::config_dir().map(|p| p.join("dev.loom.app")))
        .unwrap_or_else(|| PathBuf::from(".loom"));
    let version = std::env::var("LOOM_VERSION").unwrap_or_else(|_| "0.4.0".to_string());

    let writer = Arc::new(Writer::new());
    let emitter_writer = writer.clone();
    let app = AppHandle::new(
        config_dir,
        version,
        Arc::new(move |event, payload| {
            emitter_writer.line(&json!({ "event": event, "payload": payload }));
        }),
    );
    let registry = Arc::new(cli::CliRegistry::default());
    app.set_state(registry.clone());

    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut tasks = tokio::task::JoinSet::new();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) if !line.trim().is_empty() => {
                let request: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(e) => {
                        writer.line(&json!({ "id": Value::Null, "ok": false, "error": format!("bad request: {e}") }));
                        continue;
                    }
                };
                let id = request.get("id").cloned().unwrap_or(Value::Null);
                let cmd = request
                    .get("cmd")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let args = request.get("args").cloned().unwrap_or_else(|| json!({}));
                let app = app.clone();
                let registry = registry.clone();
                let writer = writer.clone();
                tasks.spawn(async move {
                    let response = match dispatch(&app, &registry, &cmd, args).await {
                        Ok(data) => json!({ "id": id, "ok": true, "data": data }),
                        Err(error) => json!({ "id": id, "ok": false, "error": error }),
                    };
                    writer.line(&response);
                });
            }
            Ok(Some(_)) => {}
            Ok(None) => break,
            Err(e) => {
                eprintln!("[loom-backend] stdin error: {e}");
                break;
            }
        }
    }
    while tasks.join_next().await.is_some() {}
    registry.shutdown();
}
