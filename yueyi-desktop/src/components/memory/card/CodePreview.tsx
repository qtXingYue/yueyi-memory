/** 代码片段预览窗 */
export default function CodePreview({ content }: { content: string }) {
  return (
    <div className="code-window mt-2.5 px-3 pb-2.5 pt-2">
      <div className="code-window-head mb-1.5">
        <span className="code-window-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="code-window-lang">CODE</span>
      </div>
      <pre className="max-h-24 overflow-hidden font-mono text-[12px] leading-relaxed">
        <code>
          {content.slice(0, 220)}
          {content.length > 220 ? " …" : ""}
        </code>
      </pre>
    </div>
  );
}
