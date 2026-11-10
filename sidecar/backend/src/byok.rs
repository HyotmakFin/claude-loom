//! 把 BYOK 的 env 合并写入 Claude Code 的 settings.json。
//!
//! Claude Code 的 settings.json `env` 优先级高于进程环境变量，只把变量传给
//! 子进程不会覆盖已有 settings。这里在每次 `cli_start` 前做一次原子合并：
//!   - 只 set 当前 profile 提供的键，删除 envRemove 中的键
//!   - 保留 hooks / statusLine / theme / 其他 env 等所有已有字段
//!   - 首次修改前备份为 settings.json.loom-backup
//!   - 文件权限 0600（可能含 API Key）
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

use serde_json::{Map, Value};

static LOCK: Mutex<()> = Mutex::new(());

fn write_secure(path: &Path, data: &[u8]) -> Result<(), String> {
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path).map_err(|e| format!("写入 {} 失败：{e}", path.display()))?;
    f.write_all(data).map_err(|e| format!("写入 {} 失败：{e}", path.display()))?;
    f.sync_all().ok();
    Ok(())
}

pub fn apply_at(path: &Path, env: &HashMap<String, String>, remove: &[String]) -> Result<bool, String> {
    if env.is_empty() && remove.is_empty() {
        return Ok(false);
    }
    let _guard = LOCK.lock().unwrap();

    let mut root: Value = match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s)
            .map_err(|e| format!("{} 不是合法 JSON，未写入：{e}", path.display()))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Value::Object(Map::new()),
        Err(e) => return Err(format!("读取 {} 失败：{e}", path.display())),
    };
    let obj = root
        .as_object_mut()
        .ok_or_else(|| format!("{} 顶层必须是 JSON 对象", path.display()))?;
    let env_value = obj.entry("env").or_insert_with(|| Value::Object(Map::new()));
    let env_obj = env_value
        .as_object_mut()
        .ok_or_else(|| format!("{} 的 env 必须是 JSON 对象", path.display()))?;

    let mut changed = false;
    for (k, v) in env {
        let want = Value::String(v.clone());
        if env_obj.get(k) != Some(&want) {
            env_obj.insert(k.clone(), want);
            changed = true;
        }
    }
    for k in remove {
        if env_obj.remove(k).is_some() {
            changed = true;
        }
    }
    if !changed {
        return Ok(false);
    }

    // 只备份一次原始文件，避免每次启动覆盖备份
    let backup = path.with_file_name("settings.json.loom-backup");
    if !backup.exists() {
        if let Ok(original) = fs::read(path) {
            write_secure(&backup, &original)?;
        }
    }

    let data = serde_json::to_vec_pretty(&root).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    write_secure(&tmp, &data)?;
    #[cfg(windows)]
    {
        // Windows 的 rename 不会覆盖已存在的目标文件
        if path.exists() {
            fs::remove_file(path).map_err(|e| format!("替换 {} 失败：{e}", path.display()))?;
        }
    }
    fs::rename(&tmp, path).map_err(|e| format!("替换 {} 失败：{e}", path.display()))?;
    Ok(true)
}

/// 写入 `$CLAUDE_CONFIG_DIR/settings.json`（未设置时为 `~/.claude/settings.json`）。
pub fn apply(env: &HashMap<String, String>, remove: &[String]) -> Result<bool, String> {
    let dir = crate::paths::claude_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建 {} 失败：{e}", dir.display()))?;
    apply_at(&dir.join("settings.json"), env, remove)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_path(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "loom-byok-{}-{}-{}.json",
            std::process::id(),
            tag,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn merges_env_and_preserves_other_settings() {
        let path = temp_path("merge");
        fs::write(
            &path,
            serde_json::to_vec_pretty(&json!({
                "theme": "dark",
                "hooks": {"PreToolUse": []},
                "env": {
                    "KEEP": "yes",
                    "CLAUDE_CODE_AUTO_MODE_SERVER": "keep",
                    "ANTHROPIC_AUTH_TOKEN": "old-token",
                    "ANTHROPIC_BASE_URL": "https://old"
                }
            }))
            .unwrap(),
        )
        .unwrap();
        let mut env = HashMap::new();
        env.insert("ANTHROPIC_BASE_URL".to_string(), "https://new".to_string());
        env.insert("ANTHROPIC_API_KEY".to_string(), "sk-new".to_string());
        let remove = vec!["ANTHROPIC_AUTH_TOKEN".to_string()];

        assert!(apply_at(&path, &env, &remove).unwrap());
        let got: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(got["theme"], "dark");
        assert_eq!(got["hooks"]["PreToolUse"], json!([]));
        assert_eq!(got["env"]["KEEP"], "yes");
        assert_eq!(got["env"]["CLAUDE_CODE_AUTO_MODE_SERVER"], "keep");
        assert_eq!(got["env"]["ANTHROPIC_BASE_URL"], "https://new");
        assert_eq!(got["env"]["ANTHROPIC_API_KEY"], "sk-new");
        assert!(got["env"].get("ANTHROPIC_AUTH_TOKEN").is_none());
        assert!(path.with_file_name("settings.json.loom-backup").exists());

        // 无变化时不重写
        assert!(!apply_at(&path, &env, &remove).unwrap());
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_file_name("settings.json.loom-backup"));
    }

    #[test]
    fn creates_missing_settings_and_rejects_bad_json() {
        let path = temp_path("create");
        let mut env = HashMap::new();
        env.insert("ANTHROPIC_MODEL".to_string(), "claude-sonnet-5-5".to_string());
        assert!(apply_at(&path, &env, &[]).unwrap());
        let got: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(got["env"]["ANTHROPIC_MODEL"], "claude-sonnet-5-5");
        let _ = fs::remove_file(&path);

        let bad = temp_path("bad");
        fs::write(&bad, "{not json").unwrap();
        assert!(apply_at(&bad, &env, &[]).is_err());
        let _ = fs::remove_file(&bad);
    }
}
