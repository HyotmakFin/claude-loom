//! 平台相关的小工具。
//!
//! WebKitGTK（实测 2.54）不会把 CSS 通用族 `sans-serif` / `monospace` 交给 fontconfig 解析，
//! 而是一律落到默认衬线字体。所以 Linux 下由这里调用 `fc-match`，查出用户配置的
//! sans-serif 具体对应哪个字体（拉丁、简中各查一次），前端把这些名字放到字体栈最前面。

use serde::Serialize;

#[derive(Debug, Default, Serialize)]
pub struct SystemFonts {
    /// 具体字体族名，按优先级排列；非 Linux 平台为空
    pub sans: Vec<String>,
}

#[tauri::command]
pub async fn system_fonts() -> SystemFonts {
    #[cfg(target_os = "linux")]
    {
        tauri::async_runtime::spawn_blocking(linux::resolve)
            .await
            .unwrap_or_default()
    }
    #[cfg(not(target_os = "linux"))]
    {
        SystemFonts::default()
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::SystemFonts;
    use std::process::{Command, Stdio};

    fn fc_match(pattern: &str) -> Option<String> {
        let out = Command::new("fc-match")
            .args(["-f", "%{family[0]}", pattern])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()?;
        let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (out.status.success() && !name.is_empty()).then_some(name)
    }

    pub fn resolve() -> SystemFonts {
        let mut sans = Vec::new();
        for pattern in ["sans-serif:lang=en", "sans-serif:lang=zh-cn"] {
            if let Some(f) = fc_match(pattern) {
                if !sans.contains(&f) {
                    sans.push(f);
                }
            }
        }
        SystemFonts { sans }
    }
}
