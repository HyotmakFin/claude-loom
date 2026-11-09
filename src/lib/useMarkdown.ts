import { useEffect, useState } from "react";

import { escapeHtml, renderMarkdown } from "./markdown";
import { useTheme } from "@/stores/theme";

const cache = new Map<string, string>();
const CACHE_LIMIT = 200;

/** 异步渲染 Markdown；渲染完成前展示转义后的纯文本，避免闪白。 */
export function useMarkdown(source: string | null | undefined): string {
  const text = source ?? "";
  const theme = useTheme((s) => s.theme);
  const key = `${theme}\u0000${text}`;
  const [html, setHtml] = useState(() => cache.get(key) ?? "");

  useEffect(() => {
    if (cache.has(key)) {
      setHtml(cache.get(key)!);
      return;
    }
    let alive = true;
    renderMarkdown(text, theme)
      .then((h) => {
        if (!alive) return;
        if (cache.size > CACHE_LIMIT) cache.clear();
        cache.set(key, h);
        setHtml(h);
      })
      .catch((e) => console.error("markdown render failed", e));
    return () => {
      alive = false;
    };
  }, [text, theme, key]);

  return html || `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
}
