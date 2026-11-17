/**
 * Edit / Write 权限确认前的并排 diff。
 * 每个 hunk 可单独回滚：允许时把回滚过的片段剔除后再交给 CLI。
 */
import { useEffect, useMemo, useState } from "react";

import { applyRejected, diffChunks, layoutDiff } from "@/lib/diff";
import { errorText, ipc } from "@/lib/ipc";

interface Props {
  tool: string;
  input: Record<string, unknown>;
  onChange: (input: Record<string, unknown>) => void;
}

export function DiffReview({ tool, input, onChange }: Props) {
  const isWrite = tool === "Write";
  const isEdit = tool === "Edit";
  const path = typeof input.file_path === "string" ? input.file_path : "";
  const newText = String((isWrite ? input.content : input.new_string) ?? "");

  const [base, setBase] = useState<string | null>(isEdit ? String(input.old_string ?? "") : null);
  const [loading, setLoading] = useState(isWrite);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!isWrite) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    setBase(null);
    ipc
      .fileText(path)
      .then(
        (text) => {
          if (!alive) return;
          setBase(text ?? "");
          setLoading(false);
        },
        (e) => {
          if (!alive) return;
          setLoadError(errorText(e));
          setLoading(false);
        },
      );
    return () => {
      alive = false;
    };
  }, [isWrite, path]);

  const oldText = isWrite ? base : String(input.old_string ?? "");
  const chunks = useMemo(
    () => (!loading && !loadError && oldText !== null ? diffChunks(oldText, newText) : null),
    [loading, loadError, oldText, newText],
  );
  const hunks = useMemo(() => chunks?.filter((c) => c.kind === "change").length ?? 0, [chunks]);

  useEffect(() => {
    setRejected(new Set());
  }, [oldText, newText]);

  useEffect(() => {
    if (!chunks) return;
    onChange({
      ...input,
      [isWrite ? "content" : "new_string"]: applyRejected(chunks, rejected),
    });
    // input 来自权限请求，只在请求变化时变；onChange 是稳定的 setState
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunks, rejected, isWrite, onChange]);

  if (!isEdit && !isWrite) return null;

  const rows = chunks ? layoutDiff(chunks) : [];

  return (
    <div className="overflow-hidden rounded-control border border-line bg-canvas">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5 font-sans text-[11px] text-ink-faint">
        <span className="font-medium text-ink">变更审查</span>
        {path && <span className="min-w-0 flex-1 truncate font-mono">{path}</span>}
        {hunks > 0 && (
          <>
            <span>
              {hunks} 个 hunk
              {rejected.size > 0 && ` · 已回滚 ${rejected.size}`}
            </span>
            <button
              type="button"
              className="rounded-chip px-1.5 text-accent hover:bg-sunken"
              onClick={() => setRejected(new Set())}
            >
              全部接受
            </button>
            <button
              type="button"
              className="rounded-chip px-1.5 text-danger hover:bg-sunken"
              onClick={() => setRejected(new Set(chunks?.filter((c) => c.kind === "change").map((c) => c.id)))}
            >
              全部回滚
            </button>
          </>
        )}
      </div>

      {loading ? (
        <p className="px-3 py-3 font-sans text-[12px] text-ink-faint">正在读取原文件…</p>
      ) : loadError ? (
        <p className="px-3 py-3 font-sans text-[12px] text-danger">
          无法读取原文件（{loadError}），将按原参数执行，不能逐块审查。
        </p>
      ) : hunks === 0 ? (
        <p className="px-3 py-3 font-sans text-[12px] text-ink-faint">内容没有变化。</p>
      ) : (
        <div className="max-h-72 overflow-auto font-mono text-[11.5px] leading-[1.55]">
          {rows.map((row, i) => {
            if (row.type === "gap") {
              return (
                <div key={i} className="border-y border-line bg-sunken/40 px-3 py-0.5 text-center text-[10.5px] text-ink-faint">
                  ⋯ 省略 {row.count} 行未变更内容
                </div>
              );
            }
            if (row.type === "hunk") {
              const h = row.hunk;
              const rolled = rejected.has(h.id);
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 border-y border-line bg-accent-tint/40 px-2 py-1 font-sans text-[10.5px]"
                >
                  <code className="text-ink-muted">
                    @@ -{h.oldStart},{h.oldCount} +{h.newStart},{h.newCount} @@
                  </code>
                  <button
                    type="button"
                    onClick={() =>
                      setRejected((prev) => {
                        const next = new Set(prev);
                        if (next.has(h.id)) next.delete(h.id);
                        else next.add(h.id);
                        return next;
                      })
                    }
                    className={
                      "ml-auto rounded-chip border px-1.5 leading-4 " +
                      (rolled
                        ? "border-line bg-surface text-ink-muted hover:text-ink"
                        : "border-danger/40 bg-surface text-danger hover:bg-sunken")
                    }
                  >
                    {rolled ? "接受此块" : "回滚此块"}
                  </button>
                </div>
              );
            }
            if (row.type === "context") {
              return (
                <div key={i} className="grid grid-cols-2 border-b border-line/50 last:border-0">
                  <Cell no={row.oldNo} text={row.text} tone="context" />
                  <Cell no={row.newNo} text={row.text} tone="context" />
                </div>
              );
            }
            const rolled = rejected.has(row.hunkId);
            return (
              <div
                key={i}
                className={"grid grid-cols-2 border-b border-line/50 last:border-0 " + (rolled ? "opacity-40" : "")}
              >
                <Cell no={row.oldNo} text={row.oldText} tone="old" />
                <Cell no={row.newNo} text={row.newText} tone="new" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Cell({ no, text, tone }: { no: number | null; text: string | null; tone: "old" | "new" | "context" }) {
  const toneClass =
    tone === "old" && text !== null
      ? "bg-danger/10 text-ink"
      : tone === "new" && text !== null
        ? "bg-ok/10 text-ink"
        : "text-ink-muted";
  return (
    <div className={"flex min-w-0 gap-2 border-r border-line/50 px-2 last:border-r-0 " + toneClass}>
      <span className="w-7 shrink-0 select-none text-right text-[10px] text-ink-faint">{no ?? ""}</span>
      <span className="min-w-0 whitespace-pre-wrap break-all">{text === null ? " " : text === "" ? " " : text}</span>
    </div>
  );
}
