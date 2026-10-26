import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  Plus,
  Inbox,
  CheckSquare,
  FolderInput,
  Trash2,
  X,
  Crop,
  Hash,
  Check,
  RotateCcw,
} from "lucide-react";
import { useApp, useAppPick } from "@/stores/app";
import MemoryCard from "@/components/memory/MemoryCard";
import CaptureBar from "@/components/timeline/CaptureBar";
import Segmented from "@/components/Segmented";
import { captureApi, memoryApi, collectionApi } from "@/services/api";
import { openDrawer, localImageUrl } from "@/utils/events";
import { topmostOverlay } from "@/hooks/useOverlay";

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

interface DragBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
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
  const [dragBox, setDragBox] = useState<DragBox | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [committingRegion, setCommittingRegion] = useState(false);

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
      setDragBox(null);
      setIsDragging(false);
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
    setDragBox(null);
    setIsDragging(false);
    try {
      await captureApi.cancelRegionCapture();
    } catch {
      /* ignore */
    }
  };

  const confirmVisualRegionCapture = async () => {
    if (!regionSession || committingRegion) return;
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    const scaleX = regionSession.imgWidth / vw;
    const scaleY = regionSession.imgHeight / vh;

    let cropX = 0;
    let cropY = 0;
    let cropW = regionSession.imgWidth;
    let cropH = regionSession.imgHeight;

    if (dragBox) {
      const left = Math.min(dragBox.x1, dragBox.x2);
      const top = Math.min(dragBox.y1, dragBox.y2);
      const w = Math.abs(dragBox.x2 - dragBox.x1);
      const h = Math.abs(dragBox.y2 - dragBox.y1);
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
      setDragBox(null);
      const m = await captureApi.commitRegionCapture(cropX, cropY, cropW, cropH);
      openDrawer(m.id);
      await refreshAll();
    } catch (e) {
      toast("error", `区域截图失败: ${String(e)}`);
    } finally {
      setCommittingRegion(false);
    }
  };

  useEffect(() => {
    if (!regionSession) return;
    const onKey = (e: KeyboardEvent) => {
      // Esc 走浮层栈：抽屉/命令面板叠在上面时不该把框选一起关掉
      if (e.key === "Escape") {
        if (topmostOverlay(useApp.getState()) !== "region") return;
        e.preventDefault();
        void cancelVisualRegionCapture();
      } else if (e.key === "Enter") {
        e.preventDefault();
        void confirmVisualRegionCapture();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [regionSession, dragBox]);

  // 把框选覆盖层登记进浮层栈
  useEffect(() => {
    setRegionCaptureOpen(regionSession !== null);
    return () => setRegionCaptureOpen(false);
  }, [regionSession, setRegionCaptureOpen]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

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
            今日 +{stats?.total ?? 0} · 共 {memories.length} 条 · 截图 {shotCount} · 网页 {webCount}
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
              <div className="text-[11px] uppercase tracking-wider text-ink-faint">
                合集{activeCollectionObj.goal ? ` · ${activeCollectionObj.goal}` : ""}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-dim">
                {activeCollectionObj.summary ||
                  "还没有合集摘要。先「智能整理」把历史记忆关联进来，再生成摘要。"}
              </p>
              {activeCollectionObj.summary_at && (
                <div className="mt-1 text-[11px] text-ink-faint">
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

      {/* P1-1：可视化屏幕区域框选覆盖层（全屏冻结桌面快照 + 自由拖拽拉框 + 像素尺寸实时回显） */}
      {regionSession &&
        createPortal(
          (() => {
            const vw = Math.max(1, window.innerWidth);
            const vh = Math.max(1, window.innerHeight);
            const scaleX = regionSession.imgWidth / vw;
            const scaleY = regionSession.imgHeight / vh;

            const hasBox =
              dragBox !== null &&
              Math.abs(dragBox.x2 - dragBox.x1) >= 6 &&
              Math.abs(dragBox.y2 - dragBox.y1) >= 6;

            const left = dragBox ? Math.min(dragBox.x1, dragBox.x2) : 0;
            const top = dragBox ? Math.min(dragBox.y1, dragBox.y2) : 0;
            const width = dragBox ? Math.abs(dragBox.x2 - dragBox.x1) : 0;
            const height = dragBox ? Math.abs(dragBox.y2 - dragBox.y1) : 0;

            const realW = Math.max(1, Math.round(width * scaleX));
            const realH = Math.max(1, Math.round(height * scaleY));
            const realX = Math.max(0, Math.round(left * scaleX));
            const realY = Math.max(0, Math.round(top * scaleY));

            const toolbarTop =
              top + height + 52 < vh ? top + height + 10 : Math.max(12, top - 46);
            const toolbarLeft = Math.min(
              Math.max(12, left + width - 240),
              Math.max(12, vw - 252)
            );

            return (
              <div
                onMouseDown={(e) => {
                  if (e.button === 2) {
                    e.preventDefault();
                    void cancelVisualRegionCapture();
                    return;
                  }
                  if (e.button !== 0) return;
                  const target = e.target as HTMLElement;
                  if (target.closest("button")) return;
                  setIsDragging(true);
                  setDragBox({
                    x1: e.clientX,
                    y1: e.clientY,
                    x2: e.clientX,
                    y2: e.clientY,
                  });
                }}
                onMouseMove={(e) => {
                  if (!isDragging) return;
                  setDragBox((prev) =>
                    prev ? { ...prev, x2: e.clientX, y2: e.clientY } : null
                  );
                }}
                onMouseUp={() => {
                  if (isDragging) setIsDragging(false);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  void cancelVisualRegionCapture();
                }}
                onDoubleClick={() => void confirmVisualRegionCapture()}
                className="fixed inset-0 z-[200] cursor-crosshair select-none overflow-hidden bg-black"
              >
                {/* 冻结的屏幕原始图像 */}
                <img
                  src={regionSession.previewUrl}
                  alt="屏幕快照"
                  draggable={false}
                  className="pointer-events-none h-full w-full object-fill"
                />

                {/* 未框选时的半透明暗色遮罩 */}
                {!hasBox && <div className="pointer-events-none absolute inset-0 bg-black/45" />}

                {/* 顶部悬浮操作指引胶囊 */}
                <div className="pointer-events-none fixed left-1/2 top-5 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black/75 px-4 py-2 text-[13px] font-medium text-white shadow-lg backdrop-blur-md">
                  <Crop size={14} className="text-[#60A5FA]" />
                  <span>按住左键拖拽框选区域 · 双击或按 Enter 完成截取 · 右键或按 Esc 取消</span>
                </div>

                {/* 选区高亮框（通过超大外阴影实现选区外压暗、选区内 100% 清晰透亮） */}
                {hasBox && (
                  <div
                    style={{
                      left: `${left}px`,
                      top: `${top}px`,
                      width: `${width}px`,
                      height: `${height}px`,
                      boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.52)",
                    }}
                    className="pointer-events-none absolute border-2 border-[#3B82F6]"
                  >
                    {/* 四个角控制柄装饰 */}
                    <span className="absolute -left-1.5 -top-1.5 h-2.5 w-2.5 rounded-xs bg-white ring-2 ring-[#3B82F6]" />
                    <span className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-xs bg-white ring-2 ring-[#3B82F6]" />
                    <span className="absolute -bottom-1.5 -left-1.5 h-2.5 w-2.5 rounded-xs bg-white ring-2 ring-[#3B82F6]" />
                    <span className="absolute -bottom-1.5 -right-1.5 h-2.5 w-2.5 rounded-xs bg-white ring-2 ring-[#3B82F6]" />

                    {/* 实时像素尺寸与坐标标尺 */}
                    <div
                      className="absolute left-0 flex items-center gap-2 whitespace-nowrap rounded-md bg-black/80 px-2.5 py-1 font-mono text-[11px] text-white shadow-md"
                      style={{ top: top > 32 ? "-28px" : "6px" }}
                    >
                      <span className="font-semibold text-[#60A5FA]">
                        {realW} × {realH} px
                      </span>
                      <span className="text-white/60">
                        ({realX}, {realY})
                      </span>
                    </div>
                  </div>
                )}

                {/* 松开鼠标后悬浮确认工具栏 */}
                {hasBox && !isDragging && (
                  <div
                    style={{
                      left: `${toolbarLeft}px`,
                      top: `${toolbarTop}px`,
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="fixed z-30 flex items-center gap-1.5 rounded-xl bg-[#141720]/95 p-1.5 text-white shadow-2xl ring-1 ring-white/15 backdrop-blur-md"
                  >
                    <button
                      type="button"
                      onClick={() => setDragBox(null)}
                      className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <RotateCcw size={13} />
                      <span>重选</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void cancelVisualRegionCapture()}
                      className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <X size={13.5} />
                      <span>取消</span>
                    </button>
                    <button
                      type="button"
                      disabled={committingRegion}
                      onClick={() => void confirmVisualRegionCapture()}
                      className="flex items-center gap-1 rounded-lg bg-[#2563EB] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
                    >
                      <Check size={13.5} />
                      <span>完成截图</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })(),
          document.body
        )}

      {/* 空状态 */}
      {filteredMemories.length === 0 && !loading && (
        <div className="animate-page-enter mt-14 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-base-panel2">
            <Inbox size={24} strokeWidth={1.6} className="text-ink-dim" />
          </div>
          <h3 className="text-[15px] font-semibold text-ink">
            当前筛选下还没有记忆
          </h3>
          <p className="mt-1.5 text-[13px] text-ink-faint">
            按下 <kbd>Alt + Shift + S</kbd> 捕获当前屏幕，或在上方书写卡直接记录
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
          {filteredMemories.map((m, i) => (
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
