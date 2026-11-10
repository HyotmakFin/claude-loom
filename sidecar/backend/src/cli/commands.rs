//! 暴露给前端的 Tauri 命令。

use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, State};

use super::{
    locate::{self, CliInfo},
    process::StartOptions,
    CliRegistry,
};

#[tauri::command]
pub async fn cli_locate(cli_path: Option<PathBuf>) -> Result<CliInfo, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<CliInfo, String> {
        let path = locate::locate(cli_path.as_deref())?;
        let version = locate::version(&path);
        Ok(CliInfo { path, version })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cli_start(
    app: AppHandle,
    registry: State<'_, CliRegistry>,
    options: StartOptions,
) -> Result<String, String> {
    registry.start(app, options).await
}

/// 原样写入一行 JSON（user 消息、control_response、interrupt 等均由前端构造）。
#[tauri::command]
pub async fn cli_send(registry: State<'_, CliRegistry>, run_id: String, message: Value) -> Result<(), String> {
    registry.send(&run_id, &message).await
}

#[tauri::command]
pub fn cli_stop(registry: State<'_, CliRegistry>, run_id: String) -> Result<(), String> {
    registry.stop(&run_id)
}
