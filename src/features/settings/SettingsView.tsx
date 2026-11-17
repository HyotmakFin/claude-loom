/** 设置：目前主要是 Loom 配置目录里的会话备份清理。 */
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { errorText, ipc } from "@/lib/ipc";
import type { BackupStats } from "@/lib/types";

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export function SettingsView() {
  const [stats, setStats] = useState<BackupStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { days?: number }>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setStats(await ipc.backupStats());
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const clean = async (days?: number) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const removed = await ipc.backupClean(days);
      setMessage(`已清理 ${removed.files} 个备份文件，释放 ${formatBytes(removed.bytes)}。`);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <header className="mb-5">
        <h1 className="font-serif text-[20px] font-semibold text-ink">设置</h1>
        <p className="mt-1 font-sans text-[12px] text-ink-muted">本地数据与清理策略。</p>
      </header>

      <section className="max-w-[720px] rounded-card border border-line bg-surface shadow-subtle">
        <div className="flex items-start gap-3 border-b border-line px-4 py-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-control bg-accent-tint text-accent">
            <Icon name="archive" size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-sans text-[13px] font-medium text-ink">会话备份</h2>
            <p className="mt-0.5 font-sans text-[12px] leading-relaxed text-ink-muted">
              删除会话中的消息时，原 JSONL 会先备份到 Claude-Loom 配置目录。备份不会自动参与会话列表，
              确认不再需要后可以在这里清理。
            </p>
          </div>
        </div>

        <div className="space-y-3 px-4 py-3">
          <div className="rounded-control border border-line bg-canvas px-3 py-2">
            <div className="truncate font-mono text-[11.5px] text-ink-muted">{stats?.dir ?? "读取中…"}</div>
            <div className="mt-1 font-sans text-[12px] text-ink">
              {stats ? (
                <>
                  {stats.files} 个文件 · {formatBytes(stats.bytes)}
                </>
              ) : (
                "正在统计备份占用…"
              )}
            </div>
          </div>

          {message && <p className="font-sans text-[12px] text-ok">{message}</p>}
          {error && <p className="font-sans text-[12px] text-danger">{error}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy || !stats?.files} onClick={() => setConfirm({ days: 30 })}>
              清理 30 天前的备份
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy || !stats?.files}
              onClick={() => setConfirm({})}
            >
              全部清理
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>
              重新统计
            </Button>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.days ? `清理 ${confirm.days} 天前的备份？` : "清理全部会话备份？"}
        description={
          confirm?.days
            ? `将删除修改时间早于 ${confirm.days} 天的 JSONL 备份文件，此操作不可撤销。`
            : "将删除 Claude-Loom 配置目录中的全部 JSONL 备份文件，此操作不可撤销。"
        }
        confirmLabel="清理"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => void clean(confirm?.days)}
      />
    </div>
  );
}
