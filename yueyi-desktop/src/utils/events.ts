export type OpenDrawerDetail = { id: number };

/** 捕获来源的中文标签（卡片与详情抽屉共用） */
export function sourceLabel(src: string): string {
  switch (src) {
    case "screenshot":
      return "全屏截图";
    case "window_screenshot":
      return "窗口截图";
    case "region_screenshot":
      return "区域截图";
    case "clipboard":
      return "剪贴板";
    case "quick_note":
      return "悬浮速记";
    case "manual":
      return "手动记录";
    default:
      return src || "手动记录";
  }
}

/** 打开记忆详情抽屉（跨组件通信） */
export function openDrawer(id: number) {
  window.dispatchEvent(new CustomEvent<OpenDrawerDetail>("open-drawer", { detail: { id } }));
}

/** 订阅打开抽屉事件，返回取消函数 */
export function onOpenDrawer(cb: (id: number) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<OpenDrawerDetail>).detail.id);
  window.addEventListener("open-drawer", handler);
  return () => window.removeEventListener("open-drawer", handler);
}

/** 时间格式化 */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return fmtDateTime(iso);
}

/** 按天分组记忆 */
export function groupByDay<T extends { created_at: string }>(items: T[]): { day: string; items: T[] }[] {
  const groups: { day: string; items: T[] }[] = [];
  const map = new Map<string, T[]>();
  for (const it of items) {
    const key = new Date(it.created_at).toDateString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(it);
  }
  for (const [key, list] of map) {
    groups.push({ day: key, items: list });
  }
  return groups;
}

export function dayLabel(dayKey: string): string {
  const d = new Date(dayKey);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "今天";
  if (d.toDateString() === yesterday.toDateString()) return "昨天";
  return d.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
}

/**
 * 将本地文件路径转换为 Tauri v2 自定义协议 URL。
 * Windows WebView2 下自定义协议通过 http://yueyi-img.localhost/<encoded> 访问；
 * macOS / Linux 下通过 yueyi-img://localhost/<encoded> 访问。
 */
export function localImageUrl(filePath: string): string {
  if (!filePath) return "";
  const encoded = encodeURIComponent(filePath);
  if (typeof window !== "undefined" && window.location.hostname.endsWith(".localhost")) {
    return `${window.location.protocol}//yueyi-img.localhost/${encoded}`;
  }
  return `yueyi-img://localhost/${encoded}`;
}

/** 卡片缩略图 URL：协议侧按 ?thumb=1 生成 640px 版本 */
export function localThumbUrl(filePath: string): string {
  const base = localImageUrl(filePath);
  if (!base) return "";
  return `${base}${base.includes("?") ? "&" : "?"}thumb=1`;
}

/** 防抖状态：同一 URL 800ms 内只触发一次打开（连点 / 事件重复绑定保护） */
let __lastOpenUrl = "";
let __lastOpenAt = 0;

/** 在系统默认浏览器中打开外部链接（支持从截图记忆一键跳转回原视频/网页） */
export async function openExternalUrl(url: string): Promise<void> {
  let u = (url || "").trim();
  if (!u) return;

  // 自动补齐 scheme 前缀，避免缺少协议导致无法被系统解析
  if (!/^https?:\/\//i.test(u)) {
    u = `https://${u}`;
  }

  const now = Date.now();
  if (u === __lastOpenUrl && now - __lastOpenAt < 800) return;
  __lastOpenUrl = u;
  __lastOpenAt = now;

  // 日志上报改为 fire-and-forget，绝不阻塞打开链接的主流程
  void (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("ui_report", {
        info: `[openExternalUrl] invoking open_external_url: ${u.split(/[?#]/)[0]}`,
      });
    } catch {
      /* 日志失败无所谓 */
    }
  })();

  // 1. 后端统一命令（Rust 侧用 tauri-plugin-opener 打开，走默认浏览器）
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_external_url", { url: u });
    return;
  } catch (err) {
    console.warn("[openExternalUrl] invoke open_external_url error:", err);
  }

  // 2. 备用尝试 @tauri-apps/plugin-opener 原生打开
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(u);
    return;
  } catch (err) {
    console.warn("[openExternalUrl] plugin-opener error:", err);
  }

  // 3. 浏览器环境兜底
  try {
    window.open(u, "_blank", "noopener,noreferrer");
  } catch (err) {
    console.error("[openExternalUrl] failed to open URL:", err);
  }
}


