//! Skill 相关命令。所有操作都接收绝对目录（由 list 返回），不接受前端拼路径。

use std::path::PathBuf;

use super::{SkillDoc, SkillInfo};

#[tauri::command]
pub async fn skills_list() -> Result<Vec<SkillInfo>, String> {
    tauri::async_runtime::spawn_blocking(super::list).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn skill_doc(dir: PathBuf) -> Result<SkillDoc, String> {
    tauri::async_runtime::spawn_blocking(move || super::read(&dir)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn skill_save(dir: PathBuf, name: String, description: String, body: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || super::save(&dir, &name, &description, &body))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn skill_toggle(dir: PathBuf, enabled: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || super::toggle(&dir, enabled))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn skill_create(name: String, description: String) -> Result<SkillInfo, String> {
    tauri::async_runtime::spawn_blocking(move || super::create(&name, &description))
        .await
        .map_err(|e| e.to_string())?
}
