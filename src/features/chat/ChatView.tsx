/**
 * 会话对话视图：历史来自 JSONL，新消息来自 CLI 子进程（--resume）。
 * 首次发送时才 spawn CLI；切换会话后进程保留，返回时继续使用。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Phase } from "@/cli/machine";
import type { SlashCommand } from "@/cli/protocol";
import { canSend } from "@/cli/machine";
import { PermissionPrompt } from "@/components/PermissionPrompt";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Kbd, StatusPill, type Tone } from "@/components/ui/StatusDot";
import { TextArea } from "@/components/ui/TextField";
import { itemsFromCli, itemsFromHistory, type ChatItem } from "@/lib/chatItems";
import { copyText } from "@/lib/clipboard";
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

export function ChatView({
  session,
  isNew = false,
  onChanged,
  onFork,
}: {
  session: SessionSummary;
  isNew?: boolean;
  onChanged: () => void;
  onFork?: (s: SessionSummary) => void;
}) {
  const cfg = useConfig((s) => s.config);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(() => sessionRuns.get(session.id) ?? null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmLive, setConfirmLive] = useState<null | (() => void)>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);
  const slashBoot = useRef(false);
  const newSidNotified = useRef(false);
  /** 已发送但 CLI 尚未回显的用户消息（--resume 下 CLI 可能不回显） */
  const [pending, setPending] = useState<{ runId: string; text: string; index: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ChatItem | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const run = useRuns((s) => (runId ? s.runs[runId] : undefined));
  const phase = run?.state.phase ?? "idle";
  const alive = run?.state.process === "alive";
  const busy = phase === "streaming" || phase === "awaiting-permission";

  useEffect(() => {
    let alive = true;
    setLoadError(null);
    setError(null);
    setDraft("");
    setPending(null);
    setSlashDismissed(false);
    newSidNotified.current = false;
    setRunId(sessionRuns.get(session.id) ?? null);
    if (isNew) {
      setDetail({ session, messages: [] });
      return () => {
        alive = false;
      };
    }
    setDetail(null);
    ipc.sessionMessages(session.id).then(
      (d) => alive && setDetail(d),
      (e) => alive && setLoadError(errorText(e)),
    );
    return () => {
      alive = false;
    };
    // session 对象随列表刷新变化，只在 id / 是否新会话变化时重新加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, isNew]);

  const historyItems = useMemo(() => (detail ? itemsFromHistory(detail.messages) : []), [detail]);
  const liveItems = useMemo(() => (run ? itemsFromCli(run.messages) : []), [run]);
  const partial = run?.partial ?? "";

  const cwd = detail?.session.projectPath ?? session.projectPath ?? null;
  const commands = run?.commands ?? [];
  const slashQuery = !slashDismissed && /^\/[^\s]*$/.test(draft) ? draft.slice(1).toLowerCase() : null;
  const filteredCommands = useMemo(() => {
    if (slashQuery === null) return [];
    return commands
      .filter((c) => {
        const n = c.name.replace(/^\//, "").toLowerCase();
        return n.startsWith(slashQuery) || n.includes(slashQuery) || (c.aliases ?? []).some((a) => a.toLowerCase().startsWith(slashQuery));
      })
      .slice(0, 12);
  }, [commands, slashQuery]);

  useEffect(() => {
    setSlashIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    if (!/^\/[^\s]*$/.test(draft)) setSlashDismissed(false);
  }, [draft]);

  // 输入 "/" 时静默启动 CLI（不产生模型请求），以获取该目录可用的命令
  useEffect(() => {
    // 正在别的终端运行的会话不自动抢连接，等用户发送时再确认
    if (slashQuery === null || !cwd || runId || slashBoot.current || session.live) return;
    slashBoot.current = true;
    ensureRun().catch(() => {
      slashBoot.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashQuery, cwd, runId, session.live]);

  const pickCommand = (c: SlashCommand) => {
    setDraft(`/${c.name.replace(/^\//, "")} `);
    setSlashDismissed(true);
    setSlashIndex(0);
    requestAnimationFrame(() => composerRef.current?.querySelector("textarea")?.focus());
  };

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
  const runSessionId = run?.state.sessionId ?? null;
  useEffect(() => {
    if (run?.state.phase === "done") onChanged();
  }, [run?.state.phase, lastDone, onChanged]);
  useEffect(() => {
    // 新会话第一次拿到 sessionId 后刷新列表，让它出现在左侧
    if (isNew && runSessionId && !newSidNotified.current) {
      newSidNotified.current = true;
      onChanged();
    }
  }, [isNew, runSessionId, onChanged]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [historyItems.length, beforeMark.length, afterMark.length, partial, busy, echoed]);

  const ensureRun = async (): Promise<string> => {
    const existing = runId ? useRuns.getState().runs[runId] : undefined;
    if (existing && existing.state.process === "alive") return runId!;
    const cwd = detail?.session.projectPath ?? session.projectPath ?? null;
    if (!cwd) throw new Error("该会话没有记录工作目录，无法续聊");
    const id = await useRuns.getState().start(startOptions(cfg, cwd, isNew ? undefined : session.id));
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

  const handleCopy = useCallback(async (text: string) => copyText(text), []);
  const handleFork = useCallback(
    async (uuid: string) => {
      try {
        const forked = await ipc.sessionFork(session.id, uuid);
        onFork?.(forked);
      } catch (e) {
        setError(errorText(e));
      }
    },
    [session.id, onFork],
  );
  const handleDeleteRequest = useCallback((item: ChatItem) => setPendingDelete(item), []);

  const confirmDelete = async () => {
    const item = pendingDelete;
    setPendingDelete(null);
    if (!item?.uuid) return;
    setError(null);
    try {
      // 先断开正在运行的进程，避免它继续持有旧的上下文
      if (runId) {
        const r = useRuns.getState().runs[runId];
        if (r?.state.process === "alive") await useRuns.getState().stop(runId);
        sessionRuns.delete(session.id);
        setRunId(null);
      }
      await ipc.sessionDeleteMessage(session.id, item.uuid);
      const d = await ipc.sessionMessages(session.id);
      setDetail(d);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const head = run?.state.pending[0];
  const runSlice: RunSlice | undefined = run;

  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
          <div className="min-w-0">
            <h2 className="truncate font-serif text-[15px] font-semibold text-ink">{isNew ? "新会话" : session.title}</h2>
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
              <EmptyState
                icon="chat"
                title={isNew ? "新会话" : "这个会话还没有可显示的消息"}
                hint={isNew ? "输入第一条消息开始；输入 / 可以浏览可用的斜杠命令。" : "在下方输入内容即可继续。"}
              />
            )}
            {historyItems.map((item) => (
              <ChatMessageView
                key={item.key}
                item={item}
                onCopy={handleCopy}
                onFork={isNew ? undefined : handleFork}
                onDelete={isNew || session.live ? undefined : handleDeleteRequest}
              />
            ))}
            {beforeMark.map((item) => (
              <ChatMessageView key={item.key} item={item} onCopy={handleCopy} />
            ))}
            {pending && !echoed && (
              <ChatMessageView
                key="pending-user"
                item={{ key: "pending", role: "user", uuid: null, text: pending.text, thinking: null, tools: [], timestamp: null }}
              />
            )}
            {afterMark.map((item) => (
              <ChatMessageView key={item.key} item={item} onCopy={handleCopy} />
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
          <div ref={composerRef} className="relative">
            {slashQuery !== null && (
              <div className="absolute right-0 bottom-full left-0 z-20 mb-2 overflow-hidden rounded-card border border-line bg-surface shadow-raised">
                <div className="flex items-center justify-between border-b border-line px-3 py-1.5 font-sans text-[11px] text-ink-faint">
                  <span>斜杠命令</span>
                  <span>{commands.length > 0 ? `${filteredCommands.length} / ${commands.length}` : ""}</span>
                </div>
                <div className="max-h-72 overflow-y-auto py-1">
                  {commands.length === 0 ? (
                    <p className="px-3 py-3 font-sans text-[12px] text-ink-faint">
                      {session.live && !runId
                        ? "该会话正在其他终端运行，续聊后可读取命令"
                        : runId
                          ? "正在读取命令…"
                          : "正在启动 CLI 以读取命令…"}
                    </p>
                  ) : filteredCommands.length === 0 ? (
                    <p className="px-3 py-3 font-sans text-[12px] text-ink-faint">没有匹配的命令</p>
                  ) : (
                    filteredCommands.map((c, i) => (
                      <button
                        key={c.name}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickCommand(c);
                        }}
                        onMouseEnter={() => setSlashIndex(i)}
                        className={
                          "flex w-full items-start gap-3 px-3 py-1.5 text-left transition-colors " +
                          (i === slashIndex ? "bg-sunken" : "hover:bg-sunken")
                        }
                      >
                        <code className="mt-px shrink-0 font-mono text-[12px] font-bold text-ink">
                          /{c.name.replace(/^\//, "")}
                        </code>
                        <span className="min-w-0 flex-1">
                          {c.argumentHint && (
                            <span className="font-mono text-[11px] text-ink-faint">{c.argumentHint} </span>
                          )}
                          <span className="block truncate font-sans text-[11.5px] text-ink-muted">
                            {c.description ?? ""}
                          </span>
                        </span>
                        {c.builtin && (
                          <span className="mt-px shrink-0 rounded-chip border border-line px-1.5 font-sans text-[10px] leading-4 text-ink-faint">
                            内置
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
            <div className="rounded-card border border-line bg-surface shadow-raised transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-tint">
              <TextArea
              rows={2}
              className="block w-full px-4 pt-3 text-[14px]"
              value={draft}
              placeholder={
                !cwd
                  ? "该会话缺少工作目录"
                  : isNew
                    ? "输入第一条消息开始新会话；输入 / 浏览斜杠命令"
                    : alive
                      ? busy
                        ? "正在生成…"
                        : "继续这个会话…"
                      : "输入消息开始续聊（首次发送会启动 claude --resume）"
              }
              disabled={!cwd}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (slashQuery !== null && filteredCommands.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSlashIndex((i) => (i + 1) % filteredCommands.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
                    return;
                  }
                  if (e.key === "Tab" || (e.key === "Enter" && !e.metaKey && !e.ctrlKey)) {
                    e.preventDefault();
                    pickCommand(filteredCommands[slashIndex]!);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setSlashDismissed(true);
                    return;
                  }
                }
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
                会话 {(run?.state.sessionId ?? (isNew ? null : session.id))?.slice(0, 8) ?? "新会话"}
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
          </div>
        </footer>
      </div>

      {previewOpen && <PreviewPanel cwd={cwd} onClose={() => setPreviewOpen(false)} />}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这条消息？"
        description={
          pendingDelete?.role === "user"
            ? "会从会话记录中删除这条用户输入，以及它之后的回复和工具结果。原文件会备份到 Loom 配置目录；当前进程会断开，下次发送时重新 resume。"
            : "会从会话记录中删除这条回复及其工具结果。原文件会备份到 Loom 配置目录；当前进程会断开，下次发送时重新 resume。"
        }
        confirmLabel="删除"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />

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
