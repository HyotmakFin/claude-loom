//! 从 BYOK 上游拉取模型列表（OpenAI / Anthropic 兼容的 /models）。
use std::collections::BTreeSet;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelList {
    pub endpoint: String,
    pub models: Vec<String>,
}

fn candidates(base: &str) -> Vec<String> {
    let b = base.trim().trim_end_matches('/');
    let mut roots = vec![b.to_string()];
    for suffix in ["/v1/messages", "/messages", "/anthropic", "/v1"] {
        if let Some(r) = b.strip_suffix(suffix) {
            roots.push(r.trim_end_matches('/').to_string());
        }
    }
    let mut out: Vec<String> = Vec::new();
    let mut push = |u: String| {
        if !u.is_empty() && !out.contains(&u) {
            out.push(u);
        }
    };
    if b.ends_with("/v1") {
        push(format!("{b}/models"));
    }
    if b.ends_with("/anthropic") {
        push(format!("{b}/v1/models"));
    }
    for root in roots {
        push(format!("{root}/v1/models"));
        push(format!("{root}/models"));
    }
    push(format!("{b}/v1/models"));
    push(format!("{b}/models"));
    out
}

fn add_model(set: &mut BTreeSet<String>, item: &Value) {
    let id = item
        .as_str()
        .map(str::to_string)
        .or_else(|| item.get("id").and_then(Value::as_str).map(str::to_string))
        .or_else(|| item.get("name").and_then(Value::as_str).map(str::to_string));
    if let Some(id) = id {
        if !id.trim().is_empty() {
            set.insert(id);
        }
    }
}

fn extract(v: &Value) -> Vec<String> {
    let mut set = BTreeSet::new();
    if let Some(arr) = v.get("data").and_then(Value::as_array) {
        for item in arr {
            add_model(&mut set, item);
        }
    }
    if let Some(arr) = v.get("models").and_then(Value::as_array) {
        for item in arr {
            add_model(&mut set, item);
        }
    }
    if let Some(arr) = v.pointer("/data/models").and_then(Value::as_array) {
        for item in arr {
            add_model(&mut set, item);
        }
    }
    set.into_iter().collect()
}

pub async fn fetch(base: &str, api_key: &str) -> Result<ModelList, String> {
    let base = base.trim();
    if base.is_empty() {
        return Err("请先填写请求地址".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败：{e}"))?;

    let key = api_key.trim();
    let mut last = String::new();
    for url in candidates(base) {
        let mut req = client
            .get(&url)
            .header("accept", "application/json")
            .header("anthropic-version", "2023-06-01")
            .header("user-agent", "claude-code/loom");
        if !key.is_empty() {
            req = req
                .header("authorization", format!("Bearer {key}"))
                .header("x-api-key", key);
        }
        match req.send().await {
            Ok(resp) => {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                if !status.is_success() {
                    last = format!("{url} → HTTP {} {}", status.as_u16(), text.chars().take(160).collect::<String>());
                    continue;
                }
                let value: Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(_) => {
                        last = format!("{url} 返回的不是 JSON");
                        continue;
                    }
                };
                let models = extract(&value);
                if !models.is_empty() {
                    return Ok(ModelList { endpoint: url, models });
                }
                last = format!("{url} 的响应里没有模型列表");
            }
            Err(e) => {
                last = format!("{url} → {e}");
            }
        }
    }
    Err(if last.is_empty() { "无法连接模型列表接口".to_string() } else { last })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_openai_and_anthropic_shapes() {
        let openai = serde_json::json!({"data":[{"id":"claude-sonnet-4-5"},{"id":"claude-opus-4-8"}]});
        assert_eq!(extract(&openai), vec!["claude-opus-4-8", "claude-sonnet-4-5"]);
        let anthropic = serde_json::json!({"data":[{"id":"deepseek-flash","display_name":"DeepSeek"}]});
        assert_eq!(extract(&anthropic), vec!["deepseek-flash"]);
        let plain = serde_json::json!({"models":["a","b"]});
        assert_eq!(extract(&plain), vec!["a", "b"]);
    }

    #[test]
    fn builds_expected_candidates() {
        let c = candidates("https://www.micuapi.ai");
        assert!(c.contains(&"https://www.micuapi.ai/v1/models".to_string()));
        let d = candidates("https://api.deepseek.com/anthropic");
        assert!(d.contains(&"https://api.deepseek.com/v1/models".to_string()));
        assert!(d.contains(&"https://api.deepseek.com/models".to_string()));
    }
}
