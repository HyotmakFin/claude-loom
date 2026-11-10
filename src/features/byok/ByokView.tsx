/**
 * BYOK：多套配置，字段与注入变量参考 cc-switch 的 Claude Code Provider 编辑器。
 * 值会注入 Loom 启动的 claude 进程，并合并写入 ~/.claude/settings.json 的 env
 * （见 sidecar/backend/src/byok.rs；保留 hooks/theme/其他键）。
 */
import { openUrl } from "@/lib/electron";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/SectionHeader";
import { Switch } from "@/components/ui/Switch";
import { Select, TextField } from "@/components/ui/TextField";
import { AUTH_FIELDS, profileEnv, type ModelRoleKey } from "@/lib/cliOptions";
import { errorText, ipc } from "@/lib/ipc";
import type { ModelList, ModelMap, Profile } from "@/lib/types";
import { useConfig } from "@/stores/config";

function blankModels(): ModelMap {
  return {
    opus: "", sonnet: "", haiku: "", fable: "", subagent: "", fallback: "",
    opusName: "", sonnetName: "", haikuName: "", fableName: "",
    opusMillion: false, sonnetMillion: false, haikuMillion: false, fableMillion: false,
    subagentMillion: false, fallbackMillion: false,
  };
}

function blankProfile(): Profile {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `p-${Date.now()}`,
    name: "新配置",
    notes: "",
    website: "",
    baseUrl: "",
    apiKey: "",
    authField: AUTH_FIELDS[0],
    fullUrl: false,
    models: blankModels(),
  };
}

interface RoleDef {
  key: ModelRoleKey;
  label: string;
  placeholder: string;
  hasName: boolean;
  hint?: string;
}

