import { describe, expect, it } from "vitest";
import { canSend, initialRunState, reduce, type RunState, type Signal } from "./machine";

const perm = (id: string, tool = "Bash"): Signal => ({
  type: "cli_message",
  at: 0,
  msg: {
    type: "control_request",
    request_id: id,
    request: { subtype: "can_use_tool", tool_name: tool, input: { command: "ls" } },
  },
});
const msg = (m: Record<string, unknown>): Signal => ({ type: "cli_message", at: 0, msg: m as never });
const run = (...signals: Signal[]) => signals.reduce<RunState>(reduce, initialRunState);

describe("run state machine", () => {
  it("idle → streaming → awaiting-permission → streaming → done", () => {
    const phases: string[] = [];
    let s = reduce(initialRunState, { type: "spawned" });
    phases.push(s.phase);
    for (const sig of [
      { type: "user_sent" } as Signal,
      perm("r1"),
      { type: "permission_decided", requestId: "r1" } as Signal,
      msg({ type: "result", subtype: "success", is_error: false }),
    ]) {
      s = reduce(s, sig);
      phases.push(s.phase);
    }
    expect(phases).toEqual(["idle", "streaming", "awaiting-permission", "streaming", "done"]);
    expect(canSend(s)).toBe(true);
  });

  it("queues parallel permission requests and only resumes when the queue drains", () => {
    let s = run({ type: "spawned" }, { type: "user_sent" }, perm("a"), perm("b"));
    expect(s.pending.map((p) => p.requestId)).toEqual(["a", "b"]);
    s = reduce(s, { type: "permission_decided", requestId: "a" });
    expect(s.phase).toBe("awaiting-permission");
    s = reduce(s, { type: "permission_decided", requestId: "b" });
    expect(s.phase).toBe("streaming");
  });

  it("drops duplicated requests", () => {
    const s = run({ type: "spawned" }, { type: "user_sent" }, perm("a"), perm("a"));
    expect(s.pending).toHaveLength(1);
  });

  it("handles control_cancel_request from the CLI", () => {
    const s = run(
      { type: "spawned" },
      { type: "user_sent" },
      perm("a"),
      msg({ type: "control_cancel_request", request_id: "a" }),
    );
    expect(s.phase).toBe("streaming");
    expect(s.pending).toHaveLength(0);
  });

  it("captures the session id from any message", () => {
    const s = run({ type: "spawned" }, msg({ type: "system", subtype: "init", session_id: "abc" }));
    expect(s.sessionId).toBe("abc");
  });

  it("releases the UI when the process dies mid-turn", () => {
    const s = run({ type: "spawned" }, { type: "user_sent" }, perm("a"), { type: "exited", code: 1, killed: false });
    expect(s.phase).toBe("done");
    expect(s.process).toBe("exited");
    expect(s.pending).toHaveLength(0);
    expect(s.error).toMatch(/code 1/);
    expect(canSend(s)).toBe(false);
  });

  it("does not report an error when the user stopped the run", () => {
    const s = run({ type: "spawned" }, { type: "user_sent" }, { type: "exited", code: null, killed: true });
    expect(s.error).toBeNull();
  });

  it("ignores illegal transitions instead of throwing", () => {
    const s = run({ type: "spawned" }, msg({ type: "result", subtype: "success", is_error: false }));
    expect(s.phase).toBe("idle");
  });

  it("does not reopen a turn on late assistant messages", () => {
    const s = run(
      { type: "spawned" },
      { type: "user_sent" },
      msg({ type: "result", subtype: "success", is_error: false }),
      msg({ type: "assistant", message: { role: "assistant", content: [] } }),
    );
    expect(s.phase).toBe("done");
  });
});
