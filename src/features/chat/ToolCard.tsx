import { memo } from "react";

import { Icon } from "@/components/ui/Icon";
import type { ToolView } from "@/lib/chatItems";
import { toolSummary } from "@/lib/chatItems";

const ICON: Record<string, "terminal" | "file" | "globe" | "search" | "spark"> = {
  Bash: "terminal",
  Read: "file",
  Write: "file",
  Edit: "file",
  WebFetch: "globe",
  WebSearch: "search",
  Glob: "search",
  Grep: "search",
};

export const ToolCard = memo(function ToolCard({ tool }: { tool: ToolView }) {
  const pending = tool.result === undefined;
  const summary = toolSummary(tool);

  return (
    <details className="group overflow-hidden rounded-control border border-line bg-canvas open:bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-sans text-[12px]">
        <Icon name={ICON[tool.name] ?? "spark"} size={13} className="shrink-0 text-ink-faint" />
        <span className="shrink-0 font-medium text-ink">{tool.name}</span>
        {summary && <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-muted">{summary}</span>}
        {!summary && <span className="flex-1" />}
        {pending ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint">
            <span className="inline-block size-1.5 animate-pulse rounded-pill bg-warn" />
            运行中
          </span>
        ) : tool.isError ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-danger">
            <Icon name="warning" size={12} />
            出错
          </span>
        ) : (
          <Icon name="check" size={12} className="text-ok" />
        )}
        <Icon name="chevron" size={12} className="text-ink-faint transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-2 border-t border-line px-3 py-2.5">
        <div>
          <div className="mb-1 font-sans text-[10px] tracking-wide text-ink-faint">参数</div>
          <pre className="max-h-56 overflow-auto rounded-chip bg-sunken p-2 text-[11.5px] leading-relaxed text-ink">
            {JSON.stringify(tool.input, null, 2)}
          </pre>
        </div>
        {!pending && (
          <div>
            <div className="mb-1 font-sans text-[10px] tracking-wide text-ink-faint">{tool.isError ? "错误输出" : "输出"}</div>
            <pre
              className={
                "max-h-72 overflow-auto rounded-chip bg-sunken p-2 text-[11.5px] leading-relaxed whitespace-pre-wrap " +
                (tool.isError ? "text-danger" : "text-ink")
              }
            >
              {tool.result || "（无输出）"}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
});
