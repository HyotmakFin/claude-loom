# Loom

Claude Code CLI 的图形外壳。渲染层是 React 19 + TypeScript + Tailwind 4，跑在 **Electron / Chromium** 上；
业务后端是一个独立的 Rust sidecar 进程（`loom-backend`），通过 JSON-RPC over stdio 与 Electron 主进程通信。

Loom 只是一层薄壳：不负责安装 CLI，也不处理网络或模型适配。它假设 `claude` 已经安装好并且在 PATH 中
（也可以在界面配置里指定路径）。

## 为什么从 Tauri 换成 Electron

Linux 上的 Tauri 使用 WebKitGTK。WebKitGTK 2.54 在 Wayland 下把上屏帧率硬限制在 60fps：
`PreferPageRenderingUpdatesNear60FPS` 默认开启、VBlank 监视器在没有 displayID 时固定 60Hz、
渲染更新间隔 15ms。逐层补丁（监视器 200Hz、关闭 feature、trampoline 相关函数）之后，
Wayland surface commit 仍然精确是 60fps。

同一台机器、同一个 KWin/Wayland 会话，Electron 稳定 **200fps**（2560×1440@200Hz）。
所以 Loom 0.5 起改用 Electron：

- 渲染：Electron 45 / Chromium（Wayland 原生，`requestAnimationFrame` 跟随显示器刷新率）
- 前端：React 代码原样复用，只把 Tauri API 替换成 `window.loom` 桥
- 后端：Rust sidecar 复用 `sidecar/backend/src` 下的会话、配置、Skill、插件、CLI、预览逻辑，
  24 个 Rust 单测和 17 个前端单测继续运行

## 架构

```
┌───────────────────────────── Electron ─────────────────────────────┐
│  renderer (React)  ←─ preload.cjs (contextBridge) ─→  main.cjs     │
│                                                         │ IPC      │
└─────────────────────────────────────────────────────────┼──────────┘
                                                          ▼
                                   loom-backend（Rust sidecar，stdio JSON-RPC）
                                   ├─ 会话 JSONL 扫描 / 分叉 / 删除
                                   ├─ claude CLI 子进程 + NDJSON 流
                                   ├─ 配置 / Skill / 插件 / 文件预览
                                   └─ 事件：{"event":"loom://cli","payload":...}
```

sidecar 通过 `#[path]` 直接包含 `sidecar/backend/src` 的模块；项目里不再保留 Tauri 外壳。

## 功能

- **会话**：读取 `~/.claude/projects/*/*.jsonl` 与本机运行记录 `~/.claude/sessions/*.json`，
  列出标题、项目、时间、消息数与运行状态；支持按标题/内容搜索、置顶、归档、删除。
  点击会话查看历史，发送消息时以 `claude --resume <sessionId>` 续聊。
- **BYOK**：多套配置，按 cc-switch 的约定注入 `ANTHROPIC_BASE_URL`、
  `ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY`，以及
  `ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_{OPUS,SONNET,FABLE,HAIKU}_MODEL(_NAME)`、
  `CLAUDE_CODE_SUBAGENT_MODEL`；支持显示名与 1M（`[1m]`）标记，Key 默认掩码。
- **Skill**：扫描 `~/.claude/skills/*/SKILL.md`，启停、编辑 frontmatter 与正文、新建 Skill。
- **插件**：列出已安装插件；添加外部插件目录并通过 `--plugin-dir` 传给 CLI。
- **斜杠命令**：输入 `/` 实时预览当前目录可用的命令 / Skill，↑↓ 选择，Enter 或 Tab 填入。
- **消息操作**：复制整条消息或代码块；从任意助手回复分叉出新会话；
  删除用户输入或助手回复（按整轮删除，原文件自动备份到 Loom 配置目录）。
- **新会话**：会话列表顶部的「新会话」，选择目录后直接开始。
- **预览**：与对话并排、可折叠；Markdown、图片、代码高亮（Shiki），
  localhost 网页内嵌，其余可在系统浏览器打开。
- **深色模式**：跟随系统 / 浅色 / 深色三态切换，代码高亮同步。
- **权限**：CLI 的工具权限请求会变成确认卡片（允许 / 始终允许 / 拒绝 / 拒绝并中止）。

## 数据位置

| 内容 | 位置 |
| --- | --- |
| Claude Code 数据 | `$CLAUDE_CONFIG_DIR`，未设置时为 `~/.claude` |
| Loom 配置（含 API Key） | Electron `appData/dev.loom.app`：Linux `~/.config/dev.loom.app`、macOS `~/Library/Application Support/dev.loom.app`、Windows `%APPDATA%\dev.loom.app` |
| claude 可执行文件 | PATH；可在界面配置里指定 |

API Key 以明文保存在 Loom 的配置文件中（Unix 下权限 0600），不要在共享机器上使用。

## 安装

从 [Releases](https://github.com/HyotMakFin/claude-loom/releases) 下载 0.5.0 的 Linux 包：

**Arch Linux**

```bash
sudo pacman -U claude-loom-0.5.0.pacman
```

**任意 Linux**

```bash
chmod +x Loom-0.5.0.AppImage
./Loom-0.5.0.AppImage
```

无 FUSE 时：`./Loom-0.5.0.AppImage --appimage-extract-and-run`。

Windows / macOS 的 Electron 构建尚未发布；0.4.0 的旧 Tauri 包仍可在 Releases 中下载。

## 开发

```bash
npm install
(cd sidecar && cargo build)   # 首次：构建 Rust sidecar
npm run build                 # 构建前端到 dist/
npm run electron              # 启动 Electron（加载 dist/）
```

| 命令 | 用途 |
| --- | --- |
| `npm test` | 前端单测 |
| `npm run typecheck` | TypeScript 检查 |
| `(cd sidecar && cargo test)` | Rust 后端单测 |

调试时可设置 `LOOM_DEBUG=1` 看渲染进程 console，`LOOM_BACKEND=/path/to/loom-backend` 指定 sidecar。

## 打包

```bash
(cd sidecar && cargo build --release)
npm run build
npx electron-builder --linux            # AppImage + pacman
npx electron-builder --linux AppImage   # 只打 AppImage
```

产物在 `release/`。Windows/macOS 需要各自的 runner 上执行 `electron-builder --win` / `--mac`。

## 帧率验收

```bash
LOOM_FPS_OVERLAY=1 ./release/Loom-0.5.0.AppImage
```

右下角会显示当前 rAF 帧率。在 200Hz 显示器上实测稳定 **200.0 fps**。

## 品牌

标志为一根橙色纬线以拱形越过中间经线、从两侧经线背后穿过——"织机"的经纬交织。
品牌资源由 `scripts/build-logo.py` 生成到 `assets/brand/`；Electron 使用 `electron/icon.png`。
