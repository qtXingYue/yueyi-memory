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
    <article
      onClick={onActivate}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      className={`card-sheen memory-card-surface group relative cursor-pointer rounded-2xl p-4 outline-none ${
        index < 8 ? "animate-rise" : ""
      } ${selected ? "bg-accent/[0.06] ring-2 ring-accent/45" : ""}`}
    >
      {actions}

      <div className="flex items-start gap-3.5">
        {/* 批量选择：真 checkbox，避免 role=button 包按钮 */}
        {batchMode && (
          <label
            className="mt-1 flex cursor-pointer items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={Boolean(selected)}
              onChange={() => onActivate()}
              aria-label="选择这条记忆"
              className="peer sr-only"
            />
            <span
              aria-hidden
              className={`flex h-4 w-4 items-center justify-center rounded border transition-all duration-200 ${
                selected
                  ? "border-accent bg-accent text-white"
                  : "border-ink-faint/40 bg-base-panel text-transparent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50"
              }`}
            >
              {selected && <Check size={11} strokeWidth={2.5} />}
            </span>
          </label>
        )}

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </article>
  );
}
