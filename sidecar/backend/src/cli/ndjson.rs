//! NDJSON 行处理。兼容 `\n` 与 `\r\n`（Windows），容忍 UTF-8 BOM 与非法 UTF-8。

use std::borrow::Cow;

const BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

/// 去掉一行末尾的 `\n` / `\r\n` 与行首 BOM；空白行返回 `None`。
pub fn trim_line(raw: &[u8]) -> Option<Cow<'_, str>> {
    let mut end = raw.len();
    if end > 0 && raw[end - 1] == b'\n' {
        end -= 1;
    }
    if end > 0 && raw[end - 1] == b'\r' {
        end -= 1;
    }
    let body = &raw[..end];
    let body = body.strip_prefix(BOM).unwrap_or(body);
    let text = String::from_utf8_lossy(body);
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

#[cfg(test)]
mod tests {
    use super::trim_line;

    #[test]
    fn lf() {
        assert_eq!(trim_line(b"{\"a\":1}\n").as_deref(), Some("{\"a\":1}"));
    }

    #[test]
    fn crlf() {
        assert_eq!(trim_line(b"{\"a\":1}\r\n").as_deref(), Some("{\"a\":1}"));
    }

    #[test]
    fn no_terminator_at_eof() {
        assert_eq!(trim_line(b"{\"a\":1}").as_deref(), Some("{\"a\":1}"));
    }

    #[test]
    fn blank_lines() {
        assert_eq!(trim_line(b"\n"), None);
        assert_eq!(trim_line(b"\r\n"), None);
        assert_eq!(trim_line(b"   \r\n"), None);
    }

    #[test]
    fn bom() {
        assert_eq!(trim_line(b"\xEF\xBB\xBF{}\r\n").as_deref(), Some("{}"));
    }

    #[test]
    fn inner_cr_kept() {
        // JSON 字符串里的回车必定被转义成 \r，裸 \r 只可能出现在行尾
        assert_eq!(trim_line(b"{\"t\":\"a\\r\\nb\"}\r\n").as_deref(), Some("{\"t\":\"a\\r\\nb\"}"));
    }
}
