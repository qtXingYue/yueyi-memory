import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Plus,
  Inbox,
  CheckSquare,
  FolderInput,
  Trash2,
  X,
  Hash,
  MoonStar,
} from "lucide-react";
import { useApp, useAppPick } from "@/stores/app";
import MemoryCard from "@/components/memory/MemoryCard";
import RegionCaptureOverlay, { type DragBox } from "@/components/timeline/RegionCaptureOverlay";
import CaptureBar from "@/components/timeline/CaptureBar";
import Segmented from "@/components/Segmented";
import { captureApi, memoryApi, collectionApi } from "@/services/api";
import { openDrawer, localImageUrl } from "@/utils/events";

const RANGES = [
  { id: "all", label: "全部" },
  { id: "today", label: "今天" },
  { id: "week", label: "本周" },
  { id: "month", label: "本月" },
] as const;

const TYPE_FILTERS = [
  { id: "all", label: "全部" },
  { id: "Visual", label: "截图与图片" },
  { id: "Note", label: "笔记" },
  { id: "link", label: "链接" },
  { id: "code", label: "代码" },
  { id: "Doc", label: "文档" },
] as const;

interface RegionSession {
  previewUrl: string;
  imgWidth: number;
  imgHeight: number;
}

export default function Timeline() {
  const {
    memories,
    timeRange,
    setTimeRange,
    activeType,
    setActiveType,
    activeTag,
    setActiveTag,
    setComposerOpen,
    toast,
    refreshAll,
    loading,
    activeCollection,
    collections,
    setRegionCaptureOpen,
    stats,
  } = useAppPick(
    "memories",
    "timeRange",
    "setTimeRange",
    "activeType",
    "setActiveType",
    "activeTag",
    "setActiveTag",
    "setComposerOpen",
    "toast",
    "refreshAll",
    "loading",
    "activeCollection",
    "collections",
    "setRegionCaptureOpen",
    "stats"
  );

  // 批量操作状态
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [targetCollectionId, setTargetCollectionId] = useState<string>("");
  // 批量删除二次确认（防误删，2.6 秒后自动复位）
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);

  // P1-1：可视化区域框选状态（冻结屏幕快照 + 鼠标拖拽选区）
  const [regionSession, setRegionSession] = useState<RegionSession | null>(null);
  const [committingRegion, setCommittingRegion] = useState(false);
  const [visibleCount, setVisibleCount] = useState(60);

  // Ctrl+N 已提升到 App 全局处理（任何页面都可用），此处不再重复监听

  // 筛选记忆（按类型 + 标签）
  const filteredMemories = useMemo(() => {
    return memories.filter((m) => {
      if (activeTag && !m.tags.includes(activeTag)) return false;
      if (activeType === "all") return true;
      if (activeType === "Visual") return m.type === "screenshot" || m.type === "image";
      if (activeType === "Note")
        return m.type === "note" || m.type === "text" || m.type === "clipboard";
      if (activeType === "Doc") return m.type === "document" || m.type === "pdf";
      return m.type === activeType;
    });
  }, [memories, activeTag, activeType]);


  // 各日期分组的累计起始序号：错落入场动画只对首屏前 8 张卡片生效
  const collectionName = activeCollection
    ? collections.find((c) => c.id === activeCollection)?.name
    : null;
  const activeCollectionObj = collections.find((c) => c.id === activeCollection) ?? null;
  const [collBusy, setCollBusy] = useState<"smart" | "summary" | null>(null);
  const shotCount = memories.filter((m) => m.type === "screenshot" || m.type === "image").length;
  const webCount = memories.filter((m) => m.type === "link" || Boolean(m.source_url)).length;
  const queueCount = useMemo(
    () => memories.filter((m) => m.ai_status === "processing" || m.ai_status === "pending").length,
    [memories]
  );
  const phase = (() => {
    const h = new Date().getHours();
    if (h < 5) return "深夜";
    if (h < 9) return "清晨";
    if (h < 12) return "上午";
    if (h < 18) return "白天";
    if (h < 23) return "夜晚";
    return "深夜";
  })();

  const smartFill = async () => {
    if (activeCollection === null || collBusy) return;
    setCollBusy("smart");
    try {
      const n = await collectionApi.smartFill(activeCollection, true);
      await refreshAll();
      toast("success", n > 0 ? `已智能关联 ${n} 条记忆` : "没有找到可关联的记忆");
    } catch (e) {
      toast("error", `智能整理失败：${String(e)}`);
    } finally {
      setCollBusy(null);
    }
  };

  const genSummary = async () => {
    if (activeCollection === null || collBusy) return;
    setCollBusy("summary");
    try {
      await collectionApi.summary(activeCollection);
      await refreshAll();
      toast("success", "合集摘要已生成");
    } catch (e) {
      toast("error", `生成摘要失败：${String(e)}`);
    } finally {
      setCollBusy(null);
    }
  };

  // 启动可视化区域框选
  const startVisualRegionCapture = async () => {
    try {
      const res = await captureApi.prepareRegionCapture();
      setRegionSession({
        previewUrl: localImageUrl(res.preview_path),
        imgWidth: res.width,
        imgHeight: res.height,
      });
    } catch (e) {
      toast("error", `启动区域截图失败: ${String(e)}`);
    }
  };

  const cancelVisualRegionCapture = async () => {
    setRegionSession(null);
    try {
      await captureApi.cancelRegionCapture();
    } catch {
      /* ignore */
    }
  };

  const confirmVisualRegionCapture = async (box: DragBox | null) => {
    if (!regionSession || committingRegion) return;
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    const scaleX = regionSession.imgWidth / vw;
    const scaleY = regionSession.imgHeight / vh;

    let cropX = 0;
    let cropY = 0;
    let cropW = regionSession.imgWidth;
    let cropH = regionSession.imgHeight;

    if (box) {
      const left = Math.min(box.x1, box.x2);
      const top = Math.min(box.y1, box.y2);
      const w = Math.abs(box.x2 - box.x1);
      const h = Math.abs(box.y2 - box.y1);
      if (w >= 8 && h >= 8) {
        cropX = Math.max(0, Math.round(left * scaleX));
        cropY = Math.max(0, Math.round(top * scaleY));
        cropW = Math.max(1, Math.round(w * scaleX));
        cropH = Math.max(1, Math.round(h * scaleY));
      }
    }

    setCommittingRegion(true);
    try {
      setRegionSession(null);
      const m = await captureApi.commitRegionCapture(cropX, cropY, cropW, cropH);
      openDrawer(m.id);
      await refreshAll();
    } catch (e) {
      toast("error", `区域截图失败: ${String(e)}`);
    } finally {
      setCommittingRegion(false);
    }
  };

  // 把框选覆盖层登记进浮层栈
  useEffect(() => {
    setRegionCaptureOpen(regionSession !== null);
    return () => setRegionCaptureOpen(false);
  }, [regionSession, setRegionCaptureOpen]);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  // 筛选变化回到首批，避免在旧筛选的滚动位置渲染过多卡片
  useEffect(() => {
    setVisibleCount(60);
  }, [activeTag, activeType, activeCollection, timeRange]);

  const visibleMemories = useMemo(
    () => filteredMemories.slice(0, visibleCount),
    [filteredMemories, visibleCount]
  );

  const selectAll = () => {
    if (selectedIds.length === filteredMemories.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredMemories.map((m) => m.id));
    }
  };

  const batchMove = async () => {
    if (selectedIds.length === 0) return;
    const cid = targetCollectionId ? Number(targetCollectionId) : null;
    try {
      await memoryApi.moveToCollection(selectedIds, cid);
      toast("success", `已将 ${selectedIds.length} 条记忆移动到目标合集`);
      setSelectedIds([]);
      setBatchMode(false);
      await refreshAll();
    } catch (e) {
      toast("error", `批量移动失败: ${String(e)}`);
    }
  };

  const batchDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirmBatchDelete) {
      setConfirmBatchDelete(true);
      window.setTimeout(() => setConfirmBatchDelete(false), 2600);
      return;
    }
    try {
      await Promise.all(selectedIds.map((id) => memoryApi.remove(id)));
      toast("success", `已将 ${selectedIds.length} 条记忆移入回收站，可在设置中恢复`);
      setSelectedIds([]);
      setConfirmBatchDelete(false);
      setBatchMode(false);
      await refreshAll();
    } catch (e) {
      toast("error", `批量删除失败: ${String(e)}`);
    }
  };

  // 筛选变化不再重建整列（原先 key={filterKey} 会让所有卡片重放入场动画）

  return (
    <div className="page-measure timeline-board pb-10">
      {/* 版头：标题 + 统计 + 操作 */}
      <div className="timeline-head">
        <div className="min-w-0">
          <div className="flex items-baseline gap-3">
            <h1 className="page-title truncate">{collectionName ?? "时间线"}</h1>
            <span className="page-count">{String(filteredMemories.length).padStart(2, "0")}</span>
            {activeCollection !== null && (
              <button
                onClick={() => useApp.getState().setActiveCollection(null)}
                className="board-back"
              >
                返回全部
              </button>
            )}
          </div>
          <p className="timeline-sub">
            <span className="inline-flex items-center gap-1 text-ink-dim" title="当前时段">
              <MoonStar size={12} strokeWidth={1.7} />
              {phase}
            </span>
            <span className="mx-1.5">·</span>
            今日 +{stats?.total ?? 0} · 共 {memories.length} 条 · 截图 {shotCount} · 网页 {webCount}
            {queueCount > 0 && (
              <span className="ml-2 text-accent">· {queueCount} 条整理中</span>
            )}
          </p>
        </div>

        <div className="timeline-actions">
          <Segmented options={RANGES} value={timeRange} onChange={setTimeRange} />
          <button
            onClick={() => {
              setBatchMode((b) => !b);
              setSelectedIds([]);
            }}
            className={`btn-outline ${batchMode ? "bg-accent/15 text-accent" : ""}`}
          >
            <CheckSquare size={14} />
            {batchMode ? "退出批量" : "批量"}
          </button>
          <button onClick={() => setComposerOpen(true)} className="btn-primary">
            <Plus size={14} strokeWidth={2.2} /> 新建
          </button>
        </div>
      </div>

      {activeCollectionObj && (
        <div className="glass mb-3 rounded-2xl p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] uppercase tracking-wider text-ink-faint">
                合集{activeCollectionObj.goal ? ` · ${activeCollectionObj.goal}` : ""}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-dim">
                {activeCollectionObj.summary ||
                  "还没有合集摘要。先「智能整理」把历史记忆关联进来，再生成摘要。"}
              </p>
              {activeCollectionObj.summary_at && (
                <div className="mt-1 text-[12px] text-ink-faint">
                  摘要更新于 {activeCollectionObj.summary_at}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => void smartFill()}
                disabled={collBusy !== null}
                className="btn-outline px-2.5 py-1 text-[12px]"
              >
                {collBusy === "smart" ? "整理中…" : "智能整理"}
              </button>
              <button
                onClick={() => void genSummary()}
                disabled={collBusy !== null}
                className="btn-primary px-2.5 py-1 text-[12px]"
              >
                {collBusy === "summary" ? "生成中…" : "生成摘要"}
              </button>
              <button
                onClick={async () => {
                  if (!activeCollectionObj) return;
                  try {
                    const path = await collectionApi.exportMarkdown(activeCollectionObj.id);
                    await invoke("reveal_path", { path });
                    toast("success", "合集已导出 Markdown");
                  } catch (e) {
                    toast("error", `导出失败：${String(e)}`);
                  }
                }}
                className="btn-outline px-2.5 py-1 text-[12px]"
              >
                导出
              </button>
            </div>
          </div>
        </div>
      )}

      <CaptureBar onRegionCapture={() => void startVisualRegionCapture()} />

      {/* 类型筛选：横向 chip 滚动行 */}
      <div className="chip-row mb-5 mt-4" role="tablist" aria-label="按类型筛选">
        {TYPE_FILTERS.map((tf) => (
          <button
            key={tf.id}
            type="button"
            role="tab"
            aria-selected={activeType === tf.id}
            data-active={activeType === tf.id}
            onClick={() => setActiveType(tf.id)}
            className="chip"
          >
            {tf.label}
          </button>
        ))}
        {(activeTag || activeType !== "all" || activeCollection !== null || timeRange !== "all") && (
          <button
            type="button"
            onClick={() => {
              setActiveTag(null);
              setActiveType("all");
              setTimeRange("all");
              useApp.getState().setActiveCollection(null);
            }}
            className="chip chip-clear"
          >
            清空筛选 <X size={12} />
          </button>
        )}
      </div>

      {/* 当前激活标签筛选提示 */}
      {activeTag && (
        <div className="animate-rise mb-4 flex items-center gap-2">
          <span className="text-[12px] text-ink-faint">标签筛选：</span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-accent/12 px-2.5 py-1 text-[12px] font-medium text-accent">
            <Hash size={11} />
            {activeTag}
            <button
              onClick={() => setActiveTag(null)}
              className="ml-1 hover:opacity-75"
            >
              <X size={12} />
            </button>
          </span>
        </div>
      )}

      {/* 批量操作工具条 */}
      {batchMode && (
        <div className="glass animate-rise mb-5 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
          <button
            onClick={selectAll}
            className="btn-outline bg-base-panel px-2.5 py-1 text-[12px]"
          >
            {selectedIds.length === filteredMemories.length &&
            filteredMemories.length > 0
              ? "取消全选"
              : "全选当前"}
          </button>
          <span className="text-[13px] text-ink-dim">
            已选 <strong className="font-mono text-accent">{selectedIds.length}</strong> 条
          </span>
          <div className="flex-1" />
          <select
            value={targetCollectionId}
            onChange={(e) => setTargetCollectionId(e.target.value)}
            className="input-base w-40 bg-base-panel py-1 text-[12px]"
          >
            <option value="">移至：待整理</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                移至：{c.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => void batchMove()}
            disabled={selectedIds.length === 0}
            className="btn-primary px-3 py-1 text-[12px] disabled:opacity-40"
          >
            <FolderInput size={13} /> 批量移动
          </button>
          <button
            onClick={() => void batchDelete()}
            disabled={selectedIds.length === 0}
            className={`btn-danger px-3 py-1 text-[12px] disabled:opacity-40 ${
              confirmBatchDelete ? "bg-danger text-white" : ""
            }`}
          >
            <Trash2 size={13} />{" "}
            {confirmBatchDelete ? `确认移入回收站（${selectedIds.length}）` : "批量删除"}
          </button>
        </div>
      )}

      {regionSession && (
        <RegionCaptureOverlay
          session={regionSession}
          committing={committingRegion}
          onCancel={() => void cancelVisualRegionCapture()}
          onCommit={(box) => void confirmVisualRegionCapture(box)}
        />
      )}

      {/* 空状态 */}
      {filteredMemories.length === 0 && !loading && (
        <div className="animate-page-enter mt-14 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-base-panel2">
            <Inbox size={24} strokeWidth={1.6} className="text-ink-dim" />
          </div>
          <h3 className="text-[15px] font-semibold text-ink">
            {memories.length === 0 ? "还没有记忆" : "当前筛选下没有匹配"}
          </h3>
          <p className="mt-1.5 text-[13px] text-ink-faint">
            {memories.length === 0
              ? "按下 Alt + Shift + S 捕获当前屏幕，或在上方书写卡记录第一条"
              : "换个关键词、标签或时间范围试试"}
          </p>
          {(activeCollection !== null ||
            activeTag !== null ||
            activeType !== "all") && (
            <button
              onClick={() => {
                useApp.getState().setActiveCollection(null);
                setActiveTag(null);
                setActiveType("all");
              }}
              className="btn-primary mt-4"
            >
              查看全部记忆
            </button>
          )}
        </div>
      )}

      {/* 记忆卡片墙：按时间倒序，不分组，避免每天只有一张卡时右侧留洞 */}
      {filteredMemories.length > 0 && (
        <div className="memory-grid">
          {visibleMemories.map((m, i) => (
            <MemoryCard
              key={m.id}
              memory={m}
              index={i}
              isNew={
                i === 0 &&
                Date.now() - new Date(m.created_at).getTime() < 120_000
              }
              batchMode={batchMode}
              selected={selectedIds.includes(m.id)}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      )}

      {visibleMemories.length < filteredMemories.length && (
        <div className="mt-2 flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount((n) => n + 60)}
            className="btn-outline px-4 py-2 text-[12px]"
          >
            加载更多（还有 {filteredMemories.length - visibleMemories.length} 条）
          </button>
        </div>
      )}

      {/* 加载骨架屏 */}
      {loading && filteredMemories.length === 0 && (
        <div className="memory-grid" aria-busy="true" aria-label="加载中">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="memory-card-surface rounded-2xl p-4">
              <div className="skeleton mb-3 h-4 w-28" />
              <div className="skeleton mb-2 h-5 w-3/5" />
              <div className="skeleton mb-1.5 h-3.5 w-full" />
              <div className="skeleton h-3.5 w-4/5" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
