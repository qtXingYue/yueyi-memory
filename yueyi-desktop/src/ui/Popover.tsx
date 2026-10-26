import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface PopoverProps {
  open: boolean;
  /** 触发元素的屏幕矩形（getBoundingClientRect） */
  anchor: DOMRect | null;
  onClose: () => void;
  width?: number;
  /** 预估高度，用于上下翻转 */
  estimatedHeight?: number;
  align?: "start" | "end";
  ariaLabel?: string;
  children: ReactNode;
}

/**
 * 通用浮层：portal 到 body，自动避开视口边缘与上下溢出。
 * 只负责定位与关闭，内容由调用方决定（菜单/取色器/设置面板都可用）。
 */
export function Popover({
  open,
  anchor,
  onClose,
  width = 196,
  estimatedHeight = 220,
  align = "end",
  ariaLabel,
  children,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onLayout = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onLayout);
    window.addEventListener("scroll", onLayout, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onLayout);
      window.removeEventListener("scroll", onLayout, true);
    };
  }, [open, onClose]);

  if (!open || !anchor) return null;

  const left =
    align === "end"
      ? Math.min(Math.max(8, anchor.right - width), window.innerWidth - width - 8)
      : Math.min(Math.max(8, anchor.left), window.innerWidth - width - 8);
  const top =
    anchor.bottom + 6 + estimatedHeight > window.innerHeight
      ? Math.max(8, anchor.top - estimatedHeight - 6)
      : anchor.bottom + 6;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={ariaLabel}
      className="glass-deep fixed z-[120] rounded-xl border border-base-border/70 p-1.5 shadow-drawer"
      style={{ left, top, width }}
    >
      {children}
    </div>,
    document.body
  );
}
