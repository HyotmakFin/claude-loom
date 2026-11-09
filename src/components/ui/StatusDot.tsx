export type Tone = "accent" | "ok" | "warn" | "danger" | "idle";

const dot: Record<Tone, string> = {
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  idle: "bg-ink-faint",
};

export function StatusDot({ tone, pulse = false, label }: { tone: Tone; pulse?: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-sans text-[12px] text-ink-muted">
      <span className="relative inline-flex size-1.5">
        {pulse && <span className={`absolute inset-0 animate-ping rounded-pill opacity-60 ${dot[tone]}`} />}
        <span className={`relative inline-block size-1.5 rounded-pill ${dot[tone]}`} />
      </span>
      {label}
    </span>
  );
}

/** 胶囊状态标签：白底细边框 + 状态点 */
export function StatusPill({ tone, pulse, children }: { tone: Tone; pulse?: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-pill border border-line bg-surface px-2.5 font-sans text-[12px] text-ink-muted shadow-subtle">
      <StatusDot tone={tone} pulse={pulse} />
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-chip border border-line bg-surface px-1 font-sans text-[11px] text-ink-faint">
      {children}
    </kbd>
  );
}
