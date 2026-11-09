#!/usr/bin/env python3
"""
生成 Loom 品牌资源：一根橙色纬线（波浪）穿过三根经线，交替上下。

  · 波峰/波谷正好落在经线上，交叠处的切口与线垂直，干净利落
  · 纬线以拱形越过中间经线、从两侧经线背后穿过，再从两端露出
  · 前后关系靠交点处的"背景色描边"缝隙表达，不用渐变和阴影
  · 字标 "Loom" 取自 Lora SemiBold 的轮廓（转为 path，不依赖系统字体）

  python3 scripts/build-logo.py      # 需要 rsvg-convert；字标需要 .fonts-cache 中的 Lora（npm run fonts）

输出：
  assets/brand/loom-icon.svg / .png      应用图标（深色底，1024，含 macOS 图标网格边距）
  assets/brand/loom-icon-light.svg       浅色底版本
  assets/brand/loom-mark.svg             无底标志（用于米白/白色背景）
  assets/brand/loom-logo.svg             横版：标志 + 字标
  src/assets/brand/loom-mark.svg         应用内使用
"""
import math
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "brand"
APP = ROOT / "src" / "assets" / "brand"
LORA = ROOT / ".fonts-cache" / "downloads" / "Lora.ttf"

CANVAS, INK, ACCENT, LINE = "#FAF9F5", "#1F1E1B", "#D97757", "#E8E4DC"


def weave(cx: float, cy: float, unit: float, warp: str, weft: str, gap_color: str,
          amp_k: float = 0.11, middle_over: bool = True) -> str:
    """unit = 标志的基准尺寸（经线总高）。返回 SVG 片段。"""
    pitch = unit * 0.37                     # 经线间距
    w_warp = unit * 0.111                   # 经线粗细
    w_weft = unit * 0.119                   # 纬线粗细
    gap = unit * 0.034                      # 交叠缝隙
    amp = unit * amp_k                      # 波幅
    half_h = unit / 2
    xs = [cx - pitch, cx, cx + pitch]
    x0, x1 = cx - pitch * 1.85, cx + pitch * 1.85

    def y(x):  # 经线处为波峰/波谷：中间经线处为波峰，两侧为波谷
        return cy + amp * math.cos(math.pi * (x - xs[0]) / pitch)

    n = 240
    pts = [(x0 + (x1 - x0) * k / n) for k in range(n + 1)]
    d = "M" + " L".join(f"{x:.2f},{y(x):.2f}" for x in pts)
    f = lambda v: f"{v:.2f}"
    o = []
    for x in xs:
        o.append(f'<line x1="{f(x)}" y1="{f(cy-half_h)}" x2="{f(x)}" y2="{f(cy+half_h)}" stroke="{warp}" '
                 f'stroke-width="{f(w_warp)}" stroke-linecap="round"/>')
    o.append(f'<path d="{d}" fill="none" stroke="{gap_color}" stroke-width="{f(w_weft+2*gap)}" '
             f'stroke-linecap="round" stroke-linejoin="round"/>')
    o.append(f'<path d="{d}" fill="none" stroke="{weft}" stroke-width="{f(w_weft)}" '
             f'stroke-linecap="round" stroke-linejoin="round"/>')
    # 经线压在纬线上的交点：清出一条竖向缝隙再重画经线；高度取足，覆盖弯曲的纬线
    h = w_weft + gap * 2
    for xm in ([xs[0], xs[2]] if middle_over else [xs[1]]):
        ym = y(xm)
        o.append(f'<line x1="{f(xm)}" y1="{f(ym-h)}" x2="{f(xm)}" y2="{f(ym+h)}" stroke="{gap_color}" stroke-width="{f(w_warp+2*gap)}"/>')
        o.append(f'<line x1="{f(xm)}" y1="{f(cy-half_h)}" x2="{f(xm)}" y2="{f(cy+half_h)}" stroke="{warp}" '
                 f'stroke-width="{f(w_warp)}" stroke-linecap="round"/>')
    return "".join(o)


def half_width(unit: float) -> float:
    """标志的半宽：纬线伸到最外侧经线外 0.85 个间距，再加线帽。"""
    return unit * (0.37 * 1.85 + 0.119 / 2)


def svg(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{body}</svg>\n'


def icon(bg, warp, weft, border=None, pad=100):
    s, inner = 1024, 1024 - 2 * pad
    stroke = f' stroke="{border}" stroke-width="4"' if border else ""
    body = f'<rect x="{pad}" y="{pad}" width="{inner}" height="{inner}" rx="{inner*0.225:.1f}" fill="{bg}"{stroke}/>'
    return svg(s, s, body + weave(s / 2, s / 2, inner * 0.6, warp, weft, bg))


def wordmark_paths(text: str, size: float, x: float, baseline: float, color: str) -> tuple[str, float]:
    """Lora wght=600 字形转 path。返回 (svg 片段, 字标宽度)。"""
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont

    font = instantiateVariableFont(TTFont(str(LORA)), {"wght": 600})
    gs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font["hmtx"]
    scale = size / font["head"].unitsPerEm
    kern = {}
    out, cursor = [], x
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        gs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, cursor, baseline)))
        out.append(f'<path d="{pen.getCommands()}" fill="{color}"/>')
        cursor += hmtx[name][0] * scale + kern.get(ch, 0) - size * 0.01  # 轻微收紧字距
    return "".join(out), cursor - x


def render(src: Path, dst: Path, width: int):
    subprocess.check_call(["rsvg-convert", "-w", str(width), str(src), "-o", str(dst)])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    APP.mkdir(parents=True, exist_ok=True)

    (OUT / "loom-icon.svg").write_text(icon(INK, CANVAS, ACCENT))
    (OUT / "loom-icon-light.svg").write_text(icon(CANVAS, INK, ACCENT, border=LINE))
    mu = 100 / (2 * half_width(1) + 0.04)       # 横向留 2% 边距
    mark = svg(100, 100, weave(50, 50, mu, INK, ACCENT, CANVAS))
    (OUT / "loom-mark.svg").write_text(mark)
    (APP / "loom-mark.svg").write_text(mark)

    if LORA.exists():
        h, u = 120, 92
        cx = half_width(u) + 4
        text_x = cx + half_width(u) + 18
        word, ww = wordmark_paths("Loom", 76, text_x, 86, INK)
        body = weave(cx, 60, u, INK, ACCENT, CANVAS) + word
        (OUT / "loom-logo.svg").write_text(svg(int(text_x + ww + 8), h, body))
    else:
        print("跳过字标：先运行 npm run fonts 以下载 Lora", file=sys.stderr)

    if shutil.which("rsvg-convert"):
        render(OUT / "loom-icon.svg", OUT / "loom-icon.png", 1024)
        for size in (32, 128, 256):
            render(OUT / "loom-icon.svg", OUT / f"loom-icon-{size}.png", size)
        print("ok → assets/brand/（应用图标：npx tauri icon assets/brand/loom-icon.png -o src-tauri/icons）")
    else:
        print("未找到 rsvg-convert，跳过 PNG 导出", file=sys.stderr)


if __name__ == "__main__":
    main()
