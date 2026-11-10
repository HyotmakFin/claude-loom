//! 插件：列出 `installed_plugins.json` 中已安装的插件（只读），
//! 以及用户通过 Loom 添加、经 `--plugin-dir` 传给 CLI 的外部目录。

use std::{collections::BTreeMap, path::PathBuf};

use serde::{Deserialize, Serialize};

use crate::{config, paths};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    /// name@marketplace
    pub key: String,
    pub version: Option<String>,
    pub path: PathBuf,
    pub last_updated: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDirInfo {
    pub path: PathBuf,
    pub enabled: bool,
    /// 目录当前是否存在
    pub exists: bool,
    /// 若目录里有 `.claude-plugin/plugin.json`，读出名称与版本
    pub plugin_name: Option<String>,
    pub plugin_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginsListing {
    pub installed: Vec<InstalledPlugin>,
    pub dirs: Vec<PluginDirInfo>,
}

#[derive(Deserialize)]
struct InstalledFile {
    #[serde(default)]
    plugins: BTreeMap<String, Vec<InstalledEntry>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledEntry {
    #[serde(default)]
    install_path: Option<PathBuf>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    last_updated: Option<String>,
}

#[derive(Deserialize)]
struct PluginManifest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    version: Option<String>,
}

fn manifest(dir: &PathBuf) -> (Option<String>, Option<String>) {
    let path = dir.join(".claude-plugin").join("plugin.json");
    let Ok(text) = std::fs::read_to_string(path) else { return (None, None) };
    match serde_json::from_str::<PluginManifest>(&text) {
        Ok(m) => (m.name, m.version),
        Err(_) => (None, None),
    }
}

fn installed() -> Vec<InstalledPlugin> {
    let Ok(dir) = paths::plugins_dir() else { return vec![] };
    let Ok(text) = std::fs::read_to_string(dir.join("installed_plugins.json")) else { return vec![] };
    let Ok(file) = serde_json::from_str::<InstalledFile>(&text) else { return vec![] };
    let mut out = Vec::new();
    for (key, entries) in file.plugins {
        for e in entries {
            if let Some(path) = e.install_path {
                out.push(InstalledPlugin {
                    key: key.clone(),
                    version: e.version,
                    path,
                    last_updated: e.last_updated,
                });
            }
        }
    }
    out.sort_by(|a, b| a.key.cmp(&b.key));
    out
}

fn dirs(cfg: &config::LoomConfig) -> Vec<PluginDirInfo> {
    cfg.plugin_dirs
        .iter()
        .map(|d| {
            let (plugin_name, plugin_version) = manifest(&d.path);
            PluginDirInfo {
                exists: d.path.is_dir(),
                path: d.path.clone(),
                enabled: d.enabled,
                plugin_name,
                plugin_version,
            }
        })
        .collect()
}

#[tauri::command]
pub fn plugins_list(app: tauri::AppHandle) -> Result<PluginsListing, String> {
    let cfg = config::load(&app)?;
    Ok(PluginsListing { installed: installed(), dirs: dirs(&cfg) })
}

#[tauri::command]
pub fn plugin_add_dir(app: tauri::AppHandle, path: PathBuf) -> Result<PluginDirInfo, String> {
    if !path.is_dir() {
        return Err(format!("目录不存在：{}", path.display()));
    }
    let mut cfg = config::load(&app)?;
    if cfg.plugin_dirs.iter().any(|d| d.path == path) {
        return Err("该目录已添加".into());
    }
    cfg.plugin_dirs.push(config::PluginDir { path: path.clone(), enabled: true });
    config::save(&app, &cfg)?;
    let (plugin_name, plugin_version) = manifest(&path);
    Ok(PluginDirInfo {
        exists: true,
        path,
        enabled: true,
        plugin_name,
        plugin_version,
    })
}

#[tauri::command]
pub fn plugin_remove_dir(app: tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    let mut cfg = config::load(&app)?;
    cfg.plugin_dirs.retain(|d| d.path != path);
    config::save(&app, &cfg)
}

#[tauri::command]
pub fn plugin_toggle(app: tauri::AppHandle, path: PathBuf, enabled: bool) -> Result<(), String> {
    let mut cfg = config::load(&app)?;
    let d = cfg
        .plugin_dirs
        .iter_mut()
        .find(|d| d.path == path)
        .ok_or("该目录不在插件列表中")?;
    d.enabled = enabled;
    config::save(&app, &cfg)
}
