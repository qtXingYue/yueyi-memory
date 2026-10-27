import { useState } from "react";
import { Camera, PenLine, ClipboardList, AppWindow, Crop } from "lucide-react";
import { useAppPick } from "@/stores/app";
import { captureApi, memoryApi } from "@/services/api";
import { openDrawer } from "@/utils/events";

/**
 * 时间线书写卡：随手记 + 四种采集入口。
 * 从 Timeline 抽出，页面只负责列表与筛选；采集逻辑自包含。
 */
export default function CaptureBar({ onRegionCapture }: { onRegionCapture: () => void }) {
  const { toast, refreshAll } = useAppPick("toast", "refreshAll");
  const [text, setText] = useState("");

  const save = async () => {
    const content = text.trim();
    if (!content) return;
    try {
      await memoryApi.create({ content, type: "note", source: "manual" });
      setText("");
      await refreshAll();
      toast("success", "记忆已保存，AI 正在后台整理…");
    } catch (e) {
      toast("error", `保存失败: ${String(e)}`);
    }
  };

  const screenshot = async () => {
    try {
      const m = await captureApi.screenshot();
      openDrawer(m.id);
      await refreshAll();
    } catch (e) {
      toast("error", `截图失败: ${String(e)}`);
    }
  };

  const windowScreenshot = async () => {
    try {
      const m = await captureApi.windowScreenshot();
      openDrawer(m.id);
      await refreshAll();
    } catch (e) {
      toast("error", `窗口截图失败: ${String(e)}`);
    }
  };

  const clipboard = async () => {
    try {
      const m = await captureApi.clipboardSave();
      if (!m) {
        toast("info", "剪贴板为空");
        return;
      }
      openDrawer(m.id);
      await refreshAll();
      toast("success", "已从剪贴板保存记忆");
    } catch (e) {
      toast("error", `剪贴板保存失败: ${String(e)}`);
    }
  };

  return (
    <div
      className="composer-card mt-1 px-4 py-3"
      data-has-text={text.trim() ? "true" : "false"}
    >
      <div className="flex items-start gap-2.5">
        <PenLine size={15} className="mt-[3px] shrink-0 text-ink-faint" />
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
          }}
          onKeyDown={(e) => {
            // Enter 保存，Shift+Enter 换行；输入法组词期间不触发
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save().then(() => {
                (e.target as HTMLTextAreaElement).style.height = "auto";
              });
            }
          }}
          placeholder="随手记下一句话、灵感或网页链接…"
          className="min-w-0 flex-1 text-[14px] placeholder:text-ink-faint"
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            className="card-action-btn"
            title="全屏截图 (Alt+Shift+S)"
            aria-label="全屏截图"
            onClick={() => void screenshot()}
          >
            <Camera size={15} />
          </button>
          <button
            className="card-action-btn"
            title="当前活动窗口截图（自动识别浏览器网址）"
            aria-label="窗口截图"
            onClick={() => void windowScreenshot()}
          >
            <AppWindow size={15} />
          </button>
          <button
            className="card-action-btn"
            title="可视化鼠标框选区域截图"
            aria-label="区域截图"
            onClick={onRegionCapture}
          >
            <Crop size={15} />
          </button>
          <button
            className="card-action-btn"
            title="保存剪贴板内容"
            aria-label="保存剪贴板"
            onClick={() => void clipboard()}
          >
            <ClipboardList size={15} />
          </button>
        </div>
      </div>
      <div className="composer-tools">
        <div className="flex items-center justify-between pt-2.5 text-[12px] text-ink-faint">
          <span>
            <kbd>Enter</kbd> 保存 · <kbd>Shift</kbd> + <kbd>Enter</kbd> 换行
          </span>
          <button
            onClick={() => void save()}
            disabled={!text.trim()}
            className="rounded-lg bg-accent px-3 py-1 text-[12px] font-medium text-white transition-all hover:brightness-105 disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
