import { useMarkdown } from "@/lib/useMarkdown";

/** 渲染 Markdown（原始 HTML 已禁用，代码块由 Shiki 高亮）。 */
export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const html = useMarkdown(source);
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
