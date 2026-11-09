import { useEffect, useRef, useState } from "react";

import { useMarkdown } from "@/lib/useMarkdown";

/**
 * 渲染 Markdown（原始 HTML 已禁用，代码块由 Shiki 高亮）。
 * 离屏内容先显示纯文本，进入视口附近再做 Markdown 解析与高亮，
 * 避免打开几百条消息的会话时一次性阻塞主线程。
 */
export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const html = useMarkdown(visible ? source : "");

  if (!visible) {
    return (
      <div ref={ref} className={`md whitespace-pre-wrap ${className}`} aria-busy="true">
        {source}
      </div>
    );
  }
  return <div ref={ref} className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
