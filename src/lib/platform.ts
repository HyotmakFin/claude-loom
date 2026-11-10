/**
 * 平台识别与字体栈修正，需在首帧渲染前调用。
 * 原因见 sidecar/backend/src/platform.rs：WebKitGTK 不解析 CSS 通用字体族。
 */
import { ipc } from "./ipc";

export type Platform = "macos" | "windows" | "linux";

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  return /Mac/.test(ua) ? "macos" : /Windows/.test(ua) ? "windows" : "linux";
}

/** 加在 CSS 静态栈前面；带超时，避免 fc-match 异常时阻塞启动 */
export async function applyPlatformFonts(platform: Platform): Promise<void> {
  if (platform !== "linux") return;
  try {
    const { sans } = await Promise.race([
      ipc.systemFonts(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 800)),
    ]);
    if (!sans.length) return;
    const root = document.documentElement;
    const fallback = getComputedStyle(root).getPropertyValue("--font-sans").trim();
    const quoted = sans.map((f) => `"${f.replace(/["\\]/g, "")}"`).join(", ");
    root.style.setProperty("--font-sans", `${quoted}, ${fallback}`);
  } catch {
    // 退回 index.css 中的静态栈
  }
}
