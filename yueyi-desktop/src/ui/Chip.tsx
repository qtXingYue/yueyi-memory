import type { ButtonHTMLAttributes } from "react";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

/** 横向筛选 chip：选中态与 hover 由 .chip[data-active] 统一控制 */
export function Chip({ active = false, className = "", children, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      data-active={active}
      aria-pressed={active}
      className={`chip ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
