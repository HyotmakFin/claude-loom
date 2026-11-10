/** 从 CLI 事件 / 历史消息里提取 HUD 需要的数据：模型、上下文用量。 */
import type { AssistantMessage, ResultMessage, SystemInit } from "@/cli/protocol";
import type { ChatMessage, LoomConfig, TokenUsage } from "./types";
import type { RunSlice } from "@/stores/runs";

export interface ContextInfo {
  used: number;
  window: number;
  percent: number;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 兼容 JSONL（camelCase）与 CLI stream-json（snake_case）两种 usage。 */
function usageFrom(v: unknown): TokenUsage | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const has =
    "input_tokens" in o || "inputTokens" in o || "cache_read_input_tokens" in o || "cacheReadInputTokens" in o;
  if (!has) return null;
  return {
    inputTokens: num(o.input_tokens) || num(o.inputTokens),
    outputTokens: num(o.output_tokens) || num(o.outputTokens),
    cacheCreationInputTokens: num(o.cache_creation_input_tokens) || num(o.cacheCreationInputTokens),
    cacheReadInputTokens: num(o.cache_read_input_tokens) || num(o.cacheReadInputTokens),
  };
}

function windowFromResult(msg: ResultMessage, model: string | null): number | undefined {
  const mu = (msg as { modelUsage?: Record<string, Record<string, unknown>> }).modelUsage;
  if (!mu || typeof mu !== "object") return undefined;
  const keys = Object.keys(mu);
  const key = (model && keys.find((k) => k === model || model.includes(k) || k.includes(model))) ?? keys[0];
  const w = key ? mu[key]?.contextWindow : undefined;
  return typeof w === "number" && w > 0 ? w : undefined;
}

export function modelOf(run?: RunSlice, history?: ChatMessage[]): string | null {
  if (run) {
    for (let i = run.messages.length - 1; i >= 0; i--) {
      const m = run.messages[i]!;
      if (m.type === "assistant") {
        const model = (m as AssistantMessage).message?.model;
        if (typeof model === "string" && model) return model;
      }
      if (m.type === "system" && (m as SystemInit).subtype === "init") {
        const model = (m as SystemInit).model;
        if (typeof model === "string" && model) return model;
      }
    }
  }
  if (history) {
    for (let i = history.length - 1; i >= 0; i--) {
      const model = history[i]!.model;
      if (typeof model === "string" && model) return model;
    }
  }
  return null;
}

export function usageOf(
  run?: RunSlice,
  history?: ChatMessage[],
): { usage: TokenUsage; model: string | null; window?: number } | null {
  if (run) {
    for (let i = run.messages.length - 1; i >= 0; i--) {
      const m = run.messages[i]!;
      if (m.type === "assistant") {
        const a = m as AssistantMessage;
        const usage = usageFrom((a.message as { usage?: unknown } | undefined)?.usage);
        if (usage) return { usage, model: a.message?.model ?? modelOf(run, history) };
      }
      if (m.type === "result") {
        const r = m as ResultMessage;
        const usage = usageFrom((r as { usage?: unknown }).usage);
        if (usage) {
          return {
            usage,
            model: modelOf(run, history),
            window: windowFromResult(r, modelOf(run, history)),
          };
        }
      }
    }
  }
  if (history) {
    for (let i = history.length - 1; i >= 0; i--) {
      const usage = history[i]!.usage;
      if (usage) return { usage, model: history[i]!.model ?? modelOf(undefined, history) };
    }
  }
  return null;
}

function inferWindow(model: string | null, used: number, cfg: LoomConfig): number {
  if (model && /\[1m\]|(^|[^0-9])1m([^0-9]|$)/i.test(model)) return 1_000_000;
  const profile = cfg.profiles.find((p) => p.id === cfg.activeProfileId);
  if (profile && model) {
    const roles = ["opus", "sonnet", "fable", "haiku", "subagent", "fallback"] as const;
    for (const role of roles) {
      const name = profile.models[role]?.trim();
      if (!name) continue;
      if (model.includes(name) || name.includes(model)) {
        const million = profile.models[`${role}Million` as keyof typeof profile.models] as boolean;
        return million ? 1_000_000 : 200_000;
      }
    }
  }
  // 超过 200k 说明只能是更大的窗口；否则按 200k 估
  return used > 200_000 ? 1_000_000 : 200_000;
}

export function contextOf(run?: RunSlice, history?: ChatMessage[], cfg?: LoomConfig): ContextInfo | null {
  const found = usageOf(run, history);
  if (!found || !cfg) return null;
  const u = found.usage;
  const used = u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens;
  if (used <= 0) return null;
  const window = found.window ?? inferWindow(found.model, used, cfg);
  return { used, window, percent: Math.min(100, (used / window) * 100) };
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** 原始 model id → 紧凑显示名；未知格式原样返回。 */
export function modelLabel(model: string): string {
  const m = model.replace(/\[1m\]$/i, "").replace(/^claude-/, "");
  const mm = /^(opus|sonnet|haiku|fable)-(\d+)-(\d+)$/.exec(m);
  if (mm) return `${mm[1]![0]!.toUpperCase()}${mm[1]!.slice(1)} ${mm[2]}.${mm[3]}${/\[1m\]$/i.test(model) ? " 1M" : ""}`;
  return model;
}
