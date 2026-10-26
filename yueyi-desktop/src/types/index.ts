// ============ 核心数据类型（与 Rust 侧一一对应） ============

export type MemoryType =
  | "text"
  | "image"
  | "screenshot"
  | "document"
  | "pdf"
  | "link"
  | "clipboard"
  | "code"
  | "note";

export type AiStatus = "pending" | "processing" | "done" | "failed";

export interface MemoryField {
  key: string;
  value: string;
  normalized: string;
  confidence: number;
}

export interface Memory {
  id: number;
  title: string;
  content: string;
  summary: string;
  type: MemoryType;
  kind: string;
  source: string;
  source_url: string;
  file_path: string;
  ocr_text: string;
  created_at: string;
  updated_at: string;
  collection_id: number | null;
  collection_name?: string | null;
  collection_color?: string | null;
  tags: string[];
  fields: MemoryField[];
  ai_status: AiStatus;
  ai_summary: string;
  ai_category: string;
  metadata: Record<string, unknown>;
}

export interface Collection {
  id: number;
  name: string;
  description: string;
  color: string;
  goal: string;
  summary: string;
  summary_at: string;
  count?: number;
  created_at: string;
  updated_at: string;
}

export interface Reminder {
  id: number;
  memory_id: number | null;
  title: string;
  remind_at: string;
  done: boolean;
  fired: boolean;
}

export interface CollectionSuggestion {
  memory: Memory;
  score: number;
  reason: string;
}

export interface ReviewOverview {
  today_count: number;
  week_count: number;
  pending_count: number;
  upcoming: Reminder[];
  recent: Memory[];
  stale: Memory[];
}

export interface ImportOutcome {
  imported: number;
  duplicates: number;
  memories: Memory[];
}

export interface SearchResult {
  memory: Memory;
  score: number;
  snippet: string;
}

export interface AiAnswer {
  answer: string;
  citations: Citation[];
  mode: "memory" | "none";
}

export interface Citation {
  index: number;
  memory_id: number;
  title: string;
}

export interface TodayStats {
  total: number;
  screenshots: number;
  links: number;
  texts: number;
  /** 全量未删除记忆数（侧栏计数用，不随筛选变化） */
  total_all?: number;
  trend: number[]; // 最近 14 天新增数量
}

export interface AppSettings {
  api_key: string;
  api_key_set?: boolean;
  base_url: string;
  model: string;
  shortcut_screenshot: string;
  shortcut_quick_note: string;
  shortcut_search?: string;
  auto_analyze: boolean;
  launch_at_login?: boolean;
  minimize_to_tray: boolean;
  close_to_tray?: boolean;
  clipboard_watch?: boolean;
  daily_review?: boolean;
  onboarding_done: boolean;
}

export interface CreateMemoryInput {
  title?: string;
  content: string;
  type: MemoryType;
  source?: string;
  source_url?: string;
  file_path?: string;
  ocr_text?: string;
  collection_id?: number | null;
  tags?: string[];
}

/** 回收站条目 */
export interface TrashItem {
  id: number;
  title: string;
  type: MemoryType;
  deleted_at: string;
}

/** 标签及其关联记忆数 */
export interface TagInfo {
  name: string;
  count: number;
}

/** 搜索历史 */
export interface SearchHistoryItem {
  query: string;
  result_count: number;
  created_at: string;
}
