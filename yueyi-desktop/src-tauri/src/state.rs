// ============ 状态与数据库初始化 ============

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::AppHandle;

pub struct AppState {
    pub db: Mutex<Connection>,
}

/// 读取 AI 配置：优先本地 SQLite settings，缺失时回退环境变量
/// （绝不硬编码 Key，.env 仅用于本地开发）
pub fn load_ai_config(conn: &Connection) -> crate::ai::AiConfig {
    let mut api_key = get_setting(conn, "api_key");
    if api_key.trim().is_empty() {
        if let Ok(env_key) = std::env::var("DEEPSEEK_API_KEY") {
            let env_key = env_key.trim().to_string();
            if !env_key.is_empty() {
                api_key = env_key;
            }
        }
    }
    let mut base_url = get_setting(conn, "base_url");
    if base_url.trim().is_empty() {
        base_url = std::env::var("DEEPSEEK_BASE_URL")
            .unwrap_or_else(|_| "https://api.deepseek.com".into());
    }
    let mut model = get_setting(conn, "model");
    if model.trim().is_empty() {
        model = std::env::var("DEEPSEEK_MODEL").unwrap_or_else(|_| "deepseek-chat".into());
    }
    crate::ai::AiConfig { api_key, base_url, model }
}

static RESOLVED_DATA_DIR: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

