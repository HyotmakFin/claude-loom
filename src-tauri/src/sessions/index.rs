//! 会话索引：扫描 projects 目录，合并 sessions 目录中的运行中记录。
//! 单文件解析结果按 (mtime, size) 缓存，列表刷新不会重复解析 4MB 的胖文件。

use std::{
    collections::HashMap,
    fs::File,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::SystemTime,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::parse::{entry_to_message, iso_to_millis, ChatMessage};
use crate::{cli::ndjson, config, paths};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSession {
    pub pid: u32,
    pub status: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub project_path: Option<String>,
    pub git_branch: Option<String>,
    pub created_at: Option<i64>,
    pub updated_at: i64,
    pub message_count: u32,
    pub last_prompt: Option<String>,
    pub live: Option<LiveSession>,
    pub pinned: bool,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    pub session: SessionSummary,
    pub messages: Vec<ChatMessage>,
}

#[derive(Default, Clone)]
struct Index {
    title: Option<String>,
    last_prompt: Option<String>,
    cwd: Option<String>,
    branch: Option<String>,
    first: Option<i64>,
    last: Option<i64>,
    messages: u32,
    preview: Option<String>,
}

struct Cached {
    mtime: u64,
    size: u64,
    index: Index,
}

fn cache() -> &'static Mutex<HashMap<PathBuf, Cached>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Cached>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn file_stamp(path: &Path) -> Option<(u64, u64)> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some((mtime, meta.len()))
}

fn clip(s: &str, n: usize) -> String {
    let t = s.trim();
    if t.chars().count() > n {
        format!("{}…", t.chars().take(n).collect::<String>())
    } else {
        t.to_string()
    }
}

fn index_file(path: &Path) -> Index {
    let stamp = file_stamp(path);
    if let Some((mtime, size)) = stamp {
        if let Some(c) = cache().lock().unwrap().get(path) {
            if c.mtime == mtime && c.size == size {
                return c.index.clone();
            }
        }
    }

    let mut idx = Index::default();
    if let Ok(f) = File::open(path) {
        let mut reader = BufReader::with_capacity(64 * 1024, f);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let Some(line) = ndjson::trim_line(&buf) else { continue };
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            match v.get("type").and_then(Value::as_str).unwrap_or("") {
                "ai-title" => {
                    if let Some(t) = v.get("aiTitle").and_then(Value::as_str) {
                        idx.title = Some(t.trim().to_string());
                    }
                }
                "last-prompt" => {
                    if let Some(t) = v.get("lastPrompt").and_then(Value::as_str) {
                        idx.last_prompt = Some(t.trim().to_string());
                    }
                }
                _ => {
                    if let Some(m) = entry_to_message(&v) {
                        if m.role == "user" && m.text.is_some() && idx.preview.is_none() {
                            idx.preview = m.text.as_deref().map(|t| clip(t, 80));
                        }
                        if m.role == "user" && m.text.is_some()
                            || m.role == "assistant" && (!m.tool_uses.is_empty() || m.text.is_some())
                        {
                            idx.messages += 1;
                        }
                        if let Some(ts) = v.get("timestamp").and_then(Value::as_str).and_then(iso_to_millis) {
                            idx.first = Some(idx.first.map_or(ts, |f| f.min(ts)));
                            idx.last = Some(idx.last.map_or(ts, |l| l.max(ts)));
                        }
                    }
                    if idx.cwd.is_none() {
                        if let Some(c) = v.get("cwd").and_then(Value::as_str) {
                            idx.cwd = Some(c.to_string());
                        }
                    }
                    if idx.branch.is_none() {
                        if let Some(b) = v.get("gitBranch").and_then(Value::as_str) {
                            idx.branch = Some(b.to_string());
                        }
                    }
                }
            }
        }
    }

    if let Some((mtime, size)) = stamp {
        cache().lock().unwrap().insert(path.to_path_buf(), Cached { mtime, size, index: idx.clone() });
    }
    idx
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionRecord {
    session_id: Option<String>,
    pid: Option<u32>,
    cwd: Option<String>,
    status: Option<String>,
    name: Option<String>,
    updated_at: Option<i64>,
    started_at: Option<i64>,
}

