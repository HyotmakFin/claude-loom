//! Claude Code CLI 进程层：定位可执行文件、spawn、双向 NDJSON。
//!
//! Rust 侧刻意保持"哑管道"：只负责把 stdout 的每一行解析成 JSON 原样转发给前端，
//! 把前端给的 JSON 写回 stdin。会话状态机（idle → streaming → awaiting-permission →
//! streaming → done）完全在前端 `src/cli/machine.ts` 中维护。
//! 唯一例外：CLI 发来的、Loom 不支持的 control_request 子类型会被这里直接回复 error，
//! 避免 CLI 永久等待。

pub mod commands;
pub mod locate;
pub mod ndjson;
mod process;

pub use process::CliRegistry;
