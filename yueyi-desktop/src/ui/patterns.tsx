import type { ReactNode } from "react";

/** 页面标题区：四个页面唯一规格 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-6 flex items-end justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h1 className="page-title truncate">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-ink-dim">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** 设置/详情里的分组卡片 */
export function SectionCard({
  title,
  icon,
  actions,
  children,
  className = "",
  id,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`glass rounded-2xl p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {icon}
            {title && <h2 className="text-[14px] font-semibold text-ink">{title}</h2>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** 空状态：图标 + 标题 + 提示 + 可选操作 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className = "",
}: {
  icon: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center py-12 text-center ${className}`}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-base-panel2 text-ink-dim">
        {icon}
      </div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {hint && <p className="mt-1.5 max-w-[420px] text-[13px] leading-relaxed text-ink-faint">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** 骨架块 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

/** 统计数值块（右侧概览栏 / 设置存储） */
export function StatTile({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="rounded-xl bg-base-panel py-2.5 text-center">
      <div className="font-mono text-[18px] font-bold text-ink">{value}</div>
      <div className="mt-0.5 text-[12px] text-ink-faint">{label}</div>
    </div>
  );
}
