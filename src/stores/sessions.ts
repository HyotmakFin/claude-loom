import { create } from "zustand";

import { errorText, ipc } from "@/lib/ipc";
import type { SessionSummary } from "@/lib/types";

interface SessionsStore {
  list: SessionSummary[];
  loading: boolean;
  error: string | null;
  query: string;
  includeArchived: boolean;
  refresh: () => Promise<void>;
  setQuery: (q: string) => void;
  setIncludeArchived: (v: boolean) => void;
  setFlag: (id: string, flag: { pinned?: boolean; archived?: boolean }) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

let requestSeq = 0;

export const useSessions = create<SessionsStore>((set, get) => ({
  list: [],
  loading: false,
  error: null,
  query: "",
  includeArchived: false,

  async refresh() {
    const seq = ++requestSeq;
    set({ loading: true, error: null });
    try {
      const list = await ipc.sessionList(get().query, get().includeArchived);
      if (seq !== requestSeq) return; // 期间又发起了新的搜索
      set({ list, loading: false });
    } catch (e) {
      if (seq === requestSeq) set({ error: errorText(e), loading: false });
    }
  },

  setQuery(q) {
    set({ query: q });
    void get().refresh();
  },

  setIncludeArchived(v) {
    set({ includeArchived: v });
    void get().refresh();
  },

  async setFlag(id, flag) {
    await ipc.sessionSetFlag(id, flag.pinned, flag.archived);
    set((s) => ({ list: s.list.map((x) => (x.id === id ? { ...x, ...flag } : x)) }));
    void get().refresh();
  },

  async remove(id) {
    await ipc.sessionDelete(id);
    set((s) => ({ list: s.list.filter((x) => x.id !== id) }));
  },
}));
