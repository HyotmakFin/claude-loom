//! Loom 自身配置：BYOK 多套配置、插件目录、会话置顶/归档标记、CLI 路径覆盖。
//! 存放于平台配置目录（`paths::loom_config_dir`），Unix 下权限 0600（内含 API Key）。

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::paths;

const FILE: &str = "config.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ModelMap {
    /// 形如 `claude-opus-4-6` 的自定义模型名；留空则沿用 CLI 默认
    pub opus: String,
    pub sonnet: String,
    pub haiku: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub models: ModelMap,
}

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
    pub active_profile_id: Option<String>,
    pub profiles: Vec<Profile>,
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
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("配置文件损坏（{}）：{e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(LoomConfig::default()),
        Err(e) => Err(format!("读取配置失败：{e}")),
    }
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
        assert!(cfg.profiles.is_empty() && cfg.session_flags.is_empty());
        let cfg = LoomConfig {
            active_profile_id: Some("p1".into()),
            profiles: vec![Profile {
                id: "p1".into(),
                name: "官方代理".into(),
                base_url: "https://example.test".into(),
                api_key: "sk-x".into(),
                models: ModelMap { sonnet: "m-s".into(), ..Default::default() },
            }],
            plugin_dirs: vec![PluginDir { path: PathBuf::from("a"), enabled: true }],
            session_flags: HashMap::from([("s".to_string(), SessionFlag { pinned: true, archived: false })]),
            permission_mode: None,
            cli_path: None,
        };
        let back: LoomConfig = serde_json::from_str(&serde_json::to_string(&cfg).unwrap()).unwrap();
        assert_eq!(back.profiles[0].models.sonnet, "m-s");
        assert!(back.session_flags["s"].pinned);
        // 未知字段不应导致配置无法加载（向前兼容）
        let older: LoomConfig = serde_json::from_str(r#"{"futureField": 1}"#).unwrap();
        assert!(older.profiles.is_empty());
    }
}
