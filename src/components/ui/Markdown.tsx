import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";

import { copyText } from "@/lib/clipboard";

import { useMarkdown } from "@/lib/useMarkdown";

/**
 * 渲染 Markdown（原始 HTML 已禁用，代码块由 Shiki 高亮）。
 * 离屏内容先显示纯文本，进入视口附近再做 Markdown 解析与高亮，
 * 避免打开几百条消息的会话时一次性阻塞主线程。
 */
export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");

  // 已在视口（或 800px 预取范围）内的消息在首次绘制前就解析，避免先出纯文本再换成 Markdown 的闪烁。
  useLayoutEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight + 800 && rect.bottom > -800) setVisible(true);
  }, [visible]);

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

  const onCopyClick = (e: MouseEvent<HTMLDivElement>) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-loom-copy]");
    if (!btn) return;
    const pre = btn.closest(".loom-code")?.querySelector("pre");
    const text = pre?.textContent ?? "";
    void copyText(text).then((ok) => {
      if (!ok) return;
      btn.textContent = "已复制";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "复制";
        btn.classList.remove("copied");
      }, 1200);
    });
  };

  if (!visible) {
    return (
      <div ref={ref} className={`md whitespace-pre-wrap ${className}`} aria-busy="true">
        {source}
      </div>
    );
  }
  return (
    <div
      ref={ref}
      className={`md ${className}`}
      onClick={onCopyClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
