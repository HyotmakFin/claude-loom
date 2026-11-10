import { Icon } from "@/components/ui/Icon";
import type { ContextInfo } from "@/lib/hud";
import { formatTokens } from "@/lib/hud";
import type { GitInfo } from "@/lib/types";

const MODES = [
  { value: "default", label: "默认", hint: "每次工具调用都询问" },
  { value: "acceptEdits", label: "自动接受编辑", hint: "文件编辑不再询问" },
  { value: "plan", label: "计划", hint: "只读规划，不执行修改" },
  { value: "bypassPermissions", label: "跳过权限", hint: "危险：不再确认任何工具调用" },
] as const;

export function StatusHud({
  model,
  cwd,
  git,
  context,
  mode,
  modeNonce,
  busy,
  onModeChange,
  onJumpTop,
}: {
  model: string | null;
  cwd: string | null;
  git: GitInfo | null;
  context: ContextInfo | null;
  mode: string;
  modeNonce: number;
  busy: boolean;
  onModeChange: (mode: string) => void;
  onJumpTop: () => void;
}) {
  const known = MODES.some((m) => m.value === mode);
  const modes = known ? MODES : [...MODES, { value: mode, label: mode, hint: "" }];
  const ctxTone =
    !context ? "" : context.percent >= 90 ? "bg-danger" : context.percent >= 70 ? "bg-warn" : "bg-accent";

  return (
    <div className="flex h-8 shrink-0 items-center gap-3 overflow-hidden border-t border-line bg-surface px-6 font-sans text-[11px] text-ink-faint">
      <span className="flex min-w-0 shrink items-center gap-1.5" title={model ? `模型：${model}` : "尚未获取模型信息"}>
        <Icon name="spark" size={11} className="shrink-0 text-ink-faint" />
        <span className="truncate font-mono text-ink-muted">{model ?? "模型 —"}</span>
      </span>

      <span className="h-3 w-px shrink-0 bg-line" />

      <span className="flex min-w-0 items-center gap-1" title={cwd ?? undefined}>
        <Icon name="folder" size={11} className="shrink-0" />
        <span className="truncate font-mono">{cwd ?? "—"}</span>
      </span>

      {git?.branch && (
        <span
          className="flex shrink-0 items-center gap-1"
          title={`${git.branch}${git.dirty ? " · 有未提交修改" : ""}`}
        >
          <Icon name="branch" size={11} className="shrink-0" />
          <span className="max-w-[10rem] truncate font-mono">{git.branch}</span>
          {git.dirty && <span className="size-1.5 rounded-pill bg-warn" title="有未提交修改" />}
          {git.ahead > 0 && <span className="text-ink-faint">↑{git.ahead}</span>}
          {git.behind > 0 && <span className="text-ink-faint">↓{git.behind}</span>}
        </span>
      )}

      <span className="ml-auto flex shrink-0 items-center gap-3">
        <span
          className="flex items-center gap-1.5"
          title={
            context
              ? `上下文：${formatTokens(context.used)} / ${formatTokens(context.window)} tokens（${Math.round(context.percent)}%）`
              : "尚无上下文用量数据"
          }
        >
          <span>ctx</span>
          <span className="h-1 w-10 overflow-hidden rounded-pill bg-sunken">
            <span
              className={`block h-full rounded-pill transition-[width] duration-300 ${ctxTone}`}
              style={{ width: `${context ? Math.max(2, Math.min(100, context.percent)) : 0}%` }}
            />
          </span>
          <span className="tabular-nums text-ink-muted">{context ? `${Math.round(context.percent)}%` : "—"}</span>
        </span>

        <select
          key={modeNonce}
          value={mode}
          onChange={(e) => onModeChange(e.target.value)}
          title={modes.find((m) => m.value === mode)?.hint ?? "权限模式"}
          aria-label="权限模式"
          className={
            "h-6 max-w-[9.5rem] rounded-chip border border-line bg-surface px-1.5 font-sans text-[11px] text-ink-muted outline-none hover:bg-sunken focus:border-accent " +
            (mode === "bypassPermissions" ? "text-danger" : mode === "plan" ? "text-warn" : "")
          }
        >
          {modes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          title="回到最早消息"
          aria-label="回到最早消息"
          onClick={onJumpTop}
          className="flex size-6 items-center justify-center rounded-chip text-ink-faint hover:bg-sunken hover:text-ink"
        >
          <Icon name="arrowUp" size={12} />
        </button>
      </span>
      {busy && <span className="sr-only">运行中</span>}
    </div>
  );
}
