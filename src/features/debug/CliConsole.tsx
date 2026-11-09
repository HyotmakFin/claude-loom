/**
 * CLI 调试页：手动启动 claude、收发 NDJSON、走一遍权限状态机。
 * 模块 3 的正式对话视图完成后保留为开发工具。
 */
import { homeDir } from "@tauri-apps/api/path";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Phase } from "@/cli/machine";
import { canSend } from "@/cli/machine";
import type { AssistantMessage, CliMessage } from "@/cli/protocol";
import { PermissionPrompt } from "@/components/PermissionPrompt";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Kbd, StatusPill, type Tone } from "@/components/ui/StatusDot";
import { TextArea, TextField } from "@/components/ui/TextField";
import { startOptions } from "@/lib/cliOptions";
import { errorText } from "@/lib/ipc";
import { useConfig } from "@/stores/config";
import { useRuns, type LogEntry } from "@/stores/runs";

const PHASE: Record<Phase, { tone: Tone; label: string }> = {
  idle: { tone: "idle", label: "空闲" },
  streaming: { tone: "accent", label: "生成中" },
  "awaiting-permission": { tone: "warn", label: "等待授权" },
  done: { tone: "ok", label: "本轮完成" },
};

const isMac = /Mac/.test(navigator.userAgent);

export function CliConsole() {
  const [cwd, setCwd] = useState("");
  const [resume, setResume] = useState("");
  const [draft, setDraft] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useRuns((s) => (runId ? s.runs[runId] : undefined));
  const cfg = useConfig((s) => s.config);
  const { start, send, decide, interrupt, stop } = useRuns.getState();

  useEffect(() => {
    homeDir().then(setCwd, () => {});
  }, []);

  const guard = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const alive = run?.state.process === "alive";
  const phase = run?.state.phase ?? "idle";
  const busy = phase === "streaming" || phase === "awaiting-permission";
  const head = run?.state.pending[0];
  const sendable = !!run && canSend(run.state) && !!draft.trim();

  const submit = () => {
    if (!sendable || !runId) return;
    const text = draft;
    setDraft("");
    void guard(() => send(runId, text));
  };

  return (
    <div className="flex h-full flex-col">
      {/* 标题栏 */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
        <div className="min-w-0">
          <h1 className="font-serif text-[16px] font-semibold leading-tight text-ink">CLI 调试</h1>
          <p className="font-sans text-[12px] text-ink-faint">直接驱动 claude 进程，逐行查看 stdin / stdout</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {run ? (
            <>
              <StatusPill tone={PHASE[phase].tone} pulse={phase === "streaming"}>
                {PHASE[phase].label}
              </StatusPill>
              <StatusPill tone={alive ? "ok" : run.state.process === "exited" ? "danger" : "idle"}>
                {alive ? "进程运行中" : run.state.process === "exited" ? `已退出 ${run.state.exitCode ?? ""}` : "启动中"}
              </StatusPill>
            </>
          ) : (
            <StatusPill tone="idle">未启动</StatusPill>
          )}
        </div>
      </header>

      {/* 启动参数 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-6 py-3">
        <TextField
          icon="folder"
          className="flex-1"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="工作目录"
          disabled={alive}
        />
        <TextField
          icon="history"
          className="w-72 font-mono text-[12px]"
          value={resume}
          onChange={(e) => setResume(e.target.value)}
          placeholder="续聊 sessionId（可选）"
          disabled={alive}
        />
        {alive ? (
          <Button variant="danger" icon="stop" onClick={() => guard(() => stop(runId!))}>
            停止
          </Button>
        ) : (
          <Button
            variant="primary"
            icon="play"
            disabled={!cwd}
            onClick={() =>
              guard(async () => setRunId(await start(startOptions(cfg, cwd, resume.trim() || undefined))))
            }
          >
            启动
          </Button>
        )}
      </div>

      {(error || run?.state.error) && (
        <div className="mx-6 mt-3 flex items-start gap-2 rounded-card border border-line bg-sunken px-3 py-2 font-sans text-[12px] text-danger">
          <Icon name="x" size={14} className="mt-px shrink-0" />
          <span className="min-w-0 break-words">{error ?? run?.state.error}</span>
        </div>
      )}

      <Log entries={run?.log ?? []} sessionId={run?.state.sessionId ?? null} />

      {/* 输入区 */}
      <footer className="shrink-0 space-y-3 px-6 pb-5">
        {head && runId && (
          <PermissionPrompt
            item={head}
            queued={run!.state.pending.length}
            onDecide={(d) => guard(() => decide(runId, head.requestId, d))}
          />
        )}
        <div
          className={
            "rounded-card border bg-surface shadow-raised transition-[border-color,box-shadow] duration-150 " +
            "border-line focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-tint"
          }
        >
          <TextArea
            rows={2}
            className="block w-full px-4 pt-3 text-[14px]"
            value={draft}
            disabled={!run || !canSend(run.state)}
            placeholder={
              !alive ? "先启动 claude 进程" : phase === "awaiting-permission" ? "等待你的授权…" : busy ? "正在生成…" : "给 Claude 发消息"
            }
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="flex items-center justify-between px-3 pb-2.5">
            <span className="flex items-center gap-1 pl-1 font-sans text-[11px] text-ink-faint">
              <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd>↵</Kbd>
              <span className="ml-1">发送</span>
            </span>
            {busy ? (
              <Button size="sm" icon="stop" onClick={() => guard(() => interrupt(runId!))}>
                中断
              </Button>
            ) : (
              <Button variant="primary" icon="arrowUp" aria-label="发送" disabled={!sendable} onClick={submit} />
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}

const DIR: Record<LogEntry["dir"], { label: string; cls: string }> = {
  in: { label: "IN", cls: "text-ink-muted border-line bg-surface" },
  out: { label: "OUT", cls: "text-accent border-accent-tint bg-accent-tint" },
  stderr: { label: "ERR", cls: "text-danger border-line bg-surface" },
  parse_error: { label: "RAW", cls: "text-warn border-line bg-surface" },
};

function Log({ entries, sessionId }: { entries: LogEntry[]; sessionId: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex size-11 items-center justify-center rounded-card border border-line bg-canvas text-ink-faint shadow-subtle">
          <Icon name="inbox" size={20} />
        </div>
        <div className="font-sans">
          <div className="text-[13px] font-medium text-ink">还没有消息</div>
          <div className="mt-0.5 text-[12px] text-ink-faint">启动进程并发送一条消息，收发的每一行 NDJSON 都会显示在这里</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {sessionId && (
        <div className="mb-2 px-2 font-sans text-[11px] text-ink-faint">
          session <span className="font-mono text-ink-muted">{sessionId}</span>
        </div>
      )}
      <ul className="space-y-px">
        {entries.map((e) => (
          <LogRow key={e.seq} entry={e} />
        ))}
      </ul>
    </div>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const text = useMemo(() => assistantText(entry), [entry]);
  const raw = typeof entry.payload === "string" ? entry.payload : JSON.stringify(entry.payload);
  const p = entry.payload as { type?: string; subtype?: string; request?: { subtype?: string } } | null;
  const kind =
    typeof entry.payload === "object" && p?.type
      ? [p.type.replace(/^control_/, "ctl_"), p.subtype ?? p.request?.subtype].filter(Boolean).join(" · ")
      : entry.dir;
  const dir = DIR[entry.dir];

  return (
    <li className="grid grid-cols-[3rem_12rem_minmax(0,1fr)] items-start gap-3 rounded-control px-2 py-1.5 transition-colors hover:bg-sunken">
      <span
        className={`mt-px inline-flex h-[18px] items-center justify-center rounded-chip border font-mono text-[10px] font-bold ${dir.cls}`}
      >
        {dir.label}
      </span>
      <span className="truncate pt-px font-mono text-[12px] text-ink-muted">{kind}</span>
      {text ? (
        <p className="prose-serif whitespace-pre-wrap">{text}</p>
      ) : (
        <details className="group min-w-0">
          <summary className="cursor-pointer list-none truncate pt-px font-mono text-[12px] text-ink-faint hover:text-ink">
            {raw}
          </summary>
          <pre className="mt-1.5 max-h-80 overflow-auto rounded-card border border-line bg-canvas p-3 text-[12px] leading-relaxed text-ink">
            {JSON.stringify(entry.payload, null, 2)}
          </pre>
        </details>
      )}
    </li>
  );
}

function assistantText(entry: LogEntry): string | null {
  if (entry.dir !== "in") return null;
  const m = entry.payload as CliMessage;
  if (m.type !== "assistant") return null;
  const parts = (m as AssistantMessage).message.content.filter((b) => b.type === "text") as { text: string }[];
  return parts.length ? parts.map((p) => p.text).join("") : null;
}
