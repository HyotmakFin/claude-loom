# 架构

Loom 0.5 起由三个进程/层组成：

```
┌───────────────────────────── Electron ─────────────────────────────┐
│  renderer (React + Vite)  ←─ preload.cjs（contextBridge）─→ main.cjs│
│                                                          │ IPC      │
└──────────────────────────────────────────────────────────┼──────────┘
                                                           ▼
                                    loom-backend（Rust，stdio JSON-RPC）
                                    ├─ 会话 JSONL 扫描 / 分叉 / 删除
                                    ├─ claude CLI 子进程 + NDJSON 流
                                    ├─ 配置 / Skill / 插件 / 文件预览
                                    └─ 事件 → {"event":"loom://cli","payload":...}
```

## 目录

| 路径 | 作用 |
| --- | --- |
| `src/` | React 渲染层：会话、聊天、预览、Skill、插件、CLI 调试 |
| `src/lib/electron.ts` | `window.loom` 桥的 TypeScript 封装（invoke / onEvent / 对话框 / 剪贴板） |
| `electron/main.cjs` | 创建窗口、启动 sidecar、转发 IPC/事件、系统对话框 |
| `electron/preload.cjs` | `contextBridge` 暴露最小 API；渲染层无 Node 权限 |
| `sidecar/src/main.rs` | sidecar 入口：stdin JSON-RPC、stdout 响应/事件、命令分发 |
| `sidecar/backend/src/` | 复用的 Rust 后端：`cli/`、`sessions/`、`config.rs`、`paths.rs`、`plugins.rs`、`skills/`、`preview.rs`、`platform.rs` |
| `sidecar/tauri-shim/` | 最小 `tauri` 兼容层（`AppHandle` / `State` / `emit` / `async_runtime`），让后端模块无需改代码即可编译进 sidecar |

## 协议

请求（每行一个）：

```json
{"id":1,"cmd":"session_list","args":{"includeArchived":false}}
```

响应：

```json
{"id":1,"ok":true,"data":[...]}
```

CLI 事件由 sidecar 主动写 stdout：

```json
{"event":"loom://cli","payload":{"kind":"message","runId":"...","msg":{...}}}
```

Electron main 收到后 `webContents.send("loom:event", event, payload)`，preload 转成
`window.loom.onEvent(name, cb)`，`src/stores/runs.ts` 里的状态机消费。

## 关键流程

- **会话列表/详情**：`session_list` / `session_messages` 扫描 `~/.claude/projects/*/*.jsonl`，
  读取 `~/.claude/sessions/*.json` 的实时运行记录；Loom 自己的置顶/归档在配置文件中。
- **发消息**：`cli_start` 以 `claude -p --input-format stream-json --output-format stream-json --verbose`
  启动子进程；前端把 user 消息/control_response 通过 `cli_send` 写回 stdin；sidecar 逐行解析 stdout，
  原样转成事件。权限请求（`control_request`）在前端渲染成确认卡片。
- **配置**：`~/.config/dev.loom.app/config.json` 只保存插件目录、会话置顶/归档、CLI 路径和
  权限模式。Provider/API Key 由 cc-switch 或 Claude Code 的 `settings.json` 管理，Loom 不读写。
- **预览**：`preview_file` 读取文件并生成 data URL；localhost 用 iframe 内嵌，其他地址交给
  Electron `shell.openExternal`。
- **删除/分叉**：直接操作 JSONL；删除按整轮移除并备份到配置目录的 `session-backups/`。

## 为什么不是 Tauri

Linux 的 Tauri 使用 WebKitGTK。WebKitGTK 2.54 在 Wayland 下把上屏帧率限制在 60fps
（`PreferPageRenderingUpdatesNear60FPS` 默认开启、VBlank 监视器固定 60Hz、渲染间隔 15ms）。
逐层补丁后 Wayland surface commit 仍精确为 60fps。Electron/Chromium 在同一台机器上稳定
200fps，所以 0.5 起渲染层换成 Electron。

`sidecar/tauri-shim` 只是为了复用后端模块的 API 形状，与 Tauri 运行时无关。
