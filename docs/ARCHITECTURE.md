# Loom 架构

## 目录结构（✅ 已完成 / ⏳ 后续模块）

```
loom/
├─ src-tauri/                      Rust：只做进程、文件系统、预览窗口
│  ├─ tauri.conf.json              公共配置 + CSP（frame-src 仅放行 localhost）
│  ├─ tauri.{macos,windows,linux}.conf.json   三平台打包目标（自动合并）
│  └─ src/
│     ├─ lib.rs                    ✅ Builder、命令注册、退出时清理子进程
│     ├─ cli/                      ✅ 模块 1
│     │  ├─ locate.rs              查找 claude(.exe/.cmd)、构造子进程 PATH
│     │  ├─ ndjson.rs              行切分（\n / \r\n / BOM）
│     │  ├─ process.rs             spawn、stdout/stderr 读取、stop/kill 进程树
│     │  └─ commands.rs            cli_locate / cli_start / cli_send / cli_stop
│     ├─ paths.rs                  ✅ ~/.claude / CLAUDE_CONFIG_DIR / 平台配置目录
│     ├─ sessions/                 ✅ 扫描 projects/*.jsonl + sessions/*.json，mtime 缓存
│     ├─ config.rs                 ✅ BYOK 多套配置、插件目录、置顶/归档标记（0600）
│     ├─ skills/                   ✅ SKILL.md 扫描、frontmatter、启停、编辑、新建
│     ├─ plugins.rs                ✅ installed_plugins.json + 外部插件目录
│     ├─ preview.rs                ✅ 本地文件读取（文本/图片，含缓存与截断）
│     └─ platform.rs               ✅ 平台字体解析（fc-match）
│
├─ src/                            React 19 + TS + Tailwind 4 + Zustand
│  ├─ styles/tokens.css            ✅ 全部颜色/字体/圆角/阴影 token（清空了 Tailwind 默认色板）
│  ├─ styles/fonts.css             ✅ @font-face（font-display: block）
│  ├─ cli/protocol.ts              ✅ stream-json 消息类型与 stdin 消息构造
│  ├─ cli/machine.ts               ✅ 运行状态机（纯函数，有单测）
│  ├─ stores/runs.ts               ✅ Tauri 事件 → 状态机 → Zustand；所有 stdin 写入集中于此
│  ├─ lib/ipc.ts                   ✅ invoke 类型化封装
│  ├─ lib/markdown.ts              ✅ markdown-it（禁用 HTML）+ Shiki（JS 正则引擎）
│  ├─ lib/chatItems.ts             ✅ 历史 JSONL 与实时 stream-json → 统一渲染模型
│  ├─ lib/cliOptions.ts            ✅ 配置 → CLI 环境变量 / --plugin-dir
│  ├─ stores/{config,sessions,skills,plugins,runs}.ts  ✅ Zustand
│  ├─ components/ui/               ✅ Button / TextField / Switch / Markdown …（手写）
│  ├─ components/PermissionPrompt  ✅ 权限确认卡片
│  └─ features/
│     ├─ shell/                    ✅ 外框与导航
│     ├─ debug/                    ✅ CLI 调试面板
│     ├─ sessions/                 ✅ 列表、搜索、置顶/归档/删除
│     ├─ chat/                     ✅ 对话视图、流式渲染、乐观回显、权限卡片
│     ├─ byok/                     ✅ 多套配置编辑
│     ├─ skills/  plugins/         ✅ 启停与编辑 / 目录管理
│     └─ preview/                  ✅ Shiki、图片、iframe ↔ 系统浏览器降级
└─ scripts/
   ├─ build-fonts.py               ✅ 下载并生成字体子集（预算检查）
   └─ smoke-cli.mjs                ✅ 不经 Tauri 直接验证 CLI 协议
```

## CLI 通信

```
React ──invoke("cli_send", json)──▶ Rust ──json + "\n"──▶ claude stdin
React ◀──event "loom://cli"─────── Rust ◀──NDJSON 行──── claude stdout
```

spawn 参数：

```
claude -p --input-format stream-json --output-format stream-json --verbose \
       --permission-prompt-tool stdio [--resume <id>] [--model m] [--permission-mode m] [--plugin-dir d]…
```

`--permission-prompt-tool stdio` 让 CLI 把权限请求以控制消息的形式写到 stdout：

```jsonc
// CLI → Loom
{"type":"control_request","request_id":"…","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{…},"permission_suggestions":[…]}}
// Loom → CLI
{"type":"control_response","response":{"subtype":"success","request_id":"…","response":{"behavior":"allow","updatedInput":{…}}}}
{"type":"control_response","response":{"subtype":"success","request_id":"…","response":{"behavior":"deny","message":"…","interrupt":false}}}
// CLI 也可能撤回请求
{"type":"control_cancel_request","request_id":"…"}
```

