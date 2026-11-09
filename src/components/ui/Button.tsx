import type { ComponentProps } from "react";

import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-control font-sans font-medium select-none whitespace-nowrap " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] " +
  "disabled:pointer-events-none disabled:opacity-45";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent shadow-subtle hover:bg-accent-hover active:bg-accent-press",
  secondary: "bg-surface text-ink border border-line shadow-subtle hover:border-line-strong hover:bg-sunken",
  ghost: "text-ink-muted hover:text-ink hover:bg-sunken",
  danger: "bg-surface text-danger border border-line shadow-subtle hover:border-danger",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12px]",
  md: "h-8 px-3.5 text-[13px]",
};

const iconOnly: Record<Size, string> = { sm: "size-7", md: "size-8" };

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const shape = children ? sizes[size] : iconOnly[size];
  return (
    <button type={type} className={`${base} ${variants[variant]} ${shape} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === "sm" ? 13 : 14} />}
      {children}
    </button>
  );
}
