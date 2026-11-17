import { describe, expect, it } from "vitest";

import { applyRejected, diffChunks, layoutDiff } from "./diff";

describe("diffChunks / applyRejected", () => {
  it("全部接受时精确还原新文本", () => {
    const oldText = "a\nb\nc\n";
    const newText = "a\nB\nc\nd\n";
    const chunks = diffChunks(oldText, newText);
    expect(applyRejected(chunks, new Set())).toBe(newText);
  });

  it("全部回滚时精确还原旧文本", () => {
    const oldText = "a\nb\nc\n";
    const newText = "a\nB\nc\nd\n";
    const chunks = diffChunks(oldText, newText);
    const ids = chunks.filter((c) => c.kind === "change").map((c) => c.id);
    expect(applyRejected(chunks, new Set(ids))).toBe(oldText);
  });

  it("只回滚其中一个 hunk", () => {
    const oldText = "one\ntwo\nthree\nfour\nfive\n";
    const newText = "ONE\ntwo\nthree\nfour\nFIVE\n";
    const chunks = diffChunks(oldText, newText);
    const first = chunks.find((c) => c.kind === "change");
    expect(first).toBeTruthy();
    const result = applyRejected(chunks, new Set([first!.id]));
    expect(result).toContain("one");
    expect(result).toContain("FIVE");
    expect(result).not.toContain("ONE");
    expect(result).not.toContain("five");
  });

  it("相同文本没有 hunk", () => {
    const chunks = diffChunks("same\n", "same\n");
    expect(chunks.every((c) => c.kind === "equal")).toBe(true);
  });

  it("布局包含 hunk 头与新旧行号", () => {
    const rows = layoutDiff(diffChunks("a\nb\n", "a\nc\n"));
    const hunk = rows.find((r) => r.type === "hunk");
    expect(hunk && hunk.type === "hunk" ? hunk.hunk : null).toMatchObject({
      oldStart: 2,
      newStart: 2,
      oldCount: 1,
      newCount: 1,
    });
  });
});
