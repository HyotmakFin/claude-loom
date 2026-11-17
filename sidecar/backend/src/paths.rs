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

pub fn session_backups_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(loom_config_dir(app)?.join("session-backups"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStats {
    pub dir: String,
    pub files: usize,
    pub bytes: u64,
}

fn backup_files(app: &tauri::AppHandle) -> Result<Vec<(PathBuf, u64, std::time::SystemTime)>, String> {
    let dir = session_backups_dir(app)?;
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(out);
    };
    for e in entries.flatten() {
        let path = e.path();
        let Ok(meta) = e.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let modified = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        out.push((path, meta.len(), modified));
    }
    Ok(out)
}

pub fn backup_stats(app: &tauri::AppHandle) -> Result<BackupStats, String> {
    let dir = session_backups_dir(app)?;
    let files = backup_files(app)?;
    Ok(BackupStats {
        dir: dir.display().to_string(),
        files: files.len(),
        bytes: files.iter().map(|(_, size, _)| *size).sum(),
    })
}

/// 删除会话 JSONL 备份。`older_than_days` 为 None 时全部删除；
/// 否则只删除修改时间早于该天数的文件。
pub fn backup_clean(app: &tauri::AppHandle, older_than_days: Option<u64>) -> Result<BackupStats, String> {
    let cutoff = older_than_days.map(|days| {
        std::time::SystemTime::now()
            .checked_sub(std::time::Duration::from_secs(days.saturating_mul(86_400)))
    });
    let files = backup_files(app)?;
    let mut removed = 0usize;
    let mut bytes = 0u64;
    for (path, size, modified) in files {
        if let Some(Some(cutoff)) = cutoff {
            if modified >= cutoff {
                continue;
            }
        }
        std::fs::remove_file(&path).map_err(|e| format!("删除备份失败 {}：{e}", path.display()))?;
        removed += 1;
        bytes += size;
    }
    let dir = session_backups_dir(app)?;
    Ok(BackupStats {
        dir: dir.display().to_string(),
        files: removed,
        bytes,
    })
}

/// Claude settings.json 中 provider 相关部分的版本标记。
/// 只哈希 env 与顶层 model，避免 CLI 改主题等无关字段导致误重启。
pub fn claude_settings_stamp() -> String {
    use std::hash::{Hash, Hasher};
    let Some(path) = claude_dir().ok().map(|d| d.join("settings.json")) else {
        return "none".to_string();
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return "none".to_string();
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return "invalid".to_string();
    };
    let mut h = std::collections::hash_map::DefaultHasher::new();
    v.get("env").map(|x| x.to_string()).unwrap_or_default().hash(&mut h);
    v.get("model").map(|x| x.to_string()).unwrap_or_default().hash(&mut h);
    format!("{:x}", h.finish())
}

/// 当前 Claude settings 里用于新请求的模型。
/// resume 会沿用会话里上一次的模型；切换 provider 时必须用 --model 覆盖。
pub fn claude_settings_model() -> Option<String> {
    let path = claude_dir().ok()?.join("settings.json");
    let text = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let get = |k: &str| {
        v.get("env")
            .and_then(|e| e.get(k))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    if let Some(model) = get("ANTHROPIC_MODEL")
        .or_else(|| get("ANTHROPIC_DEFAULT_OPUS_MODEL"))
        .or_else(|| get("ANTHROPIC_DEFAULT_SONNET_MODEL"))
        .or_else(|| {
            v.get("model")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        })
    {
        return Some(model);
    }
    // 留空 = 显式使用 Claude Code 默认模型，避免 resume 沿用会话旧模型
    Some("default".to_string())
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
