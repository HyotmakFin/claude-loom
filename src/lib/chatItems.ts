/** 把历史（Rust 解析的 JSONL）与实时（CLI stream-json）统一成同一种渲染模型。 */
import type { CliMessage } from "@/cli/protocol";
import type { ChatMessage } from "./types";

export interface ToolView {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** undefined = 仍在等待结果 */
  result?: string;
  isError?: boolean;
}

export interface ChatItem {
  key: string;
  role: "user" | "assistant" | "system";
  /** 历史消息对应的 JSONL uuid；实时消息为 null */
  uuid: string | null;
  text: string | null;
  thinking: string | null;
  tools: ToolView[];
  timestamp: string | null;
}

type RawContent = string | { type?: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean }[] | undefined;

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === "object" && b && "text" in b ? String((b as { text?: string }).text ?? "") : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (content == null) return "";
  return JSON.stringify(content);
}

class Builder {
  items: ChatItem[] = [];
  results = new Map<string, { content: string; isError: boolean }>();

  addRaw(role: ChatItem["role"], content: RawContent, timestamp: string | null, uuid: string | null = null) {
    if (typeof content === "string") {
      if (content.trim()) this.items.push({ key: cryptoKey(), role, uuid, text: content, thinking: null, tools: [], timestamp });
      return;
    }
    if (!Array.isArray(content)) return;
    const texts: string[] = [];
    const thinking: string[] = [];
    const tools: ToolView[] = [];
    for (const b of content) {
      switch (b.type) {
        case "text":
          if (b.text?.trim()) texts.push(b.text);
          break;
        case "thinking":
          if (b.thinking) thinking.push(b.thinking);
          break;
        case "tool_use":
          if (b.id && b.name) tools.push({ id: b.id, name: b.name, input: (b.input as Record<string, unknown>) ?? {} });
          break;
        case "tool_result":
          if (b.tool_use_id) this.results.set(b.tool_use_id, { content: resultText(b.content), isError: !!b.is_error });
          break;
      }
    }
    if (!texts.length && !thinking.length && !tools.length) return;
    this.items.push({
      key: cryptoKey(),
      role,
      uuid,
      text: texts.length ? texts.join("\n") : null,
      thinking: thinking.length ? thinking.join("\n\n") : null,
      tools,
      timestamp,
    });
  }

  finish(): ChatItem[] {
    for (const item of this.items) {
      for (const tool of item.tools) {
        const r = this.results.get(tool.id);
        if (r) {
          tool.result = r.content;
          tool.isError = r.isError;
        }
      }
    }
    return this.items;
  }
}

let seq = 0;
function cryptoKey(): string {
  return `m${++seq}`;
}

export function itemsFromHistory(messages: ChatMessage[]): ChatItem[] {
  const b = new Builder();
  for (const m of messages) {
    // tool_result 先入表，保证后面统一回填
    for (const r of m.toolResults) b.results.set(r.toolUseId, { content: r.content, isError: r.isError });
  }
  for (const m of messages) {
    const hasText = !!m.text;
    const hasTools = m.toolUses.length > 0;
    if (!hasText && !hasTools && !m.thinking) continue;
    b.items.push({
      key: cryptoKey(),
      role: m.role,
      uuid: m.uuid,
      text: m.text,
      thinking: m.thinking,
      tools: m.toolUses.map((t) => ({ id: t.id, name: t.name, input: (t.input as Record<string, unknown>) ?? {} })),
      timestamp: m.timestamp,
    });
  }
  return b.finish();
}

export function itemsFromCli(messages: CliMessage[]): ChatItem[] {
  const b = new Builder();
  for (const m of messages) {
    if (m.type === "user" || m.type === "assistant") {
      const msg = (m as { message?: { content?: RawContent } }).message;
      b.addRaw(m.type, msg?.content, (m as { timestamp?: string }).timestamp ?? null, null);
    } else if (m.type === "result") {
      const r = m as { is_error?: boolean; result?: string; subtype?: string };
      if (r.is_error || (r.subtype && !r.subtype.startsWith("success"))) {
        b.items.push({
          key: cryptoKey(),
          role: "system",
          uuid: null,
          text: r.result || `本轮以 ${r.subtype ?? "错误"} 结束`,
          thinking: null,
          tools: [],
          timestamp: null,
        });
      }
    }
  }
  return b.finish();
}

export function toolSummary(tool: ToolView): string {
  const inp = tool.input ?? {};
  const pick = (k: string) => (typeof inp[k] === "string" ? (inp[k] as string) : null);
  switch (tool.name) {
    case "Bash":
      return pick("command") ?? "";
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return pick("file_path") ?? pick("notebook_path") ?? "";
    case "WebFetch":
    case "WebSearch":
      return pick("url") ?? pick("query") ?? "";
    case "Glob":
    case "Grep":
      return pick("pattern") ?? "";
    case "Task":
      return pick("description") ?? "";
    default: {
      const first = Object.values(inp).find((v) => typeof v === "string");
      return typeof first === "string" ? first : "";
    }
  }
}
