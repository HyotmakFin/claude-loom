//! Loom 自身配置：插件目录、会话置顶/归档标记、CLI 路径与默认权限模式。
//! Provider/API Key 不在这里，交给 cc-switch 或 Claude 自己的 settings.json。

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::paths;

const FILE: &str = "config.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PluginDir {
    pub path: PathBuf,
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionFlag {
    pub pinned: bool,
    pub archived: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LoomConfig {
    /// 传给 `claude --plugin-dir` 的外部插件目录
    pub plugin_dirs: Vec<PluginDir>,
    pub session_flags: HashMap<String, SessionFlag>,
    /// 指定 claude 可执行文件；为空时按 PATH 查找
    pub cli_path: Option<PathBuf>,
    /// 传给 `--permission-mode`；为空时使用 CLI 默认
    pub permission_mode: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(paths::loom_config_dir(app)?.join(FILE))
}

pub fn load(app: &AppHandle) -> Result<LoomConfig, String> {
    let path = config_path(app)?;
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(LoomConfig::default()),
        Err(e) => return Err(format!("读取配置失败：{e}")),
    };
    let cfg: LoomConfig = serde_json::from_str(&raw)
        .map_err(|e| format!("配置文件损坏（{}）：{e}", path.display()))?;

    // 旧版 BYOK 配置（profiles / activeProfileId）在这里清理掉：
    // Loom 不再保存 API Key，provider 交给 cc-switch / Claude settings。
    if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&raw) {
        if map.contains_key("profiles") || map.contains_key("activeProfileId") {
            let _ = save(app, &cfg);
        }
    }
    Ok(cfg)
}

pub fn save(app: &AppHandle, cfg: &LoomConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_vec_pretty(cfg).map_err(|e| e.to_string())?;

    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(&tmp).map_err(|e| format!("写入配置失败：{e}"))?;
    f.write_all(&data).map_err(|e| format!("写入配置失败：{e}"))?;
    f.sync_all().ok();
    drop(f);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, &path).map_err(|e| format!("替换配置失败：{e}"))
}

// ── 命令 ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn config_get(app: AppHandle) -> Result<LoomConfig, String> {
    load(&app)
}

#[tauri::command]
pub fn config_save(app: AppHandle, config: LoomConfig) -> Result<(), String> {
    save(&app, &config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_roundtrip() {
        let cfg: LoomConfig = serde_json::from_str("{}").unwrap();
        assert!(cfg.session_flags.is_empty());
        let cfg = LoomConfig {
            plugin_dirs: vec![PluginDir { path: PathBuf::from("a"), enabled: true }],
            session_flags: HashMap::from([("s".to_string(), SessionFlag { pinned: true, archived: false })]),
            permission_mode: Some("acceptEdits".into()),
            cli_path: Some(PathBuf::from("/usr/bin/claude")),
        };
        let back: LoomConfig = serde_json::from_str(&serde_json::to_string(&cfg).unwrap()).unwrap();
        assert!(back.plugin_dirs[0].enabled);
        assert!(back.session_flags["s"].pinned);
        assert_eq!(back.permission_mode.as_deref(), Some("acceptEdits"));
        assert_eq!(back.cli_path.as_deref(), Some(std::path::Path::new("/usr/bin/claude")));
        // 未知字段（包括旧版 BYOK profiles）不应导致配置无法加载
        let older: LoomConfig = serde_json::from_str(r#"{"profiles":[{"apiKey":"sk-old"}]}"#).unwrap();
        assert!(older.plugin_dirs.is_empty());
    }
}
