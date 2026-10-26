/**
 * 布局宽度的唯一真源。
 *
 * 之前有三套互不知晓的判断：概览栏用 CSS `hidden lg:flex`（视口 ≥1024）、
 * 侧栏用 JS `innerWidth` 980/1120、窗口本身默认 1180 / 最小 960 —— 在 1024~1120
 * 这段会同时给出「完整侧栏 + 完整概览栏」，把按 860px 设计的卡片列挤到约 530px。
 * 现在统一按 app-shell 实测宽度分档，侧栏与概览栏都从同一档位取值。
 */

export type LayoutBucket = "xs" | "sm" | "md" | "lg";
export type InsightMode = "hidden" | "rail" | "full";
export type InsightPref = InsightMode | "auto";

const RANK: Record<InsightMode, number> = { hidden: 0, rail: 1, full: 2 };
const MODE_BY_RANK: Record<number, InsightMode> = { 0: "hidden", 1: "rail", 2: "full" };

export function bucketOf(width: number): LayoutBucket {
  if (width < 980) return "xs";
  if (width < 1180) return "sm";
  if (width < 1400) return "md";
  return "lg";
}

/**
 * 侧栏折叠带滞回：<980 收起，≥1040 才放开，中间保持原状，
 * 否则拖动窗口边缘时侧栏会在阈值上反复跳变。
 */
export function resolveSidebarCollapsed(width: number, current: boolean): boolean {
  if (width < 980) return true;
  if (width >= 1040) return false;
  return current;
}

/** 该档位下概览栏最多能给到多宽，再高的用户偏好会被夹下来。 */
export function insightCeiling(bucket: LayoutBucket): InsightMode {
  if (bucket === "xs") return "hidden";
  if (bucket === "sm") return "rail";
  return "full";
}

/** 用户没手动干预时该档位采用的概览栏形态。 */
export function insightDefault(bucket: LayoutBucket): InsightMode {
  // 玻璃版：中等宽度优先保证内容留白，概览栏只在 lg 默认展开
  if (bucket === "lg") return "full";
  return "hidden";
}

export function resolveInsight(pref: InsightPref, bucket: LayoutBucket): InsightMode {
  const wanted = pref === "auto" ? RANK[insightDefault(bucket)] : RANK[pref];
  return MODE_BY_RANK[Math.min(wanted, RANK[insightCeiling(bucket)])];
}

const PREF_CYCLE: InsightPref[] = ["auto", "full", "rail", "hidden"];

export function nextInsightPref(pref: InsightPref): InsightPref {
  return PREF_CYCLE[(PREF_CYCLE.indexOf(pref) + 1) % PREF_CYCLE.length];
}

export const INSIGHT_PREF_LABEL: Record<InsightPref, string> = {
  auto: "自动",
  full: "完整",
  rail: "窄栏",
  hidden: "隐藏",
};

export const INSIGHT_MODE_LABEL: Record<InsightMode, string> = {
  hidden: "隐藏",
  rail: "窄栏",
  full: "完整",
};

/** 侧栏偏好：auto 跟随窗口宽度，其余为用户手动钉住的状态。 */
export type SidebarPref = "auto" | "expanded" | "collapsed";

export function effectiveSidebar(pref: SidebarPref, auto: boolean): boolean {
  return pref === "auto" ? auto : pref === "collapsed";
}
