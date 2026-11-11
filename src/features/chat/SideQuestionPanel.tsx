/**
 * 侧问面板：在当前会话上下文里问一个只读的短问题，不打断主对话。
 * 通过 fork + no-session-persistence 启动独立的 CLI 进程，并禁用全部工具（对应 CLI 的 /btw）。
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { Markdown } from "@/components/ui/Markdown";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { TextArea } from "@/components/ui/TextField";
import { itemsFromCli } from "@/lib/chatItems";
import { errorText } from "@/lib/ipc";
import { useRuns } from "@/stores/runs";

interface Props {
  cwd: string | null;
  /** 当前会话 id；主 CLI 还没建立会话时为 null（侧问将不带历史上下文） */
  sessionId: string | null;
  model: string | null;
  cliPath?: string;
  onClose: () => void;
}

export function SideQuestionPanel({ cwd, sessionId, model, cliPath, onClose }: Props) {
  const [question, setQuestion] = useState("");
  const [sideRunId, setSideRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const runIdRef = useRef<string | null>(null);

  const sideRun = useRuns((s) => (sideRunId ? s.runs[sideRunId] : undefined));

  // 关闭面板时结束侧问进程并清理 store 中的临时 run
  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      const id = runIdRef.current;
      if (!id) return;
      runIdRef.current = null;
      void useRuns
        .getState()
        .stop(id)
        .finally(() => useRuns.getState().forget(id));
    };
  }, []);

  // 回答结束就停掉常驻的 stream-json 进程，保留消息用于展示
  useEffect(() => {
    if (!sideRunId || sideRun?.state.phase !== "done") return;
    void useRuns.getState().stop(sideRunId);
  }, [sideRunId, sideRun?.state.phase]);

  const items = useMemo(() => (sideRun ? itemsFromCli(sideRun.messages) : []), [sideRun?.messages]);
  const finalText = useMemo(
    () =>
      items
        .filter((i) => i.role === "assistant" && i.text?.trim())
        .map((i) => i.text!.trim())
        .join("\n\n"),
    [items],
  );
  const streaming = !!sideRun && (sideRun.state.phase === "streaming" || sideRun.state.phase === "awaiting-permission");
  const answer = streaming ? (sideRun?.partial ?? "") : finalText;
  const runError = sideRun?.state.error ?? null;
  const shownError = error ?? runError;
  const canAsk = !!cwd && !!question.trim() && !starting && !streaming;

  const ask = async () => {
    const text = question.trim();
    if (!text || !cwd || starting || streaming) return;
    setStarting(true);
    setError(null);
    setQuestion("");
    try {
      const prev = runIdRef.current;
      if (prev) {
        await useRuns.getState().stop(prev);
        useRuns.getState().forget(prev);
        runIdRef.current = null;
        setSideRunId(null);
      }
      const id = await useRuns.getState().start({
        cwd,
        // 有会话 id 就 resume + fork：读到当前上下文，但不碰原 transcript
        resume: sessionId ?? undefined,
        forkSession: !!sessionId,
        noSessionPersistence: true,
        tools: "",
        partialMessages: true,
        cliPath,
        model: model ?? undefined,
      });
      runIdRef.current = id;
      setSideRunId(id);
      await useRuns.getState().send(id, text);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="absolute right-0 bottom-full left-0 z-30 mb-2 overflow-hidden rounded-card border border-line bg-surface shadow-raised">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Icon name="zap" size={13} className="text-accent" />
        <span className="font-sans text-[12px] font-medium text-ink">侧问</span>
        <span className="font-sans text-[11px] text-ink-faint">不打断主对话 · 不执行工具</span>
        <button
          type="button"
          aria-label="关闭侧问"
          onClick={onClose}
          className="ml-auto flex size-6 items-center justify-center rounded-chip text-ink-muted hover:bg-sunken hover:text-ink"
        >
          <Icon name="x" size={13} />
        </button>
      </div>

      <div className="max-h-[40vh] overflow-y-auto px-3.5 py-3">
        {answer ? (
          streaming ? (
            <p className="whitespace-pre-wrap font-serif text-[13.5px] leading-[1.75] text-ink">
              {answer}
              <span className="ml-0.5 inline-block h-[1.05em] w-[2px] animate-pulse bg-accent align-[-0.15em]" />
            </p>
          ) : (
            <Markdown source={answer} />
          )
        ) : (
          <p className="font-sans text-[12px] leading-relaxed text-ink-faint">
            {starting ? "正在创建侧问会话…" : sideRun ? "等待回答…" : "在当前会话上下文里问一个简短问题，主对话不会中断。"}
          </p>
        )}
        {shownError && (
          <p className="mt-2 rounded-control border border-line bg-canvas px-2.5 py-1.5 font-sans text-[11.5px] text-danger">
            {shownError}
          </p>
        )}
      </div>

      <div className="border-t border-line p-2.5">
        <TextArea
          ref={inputRef}
          rows={2}
          value={question}
          placeholder={cwd ? "输入侧问，Enter 发送，Shift+Enter 换行" : "该会话缺少工作目录"}
          disabled={!cwd || starting}
          className="w-full rounded-field border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void ask();
            }
          }}
        />
        <div className="mt-1.5 flex items-center justify-between">
          <span className="font-sans text-[10.5px] text-ink-faint">只读问答；要改代码请回到主对话</span>
          <Button size="sm" variant="primary" disabled={!canAsk} onClick={() => void ask()}>
            {streaming ? "回答中…" : starting ? "创建中…" : "提问"}
          </Button>
        </div>
      </div>
    </div>
  );
}
