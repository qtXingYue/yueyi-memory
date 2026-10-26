// ============ 全局应用状态 ============

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { AppSettings, Collection, Memory, TodayStats } from "@/types";
import {
  bucketOf,
  effectiveSidebar,
  nextInsightPref,
  resolveInsight,
  resolveSidebarCollapsed,
  type InsightMode,
  type InsightPref,
  type LayoutBucket,
  type SidebarPref,
} from "@/utils/layout";
import { collectionApi, memoryApi, settingsApi } from "@/services/api";

export type PageId = "timeline" | "collections" | "search" | "review" | "settings";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

interface AppState {
  // 导航与筛选
  page: PageId;
  activeCollection: number | null;
  activeTag: string | null;
  activeType: string;
  timeRange: "all" | "today" | "week" | "month";
  setPage: (p: PageId) => void;
  setActiveCollection: (id: number | null) => void;
  setActiveTag: (tag: string | null) => void;
  setActiveType: (t: string) => void;
  setTimeRange: (r: "all" | "today" | "week" | "month") => void;

  // 布局折叠与主题（宽度档位是唯一真源，见 utils/layout.ts）
  layout: LayoutBucket;
  sidebarPref: SidebarPref;
  sidebarAuto: boolean;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  insightPref: InsightPref;
  insightMode: InsightMode;
  cycleInsight: () => void;
  applyWidth: (width: number) => void;
  theme: "pearl" | "night";
  setTheme: (t: "pearl" | "night") => void;
  toggleTheme: () => void;
  /** 界面密度：紧凑模式减少卡片/导航间距 */
  density: "comfortable" | "compact";
  setDensity: (d: "comfortable" | "compact") => void;

  // AI 问答预填问题（跨页面传递）
  pendingQuestion: string | null;
  setPendingQuestion: (q: string | null) => void;

  // 数据
  memories: Memory[];
  collections: Collection[];
  stats: TodayStats | null;
  hotTags: { name: string; count: number }[];
  recent: Memory[];
  settings: AppSettings | null;
  loading: boolean;

  // 详情抽屉
  drawerMemoryId: number | null;
  openDrawer: (id: number) => void;
  closeDrawer: () => void;

  // Command Palette
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  // UI 实验室（开发者面板，可从设置/命令面板进入）
  labOpen: boolean;
  setLabOpen: (open: boolean) => void;

  // 新建记忆编辑器
  composerOpen: boolean;
  setComposerOpen: (open: boolean) => void;

  // 区域框选全屏覆盖层（时间线内的本地状态，登记进来供 Esc 栈判序）
  regionCaptureOpen: boolean;
  setRegionCaptureOpen: (open: boolean) => void;

  // toast
  toasts: Toast[];
  toast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;

  // 首次引导
  onboardingOpen: boolean;
  finishOnboarding: () => void;

  // 操作
  refreshAll: () => Promise<void>;
  patchMemory: (id: number) => Promise<void>;
}


/** 按字段订阅 store：避免 toast/浮层变化触发整页重渲染 */
export function useAppPick<K extends keyof AppState>(...keys: K[]): Pick<AppState, K> {
  return useApp(
    useShallow((s) => Object.fromEntries(keys.map((k) => [k, s[k]])) as Pick<AppState, K>)
  );
}

let toastSeq = 1;

const savedTheme = (typeof window !== "undefined" && localStorage.getItem("yueyi-theme-v2") === "night")
  ? "night"
  : "pearl";
if (typeof document !== "undefined") {
  document.documentElement.dataset.theme = savedTheme;
}

const savedDensity: "comfortable" | "compact" =
  typeof window !== "undefined" && localStorage.getItem("yueyi-density") === "compact"
    ? "compact"
    : "comfortable";
if (typeof document !== "undefined") {
  document.documentElement.dataset.density = savedDensity;
}

const initialWidth = typeof window !== "undefined" ? window.innerWidth : 1180;
const initialLayout = bucketOf(initialWidth);
const initialSidebarAuto = resolveSidebarCollapsed(initialWidth, false);
// 侧栏折叠偏好持久化：手动收起/展开后重启保持不变
const SIDEBAR_KEY = "yueyi-sidebar-pref";
const savedSidebarPref: SidebarPref = (() => {
  try {
    const v = localStorage.getItem(SIDEBAR_KEY);
    return v === "expanded" || v === "collapsed" ? v : "auto";
  } catch {
    return "auto";
  }
})();
const initialSidebarCollapsed = effectiveSidebar(savedSidebarPref, initialSidebarAuto);

