import { useEffect, useLayoutEffect, useRef } from "react";
import { useApp } from "@/stores/app";

/**
 * 浮层 Esc 栈：一次 Esc 只关最上面那一层。
 * 之前命令面板在全局监听 Esc，抽屉开着时按 Esc 会把它和抽屉一起关掉。
 * 优先级从高到低：区域框选 > 命令面板 > 新建编辑器 > 详情抽屉 > 首次引导。
 */
export type OverlayId = "region" | "palette" | "composer" | "drawer" | "onboarding";

const PRIORITY: OverlayId[] = ["region", "palette", "composer", "drawer", "onboarding"];

export function topmostOverlay(state: {
  regionCaptureOpen: boolean;
  paletteOpen: boolean;
  composerOpen: boolean;
  drawerMemoryId: number | null;
  onboardingOpen: boolean;
}): OverlayId | null {
  const open: Record<OverlayId, boolean> = {
    region: state.regionCaptureOpen,
    palette: state.paletteOpen,
    composer: state.composerOpen,
    drawer: state.drawerMemoryId != null,
    onboarding: state.onboardingOpen,
  };
  return PRIORITY.find((id) => open[id]) ?? null;
}

/** 仅当自己是最上层浮层时才响应 Esc。handler 需要是稳定引用（useCallback 包一下）。 */
export function useOverlayEscape(id: OverlayId, handler: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (topmostOverlay(useApp.getState()) !== id) return;
      e.preventDefault();
      e.stopPropagation();
      handler();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [id, handler]);
}

/**
 * 浮层焦点管理：把 Tab 圈在浮层内，焦点逃出时拉回，关闭后还给打开它的元素。
 *
 * 监听挂在 document 而不是浮层内部 —— 只监听容器时，一旦焦点被别的东西抢走
 * （点了背景遮罩、toast 按钮抢焦点），陷阱就彻底失效了。
 * 用 layout effect 而不是 rAF：月忆会最小化到托盘，页面隐藏时 rAF 根本不投递。
 */
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useFocusTrap<T extends HTMLElement>(active: boolean, id?: OverlayId) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!active || !root) return;

    const opener = document.activeElement as HTMLElement | null;
    const items = () =>
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0
      );

    if (!root.contains(document.activeElement)) {
      (items()[0] ?? root).focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.defaultPrevented) return;
      if (id && topmostOverlay(useApp.getState()) !== id) return;

      const list = items();
      if (!root.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? list[list.length - 1] : list[0] ?? root)?.focus();
        return;
      }
      if (list.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const now = document.activeElement;
      if (e.shiftKey && (now === first || now === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && now === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      opener?.focus?.();
    };
  }, [active, id]);

  return ref;
}
