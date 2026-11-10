//! 会话索引：读取 `~/.claude/projects/<项目>/<sessionId>.jsonl` 历史与
//! `~/.claude/sessions/*.json` 运行中进程元数据。
//!
//! JSONL 中真正有用的行：`user` / `assistant`（message）、`ai-title`、`last-prompt`。
//! 其余（attachment、api-request、file-history-snapshot …）忽略。

pub mod commands;
mod index;
mod parse;

pub use index::{SessionDetail, SessionSummary};
