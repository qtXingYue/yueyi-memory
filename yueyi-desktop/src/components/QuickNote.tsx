// 悬浮速记条 —— Alt+Shift+M 唤起，类似 Spotlight / Raycast
import { useEffect, useState, useRef } from "react";
import { Camera, Sparkles, Check, CornerDownLeft } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

const DRAFT_KEY = "yueyi-quick-note-draft";
const THEME_KEY = "yueyi-theme-v2";

/** 独立窗口不经过 App 的主题初始化——手动同步主窗口的主题选择。
 *  localStorage 跨窗口共享，storage 事件会在主窗口切换主题时广播过来，
 *  速记条实时跟随明暗切换。 */
function syncTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY) === "night" ? "night" : "pearl";
    document.documentElement.dataset.theme = t;
  } catch {
    /* ignore */
  }
}

export default function QuickNote() {
  const [mode, setMode] = useState<"text" | "screenshot">("text");
  const [text, setText] = useState<string>(() => {
    try {
      return localStorage.getItem(DRAFT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // 实时持久化未发送的草稿，失焦收起后再次唤起不丢失
  useEffect(() => {
    try {
      if (text) {
        localStorage.setItem(DRAFT_KEY, text);
      } else {
        localStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      /* ignore */
    }
  }, [text]);

  // 主题跟随：挂载同步 + 主窗口切换时通过 storage 事件实时跟随
  useEffect(() => {
    syncTheme();
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) syncTheme();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // 渲染完成通知：透明窗口在内容就绪前完全不可见，首次创建时
  // 后端等本通知再 show（否则用户感知"闪一下没显示"）
  useEffect(() => {
    invoke("quick_note_ready").catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    const un = listen("quick-note-open", () => {
      setDone(false);
      // 重新唤起时不清空草稿，直接聚焦输入框
      setTimeout(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          const len = el.value.length;
          el.setSelectionRange(len, len);
        }
      }, 60);
    });
    return () => {
      clearTimeout(t);
      void un.then((f) => f());
    };
  }, []);

  const dismiss = async () => {
    try {
      await invoke("quick_note_dismiss");
    } catch {
      await getCurrentWindow().hide();
    }
  };

  // 拖动：按住顶部热区即可拖动窗口（不干扰输入框/按钮）
  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    void getCurrentWindow().startDragging();
  };

  const clearDraft = () => {
    setText("");
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  };

  const save = async () => {
    if (saving) return;
    if (mode === "text" && !text.trim()) return;
    setSaving(true);
    setError("");
    try {
      // 截屏模式统一走 quick_note_save，后端先隐藏速记条并等待动画消退再截屏
      await invoke("quick_note_save", { text: text.trim(), mode });
      clearDraft();
      setDone(true);
      if (mode !== "screenshot") {
        setTimeout(() => void dismiss(), 620);
      }
    } catch (e) {
      setError(`${mode === "screenshot" ? "截图" : "保存"}失败：${e}`);
      window.setTimeout(() => setError(""), 5000);
    }
    setSaving(false);
  };

  return (
    <div className={`qn-root ${done ? "qn-done" : ""}`}>
      <div className="qn-wrap">
        {/* 拖动热区：按住顶边即可拖动窗口 */}
        <div className="qn-drag" onMouseDown={onDragStart} />

        <div className="qn-main">
          {/* 状态徽标：待机用应用图标，保存中转圈，完成打勾 */}
          <div
            className={`qn-badge ${done ? "qn-badge-done" : ""} ${
              saving ? "qn-badge-saving" : ""
            }`}
          >
            {done ? (
              <Check size={18} strokeWidth={2.6} className="qn-check text-success" />
            ) : saving ? (
              <Sparkles size={16} className="animate-spin text-accent" />
            ) : (
              <img src="/app-icon.png" alt="月忆" className="h-7 w-7 rounded-[8px]" />
            )}
          </div>

          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") void dismiss();
              if (e.key === "Tab") {
                e.preventDefault();
                setMode((m) => (m === "text" ? "screenshot" : "text"));
              }
            }}
            placeholder={
              done
                ? "已保存"
                : mode === "screenshot"
                  ? "按 Enter 立即截屏…"
                  : "说点什么，或直接截屏…"
            }
            className="qn-input"
            spellCheck={false}
          />

          {/* 模式切换：一枚紧凑胶囊，不再和保存按钮抢视觉 */}
          <div className="qn-modes" role="tablist" aria-label="速记模式">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "text"}
              data-active={mode === "text"}
              onClick={() => setMode("text")}
              className="qn-mode"
            >
              文本
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "screenshot"}
              data-active={mode === "screenshot"}
              onClick={() => setMode("screenshot")}
              className="qn-mode"
            >
              <Camera size={11} /> 截屏
            </button>
          </div>

          <button onClick={() => void save()} className="qn-save" disabled={saving}>
            {done ? "已保存" : saving ? "保存中" : "保存"}
            <CornerDownLeft size={11} strokeWidth={2.4} className="opacity-80" />
          </button>
        </div>

        {/* 底部提示：默认快捷键，出错时就地显示错误 */}
        <div className="qn-hint">
          <span className={error ? "text-danger" : ""}>
            {error || "Esc 取消 · Tab 切换模式"}
          </span>
          <span className="qn-hint-key">Enter 保存</span>
        </div>
      </div>
    </div>
  );
}