fn is_dir_writable(dir: &std::path::Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let _ = std::fs::create_dir_all(dir.join("screenshots"));
    let _ = std::fs::create_dir_all(dir.join("attachments"));
    let probe = dir.join(".yueyi_write_probe");
    match std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// 数据目录优先级：
/// 1. 环境变量 YUEYI_DATA_DIR（若可写）
/// 2. 默认 <home>/YueyiData（若可写）
/// 3. 便携回退目录（当安全软件/受控文件夹拦截用户主目录或 AppData 写入返回 os error 5 时自动启用，并迁移已有数据库与截图）
pub fn data_dir() -> std::path::PathBuf {
    RESOLVED_DATA_DIR
        .get_or_init(|| {
            let mut candidates: Vec<std::path::PathBuf> = Vec::new();
            if let Ok(dir) = std::env::var("YUEYI_DATA_DIR") {
                if !dir.trim().is_empty() {
                    candidates.push(std::path::PathBuf::from(dir));
                }
            }
            let home_yueyi = dirs::home_dir().map(|h| h.join("YueyiData"));
            if let Some(ref hm) = home_yueyi {
                candidates.push(hm.clone());
            }
            if let Ok(exe) = std::env::current_exe() {
                if let Some(exe_dir) = exe.parent() {
                    if let Some(proj_root) = exe_dir
                        .parent()
                        .and_then(|p| p.parent())
                        .and_then(|p| p.parent())
                    {
                        candidates.push(proj_root.join("YueyiData"));
                    }
                    candidates.push(exe_dir.join("YueyiData"));
                }
            }
            candidates.push(std::env::temp_dir().join("YueyiData"));

            let chosen = candidates
                .into_iter()
                .find(|c| is_dir_writable(c))
                .unwrap_or_else(|| std::env::temp_dir().join("YueyiData"));

            if let Some(old_dir) = home_yueyi {
                if old_dir != chosen {
                    let old_db = old_dir.join("yueyi.db");
                    let new_db = chosen.join("yueyi.db");
                    if old_db.exists() && !new_db.exists() {
                        let _ = std::fs::copy(&old_db, &new_db);
                        if let Ok(entries) = std::fs::read_dir(old_dir.join("screenshots")) {
                            for entry in entries.flatten() {
                                let dest = chosen.join("screenshots").join(entry.file_name());
                                if !dest.exists() {
                                    let _ = std::fs::copy(entry.path(), dest);
                                }
                            }
                        }
                    }
                }
            }
            chosen
        })
        .clone()
}

pub fn db_path() -> std::path::PathBuf {
    data_dir().join("yueyi.db")
}

/// WebView2 独立用户数据目录：固定在 <data_dir>/webview2 下，规避 Windows 下
/// 未签名二进制访问 AppData\Local\<identifier> 时触发 0x800700AA / os error 5 导致的白屏崩溃。
pub fn webview_data_dir() -> std::path::PathBuf {
    let dir = data_dir().join("webview2");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    color TEXT DEFAULT '#2DD4A7',
    sort_order INTEGER DEFAULT 0,
    goal TEXT DEFAULT '',
    summary TEXT DEFAULT '',
    summary_at TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT DEFAULT '',
    content TEXT DEFAULT '',
    summary TEXT DEFAULT '',
    type TEXT DEFAULT 'note',
    kind TEXT DEFAULT 'note',
    source TEXT DEFAULT 'manual',
    source_url TEXT DEFAULT '',
    file_path TEXT DEFAULT '',
    ocr_text TEXT DEFAULT '',
    content_hash TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
    ai_status TEXT DEFAULT 'pending',
    ai_summary TEXT DEFAULT '',
    ai_category TEXT DEFAULT '',
    metadata TEXT DEFAULT '{}',
    deleted_at TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS memory_tags (
    memory_id INTEGER REFERENCES memories(id) ON DELETE CASCADE,
    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (memory_id, tag_id)
);

CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id INTEGER REFERENCES memories(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    mime TEXT DEFAULT '',
    size INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS ai_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id INTEGER REFERENCES memories(id) ON DELETE CASCADE,
    task_type TEXT DEFAULT 'analyze',
    status TEXT DEFAULT 'pending',
    error TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    finished_at TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS search_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    result_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
);

-- 结构化字段：从截图/文档里抽出的可执行信息
CREATE TABLE IF NOT EXISTS memory_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    normalized TEXT DEFAULT '',
    confidence REAL DEFAULT 0.5,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_fields_memory ON memory_fields(memory_id);

-- 智能合集：合集与记忆的多对多关联（保留来源与置信度）
CREATE TABLE IF NOT EXISTS collection_memories (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    score REAL DEFAULT 0,
    source TEXT DEFAULT 'auto',
    status TEXT DEFAULT 'confirmed',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (collection_id, memory_id)
);
CREATE INDEX IF NOT EXISTS idx_colmem_memory ON collection_memories(memory_id);

-- 提醒：来自字段 deadline / event_start 或用户手动设置
CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id INTEGER REFERENCES memories(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    remind_at TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    fired INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_reminders_time ON reminders(remind_at);

CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_collection ON memories(collection_id);
"#;

const FTS_SCHEMA: &str = r#"
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    title,
    content,
    summary,
    ai_summary,
    ocr_text,
    content='memories',
    content_rowid='id',
    tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, title, content, summary, ai_summary, ocr_text)
    VALUES (new.id, new.title, new.content, new.summary, new.ai_summary, new.ocr_text);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, title, content, summary, ai_summary, ocr_text)
    VALUES ('delete', old.id, old.title, old.content, old.summary, old.ai_summary, old.ocr_text);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, title, content, summary, ai_summary, ocr_text)
    VALUES ('delete', old.id, old.title, old.content, old.summary, old.ai_summary, old.ocr_text);
    INSERT INTO memories_fts(rowid, title, content, summary, ai_summary, ocr_text)
    VALUES (new.id, new.title, new.content, new.summary, new.ai_summary, new.ocr_text);
END;

"#;

const DEFAULT_SETTINGS: &[(&str, &str)] = &[
    ("api_key", ""),
    ("base_url", "https://api.deepseek.com"),
    ("model", "deepseek-chat"),
    ("shortcut_screenshot", "Alt+Shift+S"),
    ("shortcut_quick_note", "Alt+Shift+M"),
    ("shortcut_search", "Ctrl+K"),
    ("auto_analyze", "true"),
    ("launch_at_login", "false"),
    // 默认：最小化回任务栏、关闭直接退出（符合 Windows 常规习惯，可在设置里改回托盘）
    ("minimize_to_tray", "false"),
    ("close_to_tray", "false"),
    ("clipboard_watch", "false"),
    ("daily_review", "true"),
    ("onboarding_done", "false"),
];

