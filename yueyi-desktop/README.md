# 月忆 · Desktop（Yueyi Desktop）

一款 Windows 优先、跨平台能力的桌面 AI 个人记忆软件。
**不是笔记软件，是「电脑端 AI 第二大脑 / Personal Memory OS」。**

> 捕获 → OCR → DeepSeek 理解 → 自动标题/摘要/标签/分类 → 时间线归档 → Ctrl+K 搜索 → AI 问答 → 点击引用回到原始记忆。

---

## 一、技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | **Tauri 2**（Rust） |
| 前端 | React 18 + TypeScript + Vite 5 + Tailwind CSS 3 + Zustand |
| 数据库 | SQLite（rusqlite bundled，**Local First**） |
| OCR | Windows.Media.Ocr（WinRT，**离线本地**） |
| 截图 | Windows GDI（BitBlt + CAPTUREBLT） |
| 剪贴板 | arboard（文本 / URL / 代码 / 图片） |
| AI | DeepSeek（OpenAI 兼容协议），抽象为 `AiProvider` trait |
| 图标 | Lucide Icons（统一 stroke width 1.7~1.8） |

---

## 二、项目结构

```
yueyi-desktop/
├── src/                          # 前端
│   ├── ui/                       # 设计系统：tokens / 基元 / 浮层 / patterns / UI 实验室
│   ├── components/
│   │   ├── layout/               # Sidebar / TopBar / AiInsightPanel
│   │   ├── memory/               # MemoryCard / MemoryDrawer / MemoryComposer
│   │   ├── CommandPalette.tsx    # Ctrl+K 命令面板（含自然语言识别）
│   │   ├── QuickNote.tsx         # 悬浮速记条（Alt+Shift+M）
│   │   ├── Onboarding.tsx        # 首次启动引导
│   │   └── Sparkline.tsx         # 轻量 activity 趋势图
│   ├── pages/                    # Timeline / Collections / SearchQA / Settings
│   ├── services/api.ts           # Tauri invoke 封装
│   ├── stores/app.ts             # 全局状态（zustand）
│   ├── types/index.ts            # 类型定义（与 Rust 侧一一对应）
│   └── utils/events.ts           # 事件 / 时间 / 分组工具
│
├── src-tauri/                    # Rust 后端
│   └── src/
│       ├── lib.rs                # 窗口 / 托盘 / 全局快捷键 / yueyi-img 协议 / 捕获命令
│       ├── state.rs              # AppState + SQLite schema + 迁移 + 默认数据
│       ├── commands.rs           # 全部 Tauri 命令（记忆 / 合集 / 搜索 / AI / 设置）
│       ├── worker.rs             # 后台 AI 流水线（不阻塞 UI）
│       ├── ai.rs                 # AiProvider trait + DeepSeekProvider + 容错解析
│       ├── prompts.rs            # 全部 Prompt（集中管理，中文）
│       ├── capture.rs            # GDI 截图 + PNG 编码
│       └── ocr.rs                # WinRT OcrEngine
```

---

## 三、数据库设计

SQLite，11 张表，全部本地存储：

| 表 | 用途 |
|---|---|
| `memories` | 记忆主体（title/content/type/kind/source/ocr_text/content_hash/ai_status…） |
| `collections` | 合集（含颜色、目标 goal、智能摘要 summary） |
| `tags` / `memory_tags` | 标签多对多 |
| `memory_fields` | 结构化字段（时间、项目、待办、链接、文件路径…） |
| `collection_memories` | 合集与记忆的多对多关联（智能归集） |
| `reminders` | 到期提醒（从 deadline/event_start 自动生成） |
| `attachments` | 附件 |
| `ai_tasks` | AI 处理任务记录 |
| `search_history` | 搜索历史 |
| `settings` | 键值配置（含 API Key） |

另有 FTS5 虚表 `memories_fts`（trigram 分词）用于全文检索。

默认数据目录：`%USERPROFILE%\YueyiData`（可用环境变量 `YUEYI_DATA_DIR` 覆盖）
- `yueyi.db` — 数据库
- `screenshots/` — 截图 PNG
- `attachments/` — 附件

---

## 四、核心闭环

```
看到重要内容
      ↓  Alt+Shift+S
   全屏截图 → 保存 PNG → 立即入库（AI 状态：待整理）→ UI 提示「已捕获」
      ↓  后台线程（不阻塞 UI）
   WinRT OCR → 识别文字（失败也保留原图）
      ↓
   DeepSeek × 4 次调用：标题 → 摘要 → 标签 → 分类
      ↓
   更新数据库 + ai_status = done + 系统通知
      ↓
   时间线显示（带「新捕获」标记）
      ↓  未来任意时刻 Ctrl+K
   搜索 / AI 问答（仅发送相关检索片段）
      ↓
   点击 [1] 引用 → 打开原始记忆详情
```

**Local First 原则**：只有用户触发 AI 分析时，相关内容片段才发送给 DeepSeek；
绝不会默认上传整个数据库。AI 问答上下文上限 8 条相关记忆的内容摘要。

---

## 五、快捷键