/// 进程是否仍存活。Unix 用 kill(pid, 0)；其他平台无法低成本判断，沿用记录状态。
fn pid_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        if pid == 0 {
            return false;
        }
        // pid 可能被复用，但对会话列表来说误判概率很低
        unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        true
    }
}

fn live_sessions() -> HashMap<String, (LiveSession, Option<String>, Option<i64>)> {
    let mut map = HashMap::new();
    let Ok(dir) = paths::sessions_dir() else { return map };
    let Ok(entries) = std::fs::read_dir(dir) else { return map };
    for e in entries.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&p) else { continue };
        let Ok(rec) = serde_json::from_str::<SessionRecord>(&text) else { continue };
        let Some(id) = rec.session_id else { continue };
        let pid = rec.pid.unwrap_or(0);
        // 进程被强制结束后，~/.claude/sessions 里的记录可能残留；不要把它们当成运行中
        if pid > 0 && !pid_alive(pid) {
            continue;
        }
        let live = LiveSession {
            pid,
            status: rec.status.unwrap_or_else(|| "unknown".into()),
            name: rec.name,
        };
        map.insert(id, (live, rec.cwd, rec.updated_at.or(rec.started_at)));
    }
    map
}

fn project_dir_label(path: &Path) -> Option<String> {
    // 目录名是 cwd 把 '/' 换成 '-' 的结果：-home-user-Documents-loom。
    // 只在 JSONL 中没有 cwd 字段时兜底展示；路径本身含 '-' 时可能解析不完美。
    let name = path.file_name()?.to_str()?;
    let stripped = name.strip_prefix('-')?;
    Some(format!("/{}", stripped.replace('-', "/")))
}

fn list_jsonl(projects: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let Ok(dirs) = std::fs::read_dir(projects) else { return out };
    for d in dirs.flatten() {
        let dir = d.path();
        if !dir.is_dir() {
            continue;
        }
        let Ok(files) = std::fs::read_dir(&dir) else { continue };
        for f in files.flatten() {
            let p = f.path();
            if p.is_file() && p.extension().and_then(|x| x.to_str()) == Some("jsonl") {
                if let Some(stem) = p.file_stem().and_then(|x| x.to_str()) {
                    out.push((stem.to_string(), p));
                }
            }
        }
    }
    out
}

fn content_matches(path: &Path, needle: &str) -> bool {
    let Ok(meta) = std::fs::metadata(path) else { return false };
    if meta.len() > 32 * 1024 * 1024 {
        return false;
    }
    std::fs::read_to_string(path)
        .map(|s| s.to_lowercase().contains(needle))
        .unwrap_or(false)
}

