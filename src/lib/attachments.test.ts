import { describe, expect, it } from "vitest";

import { composeMessage, fileName, splitAttachments } from "./attachments";

describe("attachments", () => {
  it("把附件路径附在消息末尾并可还原", () => {
    const text = "看一下这两个文件";
    const files = ["/tmp/a.ts", "/tmp/b.md"];
    const message = composeMessage(text, files);
    expect(message).toContain(text);
    expect(splitAttachments(message)).toEqual({ body: text, files });
  });

  it("只有附件时生成可读的正文", () => {
    const message = composeMessage("", ["/tmp/a.ts"]);
    const parsed = splitAttachments(message);
    expect(parsed.body).toBe("请查看以下附加文件：");
    expect(parsed.files).toEqual(["/tmp/a.ts"]);
  });

  it("没有附件时保持原文", () => {
    expect(composeMessage("hello", [])).toBe("hello");
    expect(splitAttachments("hello")).toEqual({ body: "hello", files: [] });
  });

  it("路径可能包含空格", () => {
    const files = ["/tmp/a b/c d.txt"];
    expect(splitAttachments(composeMessage("x", files)).files).toEqual(files);
  });

  it("取文件名时兼容 Windows 分隔符", () => {
    expect(fileName("C:\\work\\a.txt")).toBe("a.txt");
    expect(fileName("/tmp/dir/")).toBe("dir");
  });
});
