import type { Memory } from "@/types";
import type { LucideIcon } from "lucide-react";
import { localThumbUrl } from "@/utils/events";

/** 截图/图片缩略图：通栏出血到卡片边缘，顶部对齐（关键信息通常在上半部分） */
export default function MediaBlock({ memory }: { memory: Memory }) {
  if (!memory.file_path) return null;
  return (
    <div className="media-bleed relative -mx-4 -mt-4 mb-3 overflow-hidden rounded-t-2xl bg-base-panel2">
      <img
        src={localThumbUrl(memory.file_path)}
        alt={memory.title}
        loading="lazy"
        decoding="async"
        className="max-h-44 w-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-[1.02]"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/45 to-transparent px-2.5 pb-1.5 pt-6">
        <span className="rounded-md bg-black/40 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          {memory.type === "screenshot" ? "截屏" : "图片"}
        </span>
      </div>
    </div>
  );
}


/** 无图卡片的统一封面：文本、剪贴板、文档、链接都用同高封面，保持三列卡片高度规整 */
export function TextCover({ memory, icon: Icon }: { memory: Memory; icon: LucideIcon }) {
  const label =
    memory.type === "clipboard"
      ? "剪贴板"
      : memory.type === "link"
        ? "网页链接"
        : memory.type === "code"
          ? "代码片段"
          : memory.kind === "pdf" || memory.type === "pdf" || memory.type === "document"
            ? "文档"
            : "速记";
  const detail =
    memory.type === "link"
      ? memory.source_url
      : memory.file_path
        ? memory.file_path.split(/[\/]/).pop() ?? ""
        : memory.content || memory.summary;
  const snippet = (detail || memory.summary || "").trim().slice(0, 90);

  return (
    <div className="text-cover -mx-4 -mt-4 mb-3 overflow-hidden">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/55 text-accent shadow-sm dark:bg-white/10">
          <Icon size={16} strokeWidth={1.8} />
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-dim">
          {label}
        </span>
      </div>
      <p className="mt-4 line-clamp-2 text-[13px] leading-relaxed text-ink-dim">
        {snippet || memory.title}
      </p>
      <span className="pointer-events-none absolute -bottom-4 -right-1 text-6xl font-black leading-none text-ink/[0.045] dark:text-white/[0.045]">
        {label.slice(0, 1)}
      </span>
    </div>
  );
}
