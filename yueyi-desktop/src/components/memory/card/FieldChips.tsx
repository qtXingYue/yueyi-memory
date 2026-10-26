import { invoke } from "@tauri-apps/api/core";
import { CalendarClock, Code2, FolderOpen, Link2, ListTodo, User } from "lucide-react";
import type { MemoryField } from "@/types";
import { openExternalUrl } from "@/utils/events";
import { useApp } from "@/stores/app";

const PRIORITY = [
  "deadline",
  "event_start",
  "project",
  "todo",
  "url",
  "file_path",
  "code_lang",
  "people",
];

const LABEL: Record<string, string> = {
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
};

function iconFor(key: string) {
  switch (key) {
    case "deadline":
    case "event_start":
      return CalendarClock;
    case "url":
      return Link2;
    case "file_path":
      return FolderOpen;
    case "todo":
      return ListTodo;
    case "people":
      return User;
    case "code_lang":
      return Code2;
    default:
      return null;
  }
}

/** 卡片上的结构化字段：最多 3 个，链接可点、文件可定位 */
export default function FieldChips({
  fields,
  max = 3,
}: {
  fields: MemoryField[];
  max?: number;
}) {
  const toast = useApp((s) => s.toast);
  const picked = PRIORITY.map((k) => fields.find((f) => f.key === k && f.value.trim()))
    .filter((f): f is MemoryField => Boolean(f))
    .slice(0, max);
  if (picked.length === 0) return null;

  const activate = async (f: MemoryField) => {
    try {
      if (f.key === "url") {
        void openExternalUrl(f.value);
      } else if (f.key === "file_path") {
        await invoke("reveal_path", { path: f.value });
      }
    } catch (e) {
      toast("error", String(e));
    }
  };

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {picked.map((f) => {
        const Icon = iconFor(f.key);
        const clickable = f.key === "url" || f.key === "file_path";
        return (
          <button
            key={f.key}
            type="button"
            disabled={!clickable}
            onClick={(e) => {
              e.stopPropagation();
              if (clickable) void activate(f);
            }}
            title={`${LABEL[f.key] ?? f.key}：${f.value}`}
            className={`field-pill max-w-[220px] ${clickable ? "field-pill-link" : "cursor-default"}`}
          >
            <span className="shrink-0 text-ink-faint">{LABEL[f.key] ?? f.key}</span>
            {Icon && <Icon size={10} className="shrink-0 text-ink-faint" />}
            <span className="truncate">{f.value}</span>
          </button>
        );
      })}
    </div>
  );
}
