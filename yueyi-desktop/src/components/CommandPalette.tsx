import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Plus, Camera, ClipboardList, Clock, Layers, MessageSquareText,
  Settings2, CornerDownLeft, Sparkles, LucideIcon, FlaskConical, History,
} from "lucide-react";
import { useApp, useAppPick } from "@/stores/app";
import { memoryApi, captureApi } from "@/services/api";
import { openDrawer } from "@/utils/events";
import { useFocusTrap, useOverlayEscape } from "@/hooks/useOverlay";
import { ModalPanel, OverlayBackdrop } from "@/ui";
import type { Memory } from "@/types";

interface Action {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void | Promise<void>;
}

type Item =
  | { kind: "ask"; id: string }
  | { kind: "action"; id: string; action: Action }
  | { kind: "memory"; id: string; memory: Memory };

/** 判断键盘事件是否匹配设置里的快捷键字符串（如 Ctrl+K / Alt+Shift+S） */
function matchesShortcut(e: KeyboardEvent, combo: string): boolean {
  const parts = combo
    .toLowerCase()
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  const key = parts[parts.length - 1];
  const hasCtrl = parts.some((p) => p === "ctrl" || p === "control" || p === "cmdorctrl");
  const hasAlt = parts.includes("alt");
  const hasShift = parts.includes("shift");
  const pressed = e.key === " " ? "space" : e.key.toLowerCase();
  return (
    pressed === key &&
    e.ctrlKey === hasCtrl &&
    e.altKey === hasAlt &&
    e.shiftKey === hasShift
  );
}

