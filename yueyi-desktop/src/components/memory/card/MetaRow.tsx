import { useState } from "react";
import { RefreshCw } from "lucide-react";
import type { Memory } from "@/types";
import { memoryApi } from "@/services/api";
import { useAppPick } from "@/stores/app";
import { fmtRelative, sourceLabel } from "@/utils/events";

const AI_STATUS_LABEL: Record<Memory["ai_status"], string> = {
  pending: "待整理",
  processing: "AI 整理中…",
  done: "已整理",
  failed: "AI 待重试",
};

/** 元信息：状态点 · 来源 · 时间 · 合集 */
export default function MetaRow({ memory, score }: { memory: Memory; score?: number }) {
  const { toast } = useAppPick("toast");
  const [retrying, setRetrying] = useState(false);
  const retry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (retrying) return;
    setRetrying(true);
    try {
      await memoryApi.reanalyze(memory.id);
      toast("info", "已重新加入 AI 整理队列");
    } catch (err) {
      toast("error", `重新整理失败：${String(err)}`);
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px] text-ink-faint">
      {memory.ai_status === "failed" ? (
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          className="status-badge status-badge-action"
          data-status="failed"
          title="AI 整理失败，点击重新排队"
        >
          <RefreshCw size={11} className={retrying ? "animate-spin" : undefined} />
          {retrying ? "重试中…" : "待重试 · 重试"}
        </button>
      ) : memory.ai_status !== "done" ? (
        <span className="status-badge" data-status={memory.ai_status}>
          {AI_STATUS_LABEL[memory.ai_status]}
        </span>
      ) : null}
      {score != null && (
        <span className="font-mono font-semibold text-accent">{(score * 100).toFixed(0)}%</span>
      )}
      <span>{sourceLabel(memory.source)}</span>
      <span aria-hidden>·</span>
      <span>{fmtRelative(memory.created_at)}</span>
      {memory.collection_name && (
        <span className="flex items-center gap-1.5 text-ink-dim">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: memory.collection_color ?? "rgb(var(--c-accent))" }}
          />
          {memory.collection_name}
        </span>
      )}
    </div>
  );
}
