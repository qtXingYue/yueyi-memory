/**
 * 悬浮提示气泡：只渲染气泡本身，父元素需带 `group` 与 `relative`。
 * 比原生 title 快（150ms），且支持快捷键后缀。
 */
export function TooltipBubble({
  label,
  kbd,
  side = "right",
}: {
  label: string;
  kbd?: string;
  side?: "right" | "top";
}) {
  const pos =
    side === "right"
      ? "left-full top-1/2 ml-2 -translate-y-1/2"
      : "bottom-full left-1/2 mb-2 -translate-x-1/2";
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute z-50 flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-base-border/70 bg-base-panel px-2.5 py-1 text-[12px] font-medium text-ink opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 ${pos}`}
    >
      {label}
      {kbd && (
        <kbd className="rounded bg-base-panel2 px-1 py-0 font-mono text-[12px] text-ink-faint">
          {kbd}
        </kbd>
      )}
    </span>
  );
}
