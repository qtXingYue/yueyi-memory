import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search, Send, Sparkles, Loader2, BookOpen, KeyRound, ExternalLink, History, X,
} from "lucide-react";
import { useApp } from "@/stores/app";
import { aiApi, historyApi, memoryApi } from "@/services/api";
import { openDrawer } from "@/utils/events";
import Segmented from "@/components/Segmented";
import MemoryCard from "@/components/memory/MemoryCard";
import Markdown from "@/components/Markdown";
import { PageHeader } from "@/ui";
import type { AiAnswer, SearchHistoryItem, SearchResult } from "@/types";

const MODES = [
  { id: "qa", label: "✦ 智能问答" },
  { id: "keyword", label: "关键词搜索" },
] as const;

export default function SearchQA() {
  const { pendingQuestion, setPendingQuestion } = useApp();
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<"qa" | "keyword">("qa");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [keywordResults, setKeywordResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 请求序号：只接受最新一次请求的结果，防止旧响应覆盖新结果
  const seqRef = useRef(0);

  const loadHistory = useCallback(() => {
    historyApi.list(6).then(setHistory).catch(() => setHistory([]));
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const runWithQuestion = useCallback(async (rawQ: string) => {
    const q = rawQ.trim();
    if (!q) return;

    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const a = await aiApi.ask(q);
      if (seq !== seqRef.current) return;
      setAnswer(a);
      loadHistory();
    } catch (e) {
      if (seq !== seqRef.current) return;
      const msg = String(e);
      if (msg.includes("API") || msg.includes("api") || msg.includes("Key") || msg.includes("key")) {
        setError("AI 服务连接失败\n请检查 API Key 或网络连接。");
      } else {
        setError(`AI 问答失败：${msg}`);
      }
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [loadHistory]);

  // 从 Command Palette 或其他入口接收预填问题并自动提问
  useEffect(() => {
    if (pendingQuestion) {
      const q = pendingQuestion;
      setPendingQuestion(null);
      setQuestion(q);
      setMode("qa");
      void runWithQuestion(q);
    }
  }, [pendingQuestion, setPendingQuestion, runWithQuestion]);

  // 关键词模式即时搜索
  useEffect(() => {
    if (mode !== "keyword") return;
    const q = question.trim();
    if (!q) {
      setKeywordResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++seqRef.current;
    const t = setTimeout(async () => {
      try {
        const r = await memoryApi.search(q, false);
        if (seq !== seqRef.current) return;
        setKeywordResults(r);
      } catch {
        /* ignore */
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [question, mode]);

  const run = async () => {
    const q = question.trim();
    if (!q || loading) return;
    if (mode === "keyword") {
      const seq = ++seqRef.current;
      setSearching(true);
      try {
        const r = await memoryApi.search(q, true);
        if (seq !== seqRef.current) return;
        setKeywordResults(r);
        loadHistory();
      } catch {
        /* ignore */
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
      return;
    }
    await runWithQuestion(q);
  };

  const renderCitation = (idx: number) => {
    const cite = answer?.citations.find((c) => c.index === idx);
    if (!cite) return null;
    return (
      <button
        onClick={() => openDrawer(cite.memory_id)}
        className="mx-0.5 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 align-baseline font-mono text-[11px] text-accent transition-colors hover:bg-accent/20"
        title={cite.title}
      >
        [{idx}]
      </button>
    );
  };

  return (
    <div className="page-measure py-7">
      <PageHeader title="搜索与问答" subtitle="基于你的记忆回答 · 精准溯源不编造" />

      {/* 搜索与提问卡片 */}
      <div className="composer-card p-4 transition-all">
        <div className="flex items-start gap-3">
          <Sparkles size={18} className="mt-2.5 shrink-0 text-accent" />
          <textarea
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void run();
              }
            }}
            placeholder={
              mode === "qa"
                ? "向 AI 询问你的记忆，例如：我之前保存的深度学习资料有哪些？"
                : "输入关键词搜索记忆标题、内容或标签…"
            }
            rows={2}
            className="flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            className="btn-primary shrink-0 px-4 py-2.5"
            onClick={() => void run()}
            disabled={loading || !question.trim()}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {mode === "qa" ? "提问" : "搜索"}
          </button>
        </div>
      </div>

      {/* 模式切换：滑动分段控件 */}
      <div className="mt-4 flex items-center justify-between">
        <Segmented options={MODES} value={mode} onChange={setMode} />
        <span className="text-[12px] text-ink-faint">
          按 <kbd>Enter</kbd> 提交 · <kbd>Shift</kbd> + <kbd>Enter</kbd> 换行
        </span>
      </div>

      {/* 错误 */}
      {error && (
        <div className="animate-rise mt-5 rounded-2xl border border-danger/30 bg-danger/[0.06] p-5 text-[13px] leading-relaxed text-ink">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-danger">
            <KeyRound size={14} /> AI 服务连接失败
          </div>
          <pre className="whitespace-pre-wrap font-[inherit]">{error}</pre>
          <p className="mt-2 text-[12px] text-ink-faint">本地搜索仍然可用，可切换到「关键词搜索」模式。</p>
        </div>
      )}

      {/* AI 回答 */}
      {answer && (
        <div className="animate-rise mt-5">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-widest text-accent">
              <BookOpen size={11} /> ✦ 回答
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${
              answer.mode === "memory" ? "bg-accent/10 text-accent" : "bg-base-panel2 text-ink-faint"
            }`}>
              {answer.mode === "memory" ? "来自你的记忆" : "未找到相关记忆"}
            </span>
          </div>
          <div className="glass rounded-xl2 p-5">
            <Markdown text={answer.answer} renderCitation={renderCitation} />
          </div>

          {/* 引用列表 */}
          {answer.citations.length > 0 && (
            <div className="mt-3">
              <div className="section-label">引用的记忆</div>
              <div className="grid-half gap-2">
                {answer.citations.map((c) => (
                  <button
                    key={c.memory_id}
                    onClick={() => openDrawer(c.memory_id)}
                    className="flex items-center gap-2 rounded-lg border border-base-border/60 bg-base-panel/60 px-3 py-2.5 text-left transition-all hover:border-accent/25"
                  >
                    <span className="rounded border border-accent/40 bg-accent/10 px-1 font-mono text-[10px] text-accent">
                      [{c.index}]
                    </span>
                    <span className="flex-1 truncate text-[13px] text-ink-dim">{c.title}</span>
                    <ExternalLink size={11} className="text-ink-faint" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 关键词结果：直接复用时间线卡片，避免两处卡片漂移 */}
      {mode === "keyword" && searching && keywordResults.length === 0 && (
        <div className="mt-5 space-y-3" aria-busy="true" aria-label="搜索中">
          {[0, 1].map((i) => (
            <div key={i} className="memory-card-surface rounded-2xl p-4">
              <div className="skeleton mb-3 h-4 w-24" />
              <div className="skeleton mb-2 h-5 w-3/5" />
              <div className="skeleton h-3.5 w-4/5" />
            </div>
          ))}
        </div>
      )}

      {mode === "keyword" && keywordResults.length > 0 && (
        <div className="animate-rise mt-5 space-y-3">
          <div className="section-label">找到 {keywordResults.length} 条相关记忆</div>
          {keywordResults.map((r, i) => (
            <MemoryCard
              key={r.memory.id}
              memory={r.memory}
              index={i}
              snippet={r.snippet}
              score={r.score}
              highlightTerm={question.trim()}
            />
          ))}
        </div>
      )}

      {mode === "keyword" && question.trim() && !searching && keywordResults.length === 0 && (
        <div className="mt-10 text-center text-[13px] text-ink-faint">
          未找到与「{question.trim()}」匹配的记忆
        </div>
      )}

      {/* 空提示 */}
      {!answer && !error && mode === "qa" && !loading && (
        <div className="mt-10 flex flex-col items-center text-ink-faint">
          <Search size={22} strokeWidth={1.5} />
          <p className="mt-2.5 text-[13px]">输入问题，AI 将基于你的历史记忆作答</p>

          {history.length > 0 && (
            <div className="mt-5 w-full max-w-[520px]">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-faint">
                  <History size={11} /> 最近搜索
                </span>
                <button
                  onClick={() => {
                    void historyApi.clear().then(loadHistory);
                  }}
                  className="flex items-center gap-0.5 text-[11px] text-ink-faint transition-colors hover:text-ink-dim"
                >
                  <X size={10} /> 清空
                </button>
              </div>
              <div className="flex flex-wrap justify-center gap-1.5">
                {history.map((h) => (
                  <button
                    key={h.query}
                    onClick={() => {
                      setQuestion(h.query);
                      void runWithQuestion(h.query);
                    }}
                    className="max-w-full truncate rounded-lg bg-base-panel2 px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:bg-accent/10 hover:text-accent"
                    title={`${h.query}（${h.result_count} 条结果）`}
                  >
                    {h.query}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 space-y-1.5 text-[12px]">
            {[
              "我之前保存过哪些 Python 数据分析资料？",
              "找出我最近看过的机器学习内容",
              "去年关于 AI 的记录有哪些？",
            ].map((ex) => (
              <button
                key={ex}
                onClick={() => {
                  setQuestion(ex);
                  void runWithQuestion(ex);
                }}
                className="block w-full rounded-lg border border-base-border/60 px-4 py-1.5 text-center transition-colors hover:border-accent/25 hover:text-ink-dim"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
