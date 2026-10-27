import { PanelRightOpen } from "lucide-react";
import { useAppPick } from "@/stores/app";
import { openDrawer } from "@/utils/events";
import { Spark } from "@/components/Sparkline";

function RailStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex w-full flex-col items-center leading-none">
      <span className="font-mono text-[14px] font-bold text-ink">{value}</span>
      <span className="mt-1 text-[12px] text-ink-faint">{label}</span>
    </div>
  );
}

export default function AiInsightPanel() {
  const {
    memories,
    stats,
    hotTags,
    recent,
    insightMode,
    cycleInsight,
    activeTag,
    setActiveTag,
  } = useAppPick(
    "memories",
    "stats",
    "hotTags",
    "recent",
    "insightMode",
    "cycleInsight",
    "activeTag",
    "setActiveTag"
  );

  const totalCount = memories.length;
  const screenshotCount = memories.filter(
    (m) => m.type === "screenshot" || m.type === "image"
  ).length;
  const linkCount = memories.filter(
    (m) => m.type === "link" || Boolean(m.source_url)
  ).length;

  if (insightMode === "hidden") return null;

  /* 窄栏：窗口不够宽时的降级形态，只保留三个计数，不再挤压卡片列 */
  if (insightMode === "rail") {
    return (
      <aside
        aria-label="记忆概览（窄栏）"
        className="flex w-[56px] shrink-0 flex-col items-center gap-3.5 py-5"
      >
        <RailStat value={totalCount} label="总计" />
        <RailStat value={screenshotCount} label="截图" />
        <RailStat value={linkCount} label="网页" />
        <button
          type="button"
          onClick={cycleInsight}
          title="展开概览栏"
          className="mt-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-base-panel2 hover:text-accent"
        >
          <PanelRightOpen size={14} strokeWidth={1.8} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-label="记忆概览"
      className="flex w-[264px] shrink-0 flex-col gap-4 overflow-y-auto py-6 pr-6 pl-2 transition-all duration-300"
    >
      {/* 数据概览（无边框柔和底色块，无内部分割线） */}
      <div className="shrink-0 rounded-2xl bg-base-panel2/80 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[12px] font-semibold text-ink">记忆概览</span>
          <span className="text-[12px] text-ink-faint">
            今日 +{stats?.total ?? 0} · 14天趋势
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-base-panel py-2.5">
            <div className="font-mono text-[18px] font-bold text-ink">
              {totalCount}
            </div>
            <div className="mt-0.5 text-[12px] text-ink-faint">总计</div>
          </div>
          <div className="rounded-xl bg-base-panel py-2.5">
            <div className="font-mono text-[18px] font-bold text-ink">
              {screenshotCount}
            </div>
            <div className="mt-0.5 text-[12px] text-ink-faint">截图</div>
          </div>
          <div className="rounded-xl bg-base-panel py-2.5">
            <div className="font-mono text-[18px] font-bold text-ink">
              {linkCount}
            </div>
            <div className="mt-0.5 text-[12px] text-ink-faint">网页关联</div>
          </div>
        </div>

        <div className="mt-3.5 pt-1">
          <Spark data={stats?.trend ?? []} />
        </div>
      </div>

      {/* 热门标签 */}
      <div className="shrink-0 rounded-2xl bg-base-panel2/80 p-4">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[12px] font-semibold text-ink">常用标签</span>
          {activeTag && (
            <button
              onClick={() => setActiveTag(null)}
              className="text-[12px] text-accent hover:underline"
            >
              清除筛选
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {hotTags.length === 0 && (
            <span className="text-[12px] text-ink-faint">
              保存记忆后将由 AI 自动归纳标签
            </span>
          )}
          {hotTags.map((t) => {
            const selected = activeTag === t.name;
            return (
              <button
                key={t.name}
                onClick={() => setActiveTag(selected ? null : t.name)}
                className={`rounded-lg px-2.5 py-1 text-[12px] font-medium transition-all duration-200 ${
                  selected
                    ? "bg-accent text-white shadow-sm"
                    : "bg-base-panel text-ink-dim hover:text-ink"
                }`}
              >
                #{t.name}
                <span className="ml-1 opacity-60">{t.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 最近记录 */}
      <div className="shrink-0 rounded-2xl bg-base-panel2/80 p-4">
        <div className="mb-2 text-[12px] font-semibold text-ink">最近捕获</div>
        <div className="space-y-1">
          {recent.length === 0 && (
            <span className="text-[12px] text-ink-faint">暂无记录</span>
          )}
          {recent.map((m) => (
            <button
              key={m.id}
              onClick={() => openDrawer(m.id)}
              className="group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors duration-200 hover:bg-base-panel"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent/60 transition-colors group-hover:bg-accent" />
              <span className="flex-1 truncate text-[12px] text-ink-dim transition-colors group-hover:text-ink">
                {m.title || "未命名记忆"}
              </span>
              <span className="shrink-0 font-mono text-[12px] text-ink-faint">
                {new Date(m.created_at).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
