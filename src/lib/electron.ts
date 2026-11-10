/** Electron 渲染进程桥。preload 里通过 contextBridge 暴露 window.loom。 */
export interface OpenDialogOptions {
  multiple?: boolean;
  directory?: boolean;
  defaultPath?: string;
  title?: string;
}

export interface LoomBridge {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  onEvent(name: string, cb: (payload: unknown) => void): () => void;
  openDialog(opts?: OpenDialogOptions): Promise<string | string[] | null>;
  openUrl(url: string): Promise<void>;
  homeDir(): Promise<string>;
  copyText(text: string): Promise<boolean>;
}

declare global {
  interface Window {
    loom: LoomBridge;
  }
}

export function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return window.loom.invoke<T>(cmd, args);
}

/** 与 Tauri 的 listen 形状保持一致：回调收到 { payload }。 */
export function listen<T>(event: string, cb: (e: { payload: T }) => void): Promise<() => void> {
  if (typeof window === "undefined" || !window.loom) return Promise.resolve(() => {});
  const off = window.loom.onEvent(event, (payload) => cb({ payload: payload as T }));
  return Promise.resolve(off);
}

export async function openDialog(opts: OpenDialogOptions = {}): Promise<string | null> {
  const value = await window.loom.openDialog(opts);
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function openUrl(url: string): Promise<void> {
  return window.loom.openUrl(url);
}

export function homeDir(): Promise<string> {
  return window.loom.homeDir();
}

export function copyText(text: string): Promise<boolean> {
  return window.loom.copyText(text);
}
