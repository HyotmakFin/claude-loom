//! 本地文件预览：文本 / Markdown / 图片。大文件截断，二进制不读。

use std::path::{Path, PathBuf};

use serde::Serialize;

const TEXT_LIMIT: usize = 512 * 1024;
const IMAGE_LIMIT: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
    pub path: PathBuf,
    pub name: String,
    /// markdown | image | text | binary
    pub kind: String,
    pub mime: Option<String>,
    pub content: Option<String>,
    pub data_url: Option<String>,
    pub truncated: bool,
    pub size: u64,
}

fn ext_lower(p: &Path) -> String {
    p.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase()
}

fn image_mime(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        _ => return None,
    })
}

fn text_mime(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "md" | "markdown" | "mdx" => "text/markdown",
        "json" | "jsonl" => "application/json",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" | "cjs" | "jsx" => "text/javascript",
        "ts" | "tsx" => "text/typescript",
        "rs" => "text/rust",
        "py" => "text/x-python",
        "sh" | "bash" | "zsh" => "text/x-shellscript",
        "toml" => "text/toml",
        "yaml" | "yml" => "text/yaml",
        "xml" => "text/xml",
        "txt" | "log" | "csv" | "tsv" | "ini" | "conf" | "env" | "" => "text/plain",
        _ => return None,
    })
}

/// 以 base64 数据 URL 返回图片；按 (mtime, size) 缓存，避免每次刷新都重新编码。
fn image_data_url(path: &Path, mime: &str) -> Result<String, String> {
    use std::{collections::HashMap, sync::{Mutex, OnceLock}};
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, (u64, u64, String)>>> = OnceLock::new();

    fn b64(data: &[u8]) -> String {
        const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
        for chunk in data.chunks(3) {
            let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
            let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
            out.push(T[(n >> 18 & 63) as usize] as char);
            out.push(T[(n >> 12 & 63) as usize] as char);
            out.push(if chunk.len() > 1 { T[(n >> 6 & 63) as usize] as char } else { '=' });
            out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
        }
        out
    }

    let meta = std::fs::metadata(path).map_err(|e| format!("无法读取文件：{e}"))?;
    let stamp = (
        meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0),
        meta.len(),
    );
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some((m, s, url)) = cache.lock().unwrap().get(path) {
        if (*m, *s) == stamp {
            return Ok(url.clone());
        }
    }
    let data = std::fs::read(path).map_err(|e| format!("无法读取文件：{e}"))?;
    let url = format!("data:{mime};base64,{}", b64(&data));
    cache.lock().unwrap().insert(path.to_path_buf(), (stamp.0, stamp.1, url.clone()));
    Ok(url)
}

#[tauri::command]
pub async fn preview_file(path: PathBuf) -> Result<FilePreview, String> {
    tauri::async_runtime::spawn_blocking(move || read_preview(&path))
        .await
        .map_err(|e| e.to_string())?
}

pub fn read_preview(path: &Path) -> Result<FilePreview, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("无法读取文件：{e}"))?;
    if meta.is_dir() {
        return Err("这是一个目录".into());
    }
    let name = path.file_name().and_then(|x| x.to_str()).unwrap_or("").to_string();
    let ext = ext_lower(path);

    if let Some(mime) = image_mime(&ext) {
        if meta.len() > IMAGE_LIMIT {
            return Err(format!("图片超过 {} MB，未加载", IMAGE_LIMIT / 1024 / 1024));
        }
        return Ok(FilePreview {
            path: path.to_path_buf(),
            name,
            kind: "image".into(),
            mime: Some(mime.into()),
            content: None,
            data_url: Some(image_data_url(path, mime)?),
            truncated: false,
            size: meta.len(),
        });
    }

    let mime = text_mime(&ext);
    let mut data = std::fs::read(path).map_err(|e| format!("无法读取文件：{e}"))?;
    let truncated = data.len() > TEXT_LIMIT;
    if truncated {
        data.truncate(TEXT_LIMIT);
        // 回退到 UTF-8 边界，避免截断多字节字符
        while !data.is_empty() && std::str::from_utf8(&data).is_err() {
            data.pop();
        }
    }
    let Ok(text) = String::from_utf8(data) else {
        return Ok(FilePreview {
            path: path.to_path_buf(),
            name,
            kind: "binary".into(),
            mime: mime.map(str::to_string),
            content: None,
            data_url: None,
            truncated: false,
            size: meta.len(),
        });
    };
    let kind = if mime == Some("text/markdown") { "markdown" } else { "text" };
    Ok(FilePreview {
        path: path.to_path_buf(),
        name,
        kind: kind.into(),
        mime: mime.map(str::to_string),
        content: Some(text),
        data_url: None,
        truncated,
        size: meta.len(),
    })
}
