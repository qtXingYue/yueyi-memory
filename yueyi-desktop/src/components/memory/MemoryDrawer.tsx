import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  X, Copy, FolderInput, RefreshCw, Trash2, Sparkles, Loader2, Pencil, Check, ExternalLink,
  CalendarPlus, FolderOpen, Download,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAppPick } from "@/stores/app";
import { memoryApi } from "@/services/api";
import { onOpenDrawer, fmtDateTime, localImageUrl, openExternalUrl, sourceLabel } from "@/utils/events";
import { memoryLinkUrl } from "@/utils/site";
import { useFocusTrap, useOverlayEscape } from "@/hooks/useOverlay";
import { DrawerPanel, OverlayBackdrop } from "@/ui";
import Linkify from "@/components/memory/Linkify";
import type { Collection, Memory } from "@/types";

export default function MemoryDrawer() {
  const { drawerMemoryId, closeDrawer, collections, memories, refreshAll, toast, openDrawer } =
    useAppPick("drawerMemoryId", "closeDrawer", "collections", "memories", "refreshAll", "toast", "openDrawer");
  const [memory, setMemory] = useState<Memory | null>(null);
  const [related, setRelated] = useState<Memory[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSourceUrl, setEditSourceUrl] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => onOpenDrawer((id) => openDrawer(id)), [openDrawer]);

  // 监听当前抽屉记忆的实时 AI 分析完成/更新事件，即时刷新抽屉展示
  useEffect(() => {
    if (drawerMemoryId == null) return;
    let un: (() => void) | undefined;
    void (async () => {
      try {
        un = await listen<{ id: number; reason: string }>("memory-updated", (e) => {
          if (e.payload.id === drawerMemoryId) {
            void (async () => {
              const updated = await memoryApi.get(drawerMemoryId);
              if (updated) {
                setMemory(updated);
                setEditTitle(updated.title);
                setEditContent(updated.content);
                setEditTags(updated.tags.join(", "));
              }
              setAnalyzing(false);
            })();
          }
        });
      } catch {
        /* 非桌面环境 */
      }
    })();
    return () => {
      un?.();
    };
  }, [drawerMemoryId]);

  useEffect(() => {
    if (drawerMemoryId == null) {
      setMemory(null);
      setEditing(false);
      setShowMoveMenu(false);
      return;
    }
    setShowDeleteConfirm(false);
    setShowMoveMenu(false);
    void (async () => {
      try {
        const m = await memoryApi.get(drawerMemoryId);
        setMemory(m);
        if (m) {
          setEditTitle(m.title);
          setEditSourceUrl(m.source_url || "");
          setEditContent(m.content);
          setEditTags(m.tags.join(", "));
          const rel = await memoryApi.related(m.id).catch(() => []);
          setRelated(rel.slice(0, 4));
        }
      } catch (e) {
        toast("error", `读取记忆失败: ${String(e)}`);
      }
    })();
  }, [drawerMemoryId, memories, toast]);

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("success", "已复制到剪贴板");
    } catch {
      toast("error", "复制失败");
    }
  };

  const saveEdit = async () => {
    if (!memory) return;
    setSavingEdit(true);
    try {
      const updated = await memoryApi.update(memory.id, {
        title: editTitle.trim() || "未命名记忆",
        source_url: editSourceUrl.trim(),
        content: editContent,
        tags: editTags.split(/[,，\s]+/).filter(Boolean),
      });
      setMemory(updated);
      setEditing(false);
      await refreshAll();
      toast("success", "记忆已更新");
    } catch (e) {
      toast("error", `保存失败: ${String(e)}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const moveTo = async (collectionId: number | null) => {
    if (!memory) return;
    try {
      await memoryApi.moveToCollection([memory.id], collectionId);
      const m = await memoryApi.get(memory.id);
      setMemory(m);
      setShowMoveMenu(false);
      await refreshAll();
      toast("success", "已移动到合集");
    } catch (e) {
      toast("error", `移动失败: ${String(e)}`);
    }
  };

  const reanalyze = async () => {
    if (!memory) return;
    setAnalyzing(true);
    try {
      await memoryApi.reanalyze(memory.id);
      toast("info", "已提交 AI 重新分析");
    } catch (e) {
      toast("error", `重新分析失败: ${String(e)}`);
    }
    setTimeout(() => setAnalyzing(false), 1500);
  };

  const exportMarkdown = async () => {
    if (!memory) return;
    try {
      const path = await memoryApi.exportMarkdown(memory.id);
      await invoke("reveal_path", { path });
      toast("success", "已导出 Markdown");
    } catch (e) {
      toast("error", `导出失败：${String(e)}`);
    }
  };

  const remove = async () => {    if (!memory) return;
    try {
      await memoryApi.remove(memory.id);
      closeDrawer();
      await refreshAll();
      toast("success", "已移入回收站，可在设置中恢复");
    } catch (e) {
      toast("error", `删除失败: ${String(e)}`);
    }
  };

  const [closing, setClosing] = useState(false);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      closeDrawer();
    }, 220);
  }, [closeDrawer]);

  const panelRef = useFocusTrap<HTMLDivElement>(drawerMemoryId != null, "drawer");
  useOverlayEscape("drawer", handleClose);

  if (drawerMemoryId == null) return null;

  return (
    <div className="fixed inset-0 z-[70]" onClick={handleClose}>
      {/* 遮罩：平滑渐显/渐隐 */}
      <OverlayBackdrop closing={closing} />
      {/* Drawer 主体 */}
      <DrawerPanel
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        aria-label="记忆详情"
        closing={closing}
        className="w-[520px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部 */}
        <div className="flex items-center justify-between border-b border-base-border/60 bg-base-panel/40 px-6 py-4 backdrop-blur-md">
          <div>
            <div className="text-[12px] font-medium text-ink-faint">
              来源：{memory ? sourceLabel(memory.source) : "…"}
            </div>
            <div className="mt-0.5 text-[13px] font-semibold text-ink">
              {memory ? fmtDateTime(memory.created_at) : ""}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {memory && (
              <button
                onClick={() => {
                  if (editing) {
                    void saveEdit();
                  } else {
                    setEditTitle(memory.title);
                    setEditContent(memory.content);
                    setEditTags(memory.tags.join(", "));
                    setEditing(true);
                  }
                }}
                disabled={savingEdit}
                className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-ink-dim transition-colors hover:bg-accent/10 hover:text-accent"
                title={editing ? "保存修改" : "编辑记忆"}
              >
                {editing ? <Check size={14} className="text-accent" /> : <Pencil size={13} />}
                <span>{editing ? "保存" : "编辑"}</span>
              </button>
            )}
            <button
              onClick={handleClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-all duration-200 hover:rotate-90 hover:bg-base-panel2 hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {!memory ? (
            <div className="flex h-40 items-center justify-center text-ink-faint">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : (
            <div className="space-y-6 animate-fade-slide">
              {/* 标题 */}
              {editing ? (
                <div>
                  <div className="section-label">标题</div>
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="input-base text-[15px] font-semibold"
                  />
                </div>
              ) : (
                <h2 id="drawer-title" className="text-[18px] font-semibold leading-snug text-ink">
                  {memory.title || "未命名记忆"}
                </h2>
              )}

              {/* 来源链接（支持浏览器视频/网页截图一键跳转） */}
              {editing ? (
                <div>
                  <div className="section-label">来源网址（视频 / 网页链接，点击可直接跳转）</div>
                  <input
                    value={editSourceUrl}
                    onChange={(e) => setEditSourceUrl(e.target.value)}
                    placeholder="https://..."
                    className="input-base font-mono text-[12px]"
                  />
                </div>
              ) : (
                (() => {
                  const drawerUrl = memoryLinkUrl(memory);
                  if (!drawerUrl) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => void openExternalUrl(drawerUrl)}
                      className="group flex w-full items-center gap-3 truncate rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3 text-left text-[13px] text-accent font-medium transition-all hover:border-accent hover:bg-accent/12 active:scale-[0.99] shadow-xs cursor-pointer"
                      title={`在默认浏览器中打开: ${drawerUrl}`}
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent transition-transform group-hover:scale-105">
                        <ExternalLink size={14} />
                      </div>
                      <span className="flex-1 truncate font-mono text-[12px]">{drawerUrl}</span>
                      <span className="shrink-0 rounded-lg bg-accent/20 px-2.5 py-1 text-[12px] font-semibold text-accent transition-colors group-hover:bg-accent group-hover:text-white">
                        打开网页 ↗
                      </span>
                    </button>
                  );
                })()
              )}

              {/* AI 整理中实时状态条 */}
              {(memory.ai_status === "processing" || memory.ai_status === "pending" || analyzing) && (
                <div className="flex items-center gap-3 rounded-xl2 border border-accent/30 bg-accent/[0.08] p-3.5 text-accent animate-pulse">
                  <Loader2 size={16} className="animate-spin text-accent shrink-0" />
                  <div className="flex-1">
                    <div className="text-[13px] font-medium">AI 正在深度解析画面…</div>
                    <div className="text-[12px] text-ink-dim">正在提取文字并智能生成标题、摘要与标签分类</div>
                  </div>
                </div>
              )}

              {/* AI 整理失败提示与重试入口 */}
              {memory.ai_status === "failed" && !analyzing && !memory.summary && !memory.ai_summary && (
                <div className="flex items-center justify-between rounded-xl2 border border-warn/30 bg-warn/[0.08] p-3.5 text-warn">
                  <div className="flex items-center gap-2">
                    <Sparkles size={16} className="shrink-0" />
                    <div>
                      <div className="text-[13px] font-medium">AI 整理未完成</div>
                      <div className="text-[12px] text-ink-dim">截图已完整保存在本地，可随时点击重试</div>
                    </div>
                  </div>
                  <button
                    onClick={() => void reanalyze()}
                    className="flex items-center gap-1.5 rounded-lg bg-warn/20 hover:bg-warn/30 px-3 py-1.5 text-[12px] font-medium text-ink transition-colors"
                  >
                    <RefreshCw size={12} />
                    <span>立即分析</span>
                  </button>
                </div>
              )}

              {/* 摘要 */}
              {memory.summary && (
                <section>
                  <div className="section-label flex items-center gap-1">
                    <Sparkles size={11} className="text-accent" /> 摘要
                  </div>
                  <p className="rounded-xl2 border border-accent/20 bg-accent/[0.04] p-4 text-[14px] leading-relaxed text-ink shadow-xs">
                    {memory.summary}
                  </p>
                </section>
              )}

              {/* 结构化关键信息 */}
              {(memory.fields?.length ?? 0) > 0 && (
                <section>
                  <div className="section-label flex items-center gap-1">
                    <CalendarPlus size={11} className="text-accent" /> 关键信息
                  </div>
                  <div className="space-y-1 rounded-xl2 border border-base-border bg-base-panel/50 p-3">
                    {memory.fields.map((f) => {
                      const label =
                        {
                          deadline: "截止",
                          event_start: "日程",
                          event_end: "结束",
                          project: "项目",
                          todo: "待办",
                          url: "链接",
                          file_path: "文件",
                          code_lang: "语言",
                          people: "人物",
                          phone: "电话",
                          email: "邮箱",
                          version: "版本",
                        }[f.key] ?? f.key;
                      return (
                        <div key={f.key} className="flex items-center gap-2 text-[13px]">
                          <span className="w-12 shrink-0 text-ink-faint">{label}</span>
                          <span className="min-w-0 flex-1 truncate text-ink" title={f.value}>
                            {f.value}
                          </span>
                          {f.key === "url" && (
                            <button
                              className="shrink-0 text-[12px] font-medium text-accent hover:underline"
                              onClick={() => void openExternalUrl(f.value)}
                            >
                              打开
                            </button>
                          )}
                          {f.key === "file_path" && (
                            <button
                              className="flex shrink-0 items-center gap-0.5 text-[12px] font-medium text-accent hover:underline"
                              onClick={() => void invoke("reveal_path", { path: f.value })}
                            >
                              <FolderOpen size={10} /> 定位
                            </button>
                          )}
                          {(f.key === "deadline" || f.key === "event_start") && (
                            <button
                              className="flex shrink-0 items-center gap-0.5 text-[12px] font-medium text-accent hover:underline"
                              onClick={async () => {
                                try {
                                  const path = await invoke<string>("export_ics", {
                                    title: memory.title,
                                    start: f.value,
                                    end: null,
                                    description: memory.summary ?? "",
                                  });
                                  await invoke("open_path", { path });
                                } catch (e) {
                                  toast("error", String(e));
                                }
                              }}
                            >
                              <CalendarPlus size={10} /> 日历
                            </button>
                          )}
                          <button
                            className="shrink-0 text-ink-faint transition-colors hover:text-accent"
                            title="复制"
                            onClick={() => void copyText(f.value)}
                          >
                            <Copy size={11} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* AI 深度分析 */}
              {memory.ai_summary && memory.ai_summary !== memory.summary && (
                <section>
                  <div className="section-label flex items-center gap-1">
                    <Sparkles size={11} className="text-violet" /> AI 分析
                  </div>
                  <div className="whitespace-pre-wrap rounded-xl2 border border-violet/20 bg-violet/[0.04] p-4 text-[13px] leading-relaxed text-ink-dim shadow-xs">
                    {memory.ai_summary}
                  </div>
                </section>
              )}

              {/* 原图 */}
              {(memory.type === "image" || memory.type === "screenshot") && memory.file_path && (
                <section>
                  <div className="section-label">原图</div>
                  <img
                    src={localImageUrl(memory.file_path)}
                    alt={memory.title}
                    className="w-full rounded-xl2 border border-base-border shadow-xs"
                  />
                </section>
              )}

              {/* OCR 原文 */}
              {memory.ocr_text && (
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="section-label mb-0">OCR 原文</div>
                    <button
                      onClick={() => void copyText(memory.ocr_text)}
                      className="flex items-center gap-1 text-[12px] font-medium text-ink-faint transition-colors hover:text-accent"
                    >
                      <Copy size={12} /> 复制
                    </button>
                  </div>
                  <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-xl2 border border-base-border/70 bg-base-panel2 p-4 font-mono text-[12px] leading-relaxed text-ink-dim">
                    <Linkify text={memory.ocr_text} />
                  </pre>
                </section>
              )}

              {/* 正文内容 */}
              {editing ? (
                <section>
                  <div className="section-label">内容</div>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={8}
                    className="input-base resize-y font-[inherit] text-[13px] leading-relaxed"
                  />
                </section>
              ) : (
                <>
                  {memory.content && memory.type !== "code" && (
                    <section>
                      <div className="section-label">内容</div>
                      <div className="whitespace-pre-wrap rounded-xl2 border border-base-border/70 bg-base-panel2 p-4 text-[14px] leading-relaxed text-ink-dim">
                        <Linkify text={memory.content} />
                      </div>
                    </section>
                  )}
                  {memory.type === "code" && memory.content && (
                    <section>
                      <div className="mb-2 flex items-center justify-between">
                        <div className="section-label mb-0">代码</div>
                        <button
                          onClick={() => void copyText(memory.content)}
                          className="flex items-center gap-1 text-[12px] font-medium text-ink-faint transition-colors hover:text-accent"
                        >
                          <Copy size={12} /> 复制代码
                        </button>
                      </div>
                      <div className="code-window">
                        <div className="code-window-head px-4 pb-0 pt-3">
                          <span className="code-window-dots">
                            <i />
                            <i />
                            <i />
                          </span>
                          <span className="code-window-lang">代码片段</span>
                        </div>
                        <pre className="overflow-x-auto px-4 pb-4 pt-2 font-mono text-[12px] leading-relaxed">
                          <code>{memory.content}</code>
                        </pre>
                      </div>
                    </section>
                  )}
                </>
              )}

              {/* 标签 */}
              {editing ? (
                <section>
                  <div className="section-label">标签（逗号分隔）</div>
                  <input
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    placeholder="标签1, 标签2"
                    className="input-base text-[13px]"
                  />
                </section>
              ) : (
                memory.tags.length > 0 && (
                  <section>
                    <div className="section-label">标签</div>
                    <div className="flex flex-wrap gap-1.5">
                      {memory.tags.map((t) => (
                        <span key={t} className="tag-chip">{t}</span>
                      ))}
                    </div>
                  </section>
                )
              )}

              {/* 所属合集 */}
              <section>
                <div className="section-label">所属合集</div>
                <div className="flex flex-wrap gap-1.5">
                  {collections.map((c: Collection) => (
                    <button
                      key={c.id}
                      onClick={() => void moveTo(c.id)}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] transition-all ${
                        memory.collection_id === c.id
                          ? "border-accent/40 bg-accent/10 text-ink"
                          : "border-base-border text-ink-dim hover:border-accent/25"
                      }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
                      {c.name}
                    </button>
                  ))}
                </div>
              </section>

              {/* 相关记忆 */}
              {related.length > 0 && (
                <section>
                  <div className="section-label">你可能还记得</div>
                  <div className="space-y-1">
                    {related.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => openDrawer(r.id)}
                        className="flex w-full items-center gap-2.5 rounded-lg border border-base-border/50 bg-base-panel2/50 px-3 py-2 text-left transition-all hover:border-violet/30"
                      >
                        <Sparkles size={11} className="text-violet" />
                        <span className="flex-1 truncate text-[13px] text-ink-dim">{r.title}</span>
                        <span className="text-[12px] text-ink-faint">
                          {new Date(r.created_at).toLocaleDateString("zh-CN")}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        {/* 底部固定操作栏 */}
        {memory && (
          <div className="relative flex items-center gap-2 border-t border-base-border/60 bg-base-panel/50 px-6 py-3 backdrop-blur-md">
            <button
              className="btn-ghost"
              onClick={() => void copyText(memory.ocr_text || memory.content || memory.title)}
            >
              <Copy size={13} /> 复制原文
            </button>

            <div className="relative">
              <button
                className="btn-ghost"
                onClick={() => setShowMoveMenu((v) => !v)}
              >
                <FolderInput size={13} /> 移动到合集
              </button>
              {showMoveMenu && (
                <div className="glass-deep animate-rise absolute bottom-10 left-0 z-20 w-44 rounded-xl border border-base-border/80 p-1.5 shadow-drawer">
                  {collections.map((c: Collection) => (
                    <button
                      key={c.id}
                      onClick={() => void moveTo(c.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                        memory.collection_id === c.id
                          ? "bg-accent/15 text-accent"
                          : "text-ink-dim hover:bg-base-panel2 hover:text-ink"
                      }`}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                      <span className="truncate">{c.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button className="btn-ghost" onClick={() => void reanalyze()} disabled={analyzing}>
              <RefreshCw size={13} className={analyzing ? "animate-spin" : ""} /> 重新分析
            </button>
            <button className="btn-ghost" onClick={() => void exportMarkdown()}>
              <Download size={13} /> 导出
            </button>
            <div className="flex-1" />
            {showDeleteConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-ink-faint">确认删除？</span>
                <button className="btn-danger" onClick={() => void remove()}>确认</button>
                <button className="btn-ghost" onClick={() => setShowDeleteConfirm(false)}>取消</button>
              </div>
            ) : (
              <button className="btn-danger" onClick={() => setShowDeleteConfirm(true)}>
                <Trash2 size={13} /> 删除
              </button>
            )}
          </div>
        )}
      </DrawerPanel>
    </div>
  );
}
