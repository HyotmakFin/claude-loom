/** 把 Loom 自身配置翻译成 CLI 启动参数。Provider/密钥由 cc-switch 或 Claude settings 管理。 */
import type { StartOptions } from "./ipc";
import type { LoomConfig } from "./types";

export function startOptions(cfg: LoomConfig, cwd: string, resume?: string): StartOptions {
  return {
    cwd,
    resume,
    pluginDirs: cfg.pluginDirs.filter((d) => d.enabled).map((d) => d.path),
    permissionMode: cfg.permissionMode ?? undefined,
    cliPath: cfg.cliPath ?? undefined,
    partialMessages: true,
  };
}
