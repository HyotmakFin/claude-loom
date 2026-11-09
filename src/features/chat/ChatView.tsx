/**
 * 会话对话视图：历史来自 JSONL，新消息来自 CLI 子进程（--resume）。
 * 首次发送时才 spawn CLI；切换会话后进程保留，返回时继续使用。
 */
import { useEffect, useMemo, useRef, useState } from "react";

import type { Phase } from "@/cli/machine";
import { canSend } from "@/cli/machine";
import { PermissionPrompt } from "@/components/PermissionPrompt";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Kbd, StatusPill, type Tone } from "@/components/ui/StatusDot";
import { TextArea } from "@/components/ui/TextField";
import { itemsFromCli, itemsFromHistory } from "@/lib/chatItems";
import { startOptions } from "@/lib/cliOptions";
import { errorText, ipc } from "@/lib/ipc";
import type { SessionDetail, SessionSummary } from "@/lib/types";
import { useConfig } from "@/stores/config";
import { useRuns, type RunSlice } from "@/stores/runs";

import { ChatMessageView } from "./ChatMessageView";
import { PreviewPanel } from "@/features/preview/PreviewPanel";

/** sessionId → runId，切换会话不丢进程 */
const sessionRuns = new Map<string, string>();

const PHASE: Record<Phase, { tone: Tone; label: string }> = {
  idle: { tone: "idle", label: "空闲" },
  streaming: { tone: "accent", label: "生成中" },
  "awaiting-permission": { tone: "warn", label: "等待授权" },
  done: { tone: "ok", label: "本轮完成" },
};

const isMac = /Mac/.test(navigator.userAgent);

