//! 所有 Claude Code 数据位置的唯一解析点。
//!
//! 优先使用 `CLAUDE_CONFIG_DIR`（Claude Code 官方支持的环境变量），否则回退到
//! `home_dir()/.claude`。绝不拼接字面量家目录或平台分隔符。

use std::path::PathBuf;

use serde::Serialize;
use tauri::Manager;

pub fn claude_dir() -> Result<PathBuf, String> {
    if let Some(v) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        let p = PathBuf::from(v);
        if !p.as_os_str().is_empty() {
            return Ok(p);
        }
    }
    dirs::home_dir()
        .map(|h| h.join(".claude"))
        .ok_or_else(|| "无法定位用户主目录".to_string())
}

pub fn projects_dir() -> Result<PathBuf, String> {
    Ok(claude_dir()?.join("projects"))
}

pub fn sessions_dir() -> Result<PathBuf, String> {
    Ok(claude_dir()?.join("sessions"))
}

pub fn skills_dir() -> Result<PathBuf, String> {
    Ok(claude_dir()?.join("skills"))
}

pub fn plugins_dir() -> Result<PathBuf, String> {
    Ok(claude_dir()?.join("plugins"))
}

/// Loom 自己的配置目录（由 Tauri 按平台解析：macOS Application Support、Windows AppData、Linux XDG）。
pub fn loom_config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位配置目录：{e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建配置目录：{e}"))?;
    Ok(dir)
}

pub fn ensure_dir(p: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(p).map_err(|e| format!("无法创建目录 {}：{e}", p.display()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub claude_dir: PathBuf,
    pub config_dir: PathBuf,
    pub projects_dir: PathBuf,
    pub sessions_dir: PathBuf,
    pub skills_dir: PathBuf,
    pub plugins_dir: PathBuf,
}

#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> Result<AppInfo, String> {
    Ok(AppInfo {
        claude_dir: claude_dir()?,
        config_dir: loom_config_dir(&app)?,
        projects_dir: projects_dir()?,
        sessions_dir: sessions_dir()?,
        skills_dir: skills_dir()?,
        plugins_dir: plugins_dir()?,
    })
}