| 快捷键 | 功能 |
|---|---|
| `Alt + Shift + S` | 截屏记忆（自动 OCR + AI 整理） |
| `Alt + Shift + M` | 悬浮速记条 |
| `Ctrl + K` | 命令面板 / 全局搜索 |
| `Ctrl + N` | 新建记忆 |
| `Tab`（速记条内） | 切换 文本 / 截屏 模式 |
| `Enter / Esc` | 保存 / 取消 |

---

## 六、构建与运行

> 本机环境说明：MSVC 工具链与 Windows SDK 位于非默认路径，
> 因此提供 `cargo.sh` 包装脚本注入环境变量（已含 `RUSTC`/`PATH`/`WindowsSdkDir`）。

```bash
# 1. 安装依赖（已执行）
npm install
# 若原生模块缺失（沙箱环境常见），补装：
npm install @rollup/rollup-win32-x64-msvc @esbuild/win32-x64 --no-save

# 2. 开发运行（Vite dev + Tauri 窗口）
npm run tauri dev

# 3. 生产构建（Release：LTO + opt-level=s，约 7 MB）
cd src-tauri && ../cargo.sh build --release

# 3b. 打包 Windows 安装程序（NSIS）
npm run tauri build -- --bundles nsis
#    产物：src-tauri/target/release/bundle/nsis/月忆_0.1.0_x64-setup.exe

# 4. 命令行闭环冒烟测试（不启动 GUI，直接跑一次捕获→OCR→AI→入库）
./target/debug/yueyi-desktop.exe --capture-once

# 5. Rust 单元测试（含 DeepSeek 真实调用）
DEEPSEEK_API_KEY=sk-xxx ../cargo.sh test
```

> 安装包路径：`src-tauri/target/release/bundle/nsis/月忆_0.1.0_x64-setup.exe`（约 2.6 MB）
> 免安装直接运行：`src-tauri/target/release/yueyi-desktop.exe`（约 7.3 MB）

### 环境变量配置

复制 `.env.example` 为 `.env`（**切勿提交**），或在应用内「设置 → AI」填写：

```env
DEEPSEEK_API_KEY=sk-xxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

优先级：**应用设置（SQLite） > 环境变量**。二者皆空时 AI 功能降级为「待整理」，
本地记录、搜索、截图功能完全不受影响。

---

## 七、错误处理与降级

| 场景 | 行为 |
|---|---|
| API Key 未配置 / 错误 | AI 标记为失败，记忆仍完整保存，UI 明确提示 |
| 网络断开 | 纯本地功能全部可用，设置页状态栏显示「AI 离线」 |
| OCR 失败（无语言包） | 仍保存原图，`ocr_text` 留空，日志记录降级原因 |
| AI 返回异常 JSON | `parse_json_loose` 容错解析（剥离 ```json 包裹、截取 JSON 片段） |
| AI 单项失败（如标签） | 其他项继续处理，不整体回滚 |
| 数据库错误 | 命令返回 `Result`，前端 toast 提示，不崩溃 |
| 截图失败 | 托盘/快捷鍵路径 emit `capture-error`，前端提示 |

---

## 八、设计语言

双主题，靠 `<html data-theme>` 切换，全部色值以 CSS 变量下发（`src/styles/globals.css`），
Tailwind 侧通过 `rgb(var(--c-*) / <alpha-value>)` 暴露为 `base-* / ink / accent / violet / moon / warn / danger` 工具类。

| Token | Pearl（浅色 · 晴空月白） | Night（深色 · 星夜流霞） |
|---|---|---|
| `--c-base` 外层画布 | `#ECEFF5` | `#0C1019` |
| `--c-panel` 工作区画布 | `#FCFDFF` | `#151B28` |
| `--c-panel2` 输入/胶囊填充 | `#F1F4FA` | `#1D2536` |
| `--c-ink` / `-dim` / `-faint` | `#182030` / `#525E76` / `#707C95` | `#E6ECF6` / `#98A6BC` / `#75839C` |
| `--c-accent` 主强调 | `#3862E4` 宝石蓝 | `#5C88F6` 星蓝 |
| `--c-moon` 月金微点缀 | `#C9A45C` | `#E0BC74` |
| `--c-warn` / `--c-danger` | `#D97706` / `#E11D48` | `#F59E0B` / `#FB7185` |

- 分层靠**材质明暗 + 阴影**（`--elev-1/2/3`、发丝环 `--ring-hair`），不用描边框线
- 半透明玻璃面板 + 极轻背景渐变；禁止过度发光 / 霓虹 / 大量渐变 / 3D 按钮
- 动画 150~350ms，统一 `cubic-bezier(0.16, 1, 0.3, 1)`；`prefers-reduced-motion` 下全局降级
- 禁用 Emoji 作为 UI 图标，统一 Lucide stroke 1.7~1.8
- 主题切换状态存 `localStorage`（键 `yueyi-theme-v2`），悬浮速记窗通过 `storage` 事件同步

---

## 九、UI 系统与实验

