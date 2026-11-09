/**
 * BYOK：多套配置，注入 ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY 与模型映射。
 * 配置文件位于平台配置目录（Unix 权限 0600），API Key 以明文保存 —— 界面上明确提示。
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/SectionHeader";
import { Switch } from "@/components/ui/Switch";
import { TextField } from "@/components/ui/TextField";
import { profileEnv } from "@/lib/cliOptions";
import { errorText } from "@/lib/ipc";
import type { Profile } from "@/lib/types";
import { useConfig } from "@/stores/config";

function blankProfile(): Profile {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `p-${Date.now()}`,
    name: "新配置",
    baseUrl: "",
    apiKey: "",
    models: { opus: "", sonnet: "", haiku: "" },
  };
}

export function ByokView() {
  const config = useConfig((s) => s.config);
  const info = useConfig((s) => s.info);
  const update = useConfig((s) => s.update);
  const storeError = useConfig((s) => s.error);
  const [selectedId, setSelectedId] = useState<string | null>(config.activeProfileId ?? config.profiles[0]?.id ?? null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Profile | null>(null);

  const selected = config.profiles.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    setDraft(selected ? structuredClone(selected) : null);
    setDirty(false);
    setShowKey(false);
  }, [selectedId, selected?.id]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const edit = (patch: Partial<Profile>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };

  const save = () =>
    act(async () => {
      if (!draft) return;
      if (!draft.name.trim()) throw new Error("请填写配置名称");
      await update((cfg) => ({
        ...cfg,
        profiles: cfg.profiles.some((p) => p.id === draft.id)
          ? cfg.profiles.map((p) => (p.id === draft.id ? draft : p))
          : [...cfg.profiles, draft],
        activeProfileId: cfg.activeProfileId ?? draft.id,
      }));
      setSelectedId(draft.id);
      setDirty(false);
    });

  const create = () =>
    act(async () => {
      const p = blankProfile();
      await update((cfg) => ({ ...cfg, profiles: [...cfg.profiles, p], activeProfileId: cfg.activeProfileId ?? p.id }));
      setSelectedId(p.id);
    });

  const activate = (id: string) =>
    act(() => update((cfg) => ({ ...cfg, activeProfileId: id })));

  const envPreview = draft ? profileEnv(draft) : { env: {}, envRemove: [] };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="API 配置"
        hint="BYOK：用自己的 Base URL、Key 与模型映射启动 claude"
        actions={<Button variant="primary" icon="plus" onClick={create}>新建配置</Button>}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[280px] shrink-0 flex-col border-r border-line">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {config.profiles.length === 0 ? (
              <EmptyState icon="key" title="还没有配置" hint="新建一套配置即可启用 BYOK；不配置时会直接使用 CLI 的默认鉴权。" />
            ) : (
              <ul className="space-y-0.5">
                {config.profiles.map((p) => {
                  const active = config.activeProfileId === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className={
                          "w-full rounded-control border px-2.5 py-2 text-left transition-colors " +
                          (p.id === selectedId ? "border-line bg-surface shadow-subtle" : "border-transparent hover:bg-hover")
                        }
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-block size-1.5 shrink-0 rounded-pill ${active ? "bg-accent" : "bg-line-strong"}`} />
                          <span className="min-w-0 flex-1 truncate font-sans text-[13px] font-medium text-ink">{p.name || "未命名"}</span>
                          {active && <span className="shrink-0 font-sans text-[10px] text-accent">使用中</span>}
                        </div>
                        <div className="mt-0.5 truncate pl-3 font-mono text-[11px] text-ink-faint">
                          {p.baseUrl || "默认端点"}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="border-t border-line p-3 font-sans text-[11px] leading-relaxed text-ink-faint">
            <div className="flex items-start gap-1.5">
              <Icon name="warning" size={12} className="mt-0.5 shrink-0 text-warn" />
              <span>
                Key 以明文保存在 <span className="font-mono">{info?.configDir ?? "配置目录"}</span>（Unix 下权限 0600），请勿在共享机器上使用。
              </span>
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[640px] px-8 py-6">
            {(error || storeError) && (
              <p className="mb-4 rounded-control border border-line bg-surface px-3 py-2 font-sans text-[12px] text-danger">
                {error ?? storeError}
              </p>
            )}
            {!draft ? (
              <EmptyState icon="key" title="选择或新建一套配置" hint="配置会作为环境变量注入每次 claude 启动。" />
            ) : (
              <div className="space-y-5">
                <section className="space-y-3">
                  <h3 className="font-sans text-[12px] font-medium tracking-wide text-ink-muted">基本信息</h3>
                  <Field label="名称">
                    <TextField value={draft.name} onChange={(e) => edit({ name: e.target.value })} placeholder="例如：公司代理" />
                  </Field>
                  <Field label="Base URL" hint="对应 ANTHROPIC_BASE_URL；留空则使用默认端点。">
                    <TextField value={draft.baseUrl} onChange={(e) => edit({ baseUrl: e.target.value })} placeholder="https://api.example.com" />
                  </Field>
                  <Field label="API Key" hint="对应 ANTHROPIC_API_KEY；同时会移除 ANTHROPIC_AUTH_TOKEN，避免 CLI 优先使用旧令牌。">
                    <div className="relative">
                      <TextField
                        className="pr-10 font-mono text-[12px]"
                        type={showKey ? "text" : "password"}
                        value={draft.apiKey}
                        onChange={(e) => edit({ apiKey: e.target.value })}
                        placeholder="sk-…"
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        aria-label={showKey ? "隐藏 Key" : "显示 Key"}
                        title={showKey ? "隐藏" : "显示"}
                        onClick={() => setShowKey((v) => !v)}
                        className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-chip text-ink-faint hover:bg-sunken hover:text-ink"
                      >
                        <Icon name={showKey ? "eyeOff" : "eye"} size={14} />
                      </button>
                    </div>
                  </Field>
                </section>

                <section className="space-y-3">
                  <h3 className="font-sans text-[12px] font-medium tracking-wide text-ink-muted">模型映射</h3>
                  <p className="font-sans text-[11.5px] leading-relaxed text-ink-faint">
                    把 Claude Code 的 opus / sonnet / haiku 指向你的服务商模型名，分别写入
                    ANTHROPIC_DEFAULT_OPUS_MODEL / SONNET / HAIKU。留空表示不覆盖。
                  </p>
                  {(["opus", "sonnet", "haiku"] as const).map((k) => (
                    <Field key={k} label={k}>
                      <TextField
                        value={draft.models[k]}
                        onChange={(e) => edit({ models: { ...draft.models, [k]: e.target.value } })}
                        placeholder={k === "opus" ? "claude-opus-…" : k === "sonnet" ? "claude-sonnet-…" : "claude-haiku-…"}
                      />
                    </Field>
                  ))}
                </section>

                <section className="rounded-card border border-line bg-canvas px-3.5 py-3">
                  <div className="mb-2 flex items-center gap-2 font-sans text-[11.5px] text-ink-muted">
                    <Icon name="terminal" size={13} className="text-ink-faint" />
                    启动时注入
                  </div>
                  {Object.keys(envPreview.env).length === 0 ? (
                    <p className="font-sans text-[11.5px] text-ink-faint">不注入任何环境变量（使用 CLI 自带鉴权）。</p>
                  ) : (
                    <ul className="space-y-1 font-mono text-[11.5px] text-ink">
                      {Object.entries(envPreview.env).map(([k, v]) => (
                        <li key={k} className="flex gap-2">
                          <span className="shrink-0 text-ink-muted">{k}</span>
                          <span className="truncate text-ink">{k === "ANTHROPIC_API_KEY" ? "••••••••" : v}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <div className="flex items-center gap-2 border-t border-line pt-4">
                  <Button variant="primary" icon="save" disabled={!dirty} onClick={() => void save()}>
                    保存
                  </Button>
                  {config.activeProfileId === draft.id ? (
                    <span className="inline-flex items-center gap-1.5 font-sans text-[12px] text-accent">
                      <span className="inline-block size-1.5 rounded-pill bg-accent" />
                      正在使用
                    </span>
                  ) : (
                    <Button icon="check" onClick={() => void activate(draft.id)}>
                      设为当前配置
                    </Button>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <span className="font-sans text-[11px] text-ink-faint">启用 BYOK</span>
                    <Switch
                      checked={config.activeProfileId === draft.id}
                      label="将此配置设为当前"
                      onChange={(on) => void (on ? activate(draft.id) : update((cfg) => ({ ...cfg, activeProfileId: null })))}
                    />
                  </div>
                  <Button variant="ghost" size="sm" icon="trash" onClick={() => setPendingDelete(draft)}>
                    删除
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`删除配置「${pendingDelete?.name ?? ""}」？`}
        description="不会影响已有的 Claude Code 会话，只是不再向 CLI 注入这套环境变量。"
        confirmLabel="删除"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (!target) return;
          void act(async () => {
            await update((cfg) => ({
              ...cfg,
              profiles: cfg.profiles.filter((p) => p.id !== target.id),
              activeProfileId: cfg.activeProfileId === target.id ? null : cfg.activeProfileId,
            }));
            setSelectedId(null);
          });
        }}
      />
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 font-sans text-[12px] text-ink-muted">{label}</div>
      {children}
      {hint && <div className="mt-1 font-sans text-[11px] leading-relaxed text-ink-faint">{hint}</div>}
    </label>
  );
}
