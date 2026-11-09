//! 把一行 JSONL 变成前端可渲染的消息。工具内容截断到 20k 字符，防止单条工具输出
//! 把 IPC payload 撑到几 MB。

use serde::Serialize;
use serde_json::Value;

const TOOL_CHARS: usize = 20_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolUse {
    pub id: String,
    pub name: String,
    pub input: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub tool_use_id: String,
    pub content: String,
    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    /// user | assistant | system
    pub role: String,
    pub timestamp: Option<String>,
    pub text: Option<String>,
    pub thinking: Option<String>,
    pub tool_uses: Vec<ToolUse>,
    pub tool_results: Vec<ToolResult>,
}

impl ChatMessage {
    fn new(role: &str) -> Self {
        Self {
            role: role.into(),
            timestamp: None,
            text: None,
            thinking: None,
            tool_uses: vec![],
            tool_results: vec![],
        }
    }

    pub fn is_empty(&self) -> bool {
        self.text.is_none() && self.thinking.is_none() && self.tool_uses.is_empty() && self.tool_results.is_empty()
    }
}

fn clip(s: String) -> String {
    if s.chars().count() > TOOL_CHARS {
        let mut out: String = s.chars().take(TOOL_CHARS).collect();
        out.push_str("\n…（已截断）");
        out
    } else {
        s
    }
}

fn result_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .filter_map(|it| it.get("text").and_then(Value::as_str).map(str::to_string))
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// 解析 user / assistant 行；其他类型返回 None。
pub fn entry_to_message(v: &Value) -> Option<ChatMessage> {
    let kind = v.get("type")?.as_str()?;
    if kind != "user" && kind != "assistant" {
        return None;
    }
    // 子代理（sidechain）的内容不进入主对话
    if v.get("isSidechain").and_then(Value::as_bool).unwrap_or(false) {
        return None;
    }
    let msg = v.get("message")?;
    let mut out = ChatMessage::new(kind);
    out.timestamp = v.get("timestamp").and_then(Value::as_str).map(str::to_string);

    match msg.get("content") {
        Some(Value::String(s)) => {
            if !s.trim().is_empty() {
                out.text = Some(s.clone());
            }
        }
        Some(Value::Array(blocks)) => {
            let mut texts = Vec::new();
            let mut thinking = Vec::new();
            for b in blocks {
                match b.get("type").and_then(Value::as_str).unwrap_or("") {
                    "text" => {
                        if let Some(t) = b.get("text").and_then(Value::as_str) {
                            texts.push(t.to_string());
                        }
                    }
                    "thinking" | "redacted_thinking" => {
                        if let Some(t) = b.get("thinking").and_then(Value::as_str) {
                            thinking.push(t.to_string());
                        }
                    }
                    "tool_use" => {
                        if let (Some(id), Some(name)) =
                            (b.get("id").and_then(Value::as_str), b.get("name").and_then(Value::as_str))
                        {
                            out.tool_uses.push(ToolUse {
                                id: id.to_string(),
                                name: name.to_string(),
                                input: b.get("input").cloned().unwrap_or(Value::Null),
                            });
                        }
                    }
                    "tool_result" => {
                        if let Some(id) = b.get("tool_use_id").and_then(Value::as_str) {
                            out.tool_results.push(ToolResult {
                                tool_use_id: id.to_string(),
                                content: clip(result_text(b.get("content").unwrap_or(&Value::Null))),
                                is_error: b.get("is_error").and_then(Value::as_bool).unwrap_or(false),
                            });
                        }
                    }
                    _ => {}
                }
            }
            if !texts.is_empty() {
                out.text = Some(texts.join("\n"));
            }
            if !thinking.is_empty() {
                out.thinking = Some(thinking.join("\n\n"));
            }
        }
        _ => {}
    }
    (!out.is_empty()).then_some(out)
}

/// `2026-11-09T09:43:23.100Z` → 毫秒时间戳。CLI 只会写 UTC 的 Z 结尾格式。
pub fn iso_to_millis(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, sec) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let frac = s.get(20..23).and_then(|f| f.parse::<i64>().ok()).unwrap_or(0);
    // days_from_civil (Howard Hinnant)
    let y2 = y - i64::from(mo <= 2);
    let era = if y2 >= 0 { y2 } else { y2 - 399 } / 400;
    let yoe = y2 - era * 400;
    let doy = (153 * (mo + if mo > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 24 + h) * 60 + mi) * 60_000 + sec * 1_000 + frac)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_user_and_assistant() {
        let user = json!({"type":"user","timestamp":"2026-11-09T09:43:23.100Z","message":{"role":"user","content":"你好"}});
        let m = entry_to_message(&user).unwrap();
        assert_eq!(m.role, "user");
        assert_eq!(m.text.as_deref(), Some("你好"));

        let a = json!({"type":"assistant","message":{"role":"assistant","content":[
            {"type":"thinking","thinking":"先看看"},
            {"type":"text","text":"好的"},
            {"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}});
        let m = entry_to_message(&a).unwrap();
        assert_eq!(m.thinking.as_deref(), Some("先看看"));
        assert_eq!(m.text.as_deref(), Some("好的"));
        assert_eq!(m.tool_uses[0].name, "Bash");
    }

    #[test]
    fn attaches_tool_results_and_drops_empties() {
        let u = json!({"type":"user","message":{"role":"user","content":[
            {"type":"tool_result","tool_use_id":"t1","content":[{"type":"text","text":"file.txt"}],"is_error":false}]}});
        let m = entry_to_message(&u).unwrap();
        assert!(m.text.is_none());
        assert_eq!(m.tool_results[0].content, "file.txt");

        let att = json!({"type":"attachment","attachment":{"type":"session_context"}});
        assert!(entry_to_message(&att).is_none());

        let side = json!({"type":"assistant","isSidechain":true,"message":{"role":"assistant","content":[{"type":"text","text":"x"}]}});
        assert!(entry_to_message(&side).is_none());
    }

    #[test]
    fn iso_parsing() {
        assert_eq!(iso_to_millis("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(iso_to_millis("2026-11-09T09:43:23.100Z"), Some(1_794_217_403_100));
        assert_eq!(iso_to_millis("nope"), None);
    }

    #[test]
    fn clips_huge_tool_output() {
        let big = "x".repeat(TOOL_CHARS + 10);
        let u = json!({"type":"user","message":{"role":"user","content":[
            {"type":"tool_result","tool_use_id":"t","content":big}]}});
        let m = entry_to_message(&u).unwrap();
        assert!(m.tool_results[0].content.ends_with("（已截断）"));
    }
}
