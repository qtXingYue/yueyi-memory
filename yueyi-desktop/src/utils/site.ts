/** 从 URL / 主机名提取站点信息，并为站点生成稳定的头像色（按域名哈希，无需联网抓 favicon）。 */

import type { Memory } from "@/types";

export function extractHost(url: string): string {
  if (!url) return "";
  try {
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.replace(/^www\./i, "");
  } catch {
    return url.slice(0, 30);
  }
}

/** 常见站点的友好名称（未命中则使用主域名首段）。 */
const SITE_NAMES: Record<string, string> = {
  "bilibili.com": "哔哩哔哩",
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "github.com": "GitHub",
  "zhihu.com": "知乎",
  "weibo.com": "微博",
  "juejin.cn": "稀土掘金",
  "csdn.net": "CSDN",
  "baidu.com": "百度",
  "google.com": "Google",
  "twitter.com": "Twitter",
  "x.com": "X",
  "xiaohongshu.com": "小红书",
  "douyin.com": "抖音",
  "mp.weixin.qq.com": "微信公众号",
};

export function siteName(host: string): string {
  if (!host) return "";
  for (const key of Object.keys(SITE_NAMES)) {
    if (host === key || host.endsWith(`.${key}`)) return SITE_NAMES[key];
  }
  const parts = host.split(".");
  return parts.length >= 2 ? parts[parts.length - 2] : host;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 站点头像：首字母 + 稳定色相（低饱和，亮/暗主题均协调）。 */
export function siteAvatar(host: string): { letter: string; bg: string; fg: string } {
  const name = siteName(host) || host || "?";
  const letter = (name.match(/[\\u4e00-\\u9fa5A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();
  const hue = hashCode(host) % 360;
  return {
    letter,
    bg: `hsl(${hue} 70% 55% / 0.14)`,
    fg: `hsl(${hue} 55% 42%)`,
  };
}

/**
 * \u8bb0\u5fc6\u7684\u53ef\u8df3\u8f6c\u6765\u6e90\u94fe\u63a5\u3002\u53ea\u8ba4\u663e\u5f0f\u767b\u8bb0\u7684\u6765\u6e90\uff1a`source_url`\uff0c\u6216\u94fe\u63a5\u578b\u8bb0\u5fc6\u7684\u6b63\u6587\u672c\u8eab\u3002
 * \u4e0d\u626b\u63cf\u7b14\u8bb0/\u6458\u8981\u91cc\u7684\u4efb\u610f URL \u2014\u2014 \u7b14\u8bb0\u63d0\u5230\u67d0\u4e2a\u5730\u5740\u4e0d\u8be5\u8ba9\u5b83\u53d8\u6210\u300c\u6253\u5f00\u6d4f\u89c8\u5668\u300d\u6309\u94ae\u3002
 */
export function memoryLinkUrl(memory: Memory): string {
  const explicit = memory.source_url?.trim();
  if (explicit) return explicit;
  if (memory.type === "link") return memory.content?.trim() ?? "";
  return "";
}