中断：前端写入 `{"type":"control_request","request_id":"…","request":{"subtype":"interrupt"}}`。
Loom 不支持的 control_request 子类型由 Rust 直接回复 `subtype:"error"`，防止 CLI 卡住。

## 状态机（src/cli/machine.ts）

| 当前 phase | 信号 | 下一 phase |
| --- | --- | --- |
| idle / done | `user_sent` | streaming |
| streaming | `can_use_tool` | awaiting-permission（入队） |
| awaiting-permission | `can_use_tool` | awaiting-permission（入队） |
| awaiting-permission | `permission_decided` / `control_cancel_request` | 队列空 → streaming；否则保持 |
| streaming / awaiting-permission | `result` | done |
| 任意 | 进程 `exit` | 中途退出 → done，清空队列，非 0 且非用户停止则记错误 |

`process`（spawning / alive / exited）是与 phase 正交的维度；`canSend = alive && phase ∈ {idle, done}`。
非法迁移被忽略并打印警告，不抛异常。

## 停止进程

1. 关闭 stdin → CLI 读到 EOF 自行退出；
2. 3 秒未退出 → 杀进程树：Unix 下子进程放在独立进程组，`killpg(SIGKILL)`；
   Windows 下 `taskkill /T /F`（`claude.cmd` 经 cmd.exe 启动 node，只杀父进程会留下孤儿）。
3. 应用退出时同步杀掉所有进程树。


## 会话索引

- 历史：`$CLAUDE_CONFIG_DIR/projects/<编码目录>/<sessionId>.jsonl`（未设置时 `~/.claude`）。
  常用行：`user` / `assistant`（`message.content`）、`ai-title`（`aiTitle`）、`last-prompt`（`lastPrompt`）。
  其他行（attachment、api-request、file-history-snapshot…）忽略；`isSidechain: true` 的子代理内容不进入主对话。
- 运行中：`sessions/*.json`（pid、status、name、cwd、updatedAt），按 sessionId 合并到列表。
- 解析结果按 (mtime, size) 缓存；工具输出截断到 20k 字符。搜索先匹配标题/最近输入，再扫描文件内容（单文件上限 32MB）。
- 置顶/归档存放在 Loom 配置中，不改动 `~/.claude`；删除会移除对应的 JSONL。

## BYOK

启动前由 `lib/cliOptions.ts` 生成：

| 配置 | 环境变量 |
| --- | --- |
| Base URL | `ANTHROPIC_BASE_URL` |
| API Key | `ANTHROPIC_API_KEY`（同时从继承环境中移除 `ANTHROPIC_AUTH_TOKEN`） |
| opus / sonnet / haiku 映射 | `ANTHROPIC_DEFAULT_OPUS_MODEL` / `..._SONNET_MODEL` / `..._HAIKU_MODEL` |

配置保存在 Tauri 的 app config 目录（Unix 0600），保存采用临时文件 + 原子替换。

## Skill 与插件

- Skill 目录 = `~/.claude/skills/<id>/`。启用时入口是 `SKILL.md`，禁用时重命名为 `SKILL.md.disabled`，
  不需要改 CLI 配置。
- frontmatter 只解析顶层 `key: value`、引号与 `|` / `>` 块；其余内容原样作为正文。
- 插件：已安装列表来自 `~/.claude/plugins/installed_plugins.json`（只读）；
  Loom 添加的外部目录保存在配置中，启用项以 `--plugin-dir <path>` 传入。

## 预览

- 文件：Rust 读取并判断类型（Markdown / 文本 / 图片 / 二进制），图片转 data URL 并按 (mtime, size) 缓存，
  文本截断到 512KB。
- 网页：CSP 只允许内嵌 localhost；其他地址显示降级提示，始终提供"在系统浏览器打开"（tauri-plugin-opener）。
- Shiki 使用 JS 正则引擎：Tauri 的 CSP 不允许 WebAssembly 编译，避免额外放行 `wasm-unsafe-eval`。


## 界面状态

- **主题**：`src/stores/theme.ts` 写入 `<html data-theme>` 与 localStorage，首帧前应用；
  深色变量在 `styles/tokens.css` 的 `:root[data-theme="dark"]`，画布 `#1F1F1E`。
  Shiki 同时加载 `loom-light` / `loom-dark` 两套主题，Markdown 渲染按当前主题选择。
- **斜杠命令**：CLI spawn 后发送 `{"type":"control_request","request":{"subtype":"initialize"}}`，
  从 `control_response.response.commands` 取命令列表，存入 `RunSlice.commands`。
  输入 `/` 时如该会话尚未连接，会静默启动 CLI（不产生模型请求）以获取列表。
- **新会话**：SessionsView 先用伪 SessionSummary 打开 ChatView，首次发送时不带 `--resume`；
  拿到 system init 的 sessionId 后刷新列表，正式会话随即出现。
