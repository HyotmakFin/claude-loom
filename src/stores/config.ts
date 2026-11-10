/** Loom 自身配置 + 环境信息。Provider/密钥由 cc-switch 或 Claude settings 管理。 */
import { create } from "zustand";

import { errorText, ipc } from "@/lib/ipc";
import type { AppInfo, LoomConfig } from "@/lib/types";

export function emptyConfig(): LoomConfig {
  return {
    pluginDirs: [],
    sessionFlags: {},
    cliPath: null,
    permissionMode: null,
  };
}

interface ConfigStore {
  config: LoomConfig;
  info: AppInfo | null;
  loaded: boolean;
  error: string | null;
  init: () => Promise<void>;
  save: (next: LoomConfig) => Promise<void>;
  update: (fn: (cfg: LoomConfig) => LoomConfig) => Promise<void>;
}

export const useConfig = create<ConfigStore>((set, get) => ({
  config: emptyConfig(),
  info: null,
  loaded: false,
  error: null,

  async init() {
    try {
      const [config, info] = await Promise.all([ipc.configGet(), ipc.appInfo()]);
      set({ config, info, loaded: true, error: null });
    } catch (e) {
      set({ error: errorText(e), loaded: true });
    }
  },

  async save(next) {
    const prev = get().config;
    set({ config: next });
    try {
      await ipc.configSave(next);
    } catch (e) {
      set({ config: prev, error: errorText(e) });
      throw e;
    }
  },

  async update(fn) {
    await get().save(fn(get().config));
  },
}));
