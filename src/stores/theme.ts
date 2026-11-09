/** 主题：light / dark，写入 <html data-theme> 与 localStorage；首帧前应用。 */
import { create } from "zustand";

export type Theme = "light" | "dark";
const KEY = "loom.theme";

function stored(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // 隐私模式下写不进去也无妨
  }
}

interface ThemeStore {
  theme: Theme;
  set: (t: Theme) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeStore>((set, get) => ({
  theme: stored(),
  set(t) {
    applyTheme(t);
    set({ theme: t });
  },
  toggle() {
    get().set(get().theme === "dark" ? "light" : "dark");
  },
}));
