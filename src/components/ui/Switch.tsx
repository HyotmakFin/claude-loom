export function Switch({ checked, onChange, disabled, label }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-pill border transition-colors duration-150 " +
        "disabled:cursor-not-allowed disabled:opacity-45 " +
        (checked ? "border-accent bg-accent" : "border-line-strong bg-sunken")
      }
    >
      <span
        className={
          "inline-block size-4 rounded-pill bg-surface shadow-subtle transition-transform duration-150 " +
          (checked ? "translate-x-[17px]" : "translate-x-[3px]")
        }
      />
    </button>
  );
}
