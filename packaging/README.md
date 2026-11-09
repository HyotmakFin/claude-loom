# Linux 安装包（Arch / pacman）

发布页提供构建好的 `.pkg.tar.zst`，直接安装：

```bash
sudo pacman -U claude-loom-0.4.0-1-x86_64.pkg.tar.zst
```

安装后从应用菜单启动 Loom，或执行 `loom`。

## 自行构建

需要 `rust`、`cargo`、`nodejs`、`npm`、`pkgconf`，以及 `webkit2gtk-4.1`、`gtk3`、`librsvg`：

```bash
cd packaging
makepkg -f          # 从 GitHub 的 v0.1.0 tag 构建
```

用 rustup 而非 pacman 安装 Rust 时，makepkg 的依赖检查会失败，可加 `--nodeps`。
产物为 `claude-loom-<版本>-1-x86_64.pkg.tar.zst`。

## 包内容

| 路径 | 内容 |
| --- | --- |
| `/usr/bin/loom` | 应用二进制（前端资源已内嵌） |
| `/usr/share/applications/loom.desktop` | 桌面项；`Icon` 与 `StartupWMClass` 均为 `loom`，与 Wayland 窗口 app_id 一致 |
| `/usr/share/icons/hicolor/{32,128,256}x*/apps/loom.png` | 应用图标 |
| `/usr/share/licenses/claude-loom/LICENSE` | MIT 许可 |
| `/usr/share/doc/claude-loom/README.md` | 说明 |

`claude` CLI 是可选依赖（也可用 npm 全局安装），首次使用前请自行装好。
