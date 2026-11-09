//! Skill 管理：扫描 `~/.claude/skills/*/SKILL.md`，解析 YAML frontmatter。
//!
//! 启停靠重命名 `SKILL.md` ↔ `SKILL.md.disabled`：Claude Code 只加载含 SKILL.md 的目录，
//! 改名后目录内不再有入口文件，不需要改 CLI 配置。

pub mod commands;
mod frontmatter;

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::paths;

pub const SKILL_FILE: &str = "SKILL.md";
pub const DISABLED_FILE: &str = "SKILL.md.disabled";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    /// 目录绝对路径（前端读写都用它，避免依赖名称）
    pub dir: PathBuf,
    /// 目录名（Skill 的稳定标识）
    pub id: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    /// 其他 frontmatter 字段（字符串形式），供编辑器展示
    pub extra: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDoc {
    pub dir: PathBuf,
    pub name: String,
    pub description: String,
    pub body: String,
    pub enabled: bool,
    pub raw: String,
}

fn skill_entry(dir: &Path) -> Option<(PathBuf, bool)> {
    let enabled = dir.join(SKILL_FILE);
    if enabled.is_file() {
        return Some((enabled, true));
    }
    let disabled = dir.join(DISABLED_FILE);
    if disabled.is_file() {
        return Some((disabled, false));
    }
    None
}