pub fn scan(app: &tauri::AppHandle, query: Option<&str>, include_archived: bool) -> Result<Vec<SessionSummary>, String> {
    let cfg = config::load(app)?;
    let live = live_sessions();
    let projects = paths::projects_dir()?;
    let needle = query.map(|q| q.trim().to_lowercase()).filter(|q| !q.is_empty());

    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for (id, path) in list_jsonl(&projects) {
        let idx = index_file(&path);
        let flag = cfg.session_flags.get(&id).copied().unwrap_or_default();
        let title = idx
            .title
            .clone()
            .filter(|t| !t.is_empty())
            .or_else(|| idx.last_prompt.clone().map(|p| clip(&p, 60)))
            .or_else(|| idx.preview.clone())
            .unwrap_or_else(|| format!("会话 {}", &id[..id.len().min(8)]));
        let summary = SessionSummary {
            id: id.clone(),
            title,
            project_path: idx.cwd.clone().or_else(|| project_dir_label(&path.parent().unwrap_or(Path::new("")))),
            git_branch: idx.branch.clone(),
            created_at: idx.first,
            updated_at: idx.last.unwrap_or_else(|| file_stamp(&path).map(|(m, _)| m as i64).unwrap_or(0)),
            message_count: idx.messages,
            last_prompt: idx.last_prompt.clone(),
            live: live.get(&id).map(|(l, _, _)| l.clone()),
            pinned: flag.pinned,
            archived: flag.archived,
        };
        seen.insert(id);
        out.push(summary);
        if let Some(q) = &needle {
            let hit = out.last().unwrap().title.to_lowercase().contains(q)
                || out.last().unwrap().last_prompt.as_deref().unwrap_or("").to_lowercase().contains(q)
                || content_matches(&path, q);
            if !hit {
                out.pop();
            }
        }
    }

    // 只有运行记录、还没有 JSONL 的会话（例如刚启动）也列出来
    for (id, (l, cwd, updated)) in &live {
        if seen.contains(id) {
            continue;
        }
        if let Some(q) = &needle {
            let name = l.name.clone().unwrap_or_default().to_lowercase();
            if !name.contains(q) {
                continue;
            }
        }
        let flag = cfg.session_flags.get(id).copied().unwrap_or_default();
        out.push(SessionSummary {
            id: id.clone(),
            title: l.name.clone().unwrap_or_else(|| format!("会话 {}", &id[..id.len().min(8)])),
            project_path: cwd.clone(),
            git_branch: None,
            created_at: *updated,
            updated_at: updated.unwrap_or(0),
            message_count: 0,
            last_prompt: None,
            live: Some(l.clone()),
            pinned: flag.pinned,
            archived: flag.archived,
        });
    }

    out.retain(|s| include_archived || !s.archived);
    out.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.updated_at.cmp(&a.updated_at)));
    Ok(out)
}

fn find_file(session_id: &str) -> Result<PathBuf, String> {
    if session_id.is_empty()
        || !session_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("非法的会话 ID".into());
    }
    let projects = paths::projects_dir()?;
    for (id, path) in list_jsonl(&projects) {
        if id == session_id {
            return Ok(path);
        }
    }
    Err(format!("找不到会话 {session_id} 的记录文件"))
}

fn summary_for(app: &tauri::AppHandle, id: &str, path: &Path) -> Result<SessionSummary, String> {
    let idx = index_file(path);
    let cfg = config::load(app)?;
    let flag = cfg.session_flags.get(id).copied().unwrap_or_default();
    let title = idx
        .title
        .clone()
        .or_else(|| idx.last_prompt.clone().map(|p| clip(&p, 60)))
        .or_else(|| idx.preview.clone())
        .unwrap_or_else(|| format!("会话 {}", &id[..id.len().min(8)]));
    Ok(SessionSummary {
        id: id.to_string(),
        title,
        project_path: idx.cwd.clone(),
        git_branch: idx.branch.clone(),
        created_at: idx.first,
        updated_at: idx.last.unwrap_or(0),
        message_count: idx.messages,
        last_prompt: idx.last_prompt.clone(),
        live: live_sessions().get(id).map(|(l, _, _)| l.clone()),
        pinned: flag.pinned,
        archived: flag.archived,
    })
}

pub fn load_session(app: &tauri::AppHandle, session_id: &str) -> Result<SessionDetail, String> {
    let path = find_file(session_id)?;
    let file = File::open(&path).map_err(|e| format!("无法读取会话文件：{e}"))?;
    let mut reader = BufReader::with_capacity(64 * 1024, file);
    let mut buf = Vec::new();
    let mut messages = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let Some(line) = ndjson::trim_line(&buf) else { continue };
        if let Ok(v) = serde_json::from_str::<Value>(&line) {
            if let Some(m) = entry_to_message(&v) {
                messages.push(m);
            }
        }
    }
    Ok(SessionDetail { session: summary_for(app, session_id, &path)?, messages })
}

pub fn delete_file(session_id: &str) -> Result<(), String> {
    let path = find_file(session_id)?;
    std::fs::remove_file(&path).map_err(|e| format!("删除失败：{e}"))?;
    cache().lock().unwrap().remove(&path);
    Ok(())
}
