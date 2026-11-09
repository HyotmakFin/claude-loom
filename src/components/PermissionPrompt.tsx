/**
 * 权限确认卡片：展示 awaiting-permission 队列的队首请求。
 * 允许 / 始终允许（回传 permission_suggestions）/ 拒绝 / 拒绝并中止。Esc = 拒绝。
 */
import { useEffect, useRef, useState } from "react";

import type { PendingPermission } from "@/cli/machine";
import type { PermissionDecision } from "@/cli/protocol";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Kbd } from "./ui/StatusDot";

interface Props {
  item: PendingPermission;
  queued: number;
  onDecide: (decision: PermissionDecision) => void | Promise<void>;
}

function summarize(tool: string, input: Record<string, unknown>): { label: string; value: string } | null {
  const pick = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  switch (tool) {
    case "Bash": {
      const v = pick("command");
      return v ? { label: "命令", value: v } : null;
    }
    case "Edit":
    case "Write":
    case "Read":
    case "NotebookEdit": {
      const v = pick("file_path") ?? pick("notebook_path");
      return v ? { label: "文件", value: v } : null;
    }
    case "WebFetch": {
      const v = pick("url");
      return v ? { label: "网址", value: v } : null;
    }
    default:
      return null;
  }
}

const DENY: PermissionDecision = { behavior: "deny", message: "User denied this tool use." };

export function PermissionPrompt({ item, queued, onDecide }: Props) {
  const { tool_name, input, permission_suggestions, decision_reason, blocked_path } = item.request;
  const [busy, setBusy] = useState(false);
  const allowRef = useRef<HTMLButtonElement>(null);
  const summary = summarize(tool_name, input);
  const description = typeof input.description === "string" ? input.description : null;

  useEffect(() => {
    setBusy(false);
    allowRef.current?.focus();
  }, [item.requestId]);

  const decide = async (d: PermissionDecision) => {
    setBusy(true);
    try {
      await onDecide(d);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="alertdialog"
      aria-label={`允许使用 ${tool_name}？`}
      className="overflow-hidden rounded-card border border-line bg-surface shadow-raised"
      onKeyDown={(e) => {
        if (e.key === "Escape") void decide(DENY);
      }}
    >
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-control bg-accent-tint text-accent">
          <Icon name="shield" size={16} />
        </div>
        <div className="min-w-0 flex-1 font-sans">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-ink">允许 Claude 使用</span>
            <code className="rounded-chip border border-line bg-sunken px-1.5 text-[12px] font-bold text-ink">{tool_name}</code>
            {queued > 1 && (
              <span className="ml-auto rounded-pill bg-sunken px-2 text-[11px] leading-5 text-ink-muted">
                还有 {queued - 1} 个
              </span>
            )}
          </div>
          {(description || decision_reason) && (
            <p className="mt-0.5 text-[12px] text-ink-muted">{description ?? decision_reason}</p>
          )}
        </div>
      </div>

      <div className="space-y-2 px-4 pb-3">
        {summary && (
          <div className="overflow-hidden rounded-control border border-line bg-canvas">
            <div className="border-b border-line px-3 py-1 font-sans text-[11px] text-ink-faint">{summary.label}</div>
            <pre className="overflow-x-auto px-3 py-2 text-[12px] leading-relaxed text-ink">{summary.value}</pre>
          </div>
        )}
        {blocked_path && (
          <p className="font-sans text-[12px] text-ink-muted">
            受限路径 <span className="font-mono text-ink">{blocked_path}</span>
          </p>
        )}
        <details className="group font-sans text-[12px] text-ink-faint">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 select-none hover:text-ink">
            <Icon name="chevron" size={12} className="transition-transform group-open:rotate-90" />
            完整参数
          </summary>
          <pre className="mt-1.5 max-h-56 overflow-auto rounded-control border border-line bg-canvas px-3 py-2 text-[12px] text-ink">
            {JSON.stringify(input, null, 2)}
          </pre>
        </details>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas px-4 py-2.5">
        <span className="mr-auto flex items-center gap-1 font-sans text-[11px] text-ink-faint">
          <Kbd>Esc</Kbd>
          <span className="ml-0.5">拒绝</span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => decide({ behavior: "deny", message: "User denied and interrupted.", interrupt: true })}
        >
          拒绝并中止
        </Button>
        <Button variant="danger" size="sm" disabled={busy} onClick={() => decide(DENY)}>
          拒绝
        </Button>
        {permission_suggestions && permission_suggestions.length > 0 && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => decide({ behavior: "allow", updatedInput: input, updatedPermissions: permission_suggestions })}
          >
            始终允许
          </Button>
        )}
        <Button
          ref={allowRef}
          variant="primary"
          size="sm"
          icon="check"
          disabled={busy}
          onClick={() => decide({ behavior: "allow", updatedInput: input })}
        >
          允许
        </Button>
      </div>
    </div>
  );
}
