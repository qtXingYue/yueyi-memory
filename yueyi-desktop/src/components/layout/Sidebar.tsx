import { useMemo, useState } from "react";
import {
  Plus,
  Clock,
  Layers,
  MessageSquareText,
  History,
  ChevronLeft,
  Search,
  Settings2,
  Pencil,
  Trash2,
  MoreHorizontal,
  ArrowUp,
  ArrowDown,
  Check,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp, useAppPick } from "@/stores/app";
import { collectionApi } from "@/services/api";
import { COLLECTION_COLORS } from "@/utils/palette";
import { Popover, TooltipBubble } from "@/ui";

const APP_VERSION = "0.1.0";

const NAV = [
  { id: "timeline", label: "时间线", icon: Clock, kbd: "1" },
  { id: "collections", label: "合集", icon: Layers, kbd: "2" },
  { id: "search", label: "搜索与问答", icon: MessageSquareText, kbd: "3" },
  { id: "review", label: "回顾", icon: History, kbd: "4" },
] as const;

export default function Sidebar() {
  const {
    page,
    setPage,
    collections,
    activeCollection,
    setActiveCollection,
    setPaletteOpen,
    toast,
    refreshAll,
    sidebarCollapsed,
    stats,
  } = useAppPick(
    "page",
    "setPage",
    "collections",
    "activeCollection",
    "setActiveCollection",
    "setPaletteOpen",
    "toast",
    "refreshAll",
    "sidebarCollapsed",
    "stats"
  );

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLLECTION_COLORS[0]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // 合集搜索
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState("");

  // 行内更多菜单（Popover 基元自动处理定位/外部点击/Esc）
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);

  const closeMenu = () => {
    setMenuFor(null);
    setConfirmDeleteId(null);
  };

  // 全量计数：不随「今天/本周」或当前合集筛选变化
  const totalAll = stats?.total_all ?? collections.reduce((n, c) => n + (c.count ?? 0), 0);

  // 合集拖拽排序（仅无筛选时启用，避免子集重排歧义）
  const [orderIds, setOrderIds] = useState<number[] | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const canDrag = !filter.trim();

  const filteredCollections = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter((c) => c.name.toLowerCase().includes(q));
  }, [collections, filter]);

  // 拖拽过程中的本地顺序优先，落库成功后回到后端顺序
  const displayedCollections = useMemo(() => {
    if (!orderIds) return filteredCollections;
    const rank = new Map(orderIds.map((id, i) => [id, i]));
    return [...filteredCollections].sort(
      (a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999)
    );
  }, [filteredCollections, orderIds]);

  const handleSidebarMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        "button, input, textarea, select, a, [role='button'], [data-no-drag]"
      )
    ) {
      return;
    }
    e.preventDefault();
    void getCurrentWindow()
      .startDragging()
      .catch(() => invoke("window_control", { action: "drag" }));
  };

  const createCollection = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await collectionApi.create(name, newColor);
      setNewName("");
      setNewColor(COLLECTION_COLORS[collections.length % COLLECTION_COLORS.length]);
      setCreating(false);
      await refreshAll();
      toast("success", `已创建合集「${name}」`);
    } catch (e) {
      toast("error", `创建失败: ${String(e)}`);
    }
  };

  const saveRename = async (id: number) => {
    const name = editName.trim();
    setEditingId(null);
    if (!name) return;
    try {
      await collectionApi.rename(id, name);
      await refreshAll();
      toast("success", "合集已重命名");
    } catch (e) {
      toast("error", `重命名失败: ${String(e)}`);
    }
  };

  const setColor = async (id: number, color: string) => {
    closeMenu();
    try {
      await collectionApi.setColor(id, color);
      await refreshAll();
    } catch (e) {
      toast("error", `修改颜色失败: ${String(e)}`);
    }
  };

  const removeCollection = async (id: number, name: string) => {
    try {
      await collectionApi.remove(id);
      if (activeCollection === id) setActiveCollection(null);
      closeMenu();
      await refreshAll();
      toast("info", `已删除合集「${name}」，其中记忆移入待整理`);
    } catch (e) {
      toast("error", `删除失败: ${String(e)}`);
    }
  };

  const openMenu = (e: React.MouseEvent<HTMLElement>, id: number) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget.getBoundingClientRect());
    setConfirmDeleteId(null);
    setMenuFor(id);
  };

  /* ---------- 合集拖拽排序 ---------- */
  const startDrag = (e: React.DragEvent, id: number) => {
    if (!canDrag || (e.target as HTMLElement).closest("button,input")) {
      e.preventDefault();
      return;
    }
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", String(id));
    } catch {
      /* ignore */
    }
  };

  const overRow = (e: React.DragEvent, id: number) => {
    if (!canDrag || dragId === null || dragId === id) return;
    e.preventDefault();
    const ids = displayedCollections.map((c) => c.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(id);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    setOrderIds(next);
  };

  const commitOrder = async () => {
    if (!canDrag || dragId === null) return;
    const source = orderIds ?? collections.map((c) => c.id);
    const ids = source.filter((id) => collections.some((c) => c.id === id));
    setDragId(null);
    try {
      await collectionApi.reorder(ids);
      await refreshAll();
    } catch (e) {
      toast("error", `排序保存失败: ${String(e)}`);
    } finally {
      setOrderIds(null);
    }
  };

  /** 菜单里的上移/下移：与拖拽共用同一条落库路径 */
  const moveCollection = async (id: number, dir: -1 | 1) => {
    const ids = collections.map((c) => c.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    closeMenu();
    try {
      await collectionApi.reorder(ids);
      await refreshAll();
    } catch (e) {
      toast("error", `排序保存失败: ${String(e)}`);
    }
  };

  /* ---------------- 折叠态 ---------------- */
  if (sidebarCollapsed) {
    const dots = collections.slice(0, 3);
    return (
      <aside
        aria-label="主导航（已折叠）"
        onMouseDown={handleSidebarMouseDown}
        className="sidebar-surface relative z-10 flex w-[56px] shrink-0 select-none flex-col items-center py-3.5 transition-all duration-300 ease-out"
      >
        <button
          type="button"
          title="月忆 · 展开导航"
          onClick={() => useApp.getState().toggleSidebar()}
          className="group relative mb-3.5 flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl transition-transform duration-200 hover:scale-105 active:scale-95"
        >
          <img src="/app-icon.png" alt="月忆" className="h-8 w-8 rounded-[10px] shadow-sm" />
          <TooltipBubble label="展开导航" />
        </button>

        <button
          onClick={() => setPaletteOpen(true)}
          className="group relative mb-2 flex h-9 w-9 items-center justify-center rounded-xl text-ink-dim transition-colors hover:bg-base-panel/70 hover:text-ink"
        >
          <Search size={15} />
          <TooltipBubble label="搜索记忆" kbd="Ctrl K" />
        </button>

        <nav className="flex flex-1 flex-col items-center gap-1">
          {NAV.map(({ id, label, icon: Icon, kbd }) => {
            const active = page === id;
            return (
              <button
                key={id}
                onClick={() => setPage(id)}
                aria-current={active ? "page" : undefined}
                className={`group relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200 ${
                  active
                    ? "bg-accent/[0.1] text-accent"
                    : "text-ink-dim hover:bg-base-panel/60 hover:text-ink"
                }`}
              >
                <Icon size={16} strokeWidth={active ? 2.1 : 1.8} />
                <TooltipBubble label={label} kbd={`Ctrl ${kbd}`} />
              </button>
            );
          })}
        </nav>

        {/* 折叠态保留前 3 个合集快捷色点 */}
        {dots.length > 0 && (
          <div className="mt-auto mb-2 flex flex-col items-center gap-2 border-t border-base-border/40 pt-2.5">
            {dots.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCollection(c.id)}
                className="group relative flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-base-panel/70"
                aria-label={`打开合集 ${c.name}`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    background: c.color,
                    boxShadow: activeCollection === c.id ? `0 0 0 3px ${c.color}33` : undefined,
                  }}
                />
                <TooltipBubble label={c.name} />
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => setPage("settings")}
          aria-current={page === "settings" ? "page" : undefined}
          className={`group relative mb-1 flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
            page === "settings"
              ? "bg-accent/[0.1] text-accent"
              : "text-ink-dim hover:bg-base-panel/70 hover:text-ink"
          }`}
        >
          <Settings2 size={16} strokeWidth={1.8} />
          <TooltipBubble label="设置" kbd="Ctrl 5" />
        </button>
      </aside>
    );
  }

  /* ---------------- 展开态 ---------------- */
  return (
    <aside
      aria-label="主导航"
      onMouseDown={handleSidebarMouseDown}
      className="sidebar-surface relative z-10 flex w-[216px] shrink-0 select-none flex-col px-3 py-3 transition-all duration-300 ease-out"
    >
      {/* 品牌区：压缩到 56px，去掉重复的副标题与徽章 */}
      <div title="按住可拖动窗口" className="cursor-grab px-2 pb-3 active:cursor-grabbing">
        <div className="flex items-center gap-2.5">
          <img
            src="/app-icon.png"
            alt="月忆"
            className="h-8 w-8 shrink-0 rounded-[10px] shadow-sm transition-transform duration-200 hover:scale-105"
          />
          <h1 className="truncate text-[15px] font-bold tracking-wide text-ink">月忆</h1>
          <span className="ml-auto font-mono text-[12px] text-ink-faint">v{APP_VERSION}</span>
        </div>
      </div>

      {/* 主导航（设置移至底部，避免重复入口） */}
      <nav className="space-y-0.5">
        {NAV.map(({ id, label, icon: Icon, kbd }) => {
          const active = page === id && !(id === "timeline" && activeCollection !== null);
          return (
            <button
              key={id}
              onClick={() => setPage(id)}
              data-active={active}
              aria-current={active ? "page" : undefined}
              className={`nav-item group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-all duration-200 ${
                active
                  ? "font-semibold text-accent"
                  : "text-ink-dim hover:bg-base-panel/55 hover:text-ink"
              }`}
            >
              <Icon
                size={16}
                strokeWidth={active ? 2.1 : 1.8}
                className={active ? "text-accent" : "text-ink-faint group-hover:text-ink-dim"}
              />
              <span className="text-[13px]">{label}</span>
              <kbd className="ml-auto opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {kbd}
              </kbd>
            </button>
          );
        })}
      </nav>

      {/* 合集区 */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-base-border/40 pt-3">
        <div className="mb-1.5 flex items-center justify-between px-2.5">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[12px] font-medium text-ink-faint">快速筛选</span>
            <span className="font-mono text-[12px] text-ink-faint/70">{collections.length}</span>
          </span>
          <div className="flex items-center gap-0.5">
            {collections.length > 5 && (
              <button
                onClick={() => {
                  setFilterOpen((v) => !v);
                  if (filterOpen) setFilter("");
                }}
                className={`flex h-5 w-5 items-center justify-center rounded-md transition-colors hover:bg-base-panel hover:text-ink ${
                  filterOpen ? "text-accent" : "text-ink-faint"
                }`}
                title="搜索合集"
                aria-label="搜索合集"
              >
                <Search size={12} />
              </button>
            )}
            <button
              onClick={() => setCreating((v) => !v)}
              className="flex h-5 w-5 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-base-panel hover:text-ink"
              title="新建合集"
              aria-label="新建合集"
            >
              <Plus size={13} />
            </button>
          </div>
        </div>

        {filterOpen && (
          <div className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-base-panel px-2 py-1">
            <Search size={11} className="shrink-0 text-ink-faint" />
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setFilter("");
                  setFilterOpen(false);
                }
              }}
              placeholder="筛选合集…"
              className="w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-faint"
            />
          </div>
        )}

        {creating && (
          <div className="animate-rise mb-2 rounded-xl bg-base-panel px-2.5 py-2 shadow-sm">
            <div className="flex items-center gap-1.5">
              <Pencil size={12} className="shrink-0 text-accent" />
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createCollection();
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder="合集名称…"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-faint"
              />
              <button
                onClick={() => void createCollection()}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-semibold text-accent hover:bg-accent/10"
              >
                创建
              </button>
            </div>
            {/* 新建时即可选色（与合集页保持一致） */}
            <div className="mt-1.5 flex items-center gap-1.5 pl-5">
              {COLLECTION_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  aria-label={`选择颜色 ${c}`}
                  className={`h-3 w-3 rounded-full transition-transform ${
                    newColor === c
                      ? "scale-110 ring-2 ring-accent/45 ring-offset-1 ring-offset-base-panel"
                      : "hover:scale-110"
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain pb-2">
          {/* 从合集返回全部：只在有筛选时出现 */}
          {activeCollection !== null && (
            <button
              onClick={() => setActiveCollection(null)}
              className="all-memories-back"
            >
              <ChevronLeft size={13} />
              <span className="flex-1 text-left text-[12px]">全部记忆</span>
              <span className="font-mono text-[12px] text-ink-faint">{totalAll}</span>
            </button>
          )}

          {displayedCollections.map((c) => {
            const isSelected = activeCollection === c.id && page === "timeline";
            return (
              <div
                key={c.id}
                data-no-drag
                role="button"
                tabIndex={0}
                aria-current={isSelected ? "page" : undefined}
                aria-label={`打开合集 ${c.name}`}
                onClick={() => setActiveCollection(c.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveCollection(c.id);
                  }
                }}
                data-active={isSelected}
                draggable={canDrag && editingId !== c.id}
                onDragStart={(e) => startDrag(e, c.id)}
                onDragEnter={(e) => overRow(e, c.id)}
                onDragOver={(e) => {
                  if (canDrag && dragId !== null) e.preventDefault();
                }}
                onDragEnd={() => void commitOrder()}
                className={`nav-item group relative flex w-full items-center gap-2.5 rounded-xl py-1.5 pl-3 pr-2 text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent/45 ${
                  canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                } ${dragId === c.id ? "opacity-50" : ""} ${
                  isSelected
                    ? "font-semibold text-accent"
                    : "text-ink-dim hover:bg-base-panel/50 hover:text-ink"
                }`}
              >
                {/* 色点纯展示（选中给外环），点击不再误触换色 */}
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full transition-shadow"
                  title={canDrag ? "拖动排序" : undefined}
                  style={{
                    background: c.color,
                    boxShadow: isSelected ? `0 0 0 3px ${c.color}33` : undefined,
                  }}
                />

                {editingId === c.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveRename(c.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={() => void saveRename(c.id)}
                    className="min-w-0 flex-1 rounded bg-base-panel2 px-1.5 py-0.5 text-[12px] text-ink outline-none"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[13px]">{c.name}</span>
                )}

                <span className="shrink-0 font-mono text-[12px] text-ink-faint transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                  {c.count ?? 0}
                </span>

                {editingId !== c.id && (
                  <button
                    type="button"
                    onClick={(e) => openMenu(e, c.id)}
                    aria-label={`更多操作 ${c.name}`}
                    aria-haspopup="menu"
                    className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-faint opacity-0 transition-all hover:bg-base-panel2 hover:text-ink group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                )}
              </div>
            );
          })}

          {filteredCollections.length === 0 && collections.length > 0 && (
            <div className="px-3 py-3 text-center text-[12px] text-ink-faint">没有匹配的合集</div>
          )}
        </div>
      </div>

      {/* 底部：紧凑设置入口（不再重复主导航） */}
      <div className="mt-1 border-t border-base-border/40 pt-1.5">
        <button
          onClick={() => setPage("settings")}
          data-active={page === "settings"}
          aria-current={page === "settings" ? "page" : undefined}
          className={`nav-item group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-200 ${
            page === "settings"
              ? "font-semibold text-accent"
              : "text-ink-dim hover:bg-base-panel/70 hover:text-ink"
          }`}
        >
          <Settings2
            size={15}
            strokeWidth={1.8}
            className={page === "settings" ? "text-accent" : "text-ink-faint"}
          />
          <span className="text-[13px]">设置</span>
          <span
            className="ml-auto flex items-center gap-1 font-mono text-[12px] text-ink-faint"
            title="所有数据保存在本机 SQLite"
          >
            <span className="h-1 w-1 rounded-full bg-[rgb(var(--c-success))]/70" />
            本地
          </span>
        </button>
      </div>

      {/* 行内更多菜单 */}
      {menuFor !== null && (
        <Popover
          open
          anchor={menuAnchor}
          onClose={closeMenu}
          width={196}
          estimatedHeight={220}
          ariaLabel="合集操作"
        >
          {(() => {
            const c = collections.find((x) => x.id === menuFor);
            if (!c) return null;
            const pos = collections.findIndex((x) => x.id === c.id);
            return (
              <>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setEditingId(c.id);
                      setEditName(c.name);
                      closeMenu();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-ink-dim transition-colors hover:bg-base-panel2 hover:text-ink"
                  >
                    <Pencil size={12} /> 重命名
                  </button>

                  <div className="mt-1 flex items-center gap-1 px-1">
                    <button
                      role="menuitem"
                      disabled={pos <= 0}
                      onClick={() => void moveCollection(c.id, -1)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1 text-[12px] text-ink-dim transition-colors hover:bg-base-panel2 hover:text-ink disabled:opacity-35"
                    >
                      <ArrowUp size={11} /> 上移
                    </button>
                    <button
                      role="menuitem"
                      disabled={pos >= collections.length - 1}
                      onClick={() => void moveCollection(c.id, 1)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1 text-[12px] text-ink-dim transition-colors hover:bg-base-panel2 hover:text-ink disabled:opacity-35"
                    >
                      <ArrowDown size={11} /> 下移
                    </button>
                  </div>

                  <div className="mt-1 px-2.5 pb-1 text-[12px] text-ink-faint">颜色</div>
                  <div className="flex items-center gap-1.5 px-2.5 pb-1.5">
                    {COLLECTION_COLORS.map((color) => (
                      <button
                        key={color}
                        role="menuitemradio"
                        aria-checked={c.color === color}
                        aria-label={`设为颜色 ${color}`}
                        onClick={() => void setColor(c.id, color)}
                        className={`flex h-5 w-5 items-center justify-center rounded-full transition-transform hover:scale-110 ${
                          c.color === color ? "ring-2 ring-accent/50 ring-offset-1" : ""
                        }`}
                        style={{ background: color }}
                      >
                        {c.color === color && (
                          <Check size={10} strokeWidth={3} className="text-white" />
                        )}
                      </button>
                    ))}
                  </div>

                  <div className="my-1 h-px bg-base-border/60" />

                  {confirmDeleteId === c.id ? (
                    <div className="flex items-center gap-1.5 px-1 pt-0.5">
                      <span className="flex-1 px-1 text-[12px] text-danger">
                        删除后记忆移入待整理
                      </span>
                      <button
                        role="menuitem"
                        onClick={() => void removeCollection(c.id, c.name)}
                        className="rounded-md bg-danger px-2 py-1 text-[12px] font-semibold text-white"
                      >
                        确认
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded-md px-1.5 py-1 text-[12px] text-ink-faint hover:text-ink"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      role="menuitem"
                      onClick={() => setConfirmDeleteId(c.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-ink-dim transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 size={12} /> 删除合集
                    </button>
                  )}
                </>
              );
            })()}
        </Popover>
      )}
    </aside>
  );
}
