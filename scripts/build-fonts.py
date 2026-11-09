#!/usr/bin/env python3
"""
下载并生成 Loom 打包字体 → src/assets/fonts/

  Lora（可变字重，拉丁子集）            google/fonts
  思源宋体 SC Regular / SemiBold 静态子集  adobe-fonts/source-han-serif
      覆盖：GB2312 一级字 3755 个（≥ 常用 3500 字）+ 中英文标点 + 拉丁
      预算：两个字重合计 ≤ 2 MB，超出则失败
  JetBrains Mono Regular / Bold           JetBrains/JetBrainsMono

依赖：pip install fonttools brotli（脚本会自动在 .fonts-cache/venv 中安装）
"""
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".fonts-cache"
DOWNLOADS = CACHE / "downloads"
OUT = ROOT / "src" / "assets" / "fonts"
CJK_BUDGET = 2 * 1024 * 1024

SOURCES = {
    "Lora.ttf": "https://github.com/google/fonts/raw/main/ofl/lora/Lora%5Bwght%5D.ttf",
    "Lora-Italic.ttf": "https://github.com/google/fonts/raw/main/ofl/lora/Lora-Italic%5Bwght%5D.ttf",
    "SHS-Regular.otf": "https://github.com/adobe-fonts/source-han-serif/raw/release/SubsetOTF/CN/SourceHanSerifCN-Regular.otf",
    "SHS-SemiBold.otf": "https://github.com/adobe-fonts/source-han-serif/raw/release/SubsetOTF/CN/SourceHanSerifCN-SemiBold.otf",
    "JetBrainsMono-Regular.woff2": "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/webfonts/JetBrainsMono-Regular.woff2",
    "JetBrainsMono-Bold.woff2": "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/webfonts/JetBrainsMono-Bold.woff2",
}


def ensure_venv():
    """在独立 venv 中重新执行自身，避免污染系统 Python。"""
    venv = CACHE / "venv"
    py = venv / ("Scripts" if os.name == "nt" else "bin") / ("python.exe" if os.name == "nt" else "python")
    if Path(sys.executable).resolve() == py.resolve():
        return
    if not py.exists():
        subprocess.check_call([sys.executable, "-m", "venv", str(venv)])
        subprocess.check_call([str(py), "-m", "pip", "install", "-q", "fonttools>=4.50", "brotli"])
    os.execv(str(py), [str(py), "-I", str(Path(__file__).resolve())])


def fetch(name: str) -> Path:
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    dest = DOWNLOADS / name
    if not dest.exists():
        print(f"  下载 {name}")
        tmp = dest.with_suffix(dest.suffix + ".part")
        urllib.request.urlretrieve(SOURCES[name], tmp)
        tmp.replace(dest)
    return dest


def gb2312_level1() -> str:
    chars = []
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            if hi == 0xD7 and lo > 0xF9:  # 第 55 区只有 89 个字
                break
            chars.append(bytes([hi, lo]).decode("gb2312"))
    assert len(chars) == 3755, len(chars)
    return "".join(chars)


def ranges(*pairs) -> str:
    return "".join(chr(c) for a, b in pairs for c in range(a, b + 1))


LATIN = ranges((0x20, 0x7E), (0xA0, 0xFF), (0x2010, 0x2027), (0x2030, 0x203A), (0x20AC, 0x20AC), (0x2122, 0x2122))
CJK_PUNCT = ranges((0x3000, 0x301F), (0xFF01, 0xFF5E), (0xFFE0, 0xFFE5), (0x00B7, 0x00B7), (0x2014, 0x2026))


def subset(src: Path, dst: Path, text: str, keep_variations: bool = False):
    from fontTools import subset as fts

    opts = fts.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]  # 保留 vert/locl/kern/liga 等
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.hinting = False
    font = fts.load_font(str(src), opts)
    s = fts.Subsetter(opts)
    s.populate(text=text)
    s.subset(font)
    if not keep_variations and "fvar" in font:
        raise SystemExit(f"{src.name} 意外是可变字体")
    fts.save_font(font, str(dst), opts)
    print(f"  {dst.name:44s} {dst.stat().st_size / 1024:8.1f} KB")


def main():
    ensure_venv()
    OUT.mkdir(parents=True, exist_ok=True)
    print("生成字体 →", OUT.relative_to(ROOT))

    subset(fetch("Lora.ttf"), OUT / "Lora-Variable.woff2", LATIN, keep_variations=True)
    subset(fetch("Lora-Italic.ttf"), OUT / "Lora-Italic-Variable.woff2", LATIN, keep_variations=True)

    cjk_text = gb2312_level1() + CJK_PUNCT + LATIN
    cjk = []
    for weight in ("Regular", "SemiBold"):
        dst = OUT / f"SourceHanSerifSC-{weight}.subset.woff2"
        subset(fetch(f"SHS-{weight}.otf"), dst, cjk_text)
        cjk.append(dst.stat().st_size)

    for weight in ("Regular", "Bold"):
        src = fetch(f"JetBrainsMono-{weight}.woff2")
        (OUT / src.name).write_bytes(src.read_bytes())
        print(f"  {src.name:44s} {src.stat().st_size / 1024:8.1f} KB")

    total = sum(cjk)
    print(f"思源宋体子集合计 {total / 1024 / 1024:.2f} MB（预算 2 MB）")
    if total > CJK_BUDGET:
        raise SystemExit("超出 2 MB 预算：考虑去掉 SemiBold，标题改用 Lora 粗体 + 思源 Regular")


if __name__ == "__main__":
    main()
