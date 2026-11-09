import { useEffect, useRef } from "react";

import { Button } from "./Button";

interface Props {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, description, confirmLabel = "确认", danger, onConfirm, onCancel }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6" onMouseDown={onCancel}>
      <div
        role="alertdialog"
        aria-modal
        aria-label={title}
        className="w-full max-w-sm rounded-card border border-line bg-surface p-5 shadow-raised"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="font-sans text-[14px] font-medium text-ink">{title}</h2>
        {description && <p className="mt-1.5 font-sans text-[13px] leading-relaxed text-ink-muted">{description}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel}>取消</Button>
          <Button ref={confirmRef} variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
