import type { ReactNode } from "react";

export function PageHeader({ title, hint, actions }: { title: string; hint?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
      <div className="min-w-0">
        <h1 className="font-serif text-[16px] font-semibold leading-tight text-ink">{title}</h1>
        {hint && <p className="truncate font-sans text-[12px] text-ink-faint">{hint}</p>}
      </div>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </header>
  );
}
