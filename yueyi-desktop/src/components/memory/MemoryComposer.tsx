import { useCallback, useEffect, useState } from "react";
import { X, Save, Loader2, Paperclip, Eye, Edit3, Trash2 } from "lucide-react";
import { useAppPick } from "@/stores/app";
import { memoryApi, settingsApi } from "@/services/api";
import { useFocusTrap, useOverlayEscape } from "@/hooks/useOverlay";
import { ModalPanel, OverlayBackdrop } from "@/ui";
import type { MemoryType } from "@/types";

const TYPE_OPTIONS: { value: MemoryType; label: string }[] = [
  { value: "note", label: "笔记" },
  { value: "text", label: "文本" },
  { value: "code", label: "代码" },
  { value: "link", label: "链接" },
  { value: "image", label: "图片" },
  { value: "pdf", label: "PDF" },
  { value: "document", label: "文档" },
];

const DRAFT_KEY = "yueyi-composer-draft";

export default function MemoryComposer() {
  const { composerOpen, setComposerOpen, collections, refreshAll, toast } = useAppPick(
    "composerOpen", "setComposerOpen", "collections", "refreshAll", "toast"
  );
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<MemoryType>("note");
  const [collectionId, setCollectionId] = useState<number | null>(null);
  const [tags, setTags] = useState("");
  const [filePath, setFilePath] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const [saving, setSaving] = useState(false);

  // 恢复草稿
  useEffect(() => {
    if (!composerOpen) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as {
          title?: string;
          content?: string;
          type?: MemoryType;
          tags?: string;
          filePath?: string;
        };
        if (draft.title) setTitle(draft.title);
        if (draft.content) setContent(draft.content);
        if (draft.type) setType(draft.type);
        if (draft.tags) setTags(draft.tags);
        if (draft.filePath) setFilePath(draft.filePath);
      }
    } catch { /* ignore */ }
  }, [composerOpen]);

  // 自动保存草稿
  useEffect(() => {
    if (!composerOpen) return;
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ title, content, type, tags, filePath }),
      );
    } catch { /* ignore */ }
  }, [title, content, type, tags, filePath, composerOpen]);

  const close = useCallback(() => setComposerOpen(false), [setComposerOpen]);
  const panelRef = useFocusTrap<HTMLDivElement>(composerOpen, "composer");
  useOverlayEscape("composer", close);

  if (!composerOpen) return null;

  const pickFile = async () => {
    try {
      const p = await settingsApi.pickAttachmentFile();
      if (!p) return;
      setFilePath(p);
      const lower = p.toLowerCase();
      if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".webp")) {
        setType("image");
      } else if (lower.endsWith(".pdf")) {
        setType("pdf");
      } else if (
        lower.endsWith(".rs") || lower.endsWith(".ts") || lower.endsWith(".tsx") ||
        lower.endsWith(".js") || lower.endsWith(".py")
      ) {
        setType("code");
      } else {
        setType("document");
      }
      if (!title.trim()) {
        const base = p.split(/[\\/]/).pop() || "";
        setTitle(base);
      }
    } catch (e) {
      toast("error", `选择文件失败: ${String(e)}`);
    }
  };

  const save = async () => {
    const text = content.trim();
    if (!text && !filePath) {
      toast("info", "内容或附件不能为空");
      return;
    }
    setSaving(true);
    try {
      let finalType = type;
      let sourceUrl = "";
      if (type === "link" || /^https?:\/\/\S+$/i.test(text)) {
        finalType = "link";
        sourceUrl = text.split("\n")[0].trim();
      }
      await memoryApi.create({
        title: title.trim() || undefined,
        content: text,
        type: finalType,
        source: filePath ? "file" : "manual",
        source_url: sourceUrl,
        file_path: filePath || undefined,
        collection_id: collectionId,
        tags: tags.split(/[,，\s]+/).filter(Boolean),
      });
      setTitle("");
      setContent("");
      setTags("");
      setFilePath("");
      setPreviewMode(false);
      localStorage.removeItem(DRAFT_KEY);
      setComposerOpen(false);
      await refreshAll();
      toast("success", "记忆已保存，AI 正在整理…");
    } catch (e) {
      toast("error", `保存失败: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60]" onClick={close} role="dialog" aria-modal="true" aria-labelledby="composer-title" aria-label="新建记忆">
      <OverlayBackdrop onClick={close} />
      <ModalPanel
        ref={panelRef}
        tabIndex={-1}
        className="left-0 right-0 top-[7%] mx-auto flex max-h-[85vh] w-[740px] max-w-[92vw] flex-col overflow-hidden rounded-xl3"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            void save();
          }
        }}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-base-border/70 px-6 py-3.5">
          <div className="flex items-center gap-3">
            <h2 id="composer-title" className="text-[15px] font-semibold text-ink">新建记忆</h2>
            <div className="flex items-center rounded-lg border border-base-border/70 bg-base-panel2/60 p-0.5">
              <button
                onClick={() => setPreviewMode(false)}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] transition-colors ${
                  !previewMode ? "bg-accent/15 text-accent" : "text-ink-faint hover:text-ink"
                }`}
              >
                <Edit3 size={11} /> 编辑
              </button>
              <button
                onClick={() => setPreviewMode(true)}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] transition-colors ${
                  previewMode ? "bg-accent/15 text-accent" : "text-ink-faint hover:text-ink"
                }`}
              >
                <Eye size={11} /> 预览
              </button>
            </div>
          </div>
          <button
            onClick={() => setComposerOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-base-panel2 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        {/* 表单 */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题（留空由 AI 自动生成）"
            className="input-base text-[15px]"
          />

          {previewMode ? (
            <div className="min-h-[210px] whitespace-pre-wrap rounded-xl2 border border-base-border/70 bg-base-panel2 p-4 text-[14px] leading-relaxed text-ink">
              {content.trim() || <span className="text-ink-faint">（暂无内容）</span>}
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                type === "link"
                  ? "输入网址 URL（第一行）及备注说明，系统将自动抓取网页标题与摘要…"
                  : type === "code"
                    ? "粘贴或输入代码片段…"
                    : "输入内容，保存后链接可在详情里点击打开…"
              }
              rows={9}
              className={`input-base resize-none leading-relaxed ${type === "code" ? "font-mono text-[13px]" : "font-[inherit]"}`}
            />
          )}

          {/* 附件展示与选择 */}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => void pickFile()}
              className="btn-outline py-1.5 text-[12px]"
            >
              <Paperclip size={13} /> 添加图片 / PDF / 文档附件
            </button>
            {filePath && (
              <div className="flex flex-1 items-center justify-between truncate rounded-lg border border-accent/25 bg-accent/[0.06] px-3 py-1.5 text-[12px] text-accent">
                <span className="truncate">{filePath}</span>
                <button
                  type="button"
                  onClick={() => setFilePath("")}
                  className="ml-2 text-ink-faint hover:text-danger"
                  title="移除附件"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {TYPE_OPTIONS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setType(t.value)}
                  className={`rounded-lg border px-2.5 py-1 text-[12px] transition-all ${
                    type === t.value
                      ? "border-accent/40 bg-accent/10 text-ink"
                      : "border-base-border text-ink-dim hover:border-accent/25"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <select
              value={collectionId ?? ""}
              onChange={(e) => setCollectionId(e.target.value ? Number(e.target.value) : null)}
              className="input-base w-auto cursor-pointer"
            >
              <option value="">自动分类 / 待整理</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="标签，逗号分隔（可留空由 AI 生成）"
            className="input-base"
          />
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between border-t border-base-border/70 px-6 py-3.5">
          <span className="text-[12px] text-ink-faint">Ctrl+Enter 快速保存 · 自动保存草稿</span>
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={() => setComposerOpen(false)}>取消</button>
            <button className="btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              保存记忆
            </button>
          </div>
        </div>
      </ModalPanel>
    </div>
  );
}
