import type { ReactNode } from "react";
import { Check } from "lucide-react";

/**
 * 记忆卡片外壳：负责点击/键盘语义、批量选择、入场动画与选中态。
 * 内容由调用方组合（图片块/标题/摘要/元信息）。
 */
export default function CardShell({
  index = 0,
  batchMode,
  selected,
  onActivate,
  actions,
  children,
}: {
  index?: number;
  batchMode?: boolean;
  selected?: boolean;
  onActivate: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role={batchMode ? "checkbox" : "button"}
      aria-checked={batchMode ? selected : undefined}
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onActivate();
        }
      }}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      className={`card-sheen memory-card-surface group relative cursor-pointer rounded-2xl p-4 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
        index < 8 ? "animate-rise" : ""
      } ${selected ? "bg-accent/[0.06] ring-2 ring-accent/45" : ""}`}
    >
      {actions}

      <div className="flex items-start gap-3.5">
        {/* 批量选择框：语义由外层 role="checkbox" 承担，这里只是视觉指示 */}
        {batchMode && (
          <div className="mt-1 flex items-center" aria-hidden>
            <div
              className={`flex h-4 w-4 items-center justify-center rounded transition-all duration-200 ${
                selected
                  ? "bg-accent text-white"
                  : "bg-base-panel text-transparent ring-1 ring-ink-faint/30"
              }`}
            >
              {selected && <Check size={11} strokeWidth={2.5} />}
            </div>
          </div>
        )}

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
