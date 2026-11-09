/**
 * 插件：已安装插件只读展示；用户添加的外部目录通过 `--plugin-dir` 传给 CLI。
 */
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/SectionHeader";
import { Switch } from "@/components/ui/Switch";
import { errorText } from "@/lib/ipc";
import { useConfig } from "@/stores/config";
import { usePlugins } from "@/stores/plugins";

export function PluginsView() {
  const { data, loading, error } = usePlugins();
  const { refresh, add, remove, toggle } = usePlugins.getState();
  const info = useConfig((s) => s.info);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(errorText(e));
    }
  };

  const addDir = () =>
    act(async () => {
      const dir = await openDialog({ directory: true, multiple: false, defaultPath: info?.pluginsDir });
      if (typeof dir === "string") await add(dir);
    });

  const enabledCount = data.dirs.filter((d) => d.enabled).length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="插件"
        hint={loading ? "正在读取…" : `已安装 ${data.installed.length} 个 · 外部目录 ${data.dirs.length} 个（${enabledCount} 个启用）`}
        actions={<Button variant="primary" icon="plus" onClick={() => void addDir()}>添加目录</Button>}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[820px] px-8 py-6">
          {(actionError || error) && (
            <p className="mb-4 rounded-control border border-line bg-surface px-3 py-2 font-sans text-[12px] text-danger">{actionError ?? error}</p>
          )}

          <section>
            <SectionTitle icon="puzzle" title="外部插件目录" hint="启用后，每次启动 claude 都会追加 --plugin-dir <路径>。" />
            {data.dirs.length === 0 ? (
              <div className="rounded-card border border-dashed border-line bg-canvas px-4 py-6">
                <EmptyState
                  icon="puzzle"
                  title="还没有添加插件目录"
                  hint="可以选择包含 .claude-plugin/plugin.json 的插件目录，或任意包含 commands / skills 的目录。"
                  action={<Button icon="plus" onClick={() => void addDir()}>选择目录</Button>}
                />
              </div>
            ) : (
              <ul className="space-y-1.5">
                {data.dirs.map((d) => (
                  <li key={d.path} className="rounded-card border border-line bg-surface px-3.5 py-3 shadow-subtle">
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-control bg-canvas text-ink-muted">
                        <Icon name="puzzle" size={15} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-sans text-[13px] font-medium text-ink">
                            {d.pluginName ?? d.path.split(/[\\/]/).filter(Boolean).at(-1)}
                          </span>
                          {d.pluginVersion && (
                            <span className="rounded-chip border border-line bg-canvas px-1.5 font-mono text-[10.5px] text-ink-muted">
                              v{d.pluginVersion}
                            </span>
                          )}
                          {!d.exists && (
                            <span className="inline-flex items-center gap-1 font-sans text-[11px] text-danger">
                              <Icon name="warning" size={11} /> 目录不存在
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">{d.path}</div>
                      </div>
                      <Switch checked={d.enabled} label={`启用 ${d.path}`} onChange={(v) => void act(() => toggle(d.path, v))} />
                      <Button variant="ghost" size="sm" icon="trash" aria-label="移除" onClick={() => void act(() => remove(d.path))} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8">
            <SectionTitle icon="inbox" title="已安装插件" hint={`由 Claude Code 管理，读取自 ${info?.pluginsDir ?? "~/.claude/plugins"}/installed_plugins.json，会话启动时自动加载。`} />
            {data.installed.length === 0 ? (
              <p className="rounded-card border border-line bg-canvas px-4 py-5 text-center font-sans text-[12px] text-ink-faint">
                没有检测到已安装插件。
              </p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                {data.installed.map((p) => (
                  <li key={p.path} className="flex items-center gap-3 px-4 py-3">
                    <Icon name="puzzle" size={14} className="shrink-0 text-ink-faint" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-sans text-[13px] text-ink">{p.key}</span>
                        {p.version && <span className="font-mono text-[11px] text-ink-faint">v{p.version}</span>}
                      </div>
                      <div className="truncate font-mono text-[10.5px] text-ink-faint">{p.path}</div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1.5 font-sans text-[11px] text-ink-muted">
                      <span className="inline-block size-1.5 rounded-pill bg-ok" />
                      已安装
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="mt-6 flex items-start gap-2 font-sans text-[11.5px] leading-relaxed text-ink-faint">
            <Icon name="warning" size={12} className="mt-0.5 shrink-0" />
            已安装插件由 CLI 自行加载，Loom 无法单独关闭；需要完全控制时，请把这些目录作为外部目录添加并禁用对应的安装项。
          </p>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon, title, hint }: { icon: "puzzle" | "inbox"; title: string; hint: string }) {
  return (
    <div className="mb-2.5">
      <div className="flex items-center gap-1.5 font-sans text-[12.5px] font-medium text-ink">
        <Icon name={icon} size={13} className="text-ink-faint" />
        {title}
      </div>
      <p className="mt-0.5 font-sans text-[11.5px] text-ink-faint">{hint}</p>
    </div>
  );
}