const ROLES: RoleDef[] = [
  { key: "sonnet", label: "Sonnet", placeholder: "claude-sonnet-…", hasName: true },
  { key: "opus", label: "Opus", placeholder: "claude-opus-…", hasName: true },
  { key: "fable", label: "Fable", placeholder: "claude-fable-…", hasName: true },
  { key: "haiku", label: "Haiku", placeholder: "claude-haiku-…", hasName: true },
  { key: "subagent", label: "Subagent", placeholder: "子代理模型", hasName: false, hint: "不显示在 /model 菜单" },
  { key: "fallback", label: "默认兜底", placeholder: "ANTHROPIC_MODEL", hasName: false, hint: "未指定角色时使用" },
];

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
  const [modelList, setModelList] = useState<ModelList | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

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

  const editModel = (patch: Partial<ModelMap>) => {
    setDraft((d) => (d ? { ...d, models: { ...d.models, ...patch } } : d));
    setDirty(true);
  };

  useEffect(() => {
    setModelList(null);
    setModelsError(null);
  }, [selectedId, draft?.baseUrl, draft?.apiKey]);

  const fetchModels = async () => {
    if (!draft) return;
    setModelsError(null);
    setModelsLoading(true);
    try {
      const list = await ipc.modelsList(draft.baseUrl.trim(), draft.apiKey.trim());
      setModelList(list);
      if (list.models.length === 0) setModelsError("接口没有返回任何模型");
    } catch (e) {
      setModelsError(errorText(e));
    } finally {
      setModelsLoading(false);
    }
  };

  const save = () =>
    act(async () => {
      if (!draft) return;
      if (!draft.name.trim()) throw new Error("请填写配置名称");
      if (draft.fullUrl && draft.baseUrl && !/^https?:\/\//i.test(draft.baseUrl)) {
        throw new Error("请求地址需要以 http:// 或 https:// 开头");
      }
      const clean: Profile = { ...draft, authField: draft.authField || AUTH_FIELDS[0] };
      await update((cfg) => ({
        ...cfg,
        profiles: cfg.profiles.some((p) => p.id === clean.id)
          ? cfg.profiles.map((p) => (p.id === clean.id ? clean : p))
          : [...cfg.profiles, clean],
        activeProfileId: cfg.activeProfileId ?? clean.id,
      }));
      setSelectedId(clean.id);
      setDirty(false);
    });

  const create = () =>
    act(async () => {
      const p = blankProfile();
      await update((cfg) => ({ ...cfg, profiles: [...cfg.profiles, p], activeProfileId: cfg.activeProfileId ?? p.id }));
      setSelectedId(p.id);
    });

  const activate = (id: string) => act(() => update((cfg) => ({ ...cfg, activeProfileId: id })));
  const envPreview = draft ? profileEnv(draft) : { env: {}, envRemove: [] };
  const authField = draft?.authField || AUTH_FIELDS[0];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="API 配置"
        hint="BYOK：套用 cc-switch 的环境变量约定，支持 Opus / Sonnet / Fable / Haiku / Subagent 映射"
        actions={<Button variant="primary" icon="plus" onClick={create}>新建配置</Button>}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[280px] shrink-0 flex-col border-r border-line">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {config.profiles.length === 0 ? (
              <EmptyState icon="key" title="还没有配置" hint="新建一套配置即可启用 BYOK；不配置时使用 CLI 自带的鉴权。" />
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
                        <div className="mt-0.5 truncate pl-3 font-mono text-[11px] text-ink-faint">{p.baseUrl || "默认端点"}</div>
                        {p.notes && <div className="mt-0.5 truncate pl-3 font-sans text-[11px] text-ink-faint">{p.notes}</div>}
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
          <div className="mx-auto w-full max-w-[760px] px-8 py-6">
            {(error || storeError) && (
              <p className="mb-4 rounded-control border border-line bg-surface px-3 py-2 font-sans text-[12px] text-danger">
                {error ?? storeError}
              </p>
            )}
            {!draft ? (
              <EmptyState icon="key" title="选择或新建一套配置" hint="配置会作为环境变量注入每次 claude 启动。" />
            ) : (
              <div className="space-y-6">
                <div className="flex items-start gap-2 rounded-card border border-line bg-canvas px-3.5 py-2.5 font-sans text-[12px] leading-relaxed text-ink-muted">
                  <Icon name="spark" size={13} className="mt-0.5 shrink-0 text-ink-faint" />
                  这些值只注入 Loom 启动的 claude 进程，不会改动 <span className="font-mono">~/.claude/settings.json</span>。
                </div>

                <section className="space-y-3">
                  <SectionTitle title="基本信息" />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="名称" required>
                      <TextField value={draft.name} onChange={(e) => edit({ name: e.target.value })} placeholder="例如：DeepSeek" />
                    </Field>
                    <Field label="备注">
                      <TextField value={draft.notes} onChange={(e) => edit({ notes: e.target.value })} placeholder="例如：公司专用账号" />
                    </Field>
                  </div>
                  <Field label="官网链接" hint="用于“获取 API Key”跳转，可留空。">
                    <TextField value={draft.website} onChange={(e) => edit({ website: e.target.value })} placeholder="https://platform.example.com" />
                  </Field>
                </section>

                <section className="space-y-3">
                  <SectionTitle title="连接" />
                  <Field
                    label="API Key"
                    required
                    hint={`写入 ${authField}；另一个认证变量会从继承环境中移除。`}
                    extra={
                      draft.website.trim() ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 font-sans text-[11.5px] text-accent hover:underline"
                          onClick={() => void openUrl(draft.website.trim()).catch((e) => setError(errorText(e)))}
                        >
                          获取 API Key <Icon name="external" size={11} />
                        </button>
                      ) : null
                    }
                  >
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
                  <Field label="请求地址" required hint="对应 ANTHROPIC_BASE_URL；中转站通常以 /anthropic 结尾。">
                    <TextField
                      className="font-mono text-[12px]"
                      value={draft.baseUrl}
                      onChange={(e) => edit({ baseUrl: e.target.value })}
                      placeholder="https://api.example.com/anthropic"
                    />
                  </Field>
                </section>

                <section className="rounded-card border border-line bg-canvas px-4 py-3">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 font-sans text-[12.5px] font-medium text-ink">
                      <Icon name="chevron" size={12} className="transition-transform group-open:rotate-90" />
                      高级选项
                    </summary>
                    <div className="mt-3 space-y-3">
                      <Row label="上游格式" hint="Loom 只支持 Anthropic Messages 协议。">
                        <span className="font-sans text-[12.5px] text-ink-muted">Anthropic Messages（原生）</span>
                      </Row>
                      <Row label="完整 URL" hint="请求地址已经是完整接口地址时打开。">
                        <Switch
                          checked={draft.fullUrl}
                          label="请求地址是完整 URL"
                          onChange={(v) => edit({ fullUrl: v })}
                        />
                      </Row>
                      <Row label="认证字段" hint="多数中转网关使用 ANTHROPIC_AUTH_TOKEN。">
                        <Select
                          className="w-64"
                          value={authField}
                          onChange={(e) => edit({ authField: e.target.value })}
                        >
                          <option value="ANTHROPIC_AUTH_TOKEN">ANTHROPIC_AUTH_TOKEN（默认）</option>
                          <option value="ANTHROPIC_API_KEY">ANTHROPIC_API_KEY</option>
                        </Select>
                      </Row>
                    </div>
                  </details>
                </section>

                <section>
                  <div className="mb-2 flex items-end justify-between gap-3">
                    <SectionTitle
                      title="模型映射"
                      hint="留空会移除对应覆盖，回落到 Claude 官方默认模型。实际请求模型写入 ANTHROPIC_DEFAULT_*_MODEL / CLAUDE_CODE_SUBAGENT_MODEL；勾选 1M 会追加 [1m]（客户端后缀，请求前会去掉）。"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="refresh"
                      disabled={!draft.baseUrl.trim() || modelsLoading}
                      onClick={() => void fetchModels()}
                    >
                      {modelsLoading ? "请求中…" : "请求模型列表"}
                    </Button>
                  </div>
                  {modelsError && (
                    <p className="mb-2 rounded-control border border-line bg-surface px-2.5 py-1.5 font-sans text-[11px] text-danger">
                      {modelsError}
                    </p>
                  )}
                  {modelList && (
                    <p className="mb-2 truncate font-sans text-[11px] text-ink-faint" title={modelList.endpoint}>
                      已获取 {modelList.models.length} 个模型 · {modelList.endpoint}
                    </p>
                  )}
                  <div className="overflow-hidden rounded-card border border-line">
                    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)_2.5rem] gap-2 border-b border-line bg-canvas px-3 py-2 font-sans text-[11px] text-ink-faint">
                      <span>模型角色</span>
                      <span>显示名称</span>
                      <span>实际请求模型</span>
                      <span className="text-center">1M</span>
                    </div>
                    {ROLES.map((role) => {
                      const model = draft.models[role.key];
                      const nameKey = `${role.key}Name` as keyof ModelMap;
                      const millionKey = `${role.key}Million` as keyof ModelMap;
                      return (
                        <div
                          key={role.key}
                          className="grid grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)_2.5rem] items-center gap-2 border-b border-line px-3 py-2 last:border-b-0"
                        >
                          <span className="font-sans text-[12px] text-ink">{role.label}</span>
                          {role.hasName ? (
                            <TextField
                              className="h-7 rounded-chip px-2 text-[12px]"
                              value={draft.models[nameKey] as string}
                              onChange={(e) => editModel({ [nameKey]: e.target.value } as Partial<ModelMap>)}
                              placeholder={role.key === "fable" ? "Fable" : role.label}
                            />
                          ) : (
                            <span className="font-sans text-[11px] text-ink-faint">{role.hint}</span>
                          )}
                          <div className="flex min-w-0 items-center gap-1">
                            <TextField
                              className="h-7 min-w-0 flex-1 rounded-chip px-2 font-mono text-[11.5px]"
                              value={model}
                              onChange={(e) => editModel({ [role.key]: e.target.value } as Partial<ModelMap>)}
                              placeholder={role.placeholder}
                            />
                            <select
                              aria-label={`选择 ${role.label} 模型`}
                              title="从已获取的模型列表中选择"
                              className="h-7 w-24 shrink-0 rounded-chip border border-line bg-surface px-1 font-mono text-[10.5px] text-ink-muted outline-none hover:bg-sunken disabled:opacity-50"
                              value={modelList?.models.includes(model) ? model : ""}
                              disabled={!modelList || modelList.models.length === 0}
                              onChange={(e) => {
                                if (e.target.value) editModel({ [role.key]: e.target.value } as Partial<ModelMap>);
                              }}
                            >
                              <option value="">选择</option>
                              {modelList?.models.map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </select>
                          </div>
                          <label className="flex justify-center" title="声明 1M 上下文">
                            <input
                              type="checkbox"
                              checked={draft.models[millionKey] as boolean}
                              onChange={(e) => editModel({ [millionKey]: e.target.checked } as Partial<ModelMap>)}
                              className="size-3.5 accent-accent"
                            />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 font-sans text-[11px] leading-relaxed text-ink-faint">
                    留空的角色会从启动环境与 settings.json 中移除。Claude 中转站通常留空，或从上方列表选择；
                    DeepSeek 官方配置：Sonnet/Opus 填 <code className="font-mono">deepseek-flash[1m]</code> 并勾选 1M，
                    Haiku/Subagent 填 <code className="font-mono">deepseek-flash</code>。
                  </p>
                </section>

                <section className="rounded-card border border-line bg-canvas px-3.5 py-3">
                  <div className="mb-2 flex items-center gap-2 font-sans text-[11.5px] text-ink-muted">
                    <Icon name="terminal" size={13} className="text-ink-faint" />
                    启动时注入
                  </div>
                  {Object.keys(envPreview.env).length === 0 ? (
                    <p className="font-sans text-[11.5px] text-ink-faint">
                      不注入环境变量；留空的模型项会从环境与 settings 中移除。
                    </p>
                  ) : (
                    <ul className="space-y-1 font-mono text-[11.5px]">
                      {Object.entries(envPreview.env).map(([k, v]) => (
                        <li key={k} className="flex gap-2">
                          <span className="shrink-0 text-ink-muted">{k}</span>
                          <span className="truncate text-ink">{AUTH_FIELDS.includes(k as (typeof AUTH_FIELDS)[number]) ? "••••••••" : v}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {envPreview.envRemove.length > 0 && (
                    <p className="mt-2 break-words font-mono text-[10.5px] text-ink-faint">
                      移除：{envPreview.envRemove.join(", ")}
                    </p>
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

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-2">
      <h3 className="font-sans text-[12px] font-medium tracking-wide text-ink-muted">{title}</h3>
      {hint && <p className="mt-0.5 font-sans text-[11px] leading-relaxed text-ink-faint">{hint}</p>}
    </div>
  );
}

function Field({ label, hint, extra, required, children }: {
  label: string;
  hint?: string;
  extra?: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center gap-1 font-sans text-[12px] text-ink-muted">
        <span>
          {label}
          {required && <span className="ml-0.5 text-accent">*</span>}
        </span>
        {extra && <span className="ml-auto">{extra}</span>}
      </div>
      {children}
      {hint && <div className="mt-1 font-sans text-[11px] leading-relaxed text-ink-faint">{hint}</div>}
    </label>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0">
        <div className="font-sans text-[12.5px] text-ink">{label}</div>
        {hint && <div className="font-sans text-[11px] text-ink-faint">{hint}</div>}
      </div>
      <div className="ml-auto shrink-0">{children}</div>
    </div>
  );
}
