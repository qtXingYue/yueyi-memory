import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Crop, RotateCcw, X } from "lucide-react";
import { useApp } from "@/stores/app";
import { topmostOverlay } from "@/hooks/useOverlay";

export interface DragBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface RegionSession {
  previewUrl: string;
  imgWidth: number;
  imgHeight: number;
}

interface Props {
  session: RegionSession;
  committing: boolean;
  onCancel: () => void;
  onCommit: (box: DragBox | null) => void;
}

/** 区域框选遮罩：拖拽状态只在本组件内更新，不重渲卡片墙 */
export default function RegionCaptureOverlay({ session, committing, onCancel, onCommit }: Props) {
  const [dragBox, setDragBox] = useState<DragBox | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const boxRef = useRef<DragBox | null>(null);
  const dragRef = useRef(false);
  const frameRef = useRef(0);
  const pointRef = useRef({ x: 0, y: 0 });

  boxRef.current = dragBox;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (topmostOverlay(useApp.getState()) !== "region") return;
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onCommit(boxRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onCommit]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    dragRef.current = true;
    setIsDragging(true);
    const box = { x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY };
    boxRef.current = box;
    setDragBox(box);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    pointRef.current = { x: e.clientX, y: e.clientY };
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const prev = boxRef.current;
      if (!prev) return;
      const next = { ...prev, x2: pointRef.current.x, y2: pointRef.current.y };
      boxRef.current = next;
      setDragBox(next);
    });
  };

  const stopDrag = () => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    dragRef.current = false;
    setIsDragging(false);
  };

  const vw = Math.max(1, window.innerWidth);
  const vh = Math.max(1, window.innerHeight);
  const scaleX = session.imgWidth / vw;
  const scaleY = session.imgHeight / vh;

  const hasBox =
    dragBox !== null &&
    Math.abs(dragBox.x2 - dragBox.x1) >= 6 &&
    Math.abs(dragBox.y2 - dragBox.y1) >= 6;
  const left = dragBox ? Math.min(dragBox.x1, dragBox.x2) : 0;
  const top = dragBox ? Math.min(dragBox.y1, dragBox.y2) : 0;
  const width = dragBox ? Math.abs(dragBox.x2 - dragBox.x1) : 0;
  const height = dragBox ? Math.abs(dragBox.y2 - dragBox.y1) : 0;
  const realW = Math.max(1, Math.round(width * scaleX));
  const realH = Math.max(1, Math.round(height * scaleY));
  const realX = Math.max(0, Math.round(left * scaleX));
  const realY = Math.max(0, Math.round(top * scaleY));
  const toolbarTop = top + height + 52 < vh ? top + height + 10 : Math.max(12, top - 46);
  const toolbarLeft = Math.min(Math.max(12, left + width - 240), Math.max(12, vw - 252));

  return createPortal(
    <div
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
      onContextMenu={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onDoubleClick={() => onCommit(boxRef.current)}
      className="fixed inset-0 z-[200] cursor-crosshair select-none overflow-hidden bg-black"
    >
      <img
        src={session.previewUrl}
        alt="屏幕快照"
        draggable={false}
        className="pointer-events-none h-full w-full object-fill"
      />

      {!hasBox && <div className="pointer-events-none absolute inset-0 bg-black/45" />}

      <div className="pointer-events-none fixed left-1/2 top-5 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black/75 px-4 py-2 text-[13px] font-medium text-white shadow-lg">
        <Crop size={14} className="text-[#60A5FA]" />
        <span>按住左键拖拽框选区域 · 双击或按 Enter 完成截取 · 右键或按 Esc 取消</span>
      </div>

      {hasBox && (
        <div
          style={{
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.52)",
          }}
          className="pointer-events-none absolute border-2 border-[#3B82F6]"
        >
          <span className="absolute -left-1.5 -top-1.5 h-2.5 w-2.5 rounded-xs bg-white ring-2 ring-[#3B82F6]" />
          <span className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-xs bg-white ring-2 ring-[#3B82F6]" />
          <span className="absolute -bottom-1.5 -left-1.5 h-2.5 w-2.5 rounded-xs bg-white ring-2 ring-[#3B82F6]" />
          <span className="absolute -bottom-1.5 -right-1.5 h-2.5 w-2.5 rounded-xs bg-white ring-2 ring-[#3B82F6]" />

          <div
            className="absolute left-0 flex items-center gap-2 whitespace-nowrap rounded-md bg-black/80 px-2.5 py-1 font-mono text-[12px] text-white shadow-md"
            style={{ top: top > 32 ? "-28px" : "6px" }}
          >
            <span className="font-semibold text-[#60A5FA]">
              {realW} × {realH} px
            </span>
            <span className="text-white/60">
              ({realX}, {realY})
            </span>
          </div>
        </div>
      )}

      {hasBox && !isDragging && (
        <div
          style={{ left: `${toolbarLeft}px`, top: `${toolbarTop}px` }}
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed z-30 flex items-center gap-1.5 rounded-xl bg-[#141720]/95 p-1.5 text-white shadow-2xl ring-1 ring-white/15"
        >
          <button
            type="button"
            onClick={() => {
              setDragBox(null);
              boxRef.current = null;
            }}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <RotateCcw size={13} />
            <span>重选</span>
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={13.5} />
            <span>取消</span>
          </button>
          <button
            type="button"
            disabled={committing}
            onClick={() => onCommit(boxRef.current)}
            className="flex items-center gap-1 rounded-lg bg-[#2563EB] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            <Check size={13.5} />
            <span>完成截图</span>
          </button>
        </div>
      )}
    </div>,
    document.body
  );
}
