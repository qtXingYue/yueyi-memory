import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type IconButtonSize = "xs" | "sm" | "md";
export type IconButtonVariant = "ghost" | "surface" | "danger";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  label: string;
  icon: ReactNode;
}

const SIZE: Record<IconButtonSize, string> = {
  xs: "h-6 w-6 rounded-md",
  sm: "h-7 w-7 rounded-lg",
  md: "h-8 w-8 rounded-lg",
};

const VARIANT: Record<IconButtonVariant, string> = {
  ghost: "text-ink-dim hover:bg-base-panel hover:text-ink",
  surface: "bg-base-panel text-ink-dim hover:bg-base-panel2 hover:text-ink shadow-sm",
  danger: "text-ink-dim hover:bg-danger hover:text-white",
};

/** 方形图标按钮：label 同时作为 aria-label 与 title，保证可访问性 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = "sm", variant = "ghost", label, icon, className = "", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center transition-colors duration-200 ${SIZE[size]} ${VARIANT[variant]} ${className}`}
      {...rest}
    >
      {icon}
    </button>
  );
});
