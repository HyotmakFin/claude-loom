/**
 * Skill 管理：列表 + 启停 + frontmatter 表单 + Markdown 编辑器（带预览）。
 * 启停通过重命名 SKILL.md 实现，见 src-tauri/src/skills/mod.rs。
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Markdown } from "@/components/ui/Markdown";
import { PageHeader } from "@/components/ui/SectionHeader";
import { Switch } from "@/components/ui/Switch";
import { TextArea, TextField } from "@/components/ui/TextField";
import { errorText, ipc } from "@/lib/ipc";
import type { SkillDoc, SkillInfo } from "@/lib/types";
import { useConfig } from "@/stores/config";
import { useSkills } from "@/stores/skills";

export function SkillsView() {
  const { list, loading, error } = useSkills();
  const { refresh, toggle } = useSkills.getState();
  const info = useConfig((s) => s.info);
  const [selected, setSelected] = useState<SkillInfo | null>(null);
  const [doc, setDoc] = useState<SkillDoc | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [dirty, setDirty] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = async (skill: SkillInfo) => {
    setSelected(skill);
    setActionError(null);
    setDoc(null);
    try {
      const d = await ipc.skillDoc(skill.dir);
      setDoc(d);
      setName(d.name);
      setDescription(d.description);
      setBody(d.body);
      setDirty(false);
      setTab("edit");
    } catch (e) {
      setActionError(errorText(e));
    }
  };

  const save = async () => {
    if (!doc) return;
    setActionError(null);
    try {
      await ipc.skillSave(doc.dir, name, description, body);
      setDirty(false);
      await refresh();
    } catch (e) {
      setActionError(errorText(e));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Skill"
        hint={<span className="font-mono">{info?.skillsDir ?? "~/.claude/skills"}</span>}
        actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>新建 Skill</Button>}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[280px] shrink-0 flex-col border-r border-line">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {!loading && list.length === 0 && (
              <EmptyState
                icon="spark"
                title="没有找到 Skill"
                hint={<span>在 <span className="font-mono">{info?.skillsDir}</span> 下创建含 SKILL.md 的目录，或点击右上角新建。</span>}
              />
            )}
            <ul className="space-y-0.5">
              {list.map((s) => (
                <li key={s.dir}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => void open(s)}
                    onKeyDown={(e) => e.key === "Enter" && void open(s)}
                    className={
                      "cursor-pointer rounded-control border px-2.5 py-2 transition-colors " +
                      (selected?.dir === s.dir ? "border-line bg-surface shadow-subtle" : "border-transparent hover:bg-hover")
                    }
                  >
                    <div className="flex items-center gap-2">
                      <span className={`inline-block size-1.5 shrink-0 rounded-pill ${s.enabled ? "bg-accent" : "bg-line-strong"}`} />
                      <span className={`min-w-0 flex-1 truncate font-sans text-[13px] font-medium ${s.enabled ? "text-ink" : "text-ink-faint"}`}>
                        {s.name}
                      </span>
                      <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <Switch
                          checked={s.enabled}
                          label={`启用 ${s.name}`}
                          onChange={(v) => {
                            setActionError(null);
                            toggle(s.dir, v).catch((e) => setActionError(errorText(e)));
                          }}
                        />
                      </span>
                    </div>
                    {s.description && (
                      <p className="mt-1 line-clamp-2 pl-3.5 font-sans text-[11.5px] leading-relaxed text-ink-faint">{s.description}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-line px-3 py-2 font-mono text-[10.5px] leading-relaxed text-ink-faint">
            禁用会重命名为 SKILL.md.disabled
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto">
          {(actionError || error) && (
            <p className="mx-6 mt-4 rounded-control border border-line bg-surface px-3 py-2 font-sans text-[12px] text-danger">
              {actionError ?? error}
            </p>
          )}
          {!selected || !doc ? (
            <div className="flex h-full">
              {selected && !actionError ? (
                <p className="m-auto font-sans text-[12px] text-ink-faint">正在读取 {selected.name}…</p>
              ) : (
                <EmptyState icon="spark" title="选择一个 Skill 编辑" hint="左侧切换启用状态，右侧修改 SKILL.md 的名称、描述与正文。" />
              )}
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[760px] px-8 py-6">
              <div className="mb-4 flex items-center gap-2">
                <span className="font-mono text-[11.5px] text-ink-faint">{doc.dir}</span>
                <div className="ml-auto flex items-center gap-1 rounded-control border border-line bg-surface p-0.5 shadow-subtle">
                  {(["edit", "preview"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={
                        "h-6 rounded-chip px-2.5 font-sans text-[12px] " +
                        (tab === t ? "bg-canvas text-ink" : "text-ink-muted hover:text-ink")
                      }
                    >
                      {t === "edit" ? "编辑" : "预览"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label className="block">
                  <div className="mb-1 font-sans text-[12px] text-ink-muted">名称</div>
                  <TextField
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setDirty(true);
                    }}
                  />
                </label>
                <label className="block">
                  <div className="mb-1 font-sans text-[12px] text-ink-muted">描述</div>
                  <TextArea
                    rows={2}
                    className="px-3 py-2 text-[13px]"
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      setDirty(true);
                    }}
                  />
                </label>
              </div>

              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between font-sans text-[12px] text-ink-muted">
                  <span>SKILL.md 正文</span>
                  <span className="text-[11px] text-ink-faint">{body.length} 字符</span>
                </div>
                {tab === "edit" ? (
                  <textarea
                    value={body}
                    onChange={(e) => {
                      setBody(e.target.value);
                      setDirty(true);
                    }}
                    rows={20}
                    spellCheck={false}
                    className="block w-full resize-y rounded-card border border-line bg-surface px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none transition-colors hover:border-line-strong focus:border-accent"
                  />
                ) : (
                  <div className="min-h-[300px] rounded-card border border-line bg-surface px-5 py-4">
                    <Markdown source={body} />
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
                <Button variant="primary" icon="save" disabled={!dirty} onClick={() => void save()}>
                  保存
                </Button>
                {dirty && <span className="font-sans text-[11px] text-ink-faint">有未保存的修改</span>}
                <span className="ml-auto inline-flex items-center gap-1.5 font-sans text-[11.5px] text-ink-muted">
                  <span className={`inline-block size-1.5 rounded-pill ${selected.enabled ? "bg-accent" : "bg-line-strong"}`} />
                  {selected.enabled ? "已启用" : "已禁用"}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {creating && (
        <CreateSkillDialog
          onCancel={() => setCreating(false)}
          onCreate={async (n, d) => {
            setActionError(null);
            try {
              const created = await ipc.skillCreate(n, d);
              setCreating(false);
              await refresh();
              void open(created);
            } catch (e) {
              setActionError(errorText(e));
            }
          }}
          error={actionError}
        />
      )}
    </div>
  );
}

function CreateSkillDialog({ onCancel, onCreate, error }: {
  onCancel: () => void;
  onCreate: (name: string, description: string) => void;
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6" onMouseDown={onCancel}>
      <div className="w-full max-w-md rounded-card border border-line bg-surface p-5 shadow-raised" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="font-sans text-[14px] font-medium text-ink">新建 Skill</h2>
        <p className="mt-1 font-sans text-[12px] text-ink-muted">会在 skills 目录下创建以名称命名的文件夹和 SKILL.md。</p>
        <div className="mt-4 space-y-3">
          <label className="block">
            <div className="mb-1 font-sans text-[12px] text-ink-muted">名称</div>
            <TextField autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：pdf-tools" />
          </label>
          <label className="block">
            <div className="mb-1 font-sans text-[12px] text-ink-muted">描述</div>
            <TextArea rows={2} className="px-3 py-2" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="什么时候应该使用这个 Skill" />
          </label>
          {error && <p className="font-sans text-[12px] text-danger">{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel}>取消</Button>
          <Button variant="primary" icon="plus" disabled={!name.trim()} onClick={() => onCreate(name, description)}>
            创建
          </Button>
        </div>
      </div>
    </div>
  );
}
