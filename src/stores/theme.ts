/**
 * 主题：light / dark / system。
 * system 通过 prefers-color-scheme 解析，系统切换时实时跟随。
 * 结果写入 <html data-theme>，首帧前应用避免闪白。
 */
import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
const KEY = "loom.theme";

export function storedMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

const media = () => (typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null);

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== "system") return mode;
  return media()?.matches ? "dark" : "light";
}

export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // 隐私模式下写不进去也无妨
  }
  return resolved;
}

interface ThemeStore {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  set: (m: ThemeMode) => void;
}

export const useTheme = create<ThemeStore>((set) => ({
  mode: storedMode(),
  resolved: typeof document !== "undefined" ? (document.documentElement.dataset.theme === "dark" ? "dark" : "light") : "light",
  set(mode) {
    set({ mode, resolved: applyTheme(mode) });
  },
}));

// 系统主题变化时，如果当前是跟随系统就立即应用
media()?.addEventListener("change", () => {
  const { mode } = useTheme.getState();
  if (mode === "system") useTheme.setState({ resolved: applyTheme("system") });
});
