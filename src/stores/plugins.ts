import { create } from "zustand";

import { errorText, ipc } from "@/lib/ipc";
import type { PluginDirInfo, PluginsListing } from "@/lib/types";

interface PluginsStore {
  data: PluginsListing;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  add: (path: string) => Promise<PluginDirInfo>;
  remove: (path: string) => Promise<void>;
  toggle: (path: string, enabled: boolean) => Promise<void>;
}

export const usePlugins = create<PluginsStore>((set, get) => ({
  data: { installed: [], dirs: [] },
  loading: false,
  error: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      set({ data: await ipc.pluginsList(), loading: false });
    } catch (e) {
      set({ error: errorText(e), loading: false });
    }
  },

  async add(path) {
    const info = await ipc.pluginAddDir(path);
    await get().refresh();
    return info;
  },

  async remove(path) {
    await ipc.pluginRemoveDir(path);
    await get().refresh();
  },

  async toggle(path, enabled) {
    await ipc.pluginToggle(path, enabled);
    await get().refresh();
  },
}));
