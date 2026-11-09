export function relativeTime(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const min = 60_000;
  if (diff < min) return "刚刚";
  if (diff < 60 * min) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < 24 * 60 * min) return `${Math.floor(diff / (60 * min))} 小时前`;
  const days = Math.floor(diff / (24 * 60 * min));
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  const d = new Date(ms);
  return `${d.getFullYear() === new Date().getFullYear() ? "" : `${d.getFullYear()}/`}${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatClock(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** 路径最后一段，用于在会话列表里显示项目名 */
export function baseName(p: string | null): string {
  if (!p) return "";
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? p;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
