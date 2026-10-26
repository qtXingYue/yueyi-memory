/**
 * 轻量 Markdown 渲染（无第三方依赖）
 * 仅覆盖 AI 回答常用语法：标题、列表、引用、代码块、粗体/斜体/行内代码/链接，
 * 以及月忆的 [数字] 引用角标。刻意不做完整 CommonMark，避免引入解析器依赖。
 */
import { Fragment, type ReactNode } from "react";
import { openExternalUrl } from "@/utils/events";

interface MarkdownProps {
  text: string;
  /** 命中 [n] 引用角标时由调用方渲染（返回 null 则按普通文本显示） */
  renderCitation?: (index: number) => ReactNode | null;
}

const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\)|\[\d+\])/g;

function renderInline(text: string, renderCitation?: (i: number) => ReactNode | null): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const token = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push(<Fragment key={key++}>{text.slice(last, at)}</Fragment>);

    if (token.startsWith("**")) {
      out.push(
        <strong key={key++} className="font-semibold text-ink">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("`")) {
      out.push(
        <code
          key={key++}
          className="rounded bg-base-panel2 px-1.5 py-0.5 font-mono text-[0.92em] text-ink"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("*")) {
      out.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    } else if (/^\[\d+\]$/.test(token)) {
      const idx = Number(token.slice(1, -1));
      const rendered = renderCitation?.(idx) ?? null;
      out.push(
        <Fragment key={key++}>{rendered ?? <span>{token}</span>}</Fragment>
      );
    } else {
      // [文本](链接)
      const link = token.match(/^\[([^\]\n]+)\]\(([^)\n]+)\)$/);
      if (link) {
        out.push(
          <button
            key={key++}
            type="button"
            onClick={() => void openExternalUrl(link[2])}
            className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            {link[1]}
          </button>
        );
      } else {
        out.push(<Fragment key={key++}>{token}</Fragment>);
      }
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return out;
}

/** 引用角标由调用方决定是否渲染为按钮，这里只做占位替换 */
export default function Markdown({ text, renderCitation }: MarkdownProps) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const inline = (s: string) => renderInline(s, renderCitation);

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (line.trimStart().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      i++; // 跳过结束围栏
      blocks.push(
        <pre
          key={key++}
          className="code-window my-2 overflow-x-auto p-3 font-mono text-[12px] leading-relaxed"
        >
          <code>{body.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // 空行
    if (!line.trim()) {
      i++;
      continue;
    }

    // 标题
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const size = level <= 2 ? "text-[15px]" : "text-[14px]";
      blocks.push(
        <div key={key++} className={`mb-1.5 mt-3 font-semibold text-ink ${size}`}>
          {inline(heading[2])}
        </div>
      );
      i++;
      continue;
    }

    // 分隔线
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push(<hr key={key++} className="my-3 border-0 border-t border-base-border/70" />);
      i++;
      continue;
    }

    // 引用
    if (line.trimStart().startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="my-2 border-l-2 border-accent/35 bg-base-panel2/60 py-1.5 pl-3 pr-2 text-ink-dim"
        >
          {inline(body.join(" "))}
        </blockquote>
      );
      continue;
    }

    // 列表（有序 / 无序）
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const items: string[] = [];
      while (i < lines.length) {
        const b = lines[i].match(/^\s*[-*+]\s+(.*)$/);
        const o = lines[i].match(/^\s*\d+[.)]\s+(.*)$/);
        if (isOrdered ? !o : !b) break;
        items.push((isOrdered ? o![1] : b![1]).trim());
        i++;
      }
      blocks.push(
        isOrdered ? (
          <ol key={key++} className="my-1.5 list-decimal space-y-1 pl-5 text-ink-dim">
            {items.map((it, n) => (
              <li key={n}>{inline(it)}</li>
            ))}
          </ol>
        ) : (
          <ul key={key++} className="my-1.5 space-y-1 pl-1 text-ink-dim">
            {items.map((it, n) => (
              <li key={n} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent/60" />
                <span className="min-w-0 flex-1">{inline(it)}</span>
              </li>
            ))}
          </ul>
        )
      );
      continue;
    }

    // 普通段落：连续的裸行合并
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !lines[i].trimStart().startsWith("```") &&
      !lines[i].trimStart().startsWith(">")
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-1.5 leading-relaxed">
        {inline(para.join(" "))}
      </p>
    );
  }

  return <div className="text-[14px] text-ink">{blocks}</div>;
}
