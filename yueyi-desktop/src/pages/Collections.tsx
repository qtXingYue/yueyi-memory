import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { LayoutGrid, List, Plus, Pencil, Trash2, FolderOpen, Layers } from "lucide-react";
import { useAppPick } from "@/stores/app";
import { collectionApi, memoryApi } from "@/services/api";
import { fmtRelative, localImageUrl } from "@/utils/events";
import { COLLECTION_COLORS } from "@/utils/palette";
import Segmented from "@/components/Segmented";
import { Button, PageHeader } from "@/ui";
import type { Collection, Memory } from "@/types";

export default function Collections() {
  const { collections, refreshAll, toast, setActiveCollection } = useAppPick(
    "collections", "refreshAll", "toast", "setActiveCollection"
  );
  const [view, setView] = useState<"grid" | "list">("grid");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [newColor, setNewColor] = useState(COLLECTION_COLORS[0]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [all, setAll] = useState<Memory[]>([]);
  const [loadingAll, setLoadingAll] = useState(true);

  // 一次取回全部记忆，本地按合集分组出预览（旧实现对每个合集各发一次查询）
  useEffect(() => {
    let cancelled = false;
    memoryApi
      .list("all", null)
      .then((ms) => {
        if (!cancelled) {
          setAll(ms);
          setLoadingAll(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAll([]);
          setLoadingAll(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [collections]);

  const preview = useMemo(() => {
    const byCollection: Record<number, Memory[]> = {};
    for (const m of all) {
      if (m.collection_id == null) continue;
      const bucket = (byCollection[m.collection_id] ??= []);
      if (bucket.length < 3) bucket.push(m);
    }
    return byCollection;
  }, [all]);

  const create = async () => {
    if (!newName.trim()) return;
    try {
      const created = await collectionApi.create(
        newName.trim(),
        newColor,
        newDesc.trim(),
        newGoal.trim()
      );
      let linked = 0;
      if (newGoal.trim()) {
        try {
          linked = await collectionApi.smartFill(created.id, true);
        } catch {
          /* 智能关联失败不影响建合集 */
        }
      }
      setNewName("");
      setNewDesc("");
      setNewGoal("");
      setCreating(false);
      await refreshAll();
      toast("success", linked > 0 ? `合集已创建，智能关联 ${linked} 条` : "合集已创建");
    } catch (e) {
      toast("error", `创建失败: ${String(e)}`);
    }
  };

  const saveEdit = async (id: number) => {
    if (!editName.trim()) {
      setEditingId(null);
      return;
    }
    try {
      await collectionApi.rename(id, editName.trim());
      await collectionApi.updateDesc(id, editDesc.trim());
      setEditingId(null);
      await refreshAll();
      toast("success", "合集信息已更新");
    } catch (e) {
      toast("error", `更新失败: ${String(e)}`);
    }
  };

  const setColor = async (id: number, color: string) => {
    try {
      await collectionApi.setColor(id, color);
      await refreshAll();
    } catch (e) {
      toast("error", `设置颜色失败: ${String(e)}`);
    }
  };

  const remove = async (id: number) => {
    try {
      await collectionApi.remove(id);
      setConfirmDelete(null);
      await refreshAll();
      toast("success", "合集已删除（记忆移入待整理）");
    } catch (e) {
      toast("error", `删除失败: ${String(e)}`);
    }
  };

  const openCollection = (c: Collection) => {
    setActiveCollection(c.id);
  };

  return (
    <div className="page-measure py-7" style={{ "--measure": "980px" } as CSSProperties}>
      {/* 页头 */}
      <PageHeader
        title="合集"
        subtitle="用颜色和主题组织你的记忆"
        actions={
          <>
            <Segmented
              size="sm"
              value={view}
              onChange={(v) => setView(v as "grid" | "list")}
              options={[
                {
                  key: "grid",
                  label: (
                    <span className="flex items-center gap-1.5">
                      <LayoutGrid size={13} />
                      <span>卡片</span>
                    </span>
                  ),
                },
                {
                  key: "list",
                  label: (
                    <span className="flex items-center gap-1.5">
                      <List size={13} />
                      <span>列表</span>
                    </span>
                  ),
                },
              ]}
            />
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => setCreating((v) => !v)}
            >
              新建合集
            </Button>
          </>
        }
      />

      {/* 新建表单 */}
      {creating && (
        <div className="animate-rise glass mb-6 flex flex-wrap items-center gap-3 rounded-2xl p-4">
          <FolderOpen size={16} className="text-accent" />
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
            placeholder="合集名称…"
            className="input-base w-48 bg-base-panel"
          />
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
            placeholder="合集说明（可选）…"
            className="input-base w-56 bg-base-panel"
          />
          <input
            value={newGoal}
            onChange={(e) => setNewGoal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
            placeholder="目标，如「编译原理课程资料」…"
            className="input-base w-64 bg-base-panel"
          />
          <div className="flex items-center gap-1.5">
            {COLLECTION_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={`h-5 w-5 rounded-full transition-transform ${newColor === c ? "scale-125 ring-2 ring-accent/40" : "hover:scale-110"}`}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className="flex-1" />
          <button className="btn-primary" onClick={() => void create()}>创建</button>
          <button className="btn-ghost" onClick={() => setCreating(false)}>取消</button>
        </div>
      )}

      {/* 合集网格 */}
      {view === "grid" ? (
        <div className="coll-grid">
          {loadingAll &&
            [0, 1, 2].map((i) => (
              <div key={`sk-${i}`} className="memory-card-surface rounded-2xl p-5">
                <div className="skeleton mb-4 h-4 w-24" />
                <div className="skeleton mb-3 h-3 w-2/3" />
                <div className="skeleton mb-2 h-8 w-full" />
                <div className="skeleton h-8 w-full" />
              </div>
            ))}
          {!loadingAll &&
            collections.map((c, i) => (
            <div
              key={c.id}
              style={{ animationDelay: `${Math.min(i * 45, 280)}ms` }}
              className="card-sheen memory-card-surface animate-rise group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl p-5 outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              role="button"
              tabIndex={0}
              aria-label={`打开合集 ${c.name}`}
              onClick={() => openCollection(c)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openCollection(c);
                }
              }}
            >
              {/* 颜色点 + 名称 + 数量 */}
              <div className="relative z-10 mb-1.5 flex items-center gap-2.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: c.color }}
                />
                {editingId === c.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.key === "Enter" && void saveEdit(c.id)}
                    className="flex-1 rounded bg-base-panel px-2 py-0.5 text-[14px] text-ink outline-none"
                  />
                ) : (
                  <h3 className="flex-1 truncate text-[15px] font-semibold text-ink transition-colors group-hover:text-accent">
                    {c.name}
                  </h3>
                )}
                <span className="rounded-full bg-base-panel px-2 py-0.5 font-mono text-[12px] font-medium text-ink-dim">
                  {c.count ?? 0} 条
                </span>
              </div>

              {/* 合集说明 */}
              {editingId === c.id ? (
                <div className="mb-3 mt-1 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <input
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void saveEdit(c.id)}
                    placeholder="合集说明…"
                    className="flex-1 rounded bg-base-panel px-2 py-1 text-[12px] text-ink-dim outline-none"
                  />
                  <button
                    onClick={() => void saveEdit(c.id)}
                    className="rounded bg-accent/15 px-2 py-1 text-[12px] text-accent"
                  >
                    保存
                  </button>
                </div>
              ) : (
                <p className="mb-3 line-clamp-1 text-[12px] text-ink-faint">
                  {c.description || "暂无说明"}
                </p>
              )}

              {/* 最近 3 条记忆缩略 */}
              <div className="mb-3 flex-1 space-y-1.5">
                {(preview[c.id] ?? []).map((m) => (
                  <div key={m.id} className="flex items-center gap-2 rounded-xl bg-base-panel px-2.5 py-1.5">
                    {(m.type === "screenshot" || m.type === "image") && m.file_path ? (
                      <img
                        src={localImageUrl(m.file_path)}
                        alt=""
                        className="h-5 w-7 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-faint" />
                    )}
                    <span className="truncate text-[12px] text-ink-dim">{m.title || "未命名记忆"}</span>
                  </div>
                ))}
                {(c.count ?? 0) === 0 && (
                  <div className="rounded-xl bg-base-panel/60 px-2.5 py-3 text-center text-[12px] text-ink-faint">
                    空合集
                  </div>
                )}
              </div>

              {/* 底部：最近更新时间 + hover 操作 */}
              <div className="flex items-center justify-between pt-1 text-[12px] text-ink-faint">
                <span>更新于 {c.updated_at ? fmtRelative(c.updated_at) : "刚刚"}</span>
                <div className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(c.id);
                      setEditName(c.name);
                      setEditDesc(c.description || "");
                    }}
                    className="rounded p-1 text-ink-faint hover:bg-base-panel2 hover:text-ink"
                    title="编辑名称与说明"
                  >
                    <Pencil size={12} />
                  </button>
                  {confirmDelete === c.id ? (
                    <span className="flex items-center gap-1 text-[12px]">
                      <button className="text-danger" onClick={(e) => { e.stopPropagation(); void remove(c.id); }}>确认</button>
                      <button className="text-ink-faint" onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}>取消</button>
                    </span>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(c.id); }}
                      className="rounded p-1 text-ink-faint hover:bg-danger/10 hover:text-danger"
                      title="删除合集"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                  <div className="ml-1 flex items-center gap-1">
                    {COLLECTION_COLORS.slice(0, 5).map((pc) => (
                      <button
                        key={pc}
                        onClick={(e) => { e.stopPropagation(); void setColor(c.id, pc); }}
                        className="h-2.5 w-2.5 rounded-full opacity-60 transition-transform hover:scale-125 hover:opacity-100"
                        style={{ background: pc }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {collections.length === 0 && (
            <div className="col-span-full flex flex-col items-center py-16 text-ink-faint">
              <Layers size={22} strokeWidth={1.5} />
              <span className="mt-2 text-[13px]">还没有合集，点击右上角新建</span>
            </div>
          )}
        </div>
      ) : (
        /* 列表视图 */
        <div className="space-y-2">
          {collections.map((c) => (
            <div
              key={c.id}
              className="group flex cursor-pointer items-center gap-4 rounded-2xl bg-base-panel2/75 px-5 py-3.5 transition-colors hover:bg-base-panel2"
              onClick={() => openCollection(c)}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-ink">{c.name}</div>
                {c.description && (
                  <div className="truncate text-[12px] text-ink-faint">{c.description}</div>
                )}
              </div>
              <span className="shrink-0 text-[12px] text-ink-faint">
                {c.updated_at ? fmtRelative(c.updated_at) : ""}
              </span>
              <span className="shrink-0 font-mono text-[12px] text-ink-dim">{c.count ?? 0} 条记忆</span>

              {/* 列表视图也提供编辑/删除（此前只能切回卡片视图操作） */}
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setView("grid");
                    setEditingId(c.id);
                    setEditName(c.name);
                    setEditDesc(c.description || "");
                  }}
                  className="rounded p-1 text-ink-faint transition-colors hover:bg-base-panel hover:text-ink"
                  title="编辑"
                >
                  <Pencil size={12} />
                </button>
                {confirmDelete === c.id ? (
                  <span className="flex items-center gap-1 text-[12px]">
                    <button
                      className="rounded bg-danger px-1.5 py-0.5 text-white"
                      onClick={(e) => {
                        e.stopPropagation();
                        void remove(c.id);
                      }}
                    >
                      确认
                    </button>
                    <button
                      className="rounded px-1 py-0.5 text-ink-faint hover:text-ink"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete(null);
                      }}
                    >
                      取消
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(c.id);
                    }}
                    className="rounded p-1 text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
                    title="删除合集"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}

          {collections.length === 0 && (
            <div className="flex flex-col items-center py-16 text-ink-faint">
              <Layers size={22} strokeWidth={1.5} />
              <span className="mt-2 text-[13px]">还没有合集，点击右上角新建</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
