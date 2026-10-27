import { useState } from "react";
import { ExternalLink, Copy, Trash2, Check } from "lucide-react";
import type { Memory } from "@/types";
import { openExternalUrl } from "@/utils/events";
import { memoryApi } from "@/services/api";
import { useApp } from "@/stores/app";

/** 卡片右上角悬停操作条：打开链接 / 复制 / 两步删除 */
export default function CardActions({
  memory,
  cardUrl,
  host,
  summaryText,
}: {
  memory: Memory;
  cardUrl: string;
  host: string;
  summaryText: string;
}) {
  const toast = useApp((s) => s.toast);
  const refreshAll = useApp((s) => s.refreshAll);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const openLink = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (cardUrl) void openExternalUrl(cardUrl);
  };

  const copyText = async (e: React.SyntheticEvent) => {
    e.stopPropagation();
    const text = cardUrl || memory.content || summaryText || memory.title;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      toast("error", "复制失败");
    }
  };

  const remove = async (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (!confirmDelete) {
      setConfirmDelete(true);
      window.setTimeout(() => setConfirmDelete(false), 2600);
      return;
    }
    try {
      await memoryApi.remove(memory.id);
      toast("info", "已移入回收站，可在设置中恢复");
      await refreshAll();
    } catch (err) {
      toast("error", `删除失败: ${String(err)}`);
    }
  };

  return (
    <div className="card-actions" onClick={(e) => e.stopPropagation()}>
      {cardUrl && (
        <button
          type="button"
          className="card-action-btn"
          title={`在浏览器中打开 ${host}`}
          aria-label="在浏览器中打开"
          onClick={openLink}
        >
          <ExternalLink size={14} />
        </button>
      )}
      <button
        type="button"
        className="card-action-btn"
        title={copied ? "已复制" : cardUrl ? "复制链接" : "复制内容"}
        aria-label="复制"
        onClick={copyText}
      >
        {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
      </button>
      <button
        type="button"
        className="card-action-btn"
        data-danger="true"
        title={confirmDelete ? "再点一次确认删除" : "删除"}
        aria-label="删除"
        onClick={remove}
      >
        {confirmDelete ? (
          <span className="px-1 text-[12px] font-semibold text-danger">确认?</span>
        ) : (
          <Trash2 size={14} />
        )}
      </button>
    </div>
  );
}
