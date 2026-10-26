import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

/** 全站统一的遮罩层：渐显/渐隐由 closing 控制 */
export function OverlayBackdrop({
  closing = false,
  onClick,
  blur = true,
}: {
  closing?: boolean;
  onClick?: () => void;
  blur?: boolean;
}) {
  return (
    <div
      aria-hidden
      onClick={onClick}
      className={`absolute inset-0 bg-black/45 ${blur ? "backdrop-blur-[2px]" : ""} ${
        closing ? "animate-fade-out" : "animate-fade-in"
      }`}
    />
  );
}

type PanelProps = {
  children: ReactNode;
  className?: string;
  closing?: boolean;
} & HTMLAttributes<HTMLDivElement>;

/** 居中模态面板外壳（命令面板 / 新建记忆共用） */
export const ModalPanel = forwardRef<HTMLDivElement, PanelProps>(function ModalPanel(
  { children, className = "", closing = false, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={`glass-deep absolute shadow-drawer outline-none ${
        closing ? "animate-modal-out" : "animate-modal-in"
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
});

/** 右侧抽屉面板外壳（记忆详情） */
export const DrawerPanel = forwardRef<HTMLDivElement, PanelProps>(function DrawerPanel(
  { children, className = "", closing = false, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={`glass-deep absolute right-0 top-0 flex h-full flex-col shadow-drawer outline-none ${
        closing ? "animate-drawer-out" : "animate-drawer-in"
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
});
