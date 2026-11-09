# Loom

Claude Code CLI 的图形外壳（Tauri 2 + React 19 + TypeScript + Tailwind 4）。

Loom 只是一层薄壳：不负责安装 CLI，也不处理网络或模型适配。它假设 `claude` 已经安装好并且在 PATH 中
（也可以用环境变量 `LOOM_CLAUDE_PATH` 指定路径）。

架构说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 功能

- **会话**：读取 `~/.claude/projects/*/*.jsonl` 与本机运行记录 `~/.claude/sessions/*.json`，
  列出标题、项目、时间、消息数与运行状态；支持按标题/内容搜索、置顶、归档、删除。
  点击会话查看历史，发送消息时以 `claude --resume <sessionId>` 续聊。
- **BYOK**：多套配置，按 cc-switch 的约定注入 `ANTHROPIC_BASE_URL`、
  `ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY`，以及
  `ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_{OPUS,SONNET,FABLE,HAIKU}_MODEL(_NAME)`、
  `CLAUDE_CODE_SUBAGENT_MODEL`；支持显示名与 1M（`[1m]`）标记，Key 默认掩码。
- **Skill**：扫描 `~/.claude/skills/*/SKILL.md`，启停（重命名为 `SKILL.md.disabled`）、
  编辑 frontmatter 与正文、新建 Skill。
- **插件**：列出已安装插件；添加外部插件目录并通过 `--plugin-dir` 传给 CLI。
- **斜杠命令**：输入 `/` 实时预览当前目录可用的命令 / Skill（来自 CLI 的 initialize），
  ↑↓ 选择，Enter 或 Tab 填入。
- **消息操作**：复制整条消息或代码块；从任意助手回复分叉出新会话；
  删除用户输入或助手回复（按整轮删除，原文件自动备份到 Loom 配置目录）。
- **新会话**：会话列表顶部的「新会话」，选择目录后直接开始，无需已有历史。
- **预览**：与对话并排、可折叠；Markdown、图片、代码高亮（Shiki），
  localhost 网页内嵌，其余一律可在系统浏览器打开。
- **深色模式**：跟随系统 / 浅色 / 深色三态切换，画布 `#1F1F1E`，代码高亮同步使用深色主题；
  选择会记住，系统切换时自动跟随。
- **权限**：CLI 的工具权限请求会变成确认卡片（允许 / 始终允许 / 拒绝 / 拒绝并中止），
  状态机为 idle → streaming → awaiting-permission → streaming → done。

## 数据位置

| 内容 | 位置 |
| --- | --- |
| Claude Code 数据 | `$CLAUDE_CONFIG_DIR`，未设置时为 `~/.claude` |
| Loom 配置（含 API Key） | Tauri 的平台配置目录：Linux `~/.config/dev.loom.app`、macOS `~/Library/Application Support/dev.loom.app`、Windows `%APPDATA%\dev.loom.app` |
| claude 可执行文件 | PATH；可用 `LOOM_CLAUDE_PATH` 或界面配置覆盖 |

API Key 以明文保存在 Loom 的配置文件中（Unix 下权限 0600），不要在共享机器上使用。

## 安装

