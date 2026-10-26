import { useEffect, useState } from "react";
import {
  Keyboard,
  KeyRound,
  Database,
  FolderOpen,
  Loader2,
  CheckCircle2,
  XCircle,
  Download,
  Upload,
  HardDriveDownload,
  Trash2,
  Palette,
  Sun,
  Moon,
  Sparkles,
  RotateCcw,
  Tag as TagIcon,
  ChevronDown,
  ChevronUp,
  Pencil,
  FlaskConical,
  Info,
} from "lucide-react";
import { useApp } from "@/stores/app";
import { settingsApi, aiApi, memoryApi, tagApi } from "@/services/api";
import { invoke } from "@tauri-apps/api/core";
import { Button, PageHeader } from "@/ui";
import Segmented from "@/components/Segmented";
import type { TagInfo, TrashItem } from "@/types";

const SECTIONS = [
  { id: "appearance", label: "外观主题" },
  { id: "shortcuts", label: "全局快捷键" },
  { id: "ai", label: "AI 引擎" },
  { id: "storage", label: "本地存储" },
  { id: "trash", label: "回收站" },
  { id: "tags", label: "标签管理" },
  { id: "behavior", label: "通用行为" },
  { id: "data", label: "数据与备份" },
  { id: "about", label: "关于" },
] as const;