export default function CommandPalette() {
  const {
    paletteOpen,
    setPaletteOpen,
    setPage,
    setComposerOpen,
    setPendingQuestion,
    toast,
    refreshAll,
    settings,
    setLabOpen,
  } = useAppPick(
    "paletteOpen",
    "setPaletteOpen",
    "setPage",
    "setComposerOpen",
    "setPendingQuestion",
    "toast",
    "refreshAll",
    "settings",
    "setLabOpen"
  );
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [results, setResults] = useState<Memory[]>([]);
  const [searching, setSearching] = useState(false);
  const [aiMode, setAiMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useFocusTrap<HTMLDivElement>(paletteOpen, "palette");

  const close = useCallback(() => setPaletteOpen(false), [setPaletteOpen]);

  // 全局唤起：跟随设置里的「全局快速搜索」快捷键（默认 Ctrl+K）
  useEffect(() => {
    const combo = settings?.shortcut_search || "Ctrl+K";
    const onKey = (e: KeyboardEvent) => {
      if (!matchesShortcut(e, combo)) return;
      e.preventDefault();
      setPaletteOpen(!useApp.getState().paletteOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen, settings?.shortcut_search]);

  useOverlayEscape("palette", close);

  useEffect(() => {
    if (!paletteOpen) return;
    setQuery("");
    setResults([]);
    setAiMode(false);
    setCursor(0);
  }, [paletteOpen]);

  // 自然语言判断 → AI 模式 + 实时检索记忆
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setAiMode(false);
      setResults([]);
      return;
    }
    const naturalLang =
      /[?？]$/.test(q) || /哪些|什么|哪份|找到|找出|之前|上次|最近看过|保存过|关于.*的|总结|为什么|如何/.test(q);
    setAiMode(naturalLang && q.length > 4);
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await memoryApi.search(q, false);
        setResults(r.slice(0, 6).map((x) => x.memory));
      } catch { /* ignore */ }
      setSearching(false);
    }, 160);
    return () => clearTimeout(t);
  }, [query]);

  const actions: Action[] = useMemo(() => [
    {
      id: "search",
      label: "搜索记忆",
      hint: "关键词 / 全文",
      icon: Search,
      run: () => {
        if (query.trim()) setPendingQuestion(query.trim());
        setPage("search");
      },
    },
    { id: "new", label: "新建记忆", icon: Plus, run: () => setComposerOpen(true) },
    {
      id: "shot",
      label: "截屏",
      hint: "Alt+Shift+S",
      icon: Camera,
      run: async () => {
        const m = await captureApi.screenshot();
        openDrawer(m.id);
        await refreshAll();
      },
    },
    {
      id: "clip",
      label: "剪贴板",
      hint: "保存剪贴板",
      icon: ClipboardList,
      run: async () => {
        const m = await captureApi.clipboardSave();
        if (m) openDrawer(m.id);
        else toast("info", "剪贴板为空");
        await refreshAll();
      },
    },
    { id: "timeline", label: "打开时间线", icon: Clock, run: () => setPage("timeline") },
    { id: "collections", label: "打开合集", icon: Layers, run: () => setPage("collections") },
    {
      id: "ask",
      label: "询问 AI",
      hint: "基于记忆问答",
      icon: MessageSquareText,
      run: () => {
        if (query.trim()) setPendingQuestion(query.trim());
        setPage("search");
      },
    },
    { id: "settings", label: "打开设置", icon: Settings2, run: () => setPage("settings") },
    {
      id: "review",
      label: "今日回顾",
      hint: "待整理 / 到期 / 周报",
      icon: History,
      run: () => setPage("review"),
    },
    {
      id: "lab",
      label: "UI 实验室",
      hint: "设计基元 / 状态总览",
      icon: FlaskConical,
      run: () => setLabOpen(true),
    },
  ], [query, setComposerOpen, setPage, setPendingQuestion, refreshAll, toast, setLabOpen]);

  const filteredActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) || (a.hint ?? "").toLowerCase().includes(q)
    );
  }, [actions, query]);

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    if (aiMode) out.push({ kind: "ask", id: "item-ask" });
    for (const action of filteredActions) out.push({ kind: "action", id: `item-a-${action.id}`, action });
    for (const memory of results) out.push({ kind: "memory", id: `item-m-${memory.id}`, memory });
    return out;
  }, [aiMode, filteredActions, results]);

  const runAiAsk = () => {
    const q = query.trim();
    if (!q) return;
    close();
    setPendingQuestion(q);
    setPage("search");
  };

  const runIndex = async (i: number) => {
    const item = items[i];
    if (!item) {
      if (query.trim()) runAiAsk();
      return;
    }
    if (item.kind === "ask") {
      runAiAsk();
      return;
    }
    close();
    if (item.kind === "action") await item.action.run();
    else openDrawer(item.memory.id);
  };

  // 键盘光标移动时把它带进可视区
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`#${items[cursor]?.id}`);
    node?.scrollIntoView({ block: "nearest" });
  }, [cursor, items]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = Math.max(items.length - 1, 0);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, last));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    }
    if (e.key === "Home") {
      e.preventDefault();
      setCursor(0);
    }
    if (e.key === "End") {
      e.preventDefault();
      setCursor(last);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void runIndex(cursor);
    }
  };

  if (!paletteOpen) return null;

  const activeId = items[cursor]?.id;

  return (
    <div
      className="fixed inset-0 z-[80] animate-fade-in"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
    >
      <OverlayBackdrop onClick={close} blur={false} />
      <ModalPanel
        ref={panelRef}
        tabIndex={-1}
        className="left-0 right-0 top-[15%] mx-auto w-[640px] max-w-[90vw] overflow-hidden rounded-xl3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 输入区 */}
        <div className="flex items-center gap-3 border-b border-base-border/70 px-5 py-4">
          {aiMode ? (
            <Sparkles size={17} className="animate-pulse-soft text-accent" />
          ) : (
            <Search size={17} className="text-ink-faint" />
          )}
          <input
            ref={inputRef}
            id="palette-input"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={onKeyDown}
            placeholder="搜索你的记忆、文档、文件或问题…"
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            className="flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
          />
          {searching && <span className="text-[12px] text-ink-faint">搜索中…</span>}
          <kbd>ESC</kbd>
        </div>

        {/* 结果区 */}
        <div id="palette-list" ref={listRef} role="listbox" aria-label="命令与记忆" className="max-h-[380px] overflow-y-auto p-2">
          {items.length === 0 && (
            <div className="px-4 py-8 text-center text-[13px] text-ink-faint">
              没有匹配的操作或记忆
            </div>
          )}
          {items.map((item, i) => {
            const active = i === cursor;
            const cls = `flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left transition-colors ${
              active ? "bg-accent/10" : "hover:bg-base-panel2"
            }`;

            if (item.kind === "ask") {
              return (
                <button
                  key={item.id}
                  id={item.id}
                  role="option"
                  aria-selected={active}
                  tabIndex={-1}
                  onClick={() => void runIndex(i)}
                  className={`${cls} border-b border-base-border/60 bg-accent/[0.06] text-accent`}
                >
                  <Sparkles size={15} className="text-accent" />
                  <span className="flex-1 text-[13px]">询问 AI：「{query.trim()}」</span>
                  <kbd className="text-[12px]">Enter 提问</kbd>
                  {active && <CornerDownLeft size={12} className="text-accent" />}
                </button>
              );
            }

            if (item.kind === "action") {
              const Icon = item.action.icon;
              return (
                <button
                  key={item.id}
                  id={item.id}
                  role="option"
                  aria-selected={active}
                  tabIndex={-1}
                  onClick={() => void runIndex(i)}
                  className={cls}
                >
                  <Icon size={15} className={active ? "text-accent" : "text-ink-faint"} />
                  <span className="flex-1 text-[13px] font-medium text-ink">{item.action.label}</span>
                  {item.action.hint && (
                    <kbd className="text-[12px]">{item.action.hint}</kbd>
                  )}
                  {active && <CornerDownLeft size={12} className="text-accent" />}
                </button>
              );
            }

            return (
              <button
                key={item.id}
                id={item.id}
                role="option"
                aria-selected={active}
                tabIndex={-1}
                onClick={() => void runIndex(i)}
                className={cls}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-violet/70" />
                <span className="flex-1 truncate text-[13px] text-ink-dim">
                  {item.memory.title || "未命名记忆"}
                </span>
                <span className="text-[12px] font-mono text-ink-faint">
                  {new Date(item.memory.created_at).toLocaleDateString("zh-CN")}
                </span>
                {active && <CornerDownLeft size={12} className="text-accent" />}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-base-border/60 bg-base-panel/40 px-5 py-2.5 text-[12px] text-ink-faint">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><kbd>↑</kbd><kbd>↓</kbd> 导航</span>
            <span className="flex items-center gap-1"><kbd>↵</kbd> 执行</span>
            <span className="flex items-center gap-1"><kbd>esc</kbd> 关闭</span>
          </div>
          <span className="text-[12px] text-ink-faint">月忆</span>
        </div>
      </ModalPanel>
    </div>
  );
}
