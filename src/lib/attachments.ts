/** 附加文件以绝对路径列表的形式随消息发送，Claude 通过 Read / Glob 访问。 */
const MARKER = "[附加文件]";

export const ATTACH_LIMIT = 20;

export function composeMessage(text: string, files: string[]): string {
  if (!files.length) return text;
  const list = files.map((p) => `- ${p}`).join("\n");
  return text ? `${text}\n\n${MARKER}\n${list}` : `请查看以下附加文件：\n\n${MARKER}\n${list}`;
}

/** 从用户消息里拆出正文与附件路径，用于渲染附件 chip。 */
export function splitAttachments(text: string | null): { body: string; files: string[] } {
  if (!text) return { body: "", files: [] };
  const marker = `\n${MARKER}\n`;
  const idx = text.lastIndexOf(marker);
  if (idx === -1) return { body: text, files: [] };
  const body = text.slice(0, idx).trimEnd();
  const files = text
    .slice(idx + marker.length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
  return { body, files };
}

export function fileName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
