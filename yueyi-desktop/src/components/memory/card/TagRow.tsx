import { useApp } from "@/stores/app";

/** 标签行：最多展示 2 个，其余折叠为 +N（避免窄卡片换行） */
export default function TagRow({ tags }: { tags: string[] }) {
  const setActiveTag = useApp((s) => s.setActiveTag);
  if (tags.length === 0) return null;

  const visible = tags.slice(0, 2);
  const more = tags.length - visible.length;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {visible.map((t) => (
        <button
          key={t}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setActiveTag(t);
          }}
          className="tag-pill"
          title={`按标签 #${t} 筛选`}
        >
          #{t}
        </button>
      ))}
      {more > 0 && <span className="px-1 text-[11px] text-ink-faint">+{more}</span>}
    </div>
  );
}
