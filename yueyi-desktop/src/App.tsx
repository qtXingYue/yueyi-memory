import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useApp, useAppPick, initStore } from "@/stores/app";
import { topmostOverlay } from "@/hooks/useOverlay";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import CommandPalette from "@/components/CommandPalette";
import MemoryDrawer from "@/components/memory/MemoryDrawer";
import MemoryComposer from "@/components/memory/MemoryComposer";
import Onboarding from "@/components/Onboarding";
import ToastStack from "@/components/ToastStack";
import Timeline from "@/pages/Timeline";
import { memoryApi } from "@/services/api";

const Collections = lazy(() => import("@/pages/Collections"));
const SearchQA = lazy(() => import("@/pages/SearchQA"));
const Review = lazy(() => import("@/pages/Review"));
const Settings = lazy(() => import("@/pages/Settings"));
const UiLab = lazy(() => import("@/pages/UiLab"));

function PageFallback() {
  return (
    <div className="mx-auto w-full max-w-[1040px] px-1 py-8" aria-busy="true" aria-label="页面加载中">
      <div className="skeleton mb-3 h-7 w-40" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="memory-card-surface rounded-2xl p-4">
            <div className="skeleton mb-3 h-4 w-2/3" />
            <div className="skeleton mb-2 h-3.5 w-full" />
            <div className="skeleton h-3.5 w-4/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const {
    page,
    refreshAll,
    toast,
    layout,
    applyWidth,
    labOpen,
    setLabOpen,
    settings,
    onboardingOpen,
  } = useAppPick(
    "page",
    "refreshAll",
    "toast",
    "layout",
    "applyWidth",
    "labOpen",
    "setLabOpen",
    "settings",
    "onboardingOpen"
  );
  const [keyBannerHidden, setKeyBannerHidden] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("yueyi-ai-banner") === "1"
  );
  const shellRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  // 每个页面记住自己的滚动位置，切走再回来不会跳回顶部
  const scrollPos = useRef<Record<string, number>>({});

  // 全局 Ctrl+N 新建 + Ctrl+1..5 切页（有浮层打开时不抢）
  useEffect(() => {
    const PAGES = ["timeline", "collections", "search", "review", "settings"] as const;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const st = useApp.getState();
      if (topmostOverlay(st) !== null) return;

      if (!e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        st.setComposerOpen(true);
        return;
      }
      // Ctrl+, 打开设置（通用约定）
      if (e.key === ",") {
        e.preventDefault();
        st.setPage("settings");
        return;
      }
      const idx = Number(e.key) - 1;
      if (!e.shiftKey && Number.isInteger(idx) && idx >= 0 && idx < PAGES.length) {
        e.preventDefault();
        st.setPage(PAGES[idx]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // UI 实验室快捷键：Ctrl+Shift+L
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        const st = useApp.getState();
        st.setLabOpen(!st.labOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 记录/恢复滚动位置
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onScroll = () => {
      scrollPos.current[page] = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [page]);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const top = scrollPos.current[page] ?? 0;
    requestAnimationFrame(() => {
      el.scrollTop = top;
    });
  }, [page]);

  useEffect(() => {
    void initStore();
  }, []);

  // 拖拽文件入窗：图片 / PDF / 文档 / 代码一键入库
  useEffect(() => {
    let un: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        un = await getCurrentWebviewWindow().onDragDropEvent(async (event) => {
          if (event.payload.type !== "drop") return;
          const paths = event.payload.paths ?? [];
          if (paths.length === 0) return;
          try {
            const res = await memoryApi.importFiles(paths);
            toast(
              "success",
              `已导入 ${res.imported} 个文件${res.duplicates ? `，跳过重复 ${res.duplicates}` : ""}`
            );
            await refreshAll();
          } catch (e) {
            toast("error", `导入失败：${String(e)}`);
          }
        });
      } catch {
        /* 非桌面环境 */
      }
    })();
    return () => un?.();
  }, [refreshAll, toast]);

  // 剪贴板监听（默认关闭，设置里开启）：只捕获 8~8000 字的文本，去重交给后端
  useEffect(() => {
    let last = "";
    const timer = window.setInterval(async () => {
      const st = useApp.getState();
      if (!st.settings?.clipboard_watch) return;
      try {
        const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
        const text = (await readText())?.trim() ?? "";
        if (text.length < 8 || text.length > 8000 || text === last) return;
        last = text;
        const m = await memoryApi.create({ content: text, type: "text", source: "clipboard" });
        const fresh = Date.now() - new Date(m.created_at).getTime() < 8000;
        if (fresh) {
          st.toast("info", "已从剪贴板捕获一条记忆");
          await st.refreshAll();
        }
      } catch {
        /* 剪贴板为空或无权限 */
      }
    }, 1600);
    return () => window.clearInterval(timer);
  }, []);

  /*
   * 宽度真源：实测 app-shell 而不是读 innerWidth。
   * ResizeObserver 在页面被隐藏时不会投递回调（月忆会最小化到托盘），
   * 单靠它会在窗口恢复后留下旧档位，所以再挂 resize 与 visibilitychange 兜底。
   */
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const sync = () => applyWidth(el.offsetWidth);
    sync();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    window.addEventListener("resize", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [applyWidth]);

  // Rust 后台 AI 任务完成 / 托盘事件 / 全局快捷键状态 → 推送刷新
  useEffect(() => {
    let un1: (() => void) | undefined;
    let un2: (() => void) | undefined;
    let un3: (() => void) | undefined;
    let un4: (() => void) | undefined;
    let un5: (() => void) | undefined;
    let un6: (() => void) | undefined;
    void (async () => {
      try {
        un1 = await listen<{ id: number; reason: string; title?: string }>(
          "memory-updated",
          (e) => {
            // AI 完成只更新对应卡片；新增/清空等结构性变化才全量刷新
            if (
              (e.payload.reason === "ai-done" ||
                e.payload.reason === "ai-failed" ||
                e.payload.reason === "ai-stale") &&
              e.payload.id > 0
            ) {
              void useApp.getState().patchMemory(e.payload.id);
            } else {
              void refreshAll();
            }
            if (e.payload.reason === "ai-done" && e.payload.title) {
              toast("success", `记忆整理完成：「${e.payload.title}」`);
            } else if (e.payload.reason === "ai-failed") {
              toast("error", "AI 整理失败（保留原有内容，稍后将自动重试）");
            } else if (e.payload.reason === "captured") {
              toast("info", "已捕获一条新记忆，正在进行 AI 整理…");
            } else if (e.payload.reason === "deleted") {
              toast("info", "数据已清空");
            }
          }
        );
        // 热键截图后自动打开详情抽屉
        un2 = await listen<number>("open-drawer-payload", (e) => {
          useApp.getState().openDrawer(e.payload);
        });
        un3 = await listen<string>("capture-error", (e) => {
          toast("error", `捕获失败：${e.payload}`);
        });
        un4 = await listen<"search" | "settings">("tray-navigate", (e) => {
          useApp.getState().setPage(e.payload);
        });
        // P0-4：全局快捷键冲突/失败明确提示用户
        un5 = await listen<string>("shortcut-error", (e) => {
          toast("error", e.payload);
        });
        // P0-6：第 3 个全局快捷键唤起全局快速搜索面板
        un6 = await listen("open-global-search", () => {
          useApp.getState().setPaletteOpen(true);
        });
      } catch {
        /* 非桌面环境 */
      }
    })();
    return () => {
      un1?.();
      un2?.();
      un3?.();
      un4?.();
      un5?.();
      un6?.();
    };
  }, [refreshAll, toast]);

  if (labOpen) {
    return (
      <Suspense fallback={<PageFallback />}>
        <UiLab onClose={() => setLabOpen(false)} />
      </Suspense>
    );
  }

  return (
    <div ref={shellRef} data-layout={layout} className="app-shell flex h-full">
      {/* 左侧无框沉浸导航栏 */}
      <Sidebar />

      {/* 右侧主区域：无框顶栏 + 一体化悬浮圆角工作画布 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {!onboardingOpen && settings && !settings.api_key_set && !keyBannerHidden && (
          <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-base-border bg-base-panel2 px-3 py-2 text-[12px] text-ink-dim">
            <span className="min-w-0 flex-1">
              还没配置 AI Key：截图和文本会照常保存，但不会自动生成标题/摘要/标签。
            </span>
            <button
              type="button"
              className="btn-primary px-2.5 py-1 text-[12px]"
              onClick={() => useApp.getState().setPage("settings")}
            >
              去配置
            </button>
            <button
              type="button"
              className="btn-outline px-2.5 py-1 text-[12px]"
              onClick={() => {
                localStorage.setItem("yueyi-ai-banner", "1");
                setKeyBannerHidden(true);
              }}
            >
              先用本地模式
            </button>
          </div>
        )}
        <div className="workspace-sheet mb-2.5 mr-2.5 flex min-h-0 flex-1 overflow-hidden rounded-2xl">
          <main
            ref={mainRef}
            aria-label="主内容"
            className="relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
          >
            <div key={page} className="animate-page-enter min-h-full">
              {page === "timeline" ? (
                <Timeline />
              ) : (
                <Suspense fallback={<PageFallback />}>
                  {page === "collections" && <Collections />}
                  {page === "search" && <SearchQA />}
                  {page === "review" && <Review />}
                  {page === "settings" && <Settings />}
                </Suspense>
              )}
            </div>
          </main>
        </div>
      </div>

      {/* 全局浮层 */}
      <CommandPalette />
      <MemoryDrawer />
      <MemoryComposer />
      <Onboarding />
      <ToastStack />
    </div>
  );
}
