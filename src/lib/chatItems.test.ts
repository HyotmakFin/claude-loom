import { describe, expect, it } from "vitest";

import type { CliMessage } from "@/cli/protocol";

import { itemsFromCli } from "./chatItems";

const assistant = (text: string): CliMessage => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text }] },
});

describe("itemsFromCli", () => {
  it("追加消息时，已有条目的 key 保持不变（避免流式更新时整段重挂载）", () => {
    const before = itemsFromCli([assistant("a"), assistant("b")]);
    const after = itemsFromCli([assistant("a"), assistant("b"), assistant("c")]);

    expect(after.slice(0, 2).map((i) => i.key)).toEqual(before.map((i) => i.key));
    expect(new Set(after.map((i) => i.key)).size).toBe(3);
  });

  it("同等输入重复构建得到相同 key", () => {
    const a = itemsFromCli([assistant("a")]);
    const b = itemsFromCli([assistant("a")]);
    expect(a.map((i) => i.key)).toEqual(b.map((i) => i.key));
  });
});
