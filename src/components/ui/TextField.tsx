import type { ComponentProps, ReactNode } from "react";

import { Icon, type IconName } from "./Icon";

const shell =
  "flex items-center gap-2 rounded-field border border-line bg-surface px-3 font-sans text-[13px] text-ink " +
  "transition-[border-color,box-shadow] duration-150 hover:border-line-strong " +
  "focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-tint";

const input = "min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-faint disabled:text-ink-faint";

interface FieldProps extends Omit<ComponentProps<"input">, "prefix"> {
  icon?: IconName;
  /** 显示在输入框左侧的小标签，如 "cwd" */
  prefix?: ReactNode;
}

export function TextField({ icon, prefix, className = "", ...rest }: FieldProps) {
  return (
    <label className={`${shell} h-9 ${className}`}>
      {icon && <Icon name={icon} size={15} className="shrink-0 text-ink-faint" />}
      {prefix && <span className="shrink-0 text-[12px] text-ink-faint">{prefix}</span>}
      <input className={input} spellCheck={false} {...rest} />
    </label>
  );
}

export function TextArea({ className = "", ...rest }: ComponentProps<"textarea">) {
  return <textarea className={`${input} resize-none leading-relaxed ${className}`} {...rest} />;
}
