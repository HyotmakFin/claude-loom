/** 侧栏主题菜单：跟随系统 / 浅色 / 深色。 */
import { useEffect, useRef, useState } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { useTheme, type ThemeMode } from "@/stores/theme";

const OPTIONS: { mode: ThemeMode; label: string; icon: IconName }[] = [
  { mode: "system", label: "跟随系统", icon: "monitor" },
  { mode: "light", label: "浅色", icon: "sun" },
  { mode: "dark", label: "深色", icon: "moon" },
];

export function ThemeMenu() {
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.set);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find((o) => o.mode === mode) ?? OPTIONS[0]!;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative ml-auto">
      <button
        type="button"
        aria-label="切换主题"
        title={`主题：${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex size-7 items-center justify-center rounded-control text-ink-faint transition-colors hover:bg-hover hover:text-ink"
      >
        <Icon name={current.icon} size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-40 mt-1 w-36 overflow-hidden rounded-card border border-line bg-surface py-1 shadow-raised"
        >
          {OPTIONS.map((o) => (
            <button
              key={o.mode}
              type="button"
              role="menuitemradio"
              aria-checked={o.mode === mode}
              onClick={() => {
                setMode(o.mode);
                setOpen(false);
              }}
              className={
                "flex h-8 w-full items-center gap-2 px-2.5 text-left font-sans text-[12.5px] transition-colors " +
                (o.mode === mode ? "text-ink" : "text-ink-muted hover:bg-sunken hover:text-ink")
              }
            >
              <Icon name={o.icon} size={13} className={o.mode === mode ? "text-accent" : "text-ink-faint"} />
              <span className="flex-1">{o.label}</span>
              {o.mode === mode && <Icon name="check" size={12} className="text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