const DEFAULT_COLLECTIONS: &[(&str, &str, &str)] = &[
    ("学习资料", "#68A8FF", "课程笔记、技术文档与核心学习资料"),
    ("论文阅读", "#E08BC0", "前沿论文、学术文献与实验记录"),
    ("工作记录", "#A58BFF", "会议纪要、项目推进与日常工作归档"),
    ("灵感碎片", "#F0B85B", "随时闪现的创意、想法与思考片段"),
    ("生活日常", "#5BC0F8", "生活点滴、阅读摘录与个人备忘"),
    ("待整理", "#8A98B8", "尚未归类的临时捕获内容"),
];

pub fn init_db() -> rusqlite::Result<Connection> {
    let conn = Connection::open(db_path())?;
    let _ = conn.busy_timeout(std::time::Duration::from_millis(5000));
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");
    conn.execute_batch(SCHEMA)?;
    // 增量迁移：老库补 kind / content_hash（结构化字段与去重）
    let _ = conn.execute(
        "ALTER TABLE memories ADD COLUMN kind TEXT DEFAULT 'note'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE memories ADD COLUMN content_hash TEXT DEFAULT ''",
        [],
    );
    // 新列建好后再建索引（老库顺序很关键，否则启动即失败）
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(content_hash)",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind)",
        [],
    );
    // 增量迁移：合集目标与智能摘要
    let _ = conn.execute("ALTER TABLE collections ADD COLUMN goal TEXT DEFAULT ''", []);
    let _ = conn.execute(
        "ALTER TABLE collections ADD COLUMN summary TEXT DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE collections ADD COLUMN summary_at TEXT DEFAULT ''",
        [],
    );
    // FTS 分词器升级：默认 unicode61 对中文几乎不可用，切到 trigram（一次性重建）
    if get_setting(&conn, "fts_version") != "trigram1" {
        let _ = conn.execute_batch(
            "DROP TRIGGER IF EXISTS memories_ai;
             DROP TRIGGER IF EXISTS memories_ad;
             DROP TRIGGER IF EXISTS memories_au;
             DROP TABLE IF EXISTS memories_fts;",
        );
        let _ = conn.execute_batch(FTS_SCHEMA);
        let _ = conn.execute("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')", []);
        let _ = set_setting(&conn, "fts_version", "trigram1");
    }
    // 增量迁移：老库补 deleted_at（软删除/回收站），已存在时报错可忽略
    let _ = conn.execute(
        "ALTER TABLE memories ADD COLUMN deleted_at TEXT DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_memories_deleted ON memories(deleted_at)",
        [],
    );
    let _ = conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_memories_deleted_created ON memories(deleted_at, created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_memories_coll_deleted_created ON memories(collection_id, deleted_at, created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_ai_tasks_memory_status ON ai_tasks(memory_id, status);
         CREATE INDEX IF NOT EXISTS idx_memory_tags_tag_memory ON memory_tags(tag_id, memory_id);
         CREATE INDEX IF NOT EXISTS idx_reminders_state_time ON reminders(done, fired, remind_at);
         CREATE INDEX IF NOT EXISTS idx_attachments_memory ON attachments(memory_id);",
    );
    // 老数据回填：已归属合集的记忆补进关联表
    let _ = conn.execute(
        "INSERT OR IGNORE INTO collection_memories(collection_id, memory_id, source, status)
         SELECT collection_id, id, 'legacy', 'confirmed' FROM memories
         WHERE collection_id IS NOT NULL AND COALESCE(deleted_at,'') = ''",
        [],
    );
    // 增量迁移：合集排序字段（老库首次补列时按 id 初始化）
    if conn
        .execute(
            "ALTER TABLE collections ADD COLUMN sort_order INTEGER DEFAULT 0",
            [],
        )
        .is_ok()
    {
        let _ = conn.execute("UPDATE collections SET sort_order = id", []);
    }
    // 外键约束（删除合集时记忆 collection_id 置 NULL）
    let _ = conn.pragma_update(None, "foreign_keys", "ON");
    // 默认设置
    for (k, v) in DEFAULT_SETTINGS {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO settings(key, value) VALUES (?1, ?2)",
            rusqlite::params![k, v],
        );
    }
    // 默认合集（含描述与星月蓝配色同步）
    for (name, color, desc) in DEFAULT_COLLECTIONS {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO collections(name, color, description) VALUES (?1, ?2, ?3)",
            rusqlite::params![name, color, desc],
        );
        let _ = conn.execute(
            "UPDATE collections SET description = ?1 WHERE name = ?2 AND (description IS NULL OR description = '')",
            rusqlite::params![desc, name],
        );
    }
    let _ = conn.execute(
        "UPDATE collections SET color = '#68A8FF' WHERE name = '学习资料' AND color = '#2DD4A7'",
        [],
    );
    Ok(conn)
}

