import type { ReactNode } from "react";

import { Icon, type IconName } from "./Icon";

export function EmptyState({ icon, title, hint, action }: {
  icon: IconName;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-11 items-center justify-center rounded-card border border-line bg-canvas text-ink-faint shadow-subtle">
        <Icon name={icon} size={20} />
      </div>
      <div className="font-sans">
        <div className="text-[13px] font-medium text-ink">{title}</div>
        {hint && <div className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-ink-faint">{hint}</div>}
      </div>
      {action}
    </div>
  );
}
