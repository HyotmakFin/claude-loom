/** 会话管理：搜索、置顶、归档、删除、进入对话、新建会话。 */
import { homeDir, openDialog } from "@/lib/electron";
import { useCallback, useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { TextField } from "@/components/ui/TextField";
import { baseName, relativeTime } from "@/lib/format";
import { errorText } from "@/lib/ipc";
import type { SessionSummary } from "@/lib/types";
import { useSessions } from "@/stores/sessions";

import { ChatView } from "@/features/chat/ChatView";

type Tab = "all" | "pinned" | "archived";

export function SessionsView() {
  const { list, loading, error, query, includeArchived } = useSessions();
  const { refresh, setQuery, setIncludeArchived, setFlag, remove } = useSessions.getState();
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState(query);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 尚未产生 sessionId 的新会话（伪会话） */
  const [newSession, setNewSession] = useState<SessionSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 搜索防抖
  useEffect(() => {
    const t = setTimeout(() => search !== query && setQuery(search), 250);
    return () => clearTimeout(t);
  }, [search, query, setQuery]);

  useEffect(() => {
    const wantArchived = tab === "archived";
    if (includeArchived !== wantArchived) setIncludeArchived(wantArchived);
  }, [tab, includeArchived, setIncludeArchived]);

  const visible = tab === "pinned" ? list.filter((s) => s.pinned) : tab === "archived" ? list.filter((s) => s.archived) : list;
  const selected = visible.find((s) => s.id === selectedId) ?? list.find((s) => s.id === selectedId) ?? null;
  const active = newSession ?? selected;
  const handleChanged = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleFork = useCallback(
    async (forked: SessionSummary) => {
      setNewSession(null);
      await refresh();
      setSelectedId(forked.id);
    },
    [refresh],
  );

  const startNew = async () => {
    setActionError(null);
    try {
      const home = await homeDir().catch(() => undefined);
      const dir = await openDialog({ directory: true, multiple: false, defaultPath: home });
      if (typeof dir !== "string") return;
      setNewSession({
        id: `new-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
        title: "新会话",
        projectPath: dir,
        gitBranch: null,
        createdAt: null,
        updatedAt: Date.now(),
        messageCount: 0,
        lastPrompt: null,
        live: null,
        pinned: false,
        archived: false,
      });
      setSelectedId(null);
    } catch (e) {
      setActionError(errorText(e));
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(errorText(e));
    }
  };

  return (
    <div className="flex h-full">
      <div className="flex w-[304px] shrink-0 flex-col border-r border-line">
        <div className="shrink-0 space-y-2.5 px-3 pt-3 pb-2">
          <Button variant="secondary" icon="plus" className="w-full justify-start" onClick={() => void startNew()}>
            新会话
          </Button>
          <TextField icon="search" placeholder="搜索标题或内容" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="flex items-center gap-1">
            {(["all", "pinned", "archived"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={
                  "h-6 rounded-chip px-2 font-sans text-[12px] transition-colors " +
                  (tab === t ? "bg-surface text-ink shadow-subtle ring-1 ring-line" : "text-ink-muted hover:bg-hover hover:text-ink")
                }
              >
                {t === "all" ? "全部" : t === "pinned" ? "置顶" : "归档"}
              </button>
            ))}
            <span className="ml-auto font-sans text-[11px] text-ink-faint">
              {loading ? "读取中…" : `${visible.length} 个`}
            </span>
          </div>
        </div>

        {(error || actionError) && (
          <p className="mx-3 mb-2 rounded-control border border-line bg-surface px-2.5 py-1.5 font-sans text-[11.5px] text-danger">
            {actionError ?? error}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {!loading && visible.length === 0 && (
            <EmptyState
              icon={tab === "archived" ? "archive" : "chat"}
              title={search ? "没有匹配的会话" : tab === "archived" ? "没有归档的会话" : tab === "pinned" ? "没有置顶的会话" : "还没有会话"}
              hint={search ? "试试搜索消息内容中的关键词。" : "用 claude 在任意项目里开始对话，会话会自动出现在这里。"}
            />
          )}
          <ul className="space-y-0.5">
            {visible.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                active={s.id === active?.id}
                onSelect={() => {
                  setNewSession(null);
                  setSelectedId(s.id);
                }}
                onPin={() => act(() => setFlag(s.id, { pinned: !s.pinned }))}
                onArchive={() => act(() => setFlag(s.id, { archived: !s.archived }))}
                onDelete={() => setPendingDelete(s)}
              />
            ))}
          </ul>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {active ? (
          <ChatView
            key={active.id}
            session={active}
            isNew={!!newSession}
            onChanged={handleChanged}
            onFork={handleFork}
          />
        ) : (
          <div className="flex h-full">
            <EmptyState icon="chat" title="选择一个会话" hint="左侧列出本机所有项目里的 Claude Code 会话，点击即可查看历史并继续对话。" />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这个会话？"
        description={`会从磁盘删除会话记录文件（${pendingDelete?.title ?? ""}），此操作不可撤销。若只想隐藏，请改用"归档"。`}
        confirmLabel="删除"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (!target) return;
          void act(async () => {
            await remove(target.id);
            if (selectedId === target.id) setSelectedId(null);
          });
        }}
      />
    </div>
  );
}

function SessionRow({ session, active, onSelect, onPin, onArchive, onDelete }: {
  session: SessionSummary;
  active: boolean;
  onSelect: () => void;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const busy = session.live?.status === "busy";
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect())}
        className={
          "group relative cursor-pointer rounded-control border px-2.5 py-2 transition-colors " +
          (active ? "border-line bg-surface shadow-subtle" : "border-transparent hover:bg-hover")
        }
      >
        <div className="flex items-center gap-1.5">
          {session.pinned && <Icon name="pin" size={11} className="shrink-0 text-accent" />}
          <span className="min-w-0 flex-1 truncate font-sans text-[13px] font-medium text-ink">{session.title}</span>
          {session.live && (
            <span className="inline-flex shrink-0 items-center gap-1 font-sans text-[10px] text-ink-faint">
              <span className={`inline-block size-1.5 rounded-pill ${busy ? "animate-pulse bg-accent" : "bg-ok"}`} />
              运行中
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 pl-0 font-sans text-[11px] text-ink-faint">
          <span className="truncate">{baseName(session.projectPath) || "未知项目"}</span>
          <span>·</span>
          <span className="shrink-0">{relativeTime(session.updatedAt)}</span>
          <span>·</span>
          <span className="shrink-0">{session.messageCount} 条</span>
        </div>

        <div
          // 只在悬浮或键盘聚焦到操作按钮时显示；注意不能用 group-focus-within，
          // 否则点击会话行后行本身持有焦点，工具栏会一直挂着
          className={
            "absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5 rounded-chip border border-line bg-surface p-0.5 " +
            "pointer-events-none opacity-0 shadow-subtle transition-opacity duration-150 " +
            "group-hover:pointer-events-auto group-hover:opacity-100 " +
            "focus-within:pointer-events-auto focus-within:opacity-100"
          }
          onClick={(e) => e.stopPropagation()}
        >
          <RowAction label={session.pinned ? "取消置顶" : "置顶"} icon="pin" onClick={onPin} />
          <RowAction label={session.archived ? "取消归档" : "归档"} icon="archive" onClick={onArchive} />
          <RowAction label="删除" icon="trash" danger onClick={onDelete} />
        </div>
      </div>
    </li>
  );
}

function RowAction({ label, icon, onClick, danger }: {
  label: string;
  icon: "pin" | "archive" | "trash";
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex size-6 items-center justify-center rounded-chip transition-colors hover:bg-sunken ${danger ? "text-danger" : "text-ink-muted hover:text-ink"}`}
    >
      <Icon name={icon} size={12} />
    </button>
  );
}
