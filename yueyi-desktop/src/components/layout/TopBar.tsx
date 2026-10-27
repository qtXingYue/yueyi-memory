import { useEffect, useState } from "react";
import {
  Search,
  PanelLeft,
  Camera,
  Zap,
  Sun,
  Moon,
  Minus,
  Square,
  Copy,
  X,
  GripHorizontal,
} from "lucide-react";
import { useApp, useAppPick } from "@/stores/app";
import { captureApi } from "@/services/api";
import { openDrawer } from "@/utils/events";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconButton } from "@/ui";

export default function TopBar() {
  const {
    page,
    setPaletteOpen,
    toggleSidebar,
    sidebarCollapsed,
    refreshAll,
    toast,
    settings,
    theme,
    toggleTheme,
  } = useAppPick(
    "page",
    "setPaletteOpen",
    "toggleSidebar",
    "sidebarCollapsed",
    "refreshAll",
    "toast",
    "settings",
    "theme",
    "toggleTheme"
  );
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const syncMax = () => {
      void invoke<boolean>("window_control", { action: "is_maximized" })
        .then(setMaximized)
        .catch(() => {});
    };
    syncMax();
    window.addEventListener("resize", syncMax);
    return () => window.removeEventListener("resize", syncMax);
  }, []);

  const handleHeaderMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a, [role='button']")) {
      return;
    }
    e.preventDefault();
    if (e.detail === 2) {
      void invoke<boolean>("window_control", { action: "toggle_maximize" })
        .then(setMaximized)
        .catch(() => {});
    } else {
      void getCurrentWindow()
        .startDragging()
        .catch(() => invoke("window_control", { action: "drag" }));
    }
  };

  const minimizeWindow = () => {
    void invoke("window_control", { action: "minimize" }).catch(() => {});
  };

  const toggleMaximizeWindow = () => {
    void invoke<boolean>("window_control", { action: "toggle_maximize" })
      .then(setMaximized)
      .catch(() => {});
  };

  const closeWindow = () => {
    void invoke("window_control", { action: "close" }).catch(() => {});
  };

  const quickScreenshot = async () => {
    try {
      const m = await captureApi.screenshot();
      openDrawer(m.id);
      await refreshAll();
    } catch (e) {
      toast("error", `截图失败: ${String(e)}`);
    }
  };

  return (
    <header
      onMouseDown={handleHeaderMouseDown}
      title="按住空白处可拖动窗口 · 双击最大化/还原"
      className="topbar-surface relative z-20 flex h-[52px] shrink-0 cursor-grab select-none items-center gap-2 pr-3 pl-2 active:cursor-grabbing"
    >
      {/* 左侧栏折叠切换 */}
      <IconButton
        label={sidebarCollapsed ? "展开导航" : "收起导航"}
        size="sm"
        variant={sidebarCollapsed ? "surface" : "ghost"}
        icon={<PanelLeft size={15} strokeWidth={1.8} />}
        onClick={toggleSidebar}
      />

      {/* 全局搜索胶囊（压缩最大宽度，为顶部留出充足的窗口拖拽区） */}
      <button
        onClick={() => setPaletteOpen(true)}
        title={`快速搜索 / 命令面板 (${settings?.shortcut_search || "Ctrl+K"})`}
        className="topbar-search group flex h-9 w-full max-w-[320px] cursor-pointer items-center gap-2.5 px-3 text-left transition-all duration-200"
      >
        <Search size={13.5} className="text-ink-faint transition-colors group-hover:text-accent" />
        <span className="flex-1 truncate text-[12px] text-ink-faint transition-colors group-hover:text-ink-dim">
          搜索记忆或向 AI 提问…
        </span>
        <kbd className="rounded bg-base-panel2 px-1.5 py-0.5 font-mono text-[12px] text-ink-faint">
          {settings?.shortcut_search || "Ctrl+K"}
        </kbd>
      </button>

      {/* 中间窗口拖拽手柄区（直观提示可按住拖动） */}
      <div className="flex h-full flex-1 items-center justify-center">
        <div className="pointer-events-none flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] text-ink-faint">
          <GripHorizontal size={13} />
          <span className="hidden lg:inline">按住顶栏拖动窗口</span>
        </div>
      </div>

      {/* 极简快捷动作 */}
      <div className="hidden items-center gap-1 sm:flex">
        <button
          onClick={() => void quickScreenshot()}
          title={`全屏截屏 (${settings?.shortcut_screenshot || "Alt+Shift+S"})`}
          className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[12px] text-ink-dim transition-colors hover:bg-base-panel/80 hover:text-ink"
        >
          <Camera size={13} />
          <span>截屏</span>
        </button>
        <button
          onClick={() => void captureApi.openQuickNote()}
          title={`悬浮速记 (${settings?.shortcut_quick_note || "Alt+Shift+M"})`}
          className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[12px] text-ink-dim transition-colors hover:bg-base-panel/80 hover:text-ink"
        >
          <Zap size={13} />
          <span>速记</span>
        </button>
      </div>

      {/* 主题切换 */}
      <button
        onClick={toggleTheme}
        title={theme === "pearl" ? "切换至深色模式" : "切换至浅色模式"}
        className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg bg-base-panel/75 px-2.5 text-[12px] text-ink-dim transition-colors hover:bg-base-panel hover:text-ink"
      >
        {theme === "pearl" ? (
          <>
            <Sun size={12.5} />
            <span className="hidden md:inline">浅色</span>
          </>
        ) : (
          <>
            <Moon size={12.5} />
            <span className="hidden md:inline">深色</span>
          </>
        )}
      </button>


      {/* 无边框窗口控制按钮（最小化 / 最大化还原 / 关闭） */}
      <div className="ml-1 flex items-center gap-0.5">
        <IconButton
          label={settings?.minimize_to_tray !== false ? "最小化（隐藏至系统托盘）" : "最小化到任务栏"}
          size="sm"
          variant="ghost"
          icon={<Minus size={13.5} strokeWidth={1.9} />}
          onClick={minimizeWindow}
        />
        <IconButton
          label={maximized ? "向下还原" : "最大化"}
          size="sm"
          variant="ghost"
          icon={
            maximized ? (
              <Copy size={11.5} strokeWidth={1.9} className="rotate-180" />
            ) : (
              <Square size={11.5} strokeWidth={1.9} />
            )
          }
          onClick={toggleMaximizeWindow}
        />
        <IconButton
          label={settings?.close_to_tray !== false ? "关闭窗口（隐藏至托盘）" : "退出月忆"}
          size="sm"
          variant="danger"
          icon={<X size={14} strokeWidth={2} />}
          onClick={closeWindow}
        />
      </div>
    </header>
  );
}
