//! 轻量 git 状态查询，供 HUD 显示当前分支 / dirty / ahead / behind。
use std::path::Path;
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub branch: Option<String>,
    pub dirty: bool,
    pub ahead: u32,
    pub behind: u32,
}

fn git(path: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .map_err(|e| format!("无法运行 git：{e}"))
}

pub fn info(path: &Path) -> Result<GitInfo, String> {
    let out = git(path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if !out.status.success() {
        // 不是 git 仓库：正常情况，HUD 不显示 git
        return Ok(GitInfo::default());
    }
    let branch = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let status = git(path, &["status", "--porcelain"])?;
    let dirty = !status.stdout.is_empty();

    let mut info = GitInfo {
        branch: (branch != "HEAD" && !branch.is_empty()).then_some(branch),
        dirty,
        ..GitInfo::default()
    };

    if let Ok(out) = git(path, &["rev-list", "--count", "--left-right", "@{upstream}...HEAD"]) {
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout);
            let mut it = text.split_whitespace();
            info.behind = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
            info.ahead = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        }
    }
    Ok(info)
}
