import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: unknown[] = [];
let emit: (payload: unknown) => void = () => {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: { message?: unknown }) => {
    if (cmd === "cli_start") {
      // Rust 侧在命令返回前已发出 spawned 事件，这里模拟同样的顺序
      queueMicrotask(() => emit({ kind: "spawned", runId: "run-1", pid: 1, cliPath: "claude" }));
      return "run-1";
    }
    if (cmd === "cli_send") {
      await new Promise((r) => setTimeout(r, 5)); // 模拟 IPC 往返，制造重入窗口
      sent.push(args.message);
    }
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_: string, cb: (e: { payload: unknown }) => void) => {
    emit = (payload) => cb({ payload });
    return () => {};
  }),
}));

const { useRuns } = await import("./runs");

describe("runs store", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("answers each permission request exactly once, even when called re-entrantly", async () => {
    const id = await useRuns.getState().start({ cwd: "/" });
    await useRuns.getState().send(id, "hi");
    emit({
      kind: "message",
      runId: id,
      msg: { type: "control_request", request_id: "p1", request: { subtype: "can_use_tool", tool_name: "Bash", input: {} } },
    });
    expect(useRuns.getState().runs[id]!.state.phase).toBe("awaiting-permission");

    const allow = { behavior: "allow", updatedInput: {} } as const;
    await Promise.all([1, 2, 3].map(() => useRuns.getState().decide(id, "p1", allow)));
    await useRuns.getState().decide(id, "p1", allow); // 已应答后再次调用

    const responses = sent.filter((m) => (m as { type: string }).type === "control_response");
    expect(responses).toHaveLength(1);
    expect(useRuns.getState().runs[id]!.state.phase).toBe("streaming");
  });
});
