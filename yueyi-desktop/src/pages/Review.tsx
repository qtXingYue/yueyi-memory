import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Check, History, Inbox, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { ReviewOverview } from "@/types";
import { reviewApi, reminderApi } from "@/services/api";
import { useApp } from "@/stores/app";
import { fmtRelative, openDrawer } from "@/utils/events";
import { Button, EmptyState, PageHeader, SectionCard, StatTile } from "@/ui";
import Markdown from "@/components/Markdown";

export default function Review() {
  const { toast, refreshAll } = useApp();
  const [data, setData] = useState<ReviewOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekly, setWeekly] = useState("");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await reviewApi.overview());
    } catch (e) {
      toast("error", `读取回顾失败：${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const complete = async (id: number) => {
    try {
      await reminderApi.complete(id);
      await load();
      await refreshAll();
      toast("success", "提醒已完成");
    } catch (e) {
      toast("error", String(e));
    }
  };

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      setWeekly(await reviewApi.weekly());
    } catch (e) {
      toast("error", `生成周报失败：${String(e)}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="page-measure py-7" style={{ "--measure": "900px" } as React.CSSProperties}>
      <PageHeader title="回顾" subtitle="今天存了什么 · 什么还没整理 · 下一步做什么" />

      <div className="grid grid-cols-3 gap-2.5">
        <StatTile value={data?.today_count ?? "—"} label="今日新增" />
        <StatTile value={data?.week_count ?? "—"} label="本周新增" />
        <StatTile value={data?.pending_count ?? "—"} label="待整理" />
      </div>

      <SectionCard
        title="即将到期"
        icon={<CalendarClock size={15} />}
        className="mt-3"
        actions={
          <Button variant="ghost" size="sm" icon={<RefreshCw size={12} />} onClick={() => void load()}>
            刷新
          </Button>
        }
      >
        {data && data.upcoming.length > 0 ? (
          <div className="space-y-1.5">
            {data.upcoming.map((r) => (
              <div
                key={r.id}
                className="group flex items-center gap-3 rounded-xl bg-base-panel/60 px-3 py-2.5 transition-colors hover:bg-base-panel"
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => r.memory_id && openDrawer(r.memory_id)}
                >
                  <div className="truncate text-[13px] font-medium text-ink">{r.title}</div>
                  <div className="mt-0.5 text-[11px] text-ink-faint">{r.remind_at}</div>
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Check size={12} />}
                  onClick={() => void complete(r.id)}
                >
                  完成
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<CalendarClock size={18} />}
            title="没有到期提醒"
            hint="从记忆里识别出的 DDL、会议时间会自动出现在这里"
            className="py-6"
          />
        )}
      </SectionCard>

      <SectionCard title="最近捕获" icon={<Inbox size={15} />} className="mt-3">
        {(data?.recent.length ?? 0) > 0 ? (
          <div className="space-y-1">
            {data!.recent.map((m) => (
              <button
                key={m.id}
                onClick={() => openDrawer(m.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-base-panel/60"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent/60" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-dim">
                  {m.title || "未命名记忆"}
                </span>
                <span className="shrink-0 text-[11px] text-ink-faint">{fmtRelative(m.created_at)}</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState icon={<History size={18} />} title="还没有记忆" hint="按 Alt+Shift+M 随手记一条" className="py-6" />
        )}
      </SectionCard>

      <SectionCard
        title="周报草稿"
        icon={<Sparkles size={15} />}
        className="mt-3"
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            disabled={generating}
            onClick={() => void generate()}
          >
            {generating ? "生成中…" : "生成本周周报"}
          </Button>
        }
      >
        {weekly ? (
          <div className="text-[13px] leading-relaxed text-ink-dim">
            <Markdown text={weekly} />
          </div>
        ) : (
          <p className="text-[12px] leading-relaxed text-ink-faint">
            根据本周 60 条记忆生成主题、资料、待办与下周建议。只在点击时调用 AI。
          </p>
        )}
      </SectionCard>

      <SectionCard title="旧记忆重现" icon={<History size={15} />} className="mt-3">
        {(data?.stale.length ?? 0) > 0 ? (
          <div className="space-y-1">
            {data!.stale.map((m) => (
              <button
                key={m.id}
                onClick={() => openDrawer(m.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-base-panel/60"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-dim">
                  {m.title || "未命名记忆"}
                </span>
                <span className="shrink-0 text-[11px] text-ink-faint">{fmtRelative(m.created_at)}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-ink-faint">暂无 60 天前的记忆。</p>
        )}
      </SectionCard>

      {loading && <div className="mt-3 text-center text-[12px] text-ink-faint">加载中…</div>}
    </div>
  );
}
