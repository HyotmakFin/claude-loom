/**
 * Claude Code CLI stream-json 协议（`-p --input-format stream-json --output-format stream-json`）。
 * 只声明 Loom 用到的字段；其余字段通过索引签名保留，便于调试面板原样展示。
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

// ── CLI → Loom（stdout）────────────────────────────────────────────

export interface SystemInit {
  type: "system";
  subtype: "init";
  session_id: string;
  cwd?: string;
  model?: string;
  permissionMode?: string;
  tools?: string[];
  [k: string]: unknown;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: string; [k: string]: unknown };

export interface AssistantMessage {
  type: "assistant";
  session_id?: string;
  parent_tool_use_id?: string | null;
  message: { id?: string; role: "assistant"; content: ContentBlock[]; model?: string; [k: string]: unknown };
}

export interface UserEcho {
  type: "user";
  session_id?: string;
  parent_tool_use_id?: string | null;
  message: { role: "user"; content: string | ContentBlock[] };
}

export interface ResultMessage {
  type: "result";
  subtype: string; // "success" | "error_max_turns" | "error_during_execution" | …
  is_error: boolean;
  result?: string;
  session_id?: string;
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  [k: string]: unknown;
}

export interface StreamEvent {
  type: "stream_event";
  event: { type: string; [k: string]: unknown };
  session_id?: string;
  parent_tool_use_id?: string | null;
}

export interface PermissionSuggestion {
  type: string;
  [k: string]: unknown;
}

export interface CanUseToolRequest {
  subtype: "can_use_tool";
  tool_name: string;
  input: Record<string, unknown>;
  tool_use_id?: string;
  permission_suggestions?: PermissionSuggestion[];
  blocked_path?: string;
  decision_reason?: string;
  [k: string]: unknown;
}

export interface ControlRequest {
  type: "control_request";
  request_id: string;
  request: CanUseToolRequest | { subtype: string; [k: string]: unknown };
}

export interface ControlCancelRequest {
  type: "control_cancel_request";
  request_id: string;
}

export interface SlashCommand {
  name: string;
  description?: string;
  argumentHint?: string;
  aliases?: string[];
  builtin?: boolean;
}

export interface ControlResponseIn {
  type: "control_response";
  response: {
    subtype: "success" | "error";
    request_id: string;
    response?: { commands?: SlashCommand[]; [k: string]: unknown };
    [k: string]: unknown;
  };
}

/** 向 CLI 请求可用命令（initialize 控制消息）。 */
export function initializeRequest() {
  return {
    type: "control_request",
    request_id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    request: { subtype: "initialize" },
  };
}

export type CliMessage =
  | SystemInit
  | AssistantMessage
  | UserEcho
  | ResultMessage
  | StreamEvent
  | ControlRequest
  | ControlCancelRequest
  | ControlResponseIn
  | { type: string; [k: string]: unknown };

export function isCanUseTool(m: CliMessage): m is ControlRequest & { request: CanUseToolRequest } {
  return m.type === "control_request" && (m as ControlRequest).request?.subtype === "can_use_tool";
}

// ── Rust → 前端事件（src-tauri/src/cli/process.rs 的 CliEvent）──────────

export const CLI_EVENT = "loom://cli";

export type CliEvent =
  | { kind: "spawned"; runId: string; pid: number | null; cliPath: string }
  | { kind: "message"; runId: string; msg: CliMessage }
  | { kind: "parse_error"; runId: string; text: string }
  | { kind: "stderr"; runId: string; text: string }
  | { kind: "exit"; runId: string; code: number | null; killed: boolean };

// ── Loom → CLI（stdin）─────────────────────────────────────────────

export function userMessage(text: string, sessionId: string | null) {
  return {
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
    parent_tool_use_id: null,
    session_id: sessionId ?? "",
  };
}

export type PermissionDecision =
  | {
      behavior: "allow";
      /** 用户可在确认前修改工具入参；未修改时原样回传 */
      updatedInput: Record<string, unknown>;
      /** 选择"始终允许"时回传 CLI 给出的 permission_suggestions */
      updatedPermissions?: PermissionSuggestion[];
    }
  | { behavior: "deny"; message: string; interrupt?: boolean };

export function permissionResponse(requestId: string, decision: PermissionDecision) {
  return {
    type: "control_response",
    response: { subtype: "success", request_id: requestId, response: decision },
  };
}