export default function Settings() {
  const { settings, refreshAll, toast, theme, setTheme, density, setDensity, setLabOpen } = useApp();
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com");
  const [model, setModel] = useState("deepseek-chat");
  const [shortcutShot, setShortcutShot] = useState("Alt+Shift+S");
  const [shortcutNote, setShortcutNote] = useState("Alt+Shift+M");
  const [shortcutSearch, setShortcutSearch] = useState("Ctrl+K");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [storage, setStorage] = useState<{
    memories: number;
    screenshots: number;
    attachmentsSize: number;
    dbSize: number;
  } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // 回收站
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [confirmPurgeId, setConfirmPurgeId] = useState<number | null>(null);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  // 标签管理
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [confirmTagDelete, setConfirmTagDelete] = useState<string | null>(null);

  const reloadTrash = () => {
    memoryApi.trash().then(setTrash).catch(() => setTrash([]));
  };
  const reloadTags = () => {
    tagApi.list().then(setTags).catch(() => setTags([]));
  };

  useEffect(() => {
    if (settings) {
      setApiKey(settings.api_key);
      setBaseUrl(settings.base_url || "https://api.deepseek.com");
      setModel(settings.model || "deepseek-chat");
      setShortcutShot(settings.shortcut_screenshot || "Alt+Shift+S");
      setShortcutNote(settings.shortcut_quick_note || "Alt+Shift+M");
      setShortcutSearch(settings.shortcut_search || "Ctrl+K");
    }
  }, [settings]);

  const reloadStorage = () => {
    void settingsApi.storageInfo().then(setStorage).catch(() => {});
  };

  useEffect(() => {
    reloadStorage();
    reloadTrash();
    reloadTags();
  }, []);

  // 设置分栏：滚动时高亮当前分区
  const [activeSection, setActiveSection] = useState<string>("appearance");
  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const onScroll = () => {
      const threshold = main.getBoundingClientRect().top + 80;
      let current: string = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= threshold) current = s.id;
      }
      setActiveSection(current);
    };
    onScroll();
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, []);

  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // 回收站操作
  const restoreOne = async (id: number) => {
    try {
      await memoryApi.restore(id);
      toast("success", "已恢复到时间线");
      reloadTrash();
      reloadStorage();
      await refreshAll();
    } catch (e) {
      toast("error", `恢复失败: ${String(e)}`);
    }
  };

  const purgeOne = async (id: number) => {
    if (confirmPurgeId !== id) {
      setConfirmPurgeId(id);
      window.setTimeout(() => setConfirmPurgeId((v) => (v === id ? null : v)), 2600);
      return;
    }
    try {
      await memoryApi.purge(id);
      setConfirmPurgeId(null);
      toast("info", "已彻底删除");
      reloadTrash();
      reloadStorage();
    } catch (e) {
      toast("error", `删除失败: ${String(e)}`);
    }
  };

  const emptyTrash = async () => {
    if (!confirmEmptyTrash) {
      setConfirmEmptyTrash(true);
      window.setTimeout(() => setConfirmEmptyTrash(false), 3000);
      return;
    }
    try {
      const n = await memoryApi.emptyTrash();
      setConfirmEmptyTrash(false);
      toast("info", `已清空回收站（${n} 条）`);
      reloadTrash();
      reloadStorage();
    } catch (e) {
      toast("error", `清空失败: ${String(e)}`);
    }
  };

  // 标签操作
  const saveTagName = async (oldName: string) => {
    const next = tagDraft.trim();
    setEditingTag(null);
    if (!next || next === oldName) return;
    try {
      await tagApi.rename(oldName, next);
      toast("success", "标签已更新（同名会自动合并）");
      reloadTags();
      await refreshAll();
    } catch (e) {
      toast("error", `重命名失败: ${String(e)}`);
    }
  };

  const deleteTag = async (name: string) => {
    if (confirmTagDelete !== name) {
      setConfirmTagDelete(name);
      window.setTimeout(() => setConfirmTagDelete((v) => (v === name ? null : v)), 2600);
      return;
    }
    try {
      await tagApi.remove(name);
      setConfirmTagDelete(null);
      toast("info", `已删除标签 #${name}`);
      reloadTags();
      await refreshAll();
    } catch (e) {
      toast("error", `删除标签失败: ${String(e)}`);
    }
  };

  const save = async (patch: Record<string, unknown>) => {
    try {
      const next = await settingsApi.save(patch);
      useApp.setState({ settings: next });
      toast("success", "设置已保存");
    } catch (e) {
      toast("error", `保存失败: ${String(e)}`);
    }
  };

  const testConn = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const patch: Record<string, unknown> = {
        base_url: baseUrl.trim(),
        model: model.trim(),
      };
      if (apiKey.trim()) patch.api_key = apiKey.trim();
      const next = await settingsApi.save(patch);
      useApp.setState({ settings: next });
      const r = await aiApi.testConnection();
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, message: String(e) });
    }
    setTesting(false);
  };

  const exportAll = async () => {
    try {
      const defaultPath = `yueyi-export-${new Date().toISOString().slice(0, 10)}.json`;
      const path = await invoke<string | null>("pick_export_path", { defaultName: defaultPath });
      if (!path) return;
      const written = await settingsApi.exportData(path);
      toast("success", `已导出到 ${written}`);
    } catch (e) {
      toast("error", `导出失败: ${String(e)}`);
    }
  };

  const importAll = async () => {
    try {
      const path = await invoke<string | null>("pick_import_path");
      if (!path) return;
      const count = await settingsApi.importData(path);
      await refreshAll();
      reloadStorage();
      toast("success", `已导入 ${count} 条记忆`);
    } catch (e) {
      toast("error", `导入失败: ${String(e)}`);
    }
  };

  const backupDb = async () => {
    try {
      const defaultPath = `yueyi-backup-${new Date().toISOString().slice(0, 10)}.db`;
      const path = await invoke<string | null>("pick_backup_path", { defaultName: defaultPath });
      if (!path) return;
      const written = await settingsApi.backupDatabase(path);
      toast("success", `数据库已备份至 ${written}`);
    } catch (e) {
      toast("error", `备份失败: ${String(e)}`);
    }
  };

  const clearAll = async () => {
    try {
      await invoke("clear_all_data");
      setConfirmClear(false);
      await refreshAll();
      reloadStorage();
      toast("success", "已清空全部数据");
    } catch (e) {
      toast("error", `清空失败: ${String(e)}`);
    }
  };

  const fmtSize = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="page-measure py-7">
      <PageHeader
        title="设置"
        subtitle="外观主题 · 快捷键 · AI 引擎 · 本地存储 · 通用与数据管理"
      />

      <div className="flex items-start gap-6">
        {/* 二级导航：宽窗口显示，窄窗口自动隐藏 */}
        <nav
          aria-label="设置分区"
          className="settings-subnav sticky top-0 z-10 w-[148px] shrink-0 flex-col gap-0.5 self-start pt-1"
        >
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => jumpTo(s.id)}
              data-active={activeSection === s.id}
              aria-current={activeSection === s.id ? "true" : undefined}
              className={`nav-item flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                activeSection === s.id
                  ? "bg-accent/[0.08] font-semibold text-accent"
                  : "text-ink-dim hover:bg-base-panel/60 hover:text-ink"
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-4">
        {/* 外观与主题配色 */}
        <section id="appearance" className="glass animate-rise rounded-2xl p-5">
          <div className="mb-3.5 flex items-center gap-2">
            <Palette size={15} className="text-ink-dim" />
            <h2 className="text-[14px] font-semibold text-ink">外观主题</h2>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* 浅色模式 */}
            <button
              type="button"
              onClick={() => setTheme("pearl")}
              className={`group rounded-xl p-4 text-left transition-all duration-200 ${
                theme === "pearl"
                  ? "bg-base-panel ring-2 ring-accent/45 shadow-sm"
                  : "bg-base-panel/60 hover:bg-base-panel"
              }`}
            >
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sun size={14} className="text-ink-dim" />
                  <span className="text-[13px] font-semibold text-ink">晴空月白 · 浅色</span>
                </div>
                {theme === "pearl" && (
                  <span className="rounded-md bg-accent/12 px-2 py-0.5 text-[10px] font-semibold text-accent">
                    当前
                  </span>
                )}
              </div>
              <p className="text-[12px] leading-relaxed text-ink-faint">
                温润低眩光瓷白底色，清爽护眼，适合日间工作与长文阅读
              </p>
            </button>

            {/* 深色模式 */}
            <button
              type="button"
              onClick={() => setTheme("night")}
              className={`group rounded-xl p-4 text-left transition-all duration-200 ${
                theme === "night"
                  ? "bg-base-panel ring-2 ring-accent/45 shadow-sm"
                  : "bg-base-panel/60 hover:bg-base-panel"
              }`}
            >
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Moon size={14} className="text-ink-dim" />
                  <span className="text-[13px] font-semibold text-ink">星夜流霞 · 深色</span>
                </div>
                {theme === "night" && (
                  <span className="rounded-md bg-accent/12 px-2 py-0.5 text-[10px] font-semibold text-accent">
                    当前
                  </span>
                )}
              </div>
              <p className="text-[12px] leading-relaxed text-ink-faint">
                静谧深岩暗色面板，柔和低对比度，适合夜间沉浸式记录
              </p>
            </button>
          </div>

          {/* 界面密度 */}
          <div className="mt-3 flex items-center justify-between gap-4 rounded-xl bg-base-panel px-4 py-3">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-ink">界面密度</div>
              <div className="mt-0.5 text-[12px] text-ink-faint">
                紧凑模式压缩卡片与导航间距，一屏看到更多记忆
              </div>
            </div>
            <Segmented
              size="sm"
              value={density}
              onChange={(v) => setDensity(v as "comfortable" | "compact")}
              options={[
                { key: "comfortable", label: "舒适" },
                { key: "compact", label: "紧凑" },
              ]}
            />
          </div>
        </section>

        {/* 快捷键 */}
        <section id="shortcuts" className="glass animate-rise stagger-1 rounded-2xl p-5">
          <div className="mb-3.5 flex items-center gap-2">
            <Keyboard size={15} className="text-ink-dim" />
            <h2 className="text-[14px] font-semibold text-ink">全局快捷键</h2>
          </div>
          <div className="space-y-2">
            {[
              { label: "全屏截图采集", value: shortcutShot, set: setShortcutShot, key: "shortcut_screenshot" },
              { label: "唤起悬浮速记", value: shortcutNote, set: setShortcutNote, key: "shortcut_quick_note" },
              { label: "全局快速搜索", value: shortcutSearch, set: setShortcutSearch, key: "shortcut_search" },
            ].map((row) => (
              <div key={row.key} className="flex items-center justify-between rounded-xl bg-base-panel px-4 py-2.5">
                <span className="text-[13px] text-ink-dim">{row.label}</span>
                <div className="flex items-center gap-2">
                  <input
                    value={row.value}
                    onChange={(e) => row.set(e.target.value)}
                    onBlur={() => void save({ [row.key]: row.value })}
                    className="input-base w-36 py-1 text-center font-mono text-[12px]"
                  />
                  <button
                    className="btn-outline px-2.5 py-1 text-[12px]"
                    onClick={() => void save({ [row.key]: row.value })}
                  >
                    应用
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* AI */}
        <section id="ai" className="glass animate-rise stagger-2 rounded-2xl p-5">
          <div className="mb-3.5 flex items-center gap-2">
            <KeyRound size={15} className="text-ink-dim" />
            <h2 className="text-[14px] font-semibold text-ink">AI 引擎 · DeepSeek</h2>
          </div>
          <div className="space-y-3.5">
            <div>
              <label htmlFor="set-api-key" className="mb-1.5 block text-[12px] font-medium text-ink-faint">DeepSeek API Key</label>
              <input
                id="set-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={settings?.api_key_set ? "已配置 · 留空保持不变" : "sk-…"}
                className="input-base bg-base-panel font-mono"
              />
            </div>
            <div className="grid-half">
              <div>
                <label htmlFor="set-base-url" className="mb-1.5 block text-[12px] font-medium text-ink-faint">Base URL</label>
                <input
                  id="set-base-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="input-base bg-base-panel font-mono text-[12px]"
                />
              </div>
              <div>
                <label htmlFor="set-model" className="mb-1.5 block text-[12px] font-medium text-ink-faint">Model</label>
                <input
                  id="set-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="input-base bg-base-panel font-mono text-[12px]"
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2 text-[13px]">
                {testResult ? (
                  testResult.ok ? (
                    <span className="flex items-center gap-1.5 font-medium text-success">
                      <CheckCircle2 size={14} /> 已连接成功
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-danger">
                      <XCircle size={14} /> 连接失败：{testResult.message.slice(0, 60)}
                    </span>
                  )
                ) : (
                  <span className="text-ink-faint">连接状态未测试</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button className="btn-outline bg-base-panel" onClick={() => void testConn()} disabled={testing}>
                  {testing ? <Loader2 size={13} className="animate-spin" /> : null}
                  测试连接
                </button>
                <button
                  className="btn-primary"
                  onClick={() => {
                    const patch: Record<string, unknown> = {
                      base_url: baseUrl.trim(),
                      model: model.trim(),
                    };
                    if (apiKey.trim()) patch.api_key = apiKey.trim();
                    void save(patch);
                  }}
                >
                  保存配置
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 存储 */}
        <section id="storage" className="glass animate-rise stagger-3 rounded-2xl p-5">
          <div className="mb-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database size={15} className="text-ink-dim" />
              <h2 className="text-[14px] font-semibold text-ink">本地存储概览</h2>
            </div>
            <span className="rounded-lg bg-base-panel px-2.5 py-1 font-mono text-[11px] text-ink-faint">
              %USERPROFILE%\YueyiData
            </span>
          </div>
          <div className="grid-quarter text-center">
            {[
              { label: "记忆数量", value: storage?.memories ?? "—" },
              { label: "截图数量", value: storage?.screenshots ?? "—" },
              { label: "附件大小", value: storage ? fmtSize(storage.attachmentsSize) : "—" },
              { label: "数据库大小", value: storage ? fmtSize(storage.dbSize) : "—" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-base-panel py-3">
                <div className="font-mono text-[18px] font-bold text-ink">{s.value}</div>
                <div className="mt-0.5 text-[11px] text-ink-faint">{s.label}</div>
              </div>
            ))}
          </div>
          <button className="btn-outline mt-3.5 bg-base-panel" onClick={() => void settingsApi.openDataDir()}>
            <FolderOpen size={13.5} /> 打开本地数据目录
          </button>
        </section>

        {/* 回收站 */}
        <section id="trash" className="glass animate-rise stagger-4 rounded-2xl p-5">
          <div className="mb-3.5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setTrashOpen((v) => !v)}
              className="flex items-center gap-2 text-left"
            >
              <Trash2 size={15} className="text-ink-dim" />
              <h2 className="text-[14px] font-semibold text-ink">回收站</h2>
              <span className="rounded-full bg-base-panel px-2 py-0.5 font-mono text-[11px] text-ink-dim">
                {trash.length}
              </span>
              {trashOpen ? (
                <ChevronUp size={13} className="text-ink-faint" />
              ) : (
                <ChevronDown size={13} className="text-ink-faint" />
              )}
            </button>
            {trash.length > 0 && (
              <button
                onClick={() => void emptyTrash()}
                className={`btn-outline px-2.5 py-1 text-[12px] ${
                  confirmEmptyTrash ? "bg-danger text-white" : ""
                }`}
              >
                {confirmEmptyTrash ? "确认清空" : "清空回收站"}
              </button>
            )}
          </div>
          <p className="text-[12px] text-ink-faint">
            删除的记忆会先移到回收站，恢复后可继续查看与编辑；清空后不可恢复。
          </p>

          {trashOpen && (
            <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {trash.length === 0 && (
                <div className="rounded-xl bg-base-panel px-4 py-6 text-center text-[12px] text-ink-faint">
                  回收站是空的
                </div>
              )}
              {trash.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 rounded-xl bg-base-panel px-3.5 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-dim">
                    {t.title || "未命名记忆"}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                    {t.deleted_at}
                  </span>
                  <button
                    onClick={() => void restoreOne(t.id)}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[12px] text-accent transition-colors hover:bg-accent/10"
                  >
                    <RotateCcw size={11} /> 恢复
                  </button>
                  <button
                    onClick={() => void purgeOne(t.id)}
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[12px] transition-colors ${
                      confirmPurgeId === t.id
                        ? "bg-danger text-white"
                        : "text-ink-faint hover:bg-danger/10 hover:text-danger"
                    }`}
                  >
                    {confirmPurgeId === t.id ? "确认彻底删除" : "彻底删除"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 标签管理 */}
        <section id="tags" className="glass animate-rise stagger-4 rounded-2xl p-5">
          <div className="mb-3.5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setTagsOpen((v) => !v)}
              className="flex items-center gap-2 text-left"
            >
              <TagIcon size={15} className="text-ink-dim" />
              <h2 className="text-[14px] font-semibold text-ink">标签管理</h2>
              <span className="rounded-full bg-base-panel px-2 py-0.5 font-mono text-[11px] text-ink-dim">
                {tags.length}
              </span>
              {tagsOpen ? (
                <ChevronUp size={13} className="text-ink-faint" />
              ) : (
                <ChevronDown size={13} className="text-ink-faint" />
              )}
            </button>
            <span className="text-[11px] text-ink-faint">重命名为已有标签会自动合并</span>
          </div>

          {tagsOpen && (
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {tags.length === 0 && (
                <div className="rounded-xl bg-base-panel px-4 py-6 text-center text-[12px] text-ink-faint">
                  还没有标签，AI 整理记忆后会自动生成
                </div>
              )}
              {tags.map((t) => (
                <div key={t.name} className="flex items-center gap-2 rounded-xl bg-base-panel px-3 py-1.5">
                  {editingTag === t.name ? (
                    <input
                      autoFocus
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onBlur={() => void saveTagName(t.name)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveTagName(t.name);
                        if (e.key === "Escape") setEditingTag(null);
                      }}
                      className="min-w-0 flex-1 rounded bg-base-panel2 px-2 py-0.5 text-[12px] text-ink outline-none"
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-dim">
                      #{t.name}
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                    {t.count}
                  </span>
                  <button
                    onClick={() => {
                      setEditingTag(t.name);
                      setTagDraft(t.name);
                    }}
                    className="shrink-0 rounded p-1 text-ink-faint transition-colors hover:bg-base-panel2 hover:text-ink"
                    title="重命名"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={() => void deleteTag(t.name)}
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                      confirmTagDelete === t.name
                        ? "bg-danger text-white"
                        : "text-ink-faint hover:bg-danger/10 hover:text-danger"
                    }`}
                    title="删除标签（不影响记忆内容）"
                  >
                    {confirmTagDelete === t.name ? "确认" : <Trash2 size={11} />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 通用 */}
        <section id="behavior" className="glass animate-rise stagger-4 rounded-2xl p-5">
          <div className="mb-3.5 flex items-center gap-2">
            <Sparkles size={15} className="text-ink-dim" />
            <h2 className="text-[14px] font-semibold text-ink">通用行为</h2>
          </div>
          <div className="space-y-2">
            {[
              {
                key: "launch_at_login",
                label: "开机启动",
                desc: "登录 Windows 系统时自动在后台启动月忆",
                defaultVal: false,
              },
              {
                key: "clipboard_watch",
                label: "剪贴板监听",
                desc: "复制 8 字以上的文本自动存入月忆（自动去重，敏感内容请勿开启）",
                defaultVal: false,
              },
              {
                key: "daily_review",
                label: "每日回顾",
                desc: "每天 18:00 后推送一条今日回顾（当天只发一次）",
                defaultVal: true,
              },
              {
                key: "minimize_to_tray",
                label: "最小化到托盘",
                desc: "开启后最小化会隐藏任务栏图标只留托盘；关闭则最小化到任务栏",
                defaultVal: false,
              },
              {
                key: "close_to_tray",
                label: "关闭窗口时进入托盘",
                desc: "开启后点关闭只是驻留托盘；关闭则直接退出程序",
                defaultVal: false,
              },
              {
                key: "auto_analyze",
                label: "自动分析新记忆",
                desc: "保存后自动调用 AI 生成标题、摘要、深度分析与标签",
                defaultVal: true,
              },
            ].map((row) => {
              const on =
                (settings?.[row.key as keyof typeof settings] as boolean | undefined) ??
                row.defaultVal;
              return (
                <button
                  key={row.key}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={row.label}
                  onClick={() => void save({ [row.key]: !on })}
                  className="flex w-full items-center justify-between gap-4 rounded-xl bg-base-panel px-4 py-3 text-left transition-colors hover:bg-base-panel/80 focus-visible:ring-2 focus-visible:ring-accent/50 outline-none"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">{row.label}</div>
                    <div className="mt-0.5 text-[12px] text-ink-faint">{row.desc}</div>
                  </div>
                  <div
                    aria-hidden
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
                      on ? "bg-accent" : "bg-ink-faint/30"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                        on ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* 数据 */}
        <section id="data" className="glass animate-rise stagger-5 rounded-2xl p-5">
          <h2 className="mb-3.5 text-[14px] font-semibold text-ink">数据备份与迁移</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-outline bg-base-panel" onClick={() => void exportAll()}>
              <Download size={13.5} /> 导出全部数据
            </button>
            <button className="btn-outline bg-base-panel" onClick={() => void importAll()}>
              <Upload size={13.5} /> 导入数据
            </button>
            <button className="btn-outline bg-base-panel" onClick={() => void backupDb()}>
              <HardDriveDownload size={13.5} /> 备份数据库
            </button>
            {confirmClear ? (
              <span className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-danger">
                  将删除全部记忆、合集与附件，不可恢复
                </span>
                <button className="btn-danger" onClick={() => void clearAll()}>
                  确认清空
                </button>
                <button className="btn-ghost" onClick={() => setConfirmClear(false)}>
                  取消
                </button>
              </span>
            ) : (
              <button className="btn-danger" onClick={() => setConfirmClear(true)}>
                <Trash2 size={13.5} /> 清空全部数据
              </button>
            )}
          </div>
        </section>

        {/* 关于 */}
        <section id="about" className="glass animate-rise stagger-5 rounded-2xl p-5">
          <div className="mb-3.5 flex items-center gap-2">
            <Info size={15} className="text-ink-dim" />
            <h2 className="text-[14px] font-semibold text-ink">关于月忆</h2>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-base-panel px-4 py-3">
            <div>
              <div className="text-[13px] font-medium text-ink">月忆 Desktop v0.1.0</div>
              <div className="mt-0.5 text-[12px] text-ink-faint">
                Tauri 2 · React 18 · SQLite · Local First
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<FlaskConical size={13} />}
              onClick={() => setLabOpen(true)}
            >
              打开 UI 实验室
            </Button>
          </div>
          <p className="mt-2 text-[12px] text-ink-faint">
            UI 实验室用于查看设计基元与各状态，快捷键 Ctrl + Shift + L 可随时打开或关闭。
          </p>
        </section>
        </div>
      </div>
    </div>
  );
}