pub fn list() -> Result<Vec<SkillInfo>, String> {
    let root = paths::skills_dir()?;
    let Ok(entries) = std::fs::read_dir(&root) else { return Ok(vec![]) };
    let mut out = Vec::new();
    for e in entries.flatten() {
        let dir = e.path();
        if !dir.is_dir() {
            continue;
        }
        let Some((file, enabled)) = skill_entry(&dir) else { continue };
        let raw = std::fs::read_to_string(&file).unwrap_or_default();
        let (fields, _) = frontmatter::parse(&raw);
        let id = dir.file_name().and_then(|x| x.to_str()).unwrap_or("").to_string();
        if id.starts_with('.') {
            continue; // 隐藏目录不是 Skill
        }
        let name = fields
            .iter()
            .find(|(k, _)| k == "name")
            .map(|(_, v)| v.clone())
            .unwrap_or_else(|| id.clone());
        let description = fields
            .iter()
            .find(|(k, _)| k == "description")
            .map(|(_, v)| v.clone())
            .unwrap_or_default();
        out.push(SkillInfo {
            dir,
            id,
            name,
            description,
            enabled,
            extra: fields.into_iter().filter(|(k, _)| k != "name" && k != "description").collect(),
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

pub fn read(dir: &Path) -> Result<SkillDoc, String> {
    let (file, enabled) = skill_entry(dir).ok_or_else(|| "该目录下没有 SKILL.md".to_string())?;
    let raw = std::fs::read_to_string(&file).map_err(|e| format!("读取失败：{e}"))?;
    let (fields, body) = frontmatter::parse(&raw);
    let get = |k: &str| fields.iter().find(|(f, _)| f == k).map(|(_, v)| v.clone()).unwrap_or_default();
    let id = dir.file_name().and_then(|x| x.to_str()).unwrap_or("").to_string();
    Ok(SkillDoc {
        dir: dir.to_path_buf(),
        name: if get("name").is_empty() { id } else { get("name") },
        description: get("description"),
        body,
        enabled,
        raw,
    })
}

pub fn save(dir: &Path, name: &str, description: &str, body: &str) -> Result<(), String> {
    let (file, _) = skill_entry(dir).ok_or_else(|| "该目录下没有 SKILL.md".to_string())?;
    let content = frontmatter::build(name, description, body);
    atomic_write(&file, &content)
}

pub fn toggle(dir: &Path, enabled: bool) -> Result<(), String> {
    let (file, current) = skill_entry(dir).ok_or_else(|| "该目录下没有 SKILL.md".to_string())?;
    if current == enabled {
        return Ok(());
    }
    let target = if enabled { dir.join(SKILL_FILE) } else { dir.join(DISABLED_FILE) };
    std::fs::rename(&file, &target).map_err(|e| format!("重命名失败：{e}"))
}

pub fn create(name: &str, description: &str) -> Result<SkillInfo, String> {
    let slug: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else if c.is_whitespace() { '-' } else { '\0' })
        .filter(|c| *c != '\0')
        .collect();
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        return Err("名称至少需要包含一个字母或数字".into());
    }
    let root = paths::skills_dir()?;
    paths::ensure_dir(&root)?;
    let dir = root.join(&slug);
    if dir.exists() {
        return Err(format!("Skill 目录已存在：{}", dir.display()));
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败：{e}"))?;
    atomic_write(
        &dir.join(SKILL_FILE),
        &frontmatter::build(name.trim(), description.trim(), &format!("# {name}\n\n在这里描述这个 Skill 的使用方式。\n")),
    )?;
    list()?
        .into_iter()
        .find(|s| s.dir == dir)
        .ok_or_else(|| "创建后未能读取 Skill".to_string())
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("md.tmp");
    std::fs::write(&tmp, content).map_err(|e| format!("写入失败：{e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("保存失败：{e}"))
}

#[cfg(test)]
mod tests {
    use super::frontmatter::{build, parse};

    #[test]
    fn parses_plain_and_block_scalars() {
        let raw = "---\nname: pdf-tools\ndescription: 处理 PDF\nallowed-tools: Read, Bash\n---\n\n# 正文\n内容\n";
        let (fields, body) = parse(raw);
        assert_eq!(fields[0], ("name".into(), "pdf-tools".into()));
        assert_eq!(fields[1], ("description".into(), "处理 PDF".into()));
        assert_eq!(fields[2], ("allowed-tools".into(), "Read, Bash".into()));
        assert!(body.starts_with("# 正文"));
    }

    #[test]
    fn parses_quoted_and_folded() {
        let raw = "---\nname: \"quoted\"\ndescription: >\n  第一行\n  第二行\n---\nbody";
        let (fields, body) = parse(raw);
        assert_eq!(fields[0].1, "quoted");
        assert_eq!(fields[1].1, "第一行 第二行");
        assert_eq!(body, "body");
    }

    #[test]
    fn builds_roundtrip() {
        let raw = build("a", "多行\n描述", "# hi\n\n```js\nx\n```\n");
        let (fields, body) = parse(&raw);
        assert_eq!(fields[1].1, "多行 描述");
        assert!(body.contains("```js"));
        assert!(raw.starts_with("---\nname: a\ndescription: "));
    }

    #[test]
    fn missing_frontmatter_is_body() {
        let (fields, body) = parse("# 只有正文");
        assert!(fields.is_empty());
        assert_eq!(body, "# 只有正文");
    }
}

#[cfg(test)]
mod fs_tests {
    use super::*;

    fn tmp_skill(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("loom-skill-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(SKILL_FILE), "---\nname: x\ndescription: y\n---\nbody\n").unwrap();
        dir
    }

    #[test]
    fn toggle_renames_entry_file() {
        let dir = tmp_skill("toggle");
        toggle(&dir, false).unwrap();
        assert!(!dir.join(SKILL_FILE).exists());
        assert!(dir.join(DISABLED_FILE).exists());
        let doc = read(&dir).unwrap();
        assert!(!doc.enabled && doc.name == "x");
        toggle(&dir, true).unwrap();
        assert!(dir.join(SKILL_FILE).exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_writes_roundtrippable_doc() {
        let dir = tmp_skill("save");
        save(&dir, "new-name", "多行\n描述", "# 正文\n").unwrap();
        let doc = read(&dir).unwrap();
        assert_eq!(doc.name, "new-name");
        assert_eq!(doc.description, "多行 描述");
        assert!(doc.body.starts_with("# 正文"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
