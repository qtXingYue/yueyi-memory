import { useAppPick } from "@/stores/app";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { IconButton } from "@/ui";

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const COLORS = {
  success: "text-success",
  error: "text-danger",
  info: "text-violet",
};

export default function ToastStack() {
  const { toasts, dismissToast } = useAppPick("toasts", "dismissToast");
  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-12 left-1/2 z-[90] flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className="glass-deep animate-rise pointer-events-auto flex max-w-[420px] items-center gap-2.5 rounded-xl px-4 py-2.5 shadow-drawer"
          >
            <Icon size={15} className={COLORS[t.kind]} />
            <span className="text-[13px] text-ink">{t.text}</span>
            <IconButton
              label="关闭提示"
              size="xs"
              variant="ghost"
              icon={<X size={13} />}
              onClick={() => dismissToast(t.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
