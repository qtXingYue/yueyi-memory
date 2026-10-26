import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface SegmentedOption<T extends string = string> {
  id?: T;
  key?: T;
  label: ReactNode;
}

interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (id: T) => void;
  size?: "sm" | "md";
}

/**
 * 分段控件：带滑动指示器（transform 过渡，而非各按钮独立换底色）。
 * 指示器位置由实际按钮的 offsetLeft / offsetWidth 测得，字体或语言变化时依然精准。
 */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: SegmentedProps<T>) {
  const boxRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);

  const measure = useCallback(() => {
    const el = refs.current[value];
    if (el) setThumb({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value]);

  useLayoutEffect(measure, [measure, options]);

  // 窗口缩放后重新测量，否则滑块会停在旧位置
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div ref={boxRef} className={`seg ${size === "sm" ? "text-[12px] p-0.5" : ""}`} role="tablist">
      {thumb && (
        <span
          className="seg-thumb"
          style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }}
        />
      )}
      {options.map((o) => {
        const itemKey = (o.id ?? o.key) as T;
        return (
          <button
            key={itemKey}
            ref={(el) => {
              refs.current[itemKey] = el;
            }}
            type="button"
            role="tab"
            aria-selected={value === itemKey}
            data-active={value === itemKey}
            onClick={() => onChange(itemKey)}
            className={`seg-item ${size === "sm" ? "py-1 px-2.5 text-[12px]" : ""}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