export function ChatView({ session, onChanged }: { session: SessionSummary; onChanged: () => void }) {
  const cfg = useConfig((s) => s.config);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(() => sessionRuns.get(session.id) ?? null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmLive, setConfirmLive] = useState<null | (() => void)>(null);
  /** 已发送但 CLI 尚未回显的用户消息（--resume 下 CLI 可能不回显） */
  const [pending, setPending] = useState<{ runId: string; text: string; index: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const run = useRuns((s) => (runId ? s.runs[runId] : undefined));
  const phase = run?.state.phase ?? "idle";
  const alive = run?.state.process === "alive";
  const busy = phase === "streaming" || phase === "awaiting-permission";

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setLoadError(null);
    setError(null);
    setDraft("");
    setPending(null);
    setRunId(sessionRuns.get(session.id) ?? null);
    ipc.sessionMessages(session.id).then(
      (d) => alive && setDetail(d),
      (e) => alive && setLoadError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [session.id]);

  const historyItems = useMemo(() => (detail ? itemsFromHistory(detail.messages) : []), [detail]);
  const liveItems = useMemo(() => (run ? itemsFromCli(run.messages) : []), [run]);
  const partial = run?.partial ?? "";

  // 本次发送之前的实时消息与之后的消息分开，好把乐观回显插在正确位置
  const mark = pending && pending.runId === runId ? pending.index : null;
  const beforeMark = useMemo(
    () => (mark !== null && run ? itemsFromCli(run.messages.slice(0, mark)) : liveItems),
    [mark, run, liveItems],
  );
  const afterMark = useMemo(() => (mark !== null && run ? itemsFromCli(run.messages.slice(mark)) : []), [mark, run]);
  const echoed = !!pending && afterMark.some((i) => i.role === "user" && i.text?.trim() === pending.text.trim());
  useEffect(() => {
    if (echoed) setPending(null);
  }, [echoed]);

  const lastDone = run?.state.lastResult;
  useEffect(() => {
    if (run?.state.phase === "done") onChanged();
  }, [run?.state.phase, lastDone, onChanged]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [historyItems.length, beforeMark.length, afterMark.length, partial, busy, echoed]);

  const ensureRun = async (): Promise<string> => {
    const existing = runId ? useRuns.getState().runs[runId] : undefined;
    if (existing && existing.state.process === "alive") return runId!;
    const cwd = detail?.session.projectPath ?? session.projectPath ?? null;
    if (!cwd) throw new Error("该会话没有记录工作目录，无法续聊");
    const id = await useRuns.getState().start(startOptions(cfg, cwd, session.id));
    sessionRuns.set(session.id, id);
    setRunId(id);
    return id;
  };

  const doSend = async (text: string) => {
    setError(null);
    setDraft("");
    try {
      const id = await ensureRun();
      const index = useRuns.getState().runs[id]?.messages.length ?? 0;
      setPending({ runId: id, text, index });
      await useRuns.getState().send(id, text);
    } catch (e) {
      setDraft(text);
      setError(errorText(e));
    }
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    // 会话正在别的终端运行：先确认，避免两个实例同时写同一份转录
    if (session.live && !sessionRuns.get(session.id)) {
      setConfirmLive(() => () => void doSend(text));
      return;
    }
    void doSend(text);
  };

  const head = run?.state.pending[0];
  const runSlice: RunSlice | undefined = run;
  const cwd = detail?.session.projectPath ?? session.projectPath;

  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
          <div className="min-w-0">
            <h2 className="truncate font-serif text-[15px] font-semibold text-ink">{session.title}</h2>
            <div className="flex items-center gap-2 font-sans text-[11px] text-ink-faint">
              <span className="truncate font-mono">{cwd ?? "未知目录"}</span>
              {session.gitBranch && <span>· {session.gitBranch}</span>}
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {runSlice && (
              <StatusPill tone={PHASE[phase].tone} pulse={phase === "streaming"}>
                {PHASE[phase].label}
              </StatusPill>
            )}
            {alive && (
              <Button size="sm" variant="ghost" icon="stop" onClick={() => runId && void useRuns.getState().stop(runId)}>
                停止
              </Button>
            )}
            <Button
              size="sm"
              variant={previewOpen ? "secondary" : "ghost"}
              icon="panel"
              onClick={() => setPreviewOpen((v) => !v)}
            >
              预览
            </Button>
          </div>
        </header>

        {session.live && (
          <div className="flex items-center gap-2 border-b border-line bg-canvas px-6 py-1.5 font-sans text-[11px] text-warn">
            <Icon name="warning" size={12} />
            该会话正在另一个终端中运行（pid {session.live.pid}），同时续聊可能造成状态冲突。
          </div>
        )}

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="mx-auto w-full max-w-[780px] px-7 py-6">
            {loadError && (
              <p className="rounded-control border border-line bg-surface px-3 py-2 font-sans text-[12px] text-danger">{loadError}</p>
            )}
            {!detail && !loadError && <p className="py-20 text-center font-sans text-[12px] text-ink-faint">正在读取会话…</p>}
            {detail && historyItems.length === 0 && liveItems.length === 0 && (
              <EmptyState icon="chat" title="这个会话还没有可显示的消息" hint="在下方输入内容即可继续。" />
            )}
            {historyItems.map((item) => (
              <ChatMessageView key={item.key} item={item} />
            ))}
            {beforeMark.map((item) => (
              <ChatMessageView key={item.key} item={item} />
            ))}
            {pending && !echoed && (
              <ChatMessageView
                key="pending-user"
                item={{ key: "pending", role: "user", text: pending.text, thinking: null, tools: [], timestamp: null }}
              />
            )}
            {afterMark.map((item) => (
              <ChatMessageView key={item.key} item={item} />
            ))}
            {partial && (
              <div className="mb-7">
                <div className="flex items-center gap-2 font-sans text-[11px] text-ink-faint">
                  <Icon name="spark" size={11} />
                  <span>Claude</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap pl-3.5 font-serif text-[15px] leading-[1.75] text-ink">
                  {partial}
                  <span className="ml-0.5 inline-block h-[1.05em] w-[2px] animate-pulse bg-accent align-[-0.15em]" />
                </p>
              </div>
            )}
          </div>
        </div>

        <footer className="shrink-0 space-y-3 px-6 pb-5">
          {(error || run?.state.error) && (
            <div className="flex items-start gap-2 rounded-card border border-line bg-surface px-3 py-2 font-sans text-[12px] text-danger">
              <Icon name="warning" size={13} className="mt-px shrink-0" />
              <span className="min-w-0 break-words">{error ?? run?.state.error}</span>
            </div>
          )}
          {head && runId && (
            <PermissionPrompt
              item={head}
              queued={run!.state.pending.length}
              onDecide={async (d) => {
                try {
                  await useRuns.getState().decide(runId, head.requestId, d);
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            />
          )}
          <div className="rounded-card border border-line bg-surface shadow-raised transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-tint">
            <TextArea
              rows={2}
              className="block w-full px-4 pt-3 text-[14px]"
              value={draft}
              placeholder={
                !cwd ? "该会话缺少工作目录" : alive ? (busy ? "正在生成…" : "继续这个会话…") : "输入消息开始续聊（首次发送会启动 claude --resume）"
              }
              disabled={!cwd}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <div className="flex items-center justify-between px-3 pb-2.5">
              <span className="flex items-center gap-1 pl-1 font-sans text-[11px] text-ink-faint">
                <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
                <Kbd>↵</Kbd>
                <span className="ml-1">发送</span>
                <span className="mx-1 text-line-strong">·</span>
                会话 {session.id.slice(0, 8)}
              </span>
              {busy && runId ? (
                <Button size="sm" icon="stop" onClick={() => void useRuns.getState().stop(runId)}>
                  中断
                </Button>
              ) : (
                <Button
                  variant="primary"
                  icon="arrowUp"
                  aria-label="发送"
                  disabled={!draft.trim() || !cwd || !(!run || canSend(run.state))}
                  onClick={() => void submit()}
                />
              )}
            </div>
          </div>
        </footer>
      </div>

      {previewOpen && <PreviewPanel cwd={cwd} onClose={() => setPreviewOpen(false)} />}

      <ConfirmDialog
        open={confirmLive !== null}
        title="这个会话正在其他终端运行"
        description={`检测到 pid ${session.live?.pid ?? "?"} 仍持有该会话。同时续聊可能导致上下文或权限冲突，建议先结束原进程。`}
        confirmLabel="仍然续聊"
        onCancel={() => setConfirmLive(null)}
        onConfirm={() => {
          const go = confirmLive;
          setConfirmLive(null);
          go?.();
        }}
      />
    </div>
  );
}
