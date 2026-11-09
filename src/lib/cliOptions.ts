/** 把 Loom 配置翻译成 CLI 启动参数：BYOK 环境变量、插件目录、权限模式。 */
import type { StartOptions } from "./ipc";
import type { LoomConfig, Profile } from "./types";

/** Claude Code 支持的环境变量：模型映射走 ANTHROPIC_DEFAULT_*_MODEL。 */
export function profileEnv(p: Profile | undefined): { env: Record<string, string>; envRemove: string[] } {
  const env: Record<string, string> = {};
  const envRemove: string[] = [];
  if (!p) return { env, envRemove };
  const baseUrl = p.baseUrl.trim();
  const key = p.apiKey.trim();
  if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
  if (key) {
    env.ANTHROPIC_API_KEY = key;
    // 同时存在 AUTH_TOKEN 时 CLI 会优先用它，导致 BYOK 不生效
    envRemove.push("ANTHROPIC_AUTH_TOKEN");
  }
  const map = { opus: "ANTHROPIC_DEFAULT_OPUS_MODEL", sonnet: "ANTHROPIC_DEFAULT_SONNET_MODEL", haiku: "ANTHROPIC_DEFAULT_HAIKU_MODEL" } as const;
  for (const [k, name] of Object.entries(map) as [keyof typeof map, string][]) {
    const v = p.models[k].trim();
    if (v) env[name] = v;
  }
  return { env, envRemove };
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
