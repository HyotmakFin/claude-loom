/**
 * 单个 CLI 运行实例的状态机（纯函数，无副作用）。
 *
 *                user_sent                  can_use_tool
 *   ┌──────┐ ───────────────▶ ┌───────────┐ ─────────────▶ ┌─────────────────────┐
 *   │ idle │                  │ streaming │                │ awaiting-permission │
 *   └──────┘                  └───────────┘ ◀───────────── └─────────────────────┘
 *       ▲                       │      ▲     队列清空（用户决定 / CLI 取消）   │  ▲
 *       │                result │      │ user_sent                        └──┘
 *       │                       ▼      │                         还有排队的请求
 *       │                     ┌──────┐─┘
 *       └──── (exit) ──────── │ done │
 *                             └──────┘
 *
 * - 一个 turn 内可能有多个并行工具调用，因此 awaiting-permission 维护一个 FIFO 队列，
 *   队列清空才回到 streaming。
 * - `done` 表示一个 turn 结束；stream-json 输入模式下进程仍然存活，可继续发送下一条消息。
 * - 进程退出（exit）是正交维度，记录在 `process` 字段；任何 phase 都可能因退出而终止。
 */

import { isCanUseTool, type CanUseToolRequest, type CliMessage, type ResultMessage } from "./protocol";

export type Phase = "idle" | "streaming" | "awaiting-permission" | "done";
export type ProcessState = "spawning" | "alive" | "exited";

export interface PendingPermission {
  requestId: string;
  request: CanUseToolRequest;
  receivedAt: number;
}

export interface RunState {
  phase: Phase;
  process: ProcessState;
  sessionId: string | null;
  pending: PendingPermission[];
  lastResult: ResultMessage | null;
  exitCode: number | null;
  error: string | null;
}

export type Signal =
  | { type: "spawned" }
  | { type: "user_sent" }
  | { type: "cli_message"; msg: CliMessage; at: number }
  | { type: "permission_decided"; requestId: string }
  | { type: "exited"; code: number | null; killed: boolean }
  | { type: "failed"; error: string };

export const initialRunState: RunState = {
  phase: "idle",
  process: "spawning",
  sessionId: null,
  pending: [],
  lastResult: null,
  exitCode: null,
  error: null,
};

/** 合法的 phase 迁移表；reducer 只会产生表内的迁移。 */
export const TRANSITIONS: Record<Phase, readonly Phase[]> = {
  idle: ["streaming"],
  streaming: ["awaiting-permission", "done"],
  "awaiting-permission": ["streaming", "done"],
  done: ["streaming"],
};

function go(state: RunState, next: Phase): RunState {
  if (state.phase === next) return state;
  if (!TRANSITIONS[state.phase].includes(next)) {
    // 非法迁移保持原状态，不抛异常：CLI 协议演进时宁可少渲染一个状态也不要崩溃
    console.warn(`[loom] ignored transition ${state.phase} → ${next}`);
    return state;
  }
  return { ...state, phase: next };
}

function withPending(state: RunState, pending: PendingPermission[]): RunState {
  const next = { ...state, pending };
  if (pending.length > 0) return go(next, "awaiting-permission");
  return state.phase === "awaiting-permission" ? go(next, "streaming") : next;
}

export function canSend(s: RunState): boolean {
  return s.process === "alive" && (s.phase === "idle" || s.phase === "done");
}

export function reduce(state: RunState, signal: Signal): RunState {
  switch (signal.type) {
    case "spawned":
      return { ...state, process: "alive" };

    case "user_sent":
      return go({ ...state, lastResult: null, error: null }, "streaming");

    case "permission_decided":
      return withPending(
        state,
        state.pending.filter((p) => p.requestId !== signal.requestId),
      );

    case "exited": {
      const abnormal = !signal.killed && signal.code !== 0 && signal.code !== null;
      const midTurn = state.phase === "streaming" || state.phase === "awaiting-permission";
      return {
        ...state,
        process: "exited",
        exitCode: signal.code,
        pending: [],
        // 进程中途退出也要把 UI 从"生成中"里解放出来
        phase: midTurn ? "done" : state.phase,
        error: abnormal ? (state.error ?? `CLI 异常退出（code ${signal.code}）`) : state.error,
      };
    }

    case "failed":
      return { ...state, error: signal.error, pending: [], phase: state.phase === "idle" ? "idle" : "done" };

    case "cli_message":
      return onMessage(state, signal.msg, signal.at);
  }
}

function onMessage(state: RunState, msg: CliMessage, at: number): RunState {
  const sid = (msg as { session_id?: unknown }).session_id;
  if (typeof sid === "string" && sid && sid !== state.sessionId) {
    state = { ...state, sessionId: sid };
  }

  if (isCanUseTool(msg)) {
    if (state.pending.some((p) => p.requestId === msg.request_id)) return state;
    // 从 idle/done 收到权限请求理论上不会发生；先进入 streaming 以保持迁移表成立
    if (state.phase === "idle" || state.phase === "done") state = go(state, "streaming");
    return withPending(state, [
      ...state.pending,
      { requestId: msg.request_id, request: msg.request, receivedAt: at },
    ]);
  }

  switch (msg.type) {
    case "control_cancel_request": {
      const id = (msg as { request_id: string }).request_id;
      return withPending(
        state,
        state.pending.filter((p) => p.requestId !== id),
      );
    }
    case "result":
      return go({ ...state, pending: [], lastResult: msg as ResultMessage }, "done");
    case "assistant":
    case "stream_event":
      // CLI 在未收到输入时自行输出也视为进入 streaming；done 之后的迟到消息不重开 turn
      return state.phase === "idle" ? go(state, "streaming") : state;
    default:
      return state;
  }
}
