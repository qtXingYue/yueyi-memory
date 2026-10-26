// ============ Tauri invoke 封装：记忆 / 合集 / 搜索 / AI / 设置 ============

import { invoke } from "@tauri-apps/api/core";
import type {
  AiAnswer,
  AppSettings,
  Collection,
  CreateMemoryInput,
  Memory,
  SearchHistoryItem,
  SearchResult,
  TagInfo,
  TodayStats,
  TrashItem,
} from "@/types";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 非桌面环境兜底（浏览器 dev 预览时返回空数据，避免崩溃） */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return mockCall<T>(cmd, args);
  return invoke<T>(cmd, args);
}

// ---------- 记忆 CRUD ----------

export const memoryApi = {
  list(range: "all" | "today" | "week" | "month", collectionId?: number | null): Promise<Memory[]> {
    return call("list_memories", { range, collectionId: collectionId ?? null });
  },
  get(id: number): Promise<Memory | null> {
    return call("get_memory", { id });
  },
  create(input: CreateMemoryInput): Promise<Memory> {
    return call("create_memory", { input });
  },
  update(id: number, patch: Record<string, unknown>): Promise<Memory> {
    return call("update_memory", { id, patch });
  },
  remove(id: number): Promise<void> {
    return call("delete_memory", { id });
  },
  moveToCollection(ids: number[], collectionId: number | null): Promise<void> {
    return call("move_memories", { ids, collectionId });
  },
  related(id: number): Promise<Memory[]> {
    return call("related_memories", { id });
  },
  reanalyze(id: number): Promise<void> {
    return call("reanalyze_memory", { id });
  },
  stats(): Promise<TodayStats> {
    return call("today_stats");
  },
  search(query: string, record = true): Promise<SearchResult[]> {
    return call("search_memories", { query, record });
  },
  importFiles(paths: string[]): Promise<import("@/types").ImportOutcome> {
    return call("import_files", { paths });
  },
  exportMarkdown(id: number): Promise<string> {
    return call("export_memory_markdown", { id });
  },
  // 回收站（软删除）
  trash(): Promise<TrashItem[]> {
    return call("list_trash");
  },
  restore(id: number): Promise<void> {
    return call("restore_memory", { id });
  },
  purge(id: number): Promise<void> {
    return call("purge_memory", { id });
  },
  emptyTrash(): Promise<number> {
    return call("empty_trash");
  },
};

// ---------- 标签管理 ----------

export const tagApi = {
  list(): Promise<TagInfo[]> {
    return call("list_tags");
  },
  rename(oldName: string, newName: string): Promise<void> {
    return call("rename_tag", { old: oldName, new: newName });
  },
  remove(name: string): Promise<void> {
    return call("delete_tag", { name });
  },
};

// ---------- 搜索历史 ----------

export const historyApi = {
  list(limit = 8): Promise<SearchHistoryItem[]> {
    return call("list_search_history", { limit });
  },
  clear(): Promise<void> {
    return call("clear_search_history");
  },
};

// ---------- 合集 ----------

export const collectionApi = {
  list(): Promise<Collection[]> {
    return call("list_collections");
  },
  create(name: string, color: string, description?: string, goal?: string): Promise<Collection> {
    return call("create_collection", {
      name,
      color,
      description: description ?? "",
      goal: goal ?? "",
    });
  },
  rename(id: number, name: string): Promise<void> {
    return call("rename_collection", { id, name });
  },
  setColor(id: number, color: string): Promise<void> {
    return call("set_collection_color", { id, color });
  },
  updateDesc(id: number, description: string): Promise<void> {
    return call("update_collection_desc", { id, description });
  },
  remove(id: number): Promise<void> {
    return call("delete_collection", { id });
  },
  reorder(ids: number[]): Promise<void> {
    return call("reorder_collections", { ids });
  },
  suggest(id: number): Promise<import("@/types").CollectionSuggestion[]> {
    return call("suggest_collection_memories", { collectionId: id });
  },
  smartFill(id: number, auto = false): Promise<number> {
    return call("smart_fill_collection", { collectionId: id, auto });
  },
  unlink(id: number, memoryId: number): Promise<void> {
    return call("unlink_collection_memory", { collectionId: id, memoryId });
  },
  summary(id: number): Promise<string> {
    return call("generate_collection_summary", { collectionId: id });
  },
  exportMarkdown(id: number): Promise<string> {
    return call("export_collection_markdown", { id });
  },
};

// ---------- 提醒 / 回顾 ----------