- **Token 唯一来源**：`src/ui/tokens.css`（颜色 / 字号 / 间距 / 圆角 / 动效）。`globals.css` 不再定义色值。
- **基元**：`Button` / `IconButton` / `Input` / `Textarea` / `Select` / `Chip` / `TooltipBubble` / `Popover` / `OverlayBackdrop` / `PageHeader` / `SectionCard` / `EmptyState` / `Skeleton` / `StatTile`。
- **UI 实验室**：应用内按 `Ctrl + Shift + L` 打开，所有基元 × 两主题 × 各状态一屏查看。
- **护栏**：`npm run audit:ui` 扫描页面中的非标准字号与裸色值；加 `--strict` 可在 CI 中失败。
- **回归截图**：`python scripts/capture-window.py out.png` 直接捕获应用窗口（DPI 感知，无需第三方库）。
- **视觉对比**：`python scripts/ui-diff.py baseline.png current.png --out diff.png`，纯 Python 解码 PNG、逐像素比对并输出差异图；基线建议放 `docs/ui-baseline/`（已加入 .gitignore，避免把个人记忆截图入库）。
- **合集排序**：侧栏合集支持拖拽排序（`collections.sort_order` 持久化），筛选状态下自动禁用拖拽。

---

## 十、已实测通过的闭环（本机 Windows 11）

```
✓ 应用启动无崩溃，系统托盘 / 全局快捷键注册成功
✓ SQLite 初始化：9 张表 + 5 个默认合集 + 8 项默认设置
✓ GDI 全屏截图：1440×900 → PNG 落盘 %USERPROFILE%\YueyiData\screenshots\
✓ WinRT OCR：识别 353 字中文/英文混合界面文字（离线，无需联网）
✓ DeepSeek 真实调用：
   标题 → WorkBuddy任务助手开发与调试
   标签 → ["WorkBuddy","任务管理","项目开发","环境配置","代码调试"]
   分类 → 工作记录
✓ AI 问答防编造：无相关记忆时明确回答「我没有在你的记忆中找到相关内容」
✓ 数据落库：memories / memory_tags / collections 关联写入正确
```

命令行验证样例：

```bash
$ ./target/debug/yueyi-desktop.exe --capture-once
月忆 · 命令行捕获测试
────────────────────────────
✓ 截屏成功：1440x900
✓ PNG 保存：C:\Users\31287\YueyiData\screenshots\ab803eaa-....png
✓ 已入库：memory #2
✓ OCR 识别 353 字
✓ AI 标题 → WorkBuddy任务助手开发与调试
✓ AI 标签 → ["WorkBuddy", "任务管理", "项目开发", "环境配置", "代码调试"]
✓ AI 分类 → 工作记录
✓ 记忆 #2 整理完成
```

## 十一、已知限制

| 项 | 说明 | 降级方案 |
|---|---|---|
| 区域截图 | 已实现冻结屏幕 + 鼠标拖拽框选；多显示器暂只截主屏 | 全屏截图 `Alt+Shift+S` |
| WinRT OCR | 依赖系统已安装 OCR 语言包 | 失败时仅记录日志，原图照常保存 |
| 向量检索 | 相关记忆当前用标签交集 | `related_memories` 接口已预留 embedding 扩展 |
| 打包安装包 | NSIS 需联网下载工具链 | `cargo build --release` 产物可直接运行 |

---

## 十二、桌面场景增强（2026-10）

- **结构化字段**：AI 从截图/文档/网页中抽取 `kind / deadline / event_start / project / people / todo / url / file_path / code_lang / version / email / phone`，写入 `memory_fields`；卡片显示 chips，详情页可打开链接、定位文件、加日历（.ics）、复制。
- **智能合集**：新建合集可填目标，自动扫描历史记忆并关联（标题/摘要/正文/标签/字段加权），合集页显示 AI 精华摘要；新记忆入库自动归集。
- **全局捕获**：拖拽文件/文件夹入窗（图片、PDF、DOCX、Markdown、代码）；剪贴板监听（默认关闭，可在设置开启）；`content_hash` 去重。
- **检索升级**：FTS5 trigram 全文检索 + 时间语义（今天/本周/上周/上个月/最近 N 天）+ 类型过滤（截图/图片/链接/文档/代码）。
- **回顾**：今日/本周/待整理统计、即将到期提醒、最近捕获、60 天前旧记忆重现、AI 周报草稿；后台每分钟检查提醒，18:00 后推送每日回顾。
- **导出**：单条记忆 / 合集导出 Markdown 到「下载/月忆导出」。


## 构建注意（WorkBuddy 工作目录限制）

本机从 `C://Users//31287//WorkBuddy//Yueyi` 目录直接执行 esbuild 会被安全策略拦截，报
`winmm.dll not found` / `bcryptprimitives.dll not found`。把 esbuild 复制到普通目录并指定：

```bat
copy node_modules\esbuild\node_modules\@esbuild\win32-x64\esbuild.exe C://esbtest//esbuild.exe
set ESBUILD_BINARY_PATH=C://esbtest//esbuild.exe
npm run build
```

Rust 侧如遇 `target\release\build\...\out: OS Error 5`，把 `CARGO_TARGET_DIR` 指到临时目录
（如 `%TEMP%\yueyi-target`）再 `cargo build --release`。

---

## 作者

**QT新月**

