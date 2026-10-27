# 月忆 · Yueyi

本地优先的 AI 记忆库。把截图、网页、剪贴板和文件收进一个可检索、可回顾的个人记忆库，OCR 与 LLM 自动整理，数据保存在本机。

Windows 桌面端，基于 **Tauri 2 + React + TypeScript + Rust + SQLite**。

---

## 功能

### 捕获

- 全屏 / 区域截图，自动 OCR
- 剪贴板文本、网页链接、本地文件导入
- 全局快捷键与悬浮速记窗
- 重复内容指纹去重

### AI 整理

- 标题、摘要、标签、分类自动生成
- 结构化字段抽取
- 可配置 OpenAI 兼容接口（DeepSeek 等）
- 有界并发队列、失败重试、同一条记忆不重复分析
- 写回时校验版本，AI 运行期间的手动编辑不会被覆盖

### 组织与检索

- 合集、标签、批量移动
- 智能关联与合集摘要
- SQLite FTS5 trigram 全文检索
- 按时间、类型、标签、合集过滤
- 命令面板

### 回顾与导出

- 今日统计、每日回顾、周回顾
- 提醒与 iCal 导出
- 记忆 Markdown 导出、合集 Markdown 导出
- 数据库备份、全量 JSON 导入 / 导出

### 体验

- 浅色 / 深色主题
- 三列卡片墙、截图缩略图
- 托盘、窗口尺寸记忆、页面滚动位置记忆
- 软删除与回收站

---

## 架构

```text
┌─────────────────────────────────────────────┐
│ React + TypeScript + Zustand + Tailwind     │
│ 页面 / 卡片墙 / 详情抽屉 / 设置              │
└──────────────────────┬──────────────────────┘
                       │ Tauri invoke / event
┌──────────────────────▼──────────────────────┐
│ Rust command layer                          │
│ 记忆 CRUD / 合集 / 搜索 / 导入导出 / 设置    │
├─────────────────────────────────────────────┤
│ worker：AI 分析队列、OCR、网页抓取           │
│ capture：截图、剪贴板、区域选择              │
├─────────────────────────────────────────────┤
│ SQLite + FTS5(trigram) + WAL                 │
│ memories / collections / tags / ai_tasks …   │
└─────────────────────────────────────────────┘
```

### 目录

```text
yueyi-desktop/
├─ src/                    React 前端
│  ├─ components/          卡片、抽屉、布局、通用组件
│  ├─ pages/               时间线、合集、搜索、回顾、设置
│  ├─ stores/              Zustand 状态
│  ├─ services/            Tauri API 封装
│  └─ utils/               图片协议、站点信息、事件
├─ src-tauri/
│  ├─ src/commands.rs      IPC 命令层
│  ├─ src/worker.rs        AI / OCR 工作队列
│  ├─ src/state.rs         数据库、迁移、设置
│  ├─ src/capture.rs       截图与剪贴板
│  ├─ src/ai.rs            模型调用
│  └─ src/transfer.rs      备份与导入导出
├─ scripts/                构建、UI 回归、截图工具
└─ src-tauri/tauri.conf.json
```

### 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2、Rust、WebView2 |
| 前端 | React、TypeScript、Vite、Zustand、Tailwind CSS |
| 数据 | SQLite、FTS5 trigram、WAL |
| AI | OpenAI 兼容 Chat Completions |
| 图片 | 自定义 `yueyi-img` 协议、按需缩略图 |

---

## 数据与隐私

- 默认数据目录：`%USERPROFILE%\YueyiData`
- 数据库：`yueyi.db`
- 记忆、截图、附件均保存在本机
- 仅在调用 AI 时向所配置的模型服务发送必要文本
- 图片协议只允许读取应用自己的 `screenshots/`、`attachments/`

---

## 开发

要求：Node.js 22+、Rust stable、WebView2 Runtime。

```bash
cd yueyi-desktop
npm ci
npm run tauri dev
```

Release 构建：

```bat
cd yueyi-desktop
scripts\build-release.cmd
```

更多开发细节见 [`yueyi-desktop/README.md`](yueyi-desktop/README.md)。

---

## 署名

**QT新月**
