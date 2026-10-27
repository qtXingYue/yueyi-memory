import { memo } from "react";
import {
  Image as ImageIcon,
  FileText,
  Code2,
  StickyNote,
  Monitor,
  Globe,
  ExternalLink,
} from "lucide-react";
import type { Memory } from "@/types";
import { openDrawer, openExternalUrl } from "@/utils/events";
import { extractHost, siteName, siteAvatar, memoryLinkUrl } from "@/utils/site";
import CardShell from "./card/CardShell";
import CardActions from "./card/CardActions";
import MediaBlock, { TextCover } from "./card/MediaBlock";
import MetaRow from "./card/MetaRow";
import TagRow from "./card/TagRow";
import FieldChips from "./card/FieldChips";
import CodePreview from "./card/CodePreview";

const TYPE_ICON = {
  text: StickyNote,
  note: StickyNote,
  image: ImageIcon,
  screenshot: Monitor,
  document: FileText,
  pdf: FileText,
  link: Globe,
  clipboard: StickyNote,
  code: Code2,
} as const;

/** 创建 ≤ 6 分钟的记忆视为「新捕获」，月金徽标 6 秒后自动淡出（见 .badge-moon） */
const NEW_WINDOW_MS = 6 * 60_000;

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 搜索结果里把命中的词标出来；needle 为空时原样返回 */
function highlight(text: string, needle: string) {
  if (!needle.trim()) return text;
  const parts = text.split(new RegExp(`(${escapeRegExp(needle.trim())})`, "ig"));
  const lower = needle.trim().toLowerCase();
  return parts.map((part, i) =>
    part.toLowerCase() === lower ? (
      <mark key={i} className="rounded bg-accent/15 px-0.5 text-accent">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

interface MemoryCardProps {
  memory: Memory;
  index?: number;
  isNew?: boolean;
  batchMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
  /** 搜索结果传入：替代摘要显示命中片段 */
  snippet?: string;
  /** 搜索结果传入：相关度百分比 */
  score?: number;
  /** 搜索结果传入：需要高亮的查询词 */
  highlightTerm?: string;
}

function MemoryCard({
  memory,
  index = 0,
  isNew,
  batchMode,
  selected,
  onToggleSelect,
  snippet,
  score,
  highlightTerm = "",
}: MemoryCardProps) {
  const Icon = TYPE_ICON[memory.type] ?? StickyNote;
  const isImage = memory.type === "image" || memory.type === "screenshot";
  const isDoc = memory.type === "document" || memory.type === "pdf";
  const isCode = memory.type === "code";
  const isLink = memory.type === "link";
  const isNote = memory.type === "note" || memory.type === "text" || memory.type === "clipboard";

  const handleClick = () => {
    if (batchMode && onToggleSelect) {
      onToggleSelect(memory.id);
      return;
    }
    openDrawer(memory.id);
  };

  const docExt = (() => {
    if (memory.type === "pdf") return "PDF";
    if (memory.file_path) {
      const parts = memory.file_path.split(".");
      if (parts.length > 1) return parts[parts.length - 1].toUpperCase().slice(0, 4);
    }
    return "DOC";
  })();

  // 可跳转来源：只认显式登记的 source_url 或链接型记忆，不扫描正文
  const cardUrl = memoryLinkUrl(memory);
  const host = extractHost(cardUrl);
  const avatar = host ? siteAvatar(host) : null;
  const summaryText = snippet || memory.summary || memory.ai_summary || "";
  const bodyText = summaryText || (!isCode && memory.content ? memory.content.slice(0, 160) : "");
  // 文本/剪贴板的内容已经出现在封面里，避免重复占高度；代码有 CodePreview
  const showBody = Boolean(bodyText) && !isNote && !isCode;
  const recentlyCaptured =
    isNew || Date.now() - new Date(memory.created_at).getTime() < NEW_WINDOW_MS;

  const openLink = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (cardUrl) void openExternalUrl(cardUrl);
  };

  return (
    <CardShell
      index={index}
      batchMode={batchMode}
      selected={selected}
      onActivate={handleClick}
      actions={
        !batchMode ? (
          <CardActions memory={memory} cardUrl={cardUrl} host={host ?? ""} summaryText={summaryText} />
        ) : undefined
      }
    >
      {isImage ? <MediaBlock memory={memory} /> : <TextCover memory={memory} icon={Icon} />}

      {/* 链接站点行：稳定色头像 + 站点名（整行可点击打开浏览器） */}
      {host && avatar && (isLink || !isImage) && (
        <button
          type="button"
          onClick={openLink}
          title={`点击在系统默认浏览器中打开: ${cardUrl}`}
          className="mb-2 flex max-w-full items-center gap-2 rounded-lg py-0.5 pr-2 text-left transition-colors hover:bg-accent/[0.07]"
        >
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[12px] font-bold"
            style={{ background: avatar.bg, color: avatar.fg }}
          >
            {avatar.letter}
          </span>
          <span className="truncate text-[12px] font-medium text-ink-dim">{siteName(host)}</span>
          <span className="truncate font-mono text-[12px] text-ink-faint">{host}</span>
          <ExternalLink size={11} className="shrink-0 text-ink-faint" />
        </button>
      )}

      {/* 标题行 */}
      <div className="flex items-center gap-2 pr-16">
        {!host && !isImage && !isNote && !isCode && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-base-panel2 text-ink-dim">
            <Icon size={14} strokeWidth={1.8} />
          </span>
        )}
        {isDoc && (
          <span className="shrink-0 rounded-md bg-base-panel2 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-ink-dim">
            {docExt}
          </span>
        )}
        <h3 className="min-w-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (isLink && cardUrl) openLink(e);
              else handleClick();
            }}
            className={`line-clamp-2 w-full text-left text-[15px] font-semibold leading-snug text-ink outline-none transition-colors duration-200 group-hover:text-accent focus-visible:underline focus-visible:underline-offset-2 ${
              isLink && cardUrl ? "cursor-pointer hover:underline hover:underline-offset-2" : ""
            }`}
            title={isLink && cardUrl ? `点击在浏览器中打开: ${cardUrl}` : undefined}
          >
            {highlight(memory.title || "未命名记忆", highlightTerm)}
          </button>
        </h3>
        {recentlyCaptured && <span className="badge-moon shrink-0">新捕获</span>}
      </div>

      {/* 摘要 / 正文预览：笔记类带 2px 类型色细条 */}
      {showBody && (
        <div className={`mt-1.5 ${isNote ? "relative pl-3" : ""}`}>
          {isNote && (
            <span className="absolute bottom-0.5 left-0 top-0.5 w-[2px] rounded-full bg-accent/40" />
          )}
          <p className="line-clamp-2 text-[13px] leading-relaxed text-ink-dim">
            {highlight(bodyText, highlightTerm)}
          </p>
        </div>
      )}

      {isCode && memory.content && <CodePreview content={memory.content} />}

      <FieldChips fields={memory.fields ?? []} />
      <MetaRow memory={memory} score={score} />
      <TagRow tags={memory.tags} />
    </CardShell>
  );
}

export default memo(MemoryCard);
