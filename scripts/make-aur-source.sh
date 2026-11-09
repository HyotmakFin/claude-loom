#!/usr/bin/env bash
# 生成 AUR 构建用的源码包 packaging/loom-<版本>.tar.gz，并写回 PKGBUILD 的校验和。
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
version="$(node -p "require('./package.json').version")"
tarball="packaging/loom-$version.tar.gz"

tar -czf "$tarball" \
  --exclude='./node_modules' \
  --exclude='./src-tauri/target' \
  --exclude='./dist' \
  --exclude='./.fonts-cache' \
  --exclude='./.git' \
  --exclude='./.qa-backup' \
  --exclude='./tsconfig.tsbuildinfo' \
  --exclude='./packaging/loom-*.tar.gz' \
  --exclude='./packaging/pkg' \
  --exclude='./packaging/src' \
  --exclude='./packaging/*.pkg.tar.*' \
  --exclude='./packaging/*.log' \
  --transform "s|^\./|loom-$version/|" \
  .

sum="$(sha256sum "$tarball" | cut -d' ' -f1)"
python3 - "$sum" <<'PY'
import re, sys
path = "packaging/PKGBUILD"
text = open(path).read()
text = re.sub(r"sha256sums=\([^)]*\)", f"sha256sums=('{sys.argv[1]}')", text, count=1)
open(path, "w").write(text)
PY
echo "已生成 $tarball"
echo "sha256=$sum"
