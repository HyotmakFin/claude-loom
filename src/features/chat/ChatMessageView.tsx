import { memo, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import type { ChatItem } from "@/lib/chatItems";
import { formatClock } from "@/lib/format";

import { ToolCard } from "./ToolCard";

interface Props {
  item: ChatItem;
  onCopy?: (text: string) => Promise<boolean>;
  onFork?: (uuid: string) => void;
  onDelete?: (item: ChatItem) => void;
}

function MessageActions({ item, onCopy, onFork, onDelete }: Props) {
  const [copied, setCopied] = useState(false);
  const hasCopy = !!item.text && !!onCopy;
  const canFork = item.role === "assistant" && !!item.uuid && !!onFork;
  const canDelete = !!item.uuid && !!onDelete;
  if (!hasCopy && !canFork && !canDelete) return null;

  const doCopy = async () => {
    if (!onCopy || !item.text) return;
    if (await onCopy(item.text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };

  return (
    <div className="absolute -top-2 right-0 z-10 flex items-center gap-0.5 rounded-chip border border-line bg-surface p-0.5 opacity-0 shadow-subtle transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
      {hasCopy && (
        <button
          type="button"
          title={copied ? "已复制" : "复制"}
          aria-label="复制"
          onClick={() => void doCopy()}
          className="flex size-6 items-center justify-center rounded-chip text-ink-muted hover:bg-sunken hover:text-ink"
        >
          <Icon name={copied ? "check" : "copy"} size={12} className={copied ? "text-ok" : ""} />
        </button>
      )}
      {canFork && (
        <button
          type="button"
          title="从此回复分叉新对话"
          aria-label="分叉"
          onClick={() => item.uuid && onFork?.(item.uuid)}
          className="flex size-6 items-center justify-center rounded-chip text-ink-muted hover:bg-sunken hover:text-ink"
        >
          <Icon name="branch" size={12} />
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          title={item.role === "user" ? "删除这条输入及之后的回复" : "删除这条回复"}
          aria-label="删除"
          onClick={() => onDelete?.(item)}
          className="flex size-6 items-center justify-center rounded-chip text-danger hover:bg-sunken"
        >
          <Icon name="trash" size={12} />
        </button>
      )}
    </div>
  );
}

export const ChatMessageView = memo(function ChatMessageView({ item, onCopy, onFork, onDelete }: Props) {
  if (item.role === "system") {
    return (
      <div className="chat-item group relative my-3 flex justify-center">
        <p className="max-w-lg rounded-control border border-line bg-canvas px-3 py-1.5 text-center font-sans text-[12px] leading-relaxed text-ink-muted">
          {item.text}
        </p>
        <MessageActions item={item} onCopy={onCopy} onFork={onFork} onDelete={onDelete} />
      </div>
    );
  }

  if (item.role === "user") {
    return (
      <div className="chat-item group relative mb-6">
        <div className="flex items-center gap-2 font-sans text-[11px] text-ink-faint">
          <span className="inline-block size-1.5 rounded-pill bg-accent" />
          <span>你</span>
          {item.timestamp && <span>{formatClock(item.timestamp)}</span>}
        </div>
        <p className="mt-1.5 whitespace-pre-wrap pl-3.5 font-sans text-[13.5px] leading-relaxed text-ink">{item.text}</p>
        <MessageActions item={item} onCopy={onCopy} onFork={onFork} onDelete={onDelete} />
      </div>
    );
  }

  return (
    <div className="chat-item group relative mb-7">
      <div className="flex items-center gap-2 font-sans text-[11px] text-ink-faint">
        <Icon name="spark" size={11} className="text-ink-faint" />
        <span>Claude</span>
        {item.timestamp && <span>{formatClock(item.timestamp)}</span>}
      </div>
      <div className="mt-1.5 space-y-2 pl-3.5">
        {item.thinking && (
          <details className="group rounded-control border border-line bg-canvas px-3 py-1.5">
            <summary className="cursor-pointer list-none font-sans text-[11px] text-ink-faint hover:text-ink-muted">
              思考过程
            </summary>
            <p className="mt-1.5 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-ink-muted">{item.thinking}</p>
          </details>
        )}
        {item.text && <Markdown source={item.text} />}
        {item.tools.length > 0 && (
          <div className="space-y-1.5 pt-0.5">
            {item.tools.map((t) => (
              <ToolCard key={t.id} tool={t} />
            ))}
          </div>
        )}
      </div>
      <MessageActions item={item} onCopy={onCopy} onFork={onFork} onDelete={onDelete} />
    </div>
  );
});