export const reminderApi = {
  list(): Promise<import("@/types").Reminder[]> {
    return call("list_reminders");
  },
  create(title: string, remindAt: string, memoryId?: number | null): Promise<number> {
    return call("create_reminder", { title, remindAt, memoryId: memoryId ?? null });
  },
  complete(id: number): Promise<void> {
    return call("complete_reminder", { id });
  },
  remove(id: number): Promise<void> {
    return call("delete_reminder", { id });
  },
};

export const reviewApi = {
  overview(): Promise<import("@/types").ReviewOverview> {
    return call("review_overview");
  },
  weekly(): Promise<string> {
    return call("generate_weekly_review");
  },
};

// ---------- AI ----------

export const aiApi = {
  ask(question: string): Promise<AiAnswer> {
    return call("ai_ask", { question });
  },
  testConnection(): Promise<{ ok: boolean; message: string }> {
    return call("ai_test_connection");
  },
};

// ---------- 设置 ----------

export const settingsApi = {
  get(): Promise<AppSettings> {
    return call("get_settings");
  },
  save(patch: Record<string, unknown>): Promise<AppSettings> {
    return call("save_settings", { patch });
  },
  openDataDir(): Promise<void> {
    return call("open_data_dir");
  },
  storageInfo(): Promise<{
    memories: number;
    screenshots: number;
    attachmentsSize: number;
    dbSize: number;
  }> {
    return call("storage_info");
  },
  exportData(targetPath: string): Promise<string> {
    return call("export_data", { targetPath });
  },
  importData(sourcePath: string): Promise<number> {
    return call("import_data", { sourcePath });
  },
  backupDatabase(targetPath: string): Promise<string> {
    return call("backup_database", { targetPath });
  },
  pickAttachmentFile(): Promise<string | null> {
    return call("pick_attachment_file");
  },
};

// ---------- 捕获 ----------

export const captureApi = {
  screenshot(): Promise<Memory> {
    return call("capture_screenshot");
  },
  windowScreenshot(): Promise<Memory> {
    return call("capture_window_screenshot");
  },
  regionScreenshot(x: number, y: number, width: number, height: number): Promise<Memory> {
    return call("capture_region_screenshot", { x, y, width, height });
  },
  prepareRegionCapture(): Promise<{ preview_path: string; width: number; height: number }> {
    return call("prepare_region_capture");
  },
  commitRegionCapture(x: number, y: number, width: number, height: number): Promise<Memory> {
    return call("commit_region_capture", { x, y, width, height });
  },
  cancelRegionCapture(): Promise<void> {
    return call("cancel_region_capture");
  },
  clipboardSave(): Promise<Memory | null> {
    return call("save_clipboard");
  },
  openQuickNote(): Promise<void> {
    return call("show_quick_note_cmd");
  },
};

// ---------- 浏览器 dev mock ----------

const mem = (i: number): Memory => ({
  id: i,
  title: `示例记忆 ${i}`,
  content: "浏览器预览模式下的示例数据，桌面运行时来自本地 SQLite。",
  summary: "示例摘要：这是浏览器预览。",
  type: "text",
  kind: "note",
  source: "manual",
  source_url: "",
  file_path: "",
  ocr_text: "",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  collection_id: 1,
  collection_name: "学习资料",
  collection_color: "#2DD4A7",
  tags: ["示例"],
  fields: [],
  ai_status: "done",
  ai_summary: "",
  ai_category: "",
  metadata: {},
});

async function mockCall<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  switch (cmd) {
    case "list_memories":
      return [mem(1), mem(2), mem(3)] as T;
    case "list_collections":
      return [
        { id: 1, name: "学习资料", description: "", color: "#2DD4A7", count: 3, created_at: "", updated_at: "" },
      ] as T;
    case "today_stats":
      return { total: 3, screenshots: 1, links: 1, texts: 1, total_all: 3, trend: [0, 1, 0, 2, 0, 1, 3, 0, 1, 0, 2, 1, 0, 3] } as T;
    case "list_trash":
      return [] as T;
    case "list_tags":
      return [{ name: "示例", count: 3 }] as T;
    case "list_search_history":
      return [] as T;
    case "get_settings":
      return {
        api_key: "", base_url: "https://api.deepseek.com", model: "deepseek-chat",
        shortcut_screenshot: "Alt+Shift+S", shortcut_quick_note: "Alt+Shift+M",
        auto_analyze: true, minimize_to_tray: true, onboarding_done: false,
      } as T;
    default:
      return (null as unknown) as T;
  }
}
