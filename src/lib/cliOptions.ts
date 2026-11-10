/**
 * 把 Loom 配置翻译成 CLI 启动参数。
 *
 * 环境变量命名与 cc-switch 保持一致：
 *   ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY
 *   ANTHROPIC_MODEL（兜底）、ANTHROPIC_DEFAULT_{OPUS,SONNET,FABLE,HAIKU}_MODEL(_NAME)
 *   CLAUDE_CODE_SUBAGENT_MODEL
 * 模型名带 1M 标记时追加 `[1m]`。
 */
import type { StartOptions } from "./ipc";
import type { LoomConfig, Profile } from "./types";

export const AUTH_FIELDS = ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] as const;

/** 追加 `[1m]`；已带后缀时不重复。 */
export function effectiveModel(model: string, million: boolean): string {
  const m = model.trim();
  if (!m) return "";
  return million && !/\[1m\]$/i.test(m) ? `${m}[1m]` : m;
}

/** 角色 → 实际模型 / 显示名称 的环境变量。 */
export const MODEL_ENV = [
  { key: "opus", model: "ANTHROPIC_DEFAULT_OPUS_MODEL", name: "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME", hasName: true },
  { key: "sonnet", model: "ANTHROPIC_DEFAULT_SONNET_MODEL", name: "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME", hasName: true },
  { key: "fable", model: "ANTHROPIC_DEFAULT_FABLE_MODEL", name: "ANTHROPIC_DEFAULT_FABLE_MODEL_NAME", hasName: true },
  { key: "haiku", model: "ANTHROPIC_DEFAULT_HAIKU_MODEL", name: "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME", hasName: true },
  { key: "subagent", model: "CLAUDE_CODE_SUBAGENT_MODEL", name: "", hasName: false },
  { key: "fallback", model: "ANTHROPIC_MODEL", name: "", hasName: false },
] as const;

export type ModelRoleKey = (typeof MODEL_ENV)[number]["key"];

/** 当前配置将被注入的环境变量（key 已脱敏由调用方处理）。 */
export function profileEnv(p: Profile | undefined): { env: Record<string, string>; envRemove: string[] } {
  const env: Record<string, string> = {};
  const remove = new Set<string>();
  if (!p) return { env, envRemove: [] };

  const baseUrl = p.baseUrl.trim();
  const key = p.apiKey.trim();
  if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
  if (key) {
    const field = p.authField === "ANTHROPIC_API_KEY" ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN";
    env[field] = key;
    // 两者同时存在时 CLI 的行为不确定，主动移除另一个
    remove.add(field === "ANTHROPIC_API_KEY" ? "ANTHROPIC_AUTH_TOKEN" : "ANTHROPIC_API_KEY");
  }

  for (const role of MODEL_ENV) {
    const cfg = p.models[role.key];
    const value = effectiveModel(cfg, p.models[`${role.key}Million` as keyof Profile["models"]] as boolean);
    if (value) env[role.model] = value;
    else remove.add(role.model); // 留空：清掉旧覆盖，回落到官方默认模型
    if (role.hasName) {
      const display = p.models[`${role.key}Name` as keyof Profile["models"]] as string;
      if (display?.trim()) env[role.name] = display.trim();
      else remove.add(role.name);
    }
  }
  return { env, envRemove: [...remove] };
}

export function startOptions(cfg: LoomConfig, cwd: string, resume?: string): StartOptions {
  const profile = cfg.profiles.find((p) => p.id === cfg.activeProfileId);
  const { env, envRemove } = profileEnv(profile);
  return {
    cwd,
    resume,
    env,
    envRemove,
    pluginDirs: cfg.pluginDirs.filter((d) => d.enabled).map((d) => d.path),
    permissionMode: cfg.permissionMode ?? undefined,
    cliPath: cfg.cliPath ?? undefined,
    partialMessages: true,
  };
}
