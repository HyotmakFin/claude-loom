import { create } from "zustand";

import { errorText, ipc } from "@/lib/ipc";
import type { SkillInfo } from "@/lib/types";

interface SkillsStore {
  list: SkillInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  toggle: (dir: string, enabled: boolean) => Promise<void>;
}

export const useSkills = create<SkillsStore>((set, get) => ({
  list: [],
  loading: false,
  error: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      set({ list: await ipc.skillsList(), loading: false });
    } catch (e) {
      set({ error: errorText(e), loading: false });
    }
  },

  async toggle(dir, enabled) {
    await ipc.skillToggle(dir, enabled);
    await get().refresh();
  },
}));
