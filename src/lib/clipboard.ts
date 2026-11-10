
/** 复制文本：优先 Tauri 剪贴板插件（不依赖用户激活），再退回浏览器 API。 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof window !== "undefined" && window.loom?.copyText) {
    try {
      await window.loom.copyText(text);
      return true;
    } catch {
      // fall through
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
