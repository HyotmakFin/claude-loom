/**
 * CLI 运行实例 store。Tauri 事件 → reducer（src/cli/machine.ts）→ Zustand。
 * 所有写 stdin 的副作用集中在这里，组件只调用 action。
 */
import { listen } from "@/lib/electron";
import { create } from "zustand";

import { initialRunState, reduce, canSend, type RunState, type Signal } from "@/cli/machine";
import {
  CLI_EVENT,
  initializeRequest,
  permissionResponse,
  userMessage,
  type CliEvent,
  type CliMessage,
  type ControlResponseIn,
  type PermissionDecision,
  type SlashCommand,
} from "@/cli/protocol";
import { errorText, ipc, type StartOptions } from "@/lib/ipc";

export interface LogEntry {
  seq: number;
  at: number;
  dir: "in" | "out" | "stderr" | "parse_error";
  payload: unknown;
}

export interface RunSlice {
  runId: string;
  state: RunState;
  /** 原始收发记录：调试面板直接展示 */
  log: LogEntry[];
  messages: CliMessage[];
  /** --include-partial-messages 的增量文本；收到完整 assistant 消息后清空 */
  partial: string;
  /** initialize 控制消息返回的可用斜杠命令 */
  commands: SlashCommand[];
}

interface RunsStore {
  runs: Record<string, RunSlice>;
  start: (opts: StartOptions) => Promise<string>;
  send: (runId: string, text: string) => Promise<void>;
  decide: (runId: string, requestId: string, decision: PermissionDecision) => Promise<void>;
  interrupt: (runId: string) => Promise<void>;
  stop: (runId: string) => Promise<void>;
  forget: (runId: string) => void;
}

const LOG_LIMIT = 2000;
let seq = 0;
/** 正在写回 stdin 的权限请求；同一请求只允许应答一次（双击、订阅回调重入都会重复触发） */
const deciding = new Set<string>();

function emptySlice(runId: string): RunSlice {
  return { runId, state: initialRunState, log: [], messages: [], partial: "", commands: [] };
}

function extractCommands(msg: CliMessage): SlashCommand[] | null {
  if (msg.type !== "control_response") return null;
  const cmds = (msg as ControlResponseIn).response?.response?.commands;
  return Array.isArray(cmds) ? cmds : null;
}

function nextPartial(cur: string, msg: CliMessage): string {
  if (msg.type === "stream_event") {
    const ev = (msg as { event?: { type?: string; delta?: { type?: string; text?: string } } }).event;
    if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") return cur + (ev.delta.text ?? "");
  }
  if (msg.type === "assistant" || msg.type === "result") return "";
  return cur;
}

export const useRuns = create<RunsStore>((set, get) => {
  const apply = (runId: string, signal: Signal | null, entry?: Omit<LogEntry, "seq" | "at">, msg?: CliMessage) =>
    set((s) => {
      const cur = s.runs[runId] ?? emptySlice(runId);
      const log = entry ? [...cur.log, { ...entry, seq: ++seq, at: Date.now() }].slice(-LOG_LIMIT) : cur.log;
      return {
        runs: {
          ...s.runs,
          [runId]: {
            ...cur,
            state: signal ? reduce(cur.state, signal) : cur.state,
            log,
            messages: msg ? [...cur.messages, msg] : cur.messages,
            partial: msg ? nextPartial(cur.partial, msg) : cur.partial,
            commands: msg ? (extractCommands(msg) ?? cur.commands) : cur.commands,
          },
        },
      };
    });

  const write = async (runId: string, payload: unknown) => {
    apply(runId, null, { dir: "out", payload });
    await ipc.cliSend(runId, payload);
  };

  // Rust 侧事件只订阅一次，按 runId 分发
  void listen<CliEvent>(CLI_EVENT, ({ payload: ev }) => {
    switch (ev.kind) {
      case "spawned":
        return apply(ev.runId, { type: "spawned" });
      case "message":
        return apply(ev.runId, { type: "cli_message", msg: ev.msg, at: Date.now() }, { dir: "in", payload: ev.msg }, ev.msg);
      case "stderr":
        return apply(ev.runId, null, { dir: "stderr", payload: ev.text });
      case "parse_error":
        return apply(ev.runId, null, { dir: "parse_error", payload: ev.text });
      case "exit":
        return apply(ev.runId, { type: "exited", code: ev.code, killed: ev.killed });
    }
  });

  return {
    runs: {},

    async start(opts) {
      const runId = await ipc.cliStart(opts);
      // spawned 事件可能先于 invoke 返回到达，apply 会按需创建 slice
      apply(runId, null);
      // 等 spawned 事件落库，避免紧随其后的 send 因 process=spawning 被拒
      for (let i = 0; i < 60; i++) {
        if (get().runs[runId]?.state.process === "alive") break;
        await new Promise((r) => setTimeout(r, 50));
      }
      // 拉取斜杠命令列表（本地控制消息，不产生模型请求）
      void write(runId, initializeRequest()).catch(() => {});
      return runId;
    },

    async send(runId, text) {
      const run = get().runs[runId];
      if (!run || !canSend(run.state)) throw new Error("当前状态不能发送消息");
      set((s) => ({ runs: { ...s.runs, [runId]: { ...s.runs[runId]!, partial: "" } } }));
      apply(runId, { type: "user_sent" });
      try {
        await write(runId, userMessage(text, run.state.sessionId));
      } catch (e) {
        apply(runId, { type: "failed", error: errorText(e) });
        throw e;
      }
    },

    async decide(runId, requestId, decision) {
      const run = get().runs[runId];
      if (!run?.state.pending.some((p) => p.requestId === requestId)) return; // 已应答或已被 CLI 取消
      const key = `${runId}:${requestId}`;
      if (deciding.has(key)) return;
      deciding.add(key);
      try {
        await write(runId, permissionResponse(requestId, decision));
        apply(runId, { type: "permission_decided", requestId });
      } finally {
        deciding.delete(key);
      }
    },

    async interrupt(runId) {
      const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      await write(runId, { type: "control_request", request_id: requestId, request: { subtype: "interrupt" } });
    },

    async stop(runId) {
      await ipc.cliStop(runId);
    },

    forget(runId) {
      set((s) => {
        const { [runId]: _, ...rest } = s.runs;
        return { runs: rest };
      });
    },
  };
});