从 [Releases](https://github.com/HyotMakFin/claude-loom/releases/latest) 下载对应平台安装包。
Windows / macOS 安装包由 GitHub Actions 在原生 runner 上构建（macOS 为 universal 通用二进制）。

**Arch Linux**

```bash
sudo pacman -U claude-loom-<版本>-1-x86_64.pkg.tar.zst
```

**其他 Linux 发行版**：下载 `Loom_*.AppImage`，`chmod +x` 后直接运行
（无 FUSE 时加 `--appimage-extract-and-run`）。

**Windows**：运行 `.msi` 或 `-setup.exe`（未签名，SmartScreen 可能提示）。

**macOS**：打开 `.dmg` 拖入 Applications；未签名，首次启动需右键 → 打开，
或 `xattr -dr com.apple.quarantine /Applications/Loom.app`。

Linux 包自行构建见 [packaging/README.md](packaging/README.md)。

## 品牌

标志为一根橙色纬线以拱形越过中间经线、从两侧经线背后穿过——"织机"的经纬交织。
所有品牌资源由 `scripts/build-logo.py` 生成到 `assets/brand/`（应用图标、浅色版、无底标志、横版字标），
修改后执行 `npx tauri icon assets/brand/loom-icon.png -o src-tauri/icons` 更新各平台图标。

## 前置依赖

所有平台：Node.js ≥ 20、Rust stable ≥ 1.77（安装见 https://rustup.rs），以及已安装好的 `claude` CLI。

| 平台 | 额外依赖 |
| --- | --- |
| macOS 11+ | Xcode Command Line Tools：`xcode-select --install` |
| Windows 10/11 | Visual Studio Build Tools（勾选"使用 C++ 的桌面开发"）；WebView2 Runtime（Win11 自带，安装包会自动引导安装）；打 MSI 包需要 WiX v3（Tauri 会自动下载） |
| Linux (Debian/Ubuntu) | `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev` |
| Linux (Fedora) | `sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel libxdo-devel` `sudo dnf group install "c-development"` |
| Linux (Arch) | `sudo pacman -S webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg xdotool` |

## 开发

```bash
npm install
npm run fonts        # 首次：生成字体子集到 src/assets/fonts（已提交可跳过）
npm run tauri dev
```

| 命令 | 用途 |
| --- | --- |
| `npm test` | 前端单测（状态机） |
| `cd src-tauri && cargo test` | Rust 单测（NDJSON 行切分、control_request 兜底） |
| `node scripts/smoke-cli.mjs` | 不经 Tauri，直接用真实 CLI 跑一遍权限往返 |

## 打包

每个平台的打包目标写在各自的配置文件中，Tauri 会自动合并：

| 平台 | 配置 | 产物（`src-tauri/target/release/bundle/`） |
| --- | --- | --- |
| macOS | `tauri.macos.conf.json` | `macos/Loom.app`、`dmg/Loom_*.dmg` |
| Windows | `tauri.windows.conf.json` | `msi/*.msi`、`nsis/*-setup.exe` |
| Linux | `tauri.linux.conf.json` | `deb/*.deb`、`appimage/*.AppImage` |

```bash
npm run tauri build                       # 当前平台的全部目标
npm run tauri build -- --bundles dmg      # 只打某一种包
npm run tauri build -- --target universal-apple-darwin   # macOS 通用二进制（需先执行 rustup target add aarch64-apple-darwin x86_64-apple-darwin）
```

Tauri 不支持交叉打包，每个平台都需要在本平台（或对应的 CI runner）上构建。

## Linux 帧率

WebKitGTK 在 Wayland 下拿不到 displayID 时会回退到内部 60Hz 的 vblank 定时器
（`DisplayVBlankMonitorTimer`，`FullSpeedFramesPerSecond = 60`）。Loom 自带一个很小的
`LD_PRELOAD` 补丁（`scripts/fps-patch/vblank_patch.c`），只加速名为 `VBlankMonitor`
的那个线程的休眠，把定时器提到 200Hz，不改 WebKit 二进制：

- 默认启用（安装包已包含 `libloom-vblank.so`，启动时自动 re-exec 注入）
- `LOOM_DISABLE_VBLANK_PATCH=1` 关闭
- `LOOM_VBLANK_HZ=144` 等可指定目标帧率（默认 200）

实测 2560×1440@200Hz 下 rAF 从 62fps 提升到 190fps。补丁只影响该线程，其他线程的
sleep 原样透传。

## 跨平台验证清单

- [ ] **字体**：分别在 WKWebView（macOS）、WebView2（Windows）、WebKitGTK（Linux）中打开 CLI 调试页，
      对比以下几项：Lora 与思源宋体的混排基线、SemiBold 是真实字重而不是合成加粗（已设置 `font-synthesis: none`）、
      JetBrains Mono 的连字（`->`、`!=`）。WebKitGTK 需要确认能加载 woff2 子集：DevTools → Network 中字体请求状态为 200，
      并且 `document.fonts.check('16px "Loom Serif SC"')` 返回 true。
- [x] **Linux 无衬线字体**（Arch / WebKitGTK 2.54 实测）：WebKitGTK 会把 CSS 通用字体族 `sans-serif` 渲染成衬线，
      所以启动时由 Rust 调用 `fc-match` 查出用户实际配置的字体，插到字体栈最前面（`src-tauri/src/platform.rs`）。
- [ ] **窗口图标（Linux/Wayland）**：安装包会把 `loom.desktop` 与图标装到系统路径；
      直接从 `target/debug` 运行时，可把它们复制到 `~/.local/share/applications` 与
      `~/.local/share/icons/hicolor/*/apps` 验证。桌面文件名必须等于窗口 app_id（实测为 `loom`）。
- [ ] **CLI 查找**：从 Finder / 开始菜单 / 桌面启动器启动（而不是从终端启动），左下角能显示 CLI 版本号。
- [ ] **Windows**：npm 安装的 `claude.cmd` 与原生安装的 `claude.exe` 都能正常启动；停止进程后任务管理器里不残留 node.exe。
- [ ] **权限**：发送"运行 `ls`"，弹出确认卡片；点允许 / 拒绝 / 拒绝并中止后，状态迁移都正确。
