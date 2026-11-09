import { Icon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import type { ChatItem } from "@/lib/chatItems";
import { formatClock } from "@/lib/format";

import { ToolCard } from "./ToolCard";

export function ChatMessageView({ item }: { item: ChatItem }) {
  if (item.role === "system") {
    return (
      <div className="my-3 flex justify-center">
        <p className="max-w-lg rounded-control border border-line bg-canvas px-3 py-1.5 text-center font-sans text-[12px] leading-relaxed text-ink-muted">
          {item.text}
        </p>
      </div>
    );
  }

  if (item.role === "user") {
    return (
      <div className="mb-6">
        <div className="flex items-center gap-2 font-sans text-[11px] text-ink-faint">
          <span className="inline-block size-1.5 rounded-pill bg-accent" />
          <span>你</span>
          {item.timestamp && <span>{formatClock(item.timestamp)}</span>}
        </div>
        <p className="mt-1.5 whitespace-pre-wrap pl-3.5 font-sans text-[13.5px] leading-relaxed text-ink">{item.text}</p>
      </div>
    );
  }

  return (
    <div className="mb-7">
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
    </div>
  );
}
