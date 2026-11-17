/** 行级 diff：用于权限确认前的并排审查与逐 hunk 回滚。 */
import { diffLines } from "diff";

export type DiffChunk =
  | { kind: "equal"; value: string }
  | { kind: "change"; id: number; oldValue: string; newValue: string };

export interface Hunk {
  id: number;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

export type DiffRow =
  | { type: "context"; oldNo: number; newNo: number; text: string }
  | { type: "gap"; count: number }
  | { type: "hunk"; hunk: Hunk }
  | {
      type: "change";
      hunkId: number;
      oldNo: number | null;
      newNo: number | null;
      oldText: string | null;
      newText: string | null;
    };

/** 连续的新增/删除合并成一个可回滚的 hunk；未变化的行保留原文以便无损还原。 */
export function diffChunks(oldText: string, newText: string): DiffChunk[] {
  const parts = diffLines(oldText, newText);
  const chunks: DiffChunk[] = [];
  let id = 0;
  let change: { oldValue: string; newValue: string } | null = null;

  const flush = () => {
    if (!change) return;
    chunks.push({ kind: "change", id: ++id, ...change });
    change = null;
  };

  for (const part of parts) {
    if (part.added || part.removed) {
      change ??= { oldValue: "", newValue: "" };
      if (part.removed) change.oldValue += part.value;
      else change.newValue += part.value;
    } else {
      flush();
      chunks.push({ kind: "equal", value: part.value });
    }
  }
  flush();
  return chunks;
}

export function hunkCount(chunks: DiffChunk[]): number {
  return chunks.filter((c) => c.kind === "change").length;
}

/** 按被回滚的 hunk 集合重建文本；全部接受时精确等于 newText。 */
export function applyRejected(chunks: DiffChunk[], rejected: ReadonlySet<number>): string {
  return chunks
    .map((c) => {
      if (c.kind === "equal") return c.value;
      return rejected.has(c.id) ? c.oldValue : c.newValue;
    })
    .join("");
}

export function linesOf(value: string): string[] {
  if (!value) return [];
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function layoutDiff(chunks: DiffChunk[], context = 3): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 1;
  let newNo = 1;

  for (const chunk of chunks) {
    if (chunk.kind === "equal") {
      const lines = linesOf(chunk.value);
      if (!lines.length) continue;
      if (lines.length <= context * 2 + 1) {
        for (const text of lines) {
          rows.push({ type: "context", oldNo: oldNo++, newNo: newNo++, text });
        }
      } else {
        for (let i = 0; i < context; i++) {
          rows.push({ type: "context", oldNo: oldNo++, newNo: newNo++, text: lines[i]! });
        }
        const hidden = lines.length - context * 2;
        rows.push({ type: "gap", count: hidden });
        oldNo += hidden;
        newNo += hidden;
        for (let i = lines.length - context; i < lines.length; i++) {
          rows.push({ type: "context", oldNo: oldNo++, newNo: newNo++, text: lines[i]! });
        }
      }
      continue;
    }

    const oldLines = linesOf(chunk.oldValue);
    const newLines = linesOf(chunk.newValue);
    const hunk: Hunk = {
      id: chunk.id,
      oldStart: oldNo,
      oldCount: oldLines.length,
      newStart: newNo,
      newCount: newLines.length,
    };
    rows.push({ type: "hunk", hunk });
    const height = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < height; i++) {
      const left = i < oldLines.length ? oldLines[i]! : null;
      const right = i < newLines.length ? newLines[i]! : null;
      rows.push({
        type: "change",
        hunkId: chunk.id,
        oldNo: left === null ? null : oldNo,
        newNo: right === null ? null : newNo,
        oldText: left,
        newText: right,
      });
      if (left !== null) oldNo++;
      if (right !== null) newNo++;
    }
  }
  return rows;
}
