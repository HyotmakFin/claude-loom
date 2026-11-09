#!/usr/bin/env node
// 不依赖 Tauri 的协议冒烟测试：以与 src-tauri/src/cli/process.rs 相同的参数 spawn claude，
// 发送一条会触发 Bash 权限请求的消息，自动 allow，打印状态迁移，直到 result。
// 用法：node scripts/smoke-cli.mjs [cwd]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cwd = process.argv[2] ?? mkdtempSync(join(tmpdir(), "loom-smoke-"));
const child = spawn(
  process.env.LOOM_CLAUDE_PATH ?? "claude",
  ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-prompt-tool", "stdio"],
  { cwd, env: { ...process.env, CLAUDECODE: undefined }, stdio: ["pipe", "pipe", "inherit"], shell: process.platform === "win32" },
);
const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
let phase = "idle";
const to = (p) => { if (p !== phase) console.log(`  phase: ${phase} → ${p}`); phase = p; };

let buf = "";
child.stdout.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).replace(/\r$/, "");
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    console.log(`← ${m.type}${m.subtype ? "/" + m.subtype : ""}${m.request?.subtype ? " " + m.request.subtype + " " + m.request.tool_name : ""}`);
    if (m.type === "control_request" && m.request.subtype === "can_use_tool") {
      to("awaiting-permission");
      console.log("  input:", JSON.stringify(m.request.input), "suggestions:", (m.request.permission_suggestions ?? []).length);
      send({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: { behavior: "allow", updatedInput: m.request.input } } });
      to("streaming");
    } else if (m.type === "result") {
      to("done");
      console.log("  result:", m.is_error ? "ERROR" : "ok", JSON.stringify(m.result ?? "").slice(0, 160));
      child.stdin.end();
    }
  }
});
child.on("exit", (code) => { console.log("exit", code); process.exit(code ?? 1); });

send({ type: "user", message: { role: "user", content: [{ type: "text", text: "Run the shell command `echo loom-ok > marker.txt && cat marker.txt` with the Bash tool, then reply with just its output." }] }, parent_tool_use_id: null, session_id: "" });
to("streaming");
setTimeout(() => { console.error("timeout"); child.kill(); }, 120_000);
