import { useCallback, useState } from "react";
import { Sparkles, Check, Keyboard, KeyRound, HardDrive, Rocket, Loader2 } from "lucide-react";
import { useApp } from "@/stores/app";
import { settingsApi } from "@/services/api";
import { useOverlayEscape, useFocusTrap } from "@/hooks/useOverlay";

const STEPS = [
  { id: 1, title: "设置快捷键", desc: "截屏 Alt+Shift+S · 悬浮速记 Alt+Shift+M · 搜索 Ctrl+K", icon: Keyboard },
  { id: 2, title: "配置 DeepSeek", desc: "填入 API Key 后，AI 将自动为你的记忆生成标题、摘要与标签", icon: KeyRound },
  { id: 3, title: "选择数据位置", desc: "所有数据默认保存在本地 SQLite，不上传云端", icon: HardDrive },
  { id: 4, title: "一切就绪", desc: "你的电脑记忆，从现在开始", icon: Rocket },
];

export default function Onboarding() {
  const { onboardingOpen, finishOnboarding, refreshAll, toast, settings } = useApp();
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const skip = useCallback(() => {
    void settingsApi.save({ onboarding_done: true }).catch(() => {});
    finishOnboarding();
    void refreshAll();
  }, [finishOnboarding, refreshAll]);

  useOverlayEscape("onboarding", skip);
  const panelRef = useFocusTrap<HTMLDivElement>(onboardingOpen, "onboarding");

  if (!onboardingOpen) return null;

  const next = async () => {
    if (step === 1 && apiKey.trim()) {
      setSaving(true);
      try {
        await settingsApi.save({ api_key: apiKey.trim() });
        toast("success", "API Key 已保存");
      } catch (e) {
        toast("error", `保存失败: ${String(e)}`);
      }
      setSaving(false);
    }
    if (step === STEPS.length - 1) {
      skip();
      return;
    }
    setStep((s) => s + 1);
  };

  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-base/90 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="首次使用引导"
    >
      <div ref={panelRef} tabIndex={-1} className="glass-deep animate-rise w-[520px] rounded-xl3 p-8 shadow-drawer outline-none">
        {/* logo */}
        <div className="mb-6 flex items-center gap-3.5">
          <img
            src="/app-icon.png"
            alt="月忆"
            className="h-12 w-12 rounded-xl shadow-glow"
          />
          <div>
            <h2 className="text-[18px] font-semibold text-ink">欢迎来到月忆</h2>
            <p className="mt-0.5 text-[12px] text-ink-dim">你的电脑记忆，从现在开始。</p>
          </div>
        </div>

        {/* 步骤指示 */}
        <div className="mb-6 flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                i < step ? "bg-accent" : i === step ? "bg-accent/50" : "bg-base-border"
              }`}
            />
          ))}
        </div>

        {/* 当前步骤 */}
        <div className="animate-fade-slide">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl2 border border-base-border bg-base-panel2">
            <Icon size={20} className="text-accent" />
          </div>
          <h3 className="text-[15px] font-semibold text-ink">
            第{["一", "二", "三", "四"][step]}步 · {current.title}
          </h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">{current.desc}</p>

          {step === 0 && (
            <div className="mt-4 space-y-2">
              {[
                ["截屏记忆", settings?.shortcut_screenshot || "Alt+Shift+S"],
                ["悬浮速记", settings?.shortcut_quick_note || "Alt+Shift+M"],
                ["快速搜索", "Ctrl+K"],
              ].map(([label, key]) => (
                <div key={label} className="flex items-center justify-between rounded-lg border border-base-border/70 bg-base-panel2 px-3.5 py-2.5">
                  <span className="text-[13px] text-ink-dim">{label}</span>
                  <kbd className="rounded-md border border-base-border bg-base-panel px-2 py-0.5 font-mono text-[11px] text-ink">{key}</kbd>
                </div>
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="mt-4">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…（可跳过，稍后在设置中配置）"
                className="input-base"
              />
              <p className="mt-2 text-[11px] text-ink-faint">
                默认接入 DeepSeek 官方 API。Key 仅保存在本地数据库。
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="mt-4 rounded-xl2 border border-base-border/70 bg-base-panel2 p-4 text-[13px] leading-relaxed text-ink-dim">
              <div className="mb-1 flex items-center gap-1.5 text-ink">
                <HardDrive size={13} className="text-accent" /> Local First
              </div>
              记忆数据保存在本机用户数据目录的 SQLite 数据库中，
              只有在你触发 AI 分析时，相关内容才会发送给 DeepSeek。
            </div>
          )}

          {step === 3 && (
            <div className="mt-4 flex items-center gap-2 rounded-xl2 border border-accent/20 bg-accent/[0.05] p-4 text-[13px] text-ink">
              <Check size={15} className="text-accent" />
              一切就绪，开始捕获你的第一条记忆吧。
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="mt-7 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="btn-ghost"
              style={{ visibility: step === 0 ? "hidden" : "visible" }}
            >
              上一步
            </button>
            <button onClick={skip} className="btn-ghost">
              跳过引导
            </button>
          </div>
          <button className="btn-primary" onClick={() => void next()} disabled={saving}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {step === STEPS.length - 1 ? "开始使用" : "下一步"}
          </button>
        </div>
      </div>
    </div>
  );
}