export const useApp = create<AppState>((set, get) => ({
  page: "timeline",
  activeCollection: null,
  activeTag: null,
  activeType: "all",
  timeRange: "all",
  setPage: (page) => {
    if (page === "timeline" && get().activeCollection !== null) {
      set({ page, activeCollection: null, activeTag: null });
      void get().refreshAll();
    } else {
      set({ page });
    }
  },
  setActiveCollection: (id) => {
    set({ activeCollection: id, page: "timeline" });
    void get().refreshAll();
  },
  setActiveTag: (tag) => {
    set({ activeTag: tag, page: "timeline" });
  },
  setActiveType: (t) => {
    set({ activeType: t });
  },
  setTimeRange: (r) => {
    set({ timeRange: r });
    void get().refreshAll();
  },

  layout: initialLayout,
  sidebarPref: savedSidebarPref,
  sidebarAuto: initialSidebarAuto,
  sidebarCollapsed: initialSidebarCollapsed,
  toggleSidebar: () => {
    const collapsed = !get().sidebarCollapsed;
    const sidebarPref: SidebarPref = collapsed ? "collapsed" : "expanded";
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebarPref);
    } catch {
      /* ignore */
    }
    set({ sidebarPref, sidebarCollapsed: collapsed });
  },
  insightPref: "auto",
  insightMode: resolveInsight("auto", initialLayout),
  cycleInsight: () =>
    set((s) => {
      const insightPref = nextInsightPref(s.insightPref);
      return { insightPref, insightMode: resolveInsight(insightPref, s.layout) };
    }),
  applyWidth: (width) =>
    set((s) => {
      const layout = bucketOf(width);
      const sidebarAuto = resolveSidebarCollapsed(width, s.sidebarAuto);
      if (layout === s.layout && sidebarAuto === s.sidebarAuto) return {};
      return {
        layout,
        sidebarAuto,
        sidebarCollapsed: effectiveSidebar(s.sidebarPref, sidebarAuto),
        insightMode: resolveInsight(s.insightPref, layout),
      };
    }),
  theme: savedTheme,
  density: savedDensity,
  setDensity: (next) => {
    try {
      localStorage.setItem("yueyi-density", next);
    } catch {
      /* ignore */
    }
    if (typeof document !== "undefined") {
      document.documentElement.dataset.density = next;
    }
    set({ density: next });
  },
  setTheme: (next) => {
    try {
      localStorage.setItem("yueyi-theme-v2", next);
    } catch {
      /* ignore */
    }
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = next;
    }
    set({ theme: next });
  },
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === "pearl" ? "night" : "pearl";
      try {
        localStorage.setItem("yueyi-theme-v2", next);
      } catch {
        /* ignore */
      }
      if (typeof document !== "undefined") {
        document.documentElement.dataset.theme = next;
      }
      return { theme: next };
    }),

  pendingQuestion: null,
  setPendingQuestion: (q) => set({ pendingQuestion: q }),

  memories: [],
  collections: [],
  stats: null,
  hotTags: [],
  recent: [],
  settings: null,
  loading: false,

  drawerMemoryId: null,
  openDrawer: (id) => set({ drawerMemoryId: id }),
  closeDrawer: () => set({ drawerMemoryId: null }),

  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  labOpen: typeof window !== "undefined" && window.location.search.includes("lab=1"),
  setLabOpen: (open) => set({ labOpen: open }),

  composerOpen: false,
  setComposerOpen: (composerOpen) => set({ composerOpen }),

  regionCaptureOpen: false,
  setRegionCaptureOpen: (regionCaptureOpen) => set({ regionCaptureOpen }),

  toasts: [],
  toast: (kind, text) => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    // 错误信息需要更长时间阅读，成功/提示保持轻快
    setTimeout(() => get().dismissToast(id), kind === "error" ? 6500 : 3600);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  onboardingOpen: false,
  finishOnboarding: () => set({ onboardingOpen: false }),

  patchMemory: async (id) => {
    if (id <= 0) return;
    try {
      const m = await memoryApi.get(id);
      if (!m) return;
      set((s) => ({
        memories: s.memories.map((x) => (x.id === m.id ? m : x)),
        recent: s.recent.map((x) => (x.id === m.id ? m : x)),
      }));
    } catch {
      /* 单条刷新失败不阻塞 UI，下次全量刷新兜底 */
    }
  },
  refreshAll: async () => {
    set({ loading: true });
    try {
      const state = get();
      const [memories, collections, stats] = await Promise.all([
        memoryApi.list(state.timeRange, state.activeCollection),
        collectionApi.list(),
        memoryApi.stats().catch(() => null),
      ]);
      // 热门标签：从真实记忆计算
      const tagCount = new Map<string, number>();
      for (const m of memories) for (const t of m.tags) {
        tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
      }
      const hotTags = [...tagCount.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      const recent = memories.slice(0, 5);
      set({ memories, collections, stats, hotTags, recent, loading: false });
    } catch (e) {
      set({ loading: false });
      get().toast("error", `数据加载失败: ${String(e)}`);
    }
  },
}));

// 初始化：读取设置 + 判断是否首次引导
export async function initStore() {
  try {
    const settings = await settingsApi.get();
    useApp.setState({ settings });
    if (!settings.onboarding_done) {
      useApp.setState({ onboardingOpen: true });
    }
  } catch {
    /* 设置读取失败不阻塞 */
  }
  await useApp.getState().refreshAll();
}
