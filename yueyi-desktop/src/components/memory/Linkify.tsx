import { Fragment } from "react";
import { openExternalUrl } from "@/utils/events";

/** 与卡片 / 抽屉中提取链接的规则保持一致 */
const URL_RE = /(https?:\/\/[^\s<>"'()（）]+|www\.[^\s<>"'()（）]+)/gi;

/** 把纯文本中的网址渲染为可点击链接（点击后用系统默认浏览器打开） */
export default function Linkify({ text }: { text: string }) {
  if (!text) return null;
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void openExternalUrl(part);
            }}
            className="inline cursor-pointer break-all text-left text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
            title={`在浏览器中打开: ${part}`}
          >
            {part}
          </button>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
