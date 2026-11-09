import { useEffect, useState } from "react";

import { escapeHtml, renderMarkdown } from "./markdown";

const cache = new Map<string, string>();
const CACHE_LIMIT = 200;

/** 异步渲染 Markdown；渲染完成前展示转义后的纯文本，避免闪白。 */
export function useMarkdown(source: string | null | undefined): string {
  const text = source ?? "";
  const [html, setHtml] = useState(() => cache.get(text) ?? "");

  useEffect(() => {
    if (cache.has(text)) {
      setHtml(cache.get(text)!);
      return;
    }
    let alive = true;
    renderMarkdown(text)
      .then((h) => {
        if (!alive) return;
        if (cache.size > CACHE_LIMIT) cache.clear();
        cache.set(text, h);
        setHtml(h);
      })
      .catch((e) => console.error("markdown render failed", e));
    return () => {
      alive = false;
    };
  }, [text]);

  return html || `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
}
