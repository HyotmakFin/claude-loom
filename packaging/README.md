# 打包与发布（Arch Linux / AUR）

## 本地构建安装

```bash
scripts/make-aur-source.sh      # 生成 packaging/loom-<版本>.tar.gz 并写回 sha256
cd packaging
makepkg -si                     # 编译并安装（需要 sudo 输入密码）
```

装好后从应用菜单启动 Loom，或执行 `loom`。

`makepkg` 会检查依赖。若你像本机一样用 rustup 而不是 pacman 安装 Rust，
依赖检查会失败（makepkg 只认 pacman 包），可加 `--nodeps` 跳过：

```bash
makepkg -f --nodeps --noconfirm
```

## 提交到 AUR

1. **准备仓库**：把源码推到 GitHub（AUR 的 `url` 和 `source` 都指向它）。

2. **改成远程源码**。把 `PKGBUILD` 里的

   ```bash
   source=("$pkgname-$pkgver.tar.gz")
   sha256sums=('<本地 tarball 的哈希>')
   ```

   改成发布包地址（tag 需与 `pkgver` 一致）：

   ```bash
   source=("$pkgname-$pkgver.tar.gz::https://github.com/HyotmakFin/loom/archive/v$pkgver.tar.gz")
   sha256sums=('SKIP')
   ```

   把 `url` 和顶部的 `Maintainer` 也改成你的信息。

3. **生成校验和与 .SRCINFO**：

   ```bash
   cd packaging
   updpkgsums                      # 需要 pacman-contrib
   makepkg --printsrcinfo > .SRCINFO
   ```

   没有 `updpkgsums` 时：`sha256sum loom-0.1.0.tar.gz` 后手工填入。

4. **AUR 只接受 PKGBUILD、.SRCINFO 和辅助文件**。提交：

   ```bash
   git clone ssh://aur@aur.archlinux.org/loom.git      # 首次提交前，先在 aur.archlinux.org 确认包名可用
   cd loom
   cp ../packaging/PKGBUILD ../packaging/.SRCINFO .
   cp ../packaging/loom.desktop .
   git add PKGBUILD .SRCINFO loom.desktop
   git commit -m "Initial import: loom 0.1.0"
   git push
   ```

   注意：AUR 仓库的源码包中必须包含 `packaging/loom.desktop` 等 `package()` 用到的辅助文件，
   所以 `source=` 指向的 GitHub 归档里要有它们（本项目默认就有）。

5. **发布新版本**：改 `pkgver`、`pkgrel=1`，更新 `source` 里的 tag，重新 `updpkgsums`、
   `makepkg --printsrcinfo > .SRCINFO`，提交并推送。

## 包内容

| 路径 | 内容 |
| --- | --- |
| `/usr/bin/loom` | 发布二进制（前端资源已内嵌，依赖 `custom-protocol` feature） |
| `/usr/share/applications/loom.desktop` | 桌面项；文件名、`Icon`、`StartupWMClass` 均为 `loom`，与 Wayland 窗口 app_id 一致 |
| `/usr/share/icons/hicolor/{32,128,256}x*/apps/loom.png` | 应用图标 |
| `/usr/share/licenses/loom/LICENSE` | 许可 |
| `/usr/share/doc/loom/README.md` | 说明 |

依赖：`webkit2gtk-4.1`、`gtk3`、`librsvg`。`claude` CLI 是可选依赖（也可用 npm 全局安装）。
