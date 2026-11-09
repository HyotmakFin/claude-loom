# 打包（Arch Linux / AUR）

AUR 包名：**claude-loom**（`loom` 已被其他包占用）。上游仓库：
<https://github.com/HyotMakFin/claude-loom>。

## 本地构建安装

```bash
cd packaging
makepkg -si          # 从 GitHub 的 v0.1.0 tag 下载源码并编译
```

使用 rustup 而非 pacman 安装 Rust 时，makepkg 的依赖检查会失败，可跳过：

```bash
makepkg -si --nodeps
```

装好后从应用菜单启动 Loom，或执行 `loom`。

## 首次推送到 AUR

1. **注册 AUR 账号**并登录：<https://aur.archlinux.org/register>

2. **添加 SSH 公钥**：在账号页面的 *SSH Public Key* 填入公钥。

3. **准备 AUR 仓库**（本机已生成在 `~/Documents/claude-loom-aur/`）：

   ```bash
   cd ~/Documents/claude-loom-aur
   git push origin master
   ```

   第一次推送会自动创建 <https://aur.archlinux.org/pkgbase/claude-loom>。

## 发布新版本

1. 在 GitHub 打 tag：`git tag v0.1.1 && git push origin v0.1.1`
2. 修改 `PKGBUILD` 的 `pkgver`，`pkgrel` 重置为 1
3. 更新校验和与元数据：

   ```bash
   updpkgsums                       # 需要 pacman-contrib
   makepkg --printsrcinfo > .SRCINFO
   git add PKGBUILD .SRCINFO
   git commit -m "upgpkg: claude-loom 0.1.1"
   git push
   ```

## 包内容

| 路径 | 内容 |
| --- | --- |
| `/usr/bin/loom` | 发布二进制（前端资源已内嵌，依赖 `custom-protocol` feature） |
| `/usr/share/applications/loom.desktop` | 桌面项；文件名、`Icon`、`StartupWMClass` 均为 `loom`，与 Wayland 窗口 app_id 一致 |
| `/usr/share/icons/hicolor/{32,128,256}x*/apps/loom.png` | 应用图标 |
| `/usr/share/licenses/claude-loom/LICENSE` | 许可 |
| `/usr/share/doc/claude-loom/README.md` | 说明 |

依赖：`webkit2gtk-4.1`、`gtk3`、`librsvg`。`claude` CLI 是可选依赖（也可用 npm 全局安装）。
