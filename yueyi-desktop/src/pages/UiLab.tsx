import { useRef, useState } from "react";
import { ArrowLeft, Check, Loader2, Search, Sparkles, Trash2, X } from "lucide-react";
import { useAppPick } from "@/stores/app";
import {
  Button,
  Chip,
  EmptyState,
  IconButton,
  Input,
  Popover,
  SectionCard,
  Select,
  Skeleton,
  StatTile,
  Textarea,
  TooltipBubble,
} from "@/ui";

const COLORS = [
  ["base", "bg-base"],
  ["panel", "bg-base-panel"],
  ["panel2", "bg-base-panel2"],
  ["accent", "bg-accent"],
  ["violet", "bg-violet"],
  ["moon", "bg-moon"],
  ["success", "bg-success"],
  ["warn", "bg-warn"],
  ["danger", "bg-danger"],
] as const;

const TYPE_SCALE = [
  ["display", "22px", "页面标题"],
  ["stat", "18px", "统计数字"],
  ["title", "15px", "卡片标题"],
  ["body-lg", "14px", "强调正文"],
  ["body", "13px", "正文"],
  ["meta", "12px", "元信息"],
  ["caption", "11px", "辅助说明"],
  ["micro", "10px", "极小角标"],
] as const;

/** UI 实验室：所有基元 × 两套主题 × 各状态，一屏看完 */
export default function UiLab({ onClose }: { onClose: () => void }) {
  const { theme, setTheme } = useAppPick("theme", "setTheme");
  const [popOpen, setPopOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  return (
    // 注意：不能复用 .app-shell——它自带 overflow:hidden，会盖掉这里的滚动
    <div className="h-full overflow-y-auto overscroll-contain bg-base/60">
      <div className="mx-auto w-full max-w-[1100px] px-8 py-7">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="page-title">UI 实验室</h1>
            <p className="mt-1 text-[13px] text-ink-dim">
              基元 / 状态 / token 总览 · 按 <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd> 关闭
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setTheme(theme === "pearl" ? "night" : "pearl")}
            >
              切换到 {theme === "pearl" ? "深色" : "浅色"}
            </Button>
            <Button size="sm" variant="primary" icon={<ArrowLeft size={13} />} onClick={onClose}>
              返回应用
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionCard title="色彩 Token" className="animate-rise">
            <div className="grid grid-cols-3 gap-2">
              {COLORS.map(([name, cls]) => (
                <div key={name} className="flex items-center gap-2 rounded-lg bg-base-panel2 px-2.5 py-2">
                  <span className={`h-5 w-5 shrink-0 rounded-md ${cls}`} />
                  <span className="text-[12px] text-ink-dim">{name}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="字号阶梯" className="animate-rise">
            <div className="space-y-1.5">
              {TYPE_SCALE.map(([name, size, sample]) => (
                <div key={name} className="flex items-baseline justify-between gap-3 border-b border-base-border/40 pb-1 last:border-0">
                  <span style={{ fontSize: size }} className="text-ink">{sample} {size}</span>
                  <span className="font-mono text-[12px] text-ink-faint">--text-{name}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="按钮 · 4 变体 × 2 尺寸" className="animate-rise">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary">主操作</Button>
              <Button variant="secondary">次操作</Button>
              <Button variant="ghost">幽灵</Button>
              <Button variant="danger" icon={<Trash2 size={13} />}>危险</Button>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary">小号</Button>
              <Button size="sm" variant="secondary">小号</Button>
              <Button size="sm" variant="ghost">小号</Button>
              <Button size="sm" variant="danger">小号</Button>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Button variant="primary" loading>保存中</Button>
              <Button variant="secondary" disabled>不可用</Button>
              <Button variant="primary" icon={<Sparkles size={13} />}>带图标</Button>
            </div>
          </SectionCard>

          <SectionCard title="图标按钮 · 3 尺寸" className="animate-rise">
            <div className="flex items-center gap-3">
              <IconButton label="搜索（中）" size="md" variant="surface" icon={<Search size={15} />} />
              <IconButton label="确认（小）" size="sm" variant="ghost" icon={<Check size={14} />} />
              <IconButton label="关闭（超小）" size="xs" variant="ghost" icon={<X size={13} />} />
              <IconButton label="删除" size="sm" variant="danger" icon={<Trash2 size={13} />} />
            </div>
            <p className="mt-3 text-[12px] text-ink-faint">label 自动写入 aria-label 与 title。</p>
          </SectionCard>

          <SectionCard title="表单基元" className="animate-rise">
            <div className="space-y-2.5">
              <Input placeholder="单行输入…" />
              <Textarea rows={3} placeholder="多行输入 / 正文…" />
              <Select defaultValue="note">
                <option value="note">笔记</option>
                <option value="link">链接</option>
                <option value="code">代码</option>
              </Select>
            </div>
          </SectionCard>

          <SectionCard title="Chip 与 Tooltip" className="animate-rise">
            <div className="flex flex-wrap items-center gap-2">
              <Chip active>全部</Chip>
              <Chip>截图与图片</Chip>
              <Chip>笔记</Chip>
              <Chip>链接</Chip>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <span className="group relative inline-flex">
                <Button variant="secondary" size="sm">悬停看提示</Button>
                <TooltipBubble label="这是统一 tooltip" kbd="Ctrl K" side="top" />
              </span>
            </div>
          </SectionCard>

          <SectionCard title="Popover / Menu" className="animate-rise">
            <button
              ref={anchorRef}
              type="button"
              onClick={() => {
                setRect(anchorRef.current?.getBoundingClientRect() ?? null);
                setPopOpen((v) => !v);
              }}
              className="btn-outline"
            >
              打开浮层
            </button>
            <p className="mt-2 text-[12px] text-ink-faint">自动避让视口边界，Esc / 点击外部关闭。</p>
            <Popover
              open={popOpen}
              anchor={rect}
              onClose={() => setPopOpen(false)}
              estimatedHeight={120}
              ariaLabel="示例菜单"
            >
              {["重命名", "移动到…", "删除"].map((label, i) => (
                <button
                  key={label}
                  role="menuitem"
                  onClick={() => setPopOpen(false)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                    i === 2
                      ? "text-ink-dim hover:bg-danger/10 hover:text-danger"
                      : "text-ink-dim hover:bg-base-panel2 hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </Popover>
          </SectionCard>

          <SectionCard title="状态：空 / 骨架 / 统计" className="animate-rise">
            <div className="grid grid-cols-3 gap-2">
              <StatTile value={14} label="总计" />
              <StatTile value={12} label="截图" />
              <StatTile value={4} label="网页" />
            </div>
            <div className="mt-3 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3.5 w-full" />
            </div>
            <EmptyState
              className="py-6"
              icon={<Search size={20} />}
              title="没有匹配的内容"
              hint="换个关键词，或清除筛选后再试。"
              action={<Button size="sm" variant="secondary">清除筛选</Button>}
            />
          </SectionCard>

          <SectionCard title="圆角 / 间距 / 动效" className="animate-rise lg:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              {([
                ["sm", "rounded-sm"],
                ["md", "rounded-md"],
                ["lg", "rounded-lg"],
                ["xl", "rounded-xl"],
              ] as const).map(([r, cls]) => (
                <div key={r} className="flex flex-col items-center gap-1">
                  <div className={`h-12 w-16 bg-base-panel2 ring-1 ring-base-border/60 ${cls}`} />
                  <span className="font-mono text-[12px] text-ink-faint">--radius-{r}</span>
                </div>
              ))}
              <div className="mx-3 h-10 w-px bg-base-border/60" />
              {[
                ["fast", "120ms"],
                ["base", "180ms"],
                ["slow", "260ms"],
                ["slower", "360ms"],
              ].map(([name, ms]) => (
                <div key={name} className="rounded-lg bg-base-panel2 px-2.5 py-1.5 text-center">
                  <div className="font-mono text-[12px] text-ink">{ms}</div>
                  <div className="text-[12px] text-ink-faint">--dur-{name}</div>
                </div>
              ))}
              <Loader2 size={14} className="ml-3 animate-spin text-ink-faint" />
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
