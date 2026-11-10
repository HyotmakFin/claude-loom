//! 会话相关命令。

use tauri::AppHandle;

use super::{index, SessionDetail, SessionSummary};
use crate::config;

#[tauri::command]
pub async fn session_list(
    app: AppHandle,
    query: Option<String>,
    include_archived: Option<bool>,
) -> Result<Vec<SessionSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        index::scan(&app, query.as_deref(), include_archived.unwrap_or(false))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn session_messages(app: AppHandle, session_id: String) -> Result<SessionDetail, String> {
    tauri::async_runtime::spawn_blocking(move || index::load_session(&app, &session_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn session_delete(app: AppHandle, session_id: String) -> Result<(), String> {
    index::delete_file(&session_id)?;
    let mut cfg = config::load(&app)?;
    cfg.session_flags.remove(&session_id);
    config::save(&app, &cfg)
}

#[tauri::command]
pub async fn session_fork(app: AppHandle, session_id: String, upto_uuid: String) -> Result<SessionSummary, String> {
    tauri::async_runtime::spawn_blocking(move || index::fork_session(&app, &session_id, &upto_uuid))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn session_delete_message(app: AppHandle, session_id: String, uuid: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || index::delete_message(&app, &session_id, &uuid))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn session_set_flag(
    app: AppHandle,
    session_id: String,
    pinned: Option<bool>,
    archived: Option<bool>,
) -> Result<(), String> {
    let mut cfg = config::load(&app)?;
    let flag = cfg.session_flags.entry(session_id).or_default();
    if let Some(p) = pinned {
        flag.pinned = p;
    }
    if let Some(a) = archived {
        flag.archived = a;
    }
    config::save(&app, &cfg)
}