pub fn get_setting(conn: &Connection, key: &str) -> String {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |r| r.get(0),
    )
    .unwrap_or_default()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

/// 加载本地 .env（开发期/便携部署用；Git 已忽略该文件）
/// 候选路径：src-tauri/.env → 项目根 .env → exe 同目录 .env
/// 规则：只补充「尚未设置」的环境变量，不覆盖系统环境变量。
pub fn load_env_file() {
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidates: Vec<std::path::PathBuf> = vec![
        manifest_dir.join(".env"),
        manifest_dir.join("..").join(".env"),
    ];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(".env"));
            candidates.push(dir.join("..").join(".env"));
        }
    }
    for path in candidates {
        if let Ok(content) = std::fs::read_to_string(&path) {
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((key, value)) = line.split_once('=') {
                    let key = key.trim();
                    let value = value
                        .trim()
                        .trim_matches('"')
                        .trim_matches('\'')
                        .to_string();
                    if key.is_empty() || value.is_empty() {
                        continue;
                    }
                    if std::env::var(key).is_err() {
                        std::env::set_var(key, value);
                    }
                }
            }
            break;
        }
    }
}

pub fn init_state(app: &AppHandle) {
    load_env_file();
    use tauri::Manager;
    let conn = init_db().expect("数据库初始化失败");
    // 恢复上次异常中断在 processing 状态的记忆
    let _ = conn.execute(
        "UPDATE memories SET ai_status = 'pending' WHERE ai_status = 'processing'",
        [],
    );
    // 自愈修复历史旧版本 P0-1 遗留的「全部 AI 失败却被错误标为 done（标题、摘要、分析全空）」的记忆
    let _ = conn.execute(
        "UPDATE memories SET ai_status = 'failed'
         WHERE ai_status = 'done' AND title = '' AND summary = '' AND ai_summary = ''",
        [],
    );
    // API Key 智能自愈与环境同步：
    // 若数据库中的 api_key 为空、或为已废弃的失效 key，
    // 且环境变量 / .env 中存在 DEEPSEEK_API_KEY，自动将最新有效 key 写入数据库，并将之前失败的记忆重新排队分析
    if let Ok(env_key) = std::env::var("DEEPSEEK_API_KEY") {
        let env_key = env_key.trim();
        if !env_key.is_empty() {
            let cur_key = get_setting(&conn, "api_key");
            if cur_key.trim().is_empty() {
                let _ = set_setting(&conn, "api_key", env_key);
                let _ = conn.execute(
                    "UPDATE memories SET ai_status = 'pending' WHERE ai_status = 'failed' AND (ai_summary = '' OR ai_summary IS NULL)",
                    [],
                );
                // 重置重试失败计数，以便后台重试队列立即接管
                let _ = conn.execute("DELETE FROM ai_tasks WHERE error LIKE '%401%' OR error LIKE '%未配置%'", []);
                eprintln!("[AI Config] 已自动同步环境变量/.env中的有效 DEEPSEEK_API_KEY 到数据库");
            }
        }
    }
    app.manage(AppState { db: Mutex::new(conn) });
    crate::worker::spawn_retry_failed_memories(app.clone());
    crate::worker::start_periodic_retry_worker(app.clone());
    crate::worker::start_reminder_worker(app.clone());
}
