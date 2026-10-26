// ============ Tauri 命令层：全部前端可调用接口 ============

use crate::ai::AiService;
use crate::prompts;
use crate::state::{data_dir, db_path, get_setting, set_setting, AppState};
use crate::worker;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, State};


// ---------- 数据结构 ----------

#[derive(Serialize, Clone, Debug)]
pub struct MemoryField {
    pub key: String,
    pub value: String,
    pub normalized: String,
    pub confidence: f64,
}

#[derive(Serialize, Clone, Debug)]
pub struct Memory {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub summary: String,
    #[serde(rename = "type")]
    pub r#type: String,
    pub kind: String,
    pub source: String,
    pub source_url: String,
    pub file_path: String,
    pub ocr_text: String,
    pub created_at: String,
    pub updated_at: String,
    pub collection_id: Option<i64>,
    pub collection_name: Option<String>,
    pub collection_color: Option<String>,
    pub tags: Vec<String>,
    pub fields: Vec<MemoryField>,
    pub ai_status: String,
    pub ai_summary: String,
    pub ai_category: String,
    pub metadata: serde_json::Value,
}

#[derive(Serialize, Clone)]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub color: String,
    pub goal: String,
    pub summary: String,
    pub summary_at: String,
    pub count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize)]
pub struct CreateMemoryInput {
    pub title: Option<String>,
    pub content: String,
    #[serde(rename = "type")]
    pub r#type: String,
    pub source: Option<String>,
    pub source_url: Option<String>,
    pub file_path: Option<String>,
    pub ocr_text: Option<String>,
    pub collection_id: Option<i64>,
    pub tags: Option<Vec<String>>,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub memory: Memory,
    pub score: f64,
    pub snippet: String,
}

#[derive(Serialize)]
pub struct AiAnswer {
    pub answer: String,
    pub citations: Vec<Citation>,
    pub mode: String, // "memory" | "none"
}

#[derive(Serialize, Clone)]
pub struct Citation {
    pub index: usize,
    pub memory_id: i64,
    pub title: String,
}

#[derive(Serialize)]
pub struct TodayStats {
    pub total: i64,
    pub screenshots: i64,
    pub links: i64,
    pub texts: i64,
    /// 全量未删除记忆数（不随时间/合集筛选变化）
    pub total_all: i64,
    pub trend: Vec<i64>,
}

#[derive(Serialize)]
pub struct AppSettings {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub shortcut_screenshot: String,
    pub shortcut_quick_note: String,
    pub shortcut_search: String,
    pub api_key_set: bool,
    pub auto_analyze: bool,
    pub launch_at_login: bool,
    pub minimize_to_tray: bool,
    pub close_to_tray: bool,
    pub clipboard_watch: bool,
    pub daily_review: bool,
    pub onboarding_done: bool,
}

// ---------- 查询辅助 ----------

fn load_tags(conn: &Connection, memory_id: i64) -> Vec<String> {
    let mut stmt = match conn.prepare(
        "SELECT t.name FROM tags t
         JOIN memory_tags mt ON mt.tag_id = t.id
         WHERE mt.memory_id = ?1 ORDER BY t.name",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map(rusqlite::params![memory_id], |r| r.get::<_, String>(0))
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
}

fn memory_by_id(conn: &Connection, id: i64) -> Option<Memory> {
    conn.query_row(
        "SELECT m.id, m.title, m.content, m.summary, m.type, m.source, m.source_url,
                m.file_path, m.ocr_text, m.created_at, m.updated_at, m.collection_id,
                m.ai_status, m.ai_summary, m.ai_category, m.metadata,
                c.name, c.color, m.kind
         FROM memories m LEFT JOIN collections c ON c.id = m.collection_id
         WHERE m.id = ?1",
        rusqlite::params![id],
        |r| {
            Ok(Memory {
                id: r.get(0)?,
                title: r.get(1)?,
                content: r.get(2)?,
                summary: r.get(3)?,
                r#type: r.get(4)?,
                kind: r.get(18)?,
                source: r.get(5)?,
                source_url: r.get(6)?,
                file_path: r.get(7)?,
                ocr_text: r.get(8)?,
                created_at: r.get(9)?,
                updated_at: r.get(10)?,
                collection_id: r.get(11)?,
                collection_name: r.get(16)?,
                collection_color: r.get(17)?,
                // 不能在闭包内再借用 conn（会死锁），改为在外部补充
                tags: Vec::new(),
                fields: Vec::new(),
                ai_status: r.get(12)?,
                ai_summary: r.get(13)?,
                ai_category: r.get(14)?,
                metadata: serde_json::from_str(&r.get::<_, String>(15)?).unwrap_or(serde_json::json!({})),
            })
        },
    )
    .map(|mut m| {
        m.tags = load_tags(conn, id);
        m.fields = load_fields(conn, id);
        m
    })
    .ok()
}

fn load_fields(conn: &Connection, id: i64) -> Vec<MemoryField> {    let Ok(mut stmt) = conn.prepare(
        "SELECT key, value, normalized, confidence FROM memory_fields
         WHERE memory_id = ?1 ORDER BY id",
    ) else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map(rusqlite::params![id], |r| {
        Ok(MemoryField {
            key: r.get(0)?,
            value: r.get(1)?,
            normalized: r.get(2)?,
            confidence: r.get(3)?,
        })
    }) else {
        return Vec::new();
    };
    rows.filter_map(|r| r.ok()).collect()
}

// ============ 记忆 CRUD ============

/// 稳定的内容指纹：用于剪贴板/拖拽/重复导入去重
pub fn content_hash_of(text: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.trim().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[tauri::command]
pub fn list_memories(
    range: String,
    collection_id: Option<i64>,
    state: State<AppState>,
) -> Result<Vec<Memory>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let range_sql = match range.as_str() {
        "today" => "AND m.created_at >= date('now','localtime','start of day')",
        "week" => "AND m.created_at >= date('now','localtime','-6 days','start of day')",
        "month" => "AND m.created_at >= date('now','localtime','start of month')",
        _ => "",
    };
    let coll_sql = if collection_id.is_some() {
        "AND (m.collection_id = ?1 OR EXISTS(SELECT 1 FROM collection_memories cm WHERE cm.collection_id = ?1 AND cm.memory_id = m.id AND cm.status = 'confirmed'))"
    } else {
        ""
    };
    let sql = format!(
        "SELECT m.id FROM memories m WHERE COALESCE(m.deleted_at,'') = '' {} {} ORDER BY m.created_at DESC LIMIT 500",
        range_sql, coll_sql
    );
    let ids: Vec<i64> = if collection_id.is_some() {
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        stmt.query_map(rusqlite::params![collection_id], |r| r.get(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .map_err(|e| e.to_string())?
    } else {
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        stmt.query_map([], |r| r.get(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .map_err(|e| e.to_string())?
    };
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");

    // 1) 一次取主记录
    let sql = format!(
        "SELECT m.id, m.title, m.content, m.summary, m.type, m.source, m.source_url,
                m.file_path, m.ocr_text, m.created_at, m.updated_at, m.collection_id,
                m.ai_status, m.ai_summary, m.ai_category, m.metadata,
                c.name, c.color, m.kind
         FROM memories m LEFT JOIN collections c ON c.id = m.collection_id
         WHERE m.id IN ({})",
        placeholders
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(ids.iter()), |r| {
            Ok(Memory {
                id: r.get(0)?,
                title: r.get(1)?,
                content: r.get(2)?,
                summary: r.get(3)?,
                r#type: r.get(4)?,
                kind: r.get(18)?,
                source: r.get(5)?,
                source_url: r.get(6)?,
                file_path: r.get(7)?,
                ocr_text: r.get(8)?,
                created_at: r.get(9)?,
                updated_at: r.get(10)?,
                collection_id: r.get(11)?,
                collection_name: r.get(16)?,
                collection_color: r.get(17)?,
                tags: Vec::new(),
                fields: Vec::new(),
                ai_status: r.get(12)?,
                ai_summary: r.get(13)?,
                ai_category: r.get(14)?,
                metadata: serde_json::from_str(&r.get::<_, String>(15)?)
                    .unwrap_or(serde_json::json!({})),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect::<Vec<Memory>>();
    drop(stmt);

    // 2) 批量取标签
    let mut tag_map: HashMap<i64, Vec<String>> = HashMap::new();
    let tag_sql = format!(
        "SELECT mt.memory_id, t.name FROM memory_tags mt
         JOIN tags t ON t.id = mt.tag_id
         WHERE mt.memory_id IN ({}) ORDER BY t.name",
        placeholders
    );
    if let Ok(mut stmt) = conn.prepare(&tag_sql) {
        if let Ok(rows) = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        }) {
            for (mid, name) in rows.flatten() {
                tag_map.entry(mid).or_default().push(name);
            }
        }
    }

    // 3) 批量取结构化字段
    let mut field_map: HashMap<i64, Vec<MemoryField>> = HashMap::new();
    let field_sql = format!(
        "SELECT memory_id, key, value, normalized, confidence FROM memory_fields
         WHERE memory_id IN ({}) ORDER BY id",
        placeholders
    );
    if let Ok(mut stmt) = conn.prepare(&field_sql) {
        if let Ok(rows) = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |r| {
            Ok((
                r.get::<_, i64>(0)?,
                MemoryField {
                    key: r.get(1)?,
                    value: r.get(2)?,
                    normalized: r.get(3)?,
                    confidence: r.get(4)?,
                },
            ))
        }) {
            for (mid, field) in rows.flatten() {
                field_map.entry(mid).or_default().push(field);
            }
        }
    }

    // 4) 按时间顺序组装并挂上关系
    let mut by_id: HashMap<i64, Memory> = rows.into_iter().map(|m| (m.id, m)).collect();
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(mut m) = by_id.remove(&id) {
            m.tags = tag_map.remove(&id).unwrap_or_default();
            m.fields = field_map.remove(&id).unwrap_or_default();
            out.push(m);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn get_memory(id: i64, state: State<AppState>) -> Result<Option<Memory>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(memory_by_id(&conn, id))
}

#[tauri::command]
pub fn create_memory(
    app: AppHandle,
    input: CreateMemoryInput,
    state: State<AppState>,
) -> Result<Memory, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let title = input.title.unwrap_or_default();
    let content = input.content;
    let mtype = input.r#type;
    let source = input.source.unwrap_or_else(|| "manual".into());
    let source_url = input.source_url.unwrap_or_default();
    let file_path = input.file_path.unwrap_or_default();
    let ocr_text = input.ocr_text.unwrap_or_default();
    let collection_id = input.collection_id;

    // 去重：优先用正文哈希，其次 URL / 文件路径
    let hash_src = if !content.trim().is_empty() {
        content.trim().to_string()
    } else if !source_url.trim().is_empty() {
        source_url.trim().to_string()
    } else if !file_path.trim().is_empty() {
        file_path.trim().to_string()
    } else {
        String::new()
    };
    let hash = if hash_src.is_empty() {
        String::new()
    } else {
        content_hash_of(&hash_src)
    };
    if !hash.is_empty() {
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM memories WHERE content_hash = ?1 AND COALESCE(deleted_at,'') = '' LIMIT 1",
                rusqlite::params![hash],
                |r| r.get(0),
            )
            .ok();
        if let Some(id) = existing {
            if let Some(m) = memory_by_id(&conn, id) {
                return Ok(m);
            }
        }
    }

    let kind = match mtype.as_str() {
        "link" => "link",
        "code" => "snippet",
        "document" | "pdf" => "file",
        _ => "note",
    };

    conn.execute(
        "INSERT INTO memories(title, content, type, kind, source, source_url, file_path, ocr_text,
         content_hash, collection_id, created_at, updated_at, ai_status, metadata)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11,'pending','{}')",
        rusqlite::params![
            title,
            content,
            mtype,
            kind,
            source,
            source_url,
            file_path,
            ocr_text,
            hash,
            collection_id,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();

    if let Some(cid) = collection_id {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO collection_memories(collection_id, memory_id, source, status)
             VALUES (?1, ?2, 'manual', 'confirmed')",
            rusqlite::params![cid, id],
        );
    }

    if let Some(tags) = input.tags {
        for tag in tags {
            let _ = conn.execute("INSERT OR IGNORE INTO tags(name) VALUES (?1)", rusqlite::params![tag]);
            if let Ok(tid) = conn.query_row("SELECT id FROM tags WHERE name = ?1", rusqlite::params![tag], |r| r.get::<_, i64>(0)) {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO memory_tags(memory_id, tag_id) VALUES (?1, ?2)",
                    rusqlite::params![id, tid],
                );
            }
        }
    }

    let memory = memory_by_id(&conn, id).ok_or("读取失败")?;
    drop(conn);
    worker::spawn_analyze(app, id);
    Ok(memory)
}

#[tauri::command]
pub fn update_memory(id: i64, patch: serde_json::Value, state: State<AppState>) -> Result<Memory, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let obj = patch.as_object().ok_or("patch 必须是对象")?;
    let allowed = ["title", "content", "summary", "ai_summary", "collection_id", "source_url", "kind"];
    for key in allowed {
        if let Some(v) = obj.get(key) {
            let sql = format!(
                "UPDATE memories SET {} = ?1, updated_at = datetime('now','localtime') WHERE id = ?2",
                key
            );
            let _ = match v {
                serde_json::Value::Null => conn.execute(&sql, rusqlite::params![Option::<i64>::None, id]),
                serde_json::Value::String(s) => conn.execute(&sql, rusqlite::params![s, id]),
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        conn.execute(&sql, rusqlite::params![i, id])
                    } else {
                        conn.execute(&sql, rusqlite::params![n.to_string(), id])
                    }
                }
                other => conn.execute(&sql, rusqlite::params![other.to_string(), id]),
            };
        }
    }
    if obj.get("collection_id").is_some() {
        let new_cid = obj.get("collection_id").and_then(|v| v.as_i64());
        conn.execute(
            "DELETE FROM collection_memories WHERE memory_id = ?1 AND source = 'manual'",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
        if let Some(cid) = new_cid {
            conn.execute(
                "INSERT OR IGNORE INTO collection_memories(collection_id, memory_id, score, source, status)
                 VALUES (?1, ?2, 1.0, 'manual', 'confirmed')",
                rusqlite::params![cid, id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    if let Some(serde_json::Value::Array(arr)) = obj.get("tags") {
        let _ = conn.execute("DELETE FROM memory_tags WHERE memory_id = ?1", rusqlite::params![id]);
        for item in arr {
            if let Some(tag) = item.as_str() {
                let tag = tag.trim();
                if !tag.is_empty() {
                    let _ = conn.execute("INSERT OR IGNORE INTO tags(name) VALUES (?1)", rusqlite::params![tag]);
                    if let Ok(tid) = conn.query_row("SELECT id FROM tags WHERE name = ?1", rusqlite::params![tag], |r| r.get::<_, i64>(0)) {
                        let _ = conn.execute(
                            "INSERT OR IGNORE INTO memory_tags(memory_id, tag_id) VALUES (?1, ?2)",
                            rusqlite::params![id, tid],
                        );
                    }
                }
            }
        }
    }
    memory_by_id(&conn, id).ok_or_else(|| "记忆不存在".into())
}

#[tauri::command]
pub fn delete_memory(id: i64, state: State<AppState>) -> Result<(), String> {
    // 软删除：只打时间戳，记忆与标签关联都保留，可从回收站恢复
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE memories SET deleted_at = datetime('now','localtime') WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 回收站条目（轻量结构，不需要完整 Memory）
#[derive(serde::Serialize)]
pub struct TrashItem {
    pub id: i64,
    pub title: String,
    #[serde(rename = "type")]
    pub r#type: String,
    pub deleted_at: String,
}

#[tauri::command]
pub fn list_trash(state: State<AppState>) -> Result<Vec<TrashItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, type, deleted_at FROM memories
             WHERE COALESCE(deleted_at,'') != ''
             ORDER BY deleted_at DESC LIMIT 200",
        )
        .map_err(|e| e.to_string())?;
    let list = stmt
        .query_map([], |r| {
            Ok(TrashItem {
                id: r.get(0)?,
                title: r.get(1)?,
                r#type: r.get(2)?,
                deleted_at: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(list)
}

#[tauri::command]
pub fn restore_memory(id: i64, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE memories SET deleted_at = '' WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn purge_memory(id: i64, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM memory_tags WHERE memory_id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM memories WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn empty_trash(state: State<AppState>) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM memory_tags WHERE memory_id IN (SELECT id FROM memories WHERE COALESCE(deleted_at,'') != '')",
        [],
    )
    .map_err(|e| e.to_string())?;
    let n = conn
        .execute("DELETE FROM memories WHERE COALESCE(deleted_at,'') != ''", [])
        .map_err(|e| e.to_string())?;
    Ok(n as i64)
}

#[tauri::command]
pub fn move_memories(ids: Vec<i64>, collection_id: Option<i64>, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for id in ids {
        tx.execute(
            "UPDATE memories SET collection_id = ?1, updated_at = datetime('now','localtime') WHERE id = ?2",
            rusqlite::params![collection_id, id],
        )
        .map_err(|e| e.to_string())?;
        // 主合集与多对多关系同步：手动归属以本次目标为准，保留智能关联
        tx.execute(
            "DELETE FROM collection_memories WHERE memory_id = ?1 AND source = 'manual'",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
        if let Some(cid) = collection_id {
            tx.execute(
                "INSERT OR IGNORE INTO collection_memories(collection_id, memory_id, score, source, status)
                 VALUES (?1, ?2, 1.0, 'manual', 'confirmed')",
                rusqlite::params![cid, id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- 相关记忆（当前基于标签交集，未来可换 embedding） ----------

#[tauri::command]
pub fn related_memories(id: i64, state: State<AppState>) -> Result<Vec<Memory>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let tags = load_tags(&conn, id);
    if tags.is_empty() {
        return Ok(vec![]);
    }
    let placeholders = tags.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT DISTINCT m.id, COUNT(t.id) AS overlap
         FROM memories m
         JOIN memory_tags mt ON mt.memory_id = m.id
         JOIN tags t ON t.id = mt.tag_id AND t.name IN ({})
         WHERE m.id != ?{} AND COALESCE(m.deleted_at,'') = '' GROUP BY m.id ORDER BY overlap DESC LIMIT 4",
        placeholders,
        tags.len() + 1
    );
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = tags.iter().map(|t| Box::new(t.clone()) as Box<dyn rusqlite::ToSql>).collect();
    params.push(Box::new(id));
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let ids: Vec<i64> = stmt
        .query_map(rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())), |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(ids.into_iter().filter_map(|mid| memory_by_id(&conn, mid)).collect())
}

#[tauri::command]
pub fn reanalyze_memory(app: AppHandle, id: i64, state: State<AppState>) -> Result<(), String> {
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        // P0-2 修复：严禁在重分析前清空原有的 title / summary / ocr_text，避免 AI 失败时原数据丢失
        conn.execute(
            "UPDATE memories SET ai_status = 'processing' WHERE id = ?1",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
    }
    worker::emit_update(
        &app,
        worker::MemoryUpdated {
            id,
            reason: "processing".into(),
            title: None,
            collection_name: None,
        },
    );
    worker::spawn_analyze_with_opts(app, id, true);
    Ok(())
}

// ---------- 统计 ----------

#[tauri::command]
pub fn today_stats(state: State<AppState>) -> Result<TodayStats, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let q = |sql: &str| -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0)
    };
    let total = q("SELECT COUNT(*) FROM memories WHERE COALESCE(deleted_at,'') = '' AND created_at >= date('now','localtime','start of day')");
    let screenshots = q("SELECT COUNT(*) FROM memories WHERE COALESCE(deleted_at,'') = '' AND type IN ('screenshot','image') AND created_at >= date('now','localtime','start of day')");
    let links = q("SELECT COUNT(*) FROM memories WHERE COALESCE(deleted_at,'') = '' AND type = 'link' AND created_at >= date('now','localtime','start of day')");
    let texts = q("SELECT COUNT(*) FROM memories WHERE COALESCE(deleted_at,'') = '' AND type IN ('text','note','code','clipboard') AND created_at >= date('now','localtime','start of day')");
    let total_all = q("SELECT COUNT(*) FROM memories WHERE COALESCE(deleted_at,'') = ''");

    let mut trend = vec![0i64; 14];
    let mut stmt = conn
        .prepare(
            "SELECT date(created_at) d, COUNT(*) FROM memories
             WHERE COALESCE(deleted_at,'') = ''
               AND created_at >= date('now','localtime','-13 days','start of day')
             GROUP BY d",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    for (d, c) in rows {
        if let Ok(day) = chrono::NaiveDate::parse_from_str(&d, "%Y-%m-%d") {
            let today = chrono::Local::now().date_naive();
            if let Some(diff) = (today - day).num_days().checked_sub(0) {
                if diff < 14 && diff >= 0 {
                    trend[13 - diff as usize] = c;
                }
            }
        }
    }
    Ok(TodayStats { total, screenshots, links, texts, total_all, trend })
}

// ---------- 搜索（FTS5 + 结构化过滤 + 自然语言时间） ----------

#[derive(Default)]
struct SearchFilters {
    text: String,
    from: Option<String>,
    to: Option<String>,
    types: Vec<&'static str>,
}

fn strip_word(text: &mut String, words: &[&str]) -> bool {
    for w in words {
        if text.contains(w) {
            *text = text.replace(w, "");
            return true;
        }
    }
    false
}

fn recent_days(text: &mut String) -> Option<i64> {
    for key in ["最近", "过去", "近"] {
        if let Some(pos) = text.find(key) {
            let rest = &text[pos + key.len()..];
            let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(n) = digits.parse::<i64>() {
                if n > 0 && n <= 365 {
                    let start = pos;
                    let end = pos + key.len() + digits.len();
                    let mut tail = 0;
                    if text[end..].starts_with('天') {
                        tail = '天'.len_utf8();
                    }
                    text.replace_range(start..end + tail, "");
                    return Some(n);
                }
            }
        }
    }
    None
}

fn parse_filters(q: &str) -> SearchFilters {
    use chrono::{Datelike, Duration, NaiveDate};
    let today = chrono::Local::now().date_naive();
    let fmt = |d: NaiveDate| d.format("%Y-%m-%d").to_string();
    let mut text = q.to_string();
    let mut f = SearchFilters::default();

    if strip_word(&mut text, &["今天", "今日"]) {
        f.from = Some(fmt(today));
        f.to = Some(fmt(today + Duration::days(1)));
    } else if strip_word(&mut text, &["昨天", "昨日"]) {
        f.from = Some(fmt(today - Duration::days(1)));
        f.to = Some(fmt(today));
    } else if strip_word(&mut text, &["前天"]) {
        f.from = Some(fmt(today - Duration::days(2)));
        f.to = Some(fmt(today - Duration::days(1)));
    } else if strip_word(&mut text, &["本周", "这周", "本星期"]) {
        let monday = today - Duration::days(today.weekday().num_days_from_monday() as i64);
        f.from = Some(fmt(monday));
        f.to = Some(fmt(today + Duration::days(1)));
    } else if strip_word(&mut text, &["上周", "上个星期"]) {
        let this_monday = today - Duration::days(today.weekday().num_days_from_monday() as i64);
        f.from = Some(fmt(this_monday - Duration::days(7)));
        f.to = Some(fmt(this_monday));
    } else if strip_word(&mut text, &["本月", "这个月"]) {
        let first = NaiveDate::from_ymd_opt(today.year(), today.month(), 1).unwrap_or(today);
        f.from = Some(fmt(first));
        f.to = Some(fmt(today + Duration::days(1)));
    } else if strip_word(&mut text, &["上个月", "上月"]) {
        let first_this = NaiveDate::from_ymd_opt(today.year(), today.month(), 1).unwrap_or(today);
        let first_prev = if today.month() == 1 {
            NaiveDate::from_ymd_opt(today.year() - 1, 12, 1).unwrap_or(first_this)
        } else {
            NaiveDate::from_ymd_opt(today.year(), today.month() - 1, 1).unwrap_or(first_this)
        };
        f.from = Some(fmt(first_prev));
        f.to = Some(fmt(first_this));
    } else if strip_word(&mut text, &["今年"]) {
        let first = NaiveDate::from_ymd_opt(today.year(), 1, 1).unwrap_or(today);
        f.from = Some(fmt(first));
        f.to = Some(fmt(today + Duration::days(1)));
    } else if strip_word(&mut text, &["去年"]) {
        let first = NaiveDate::from_ymd_opt(today.year() - 1, 1, 1).unwrap_or(today);
        let end = NaiveDate::from_ymd_opt(today.year(), 1, 1).unwrap_or(today);
        f.from = Some(fmt(first));
        f.to = Some(fmt(end));
    } else if let Some(n) = recent_days(&mut text) {
        f.from = Some(fmt(today - Duration::days(n - 1)));
        f.to = Some(fmt(today + Duration::days(1)));
    }

    if strip_word(&mut text, &["截图", "截屏"]) {
        f.types.push("screenshot");
    } else if strip_word(&mut text, &["图片", "照片"]) {
        f.types.push("image");
        f.types.push("screenshot");
    } else if strip_word(&mut text, &["链接", "网页"]) {
        f.types.push("link");
    } else if strip_word(&mut text, &["文档", "PDF", "pdf"]) {
        f.types.push("document");
        f.types.push("pdf");
    } else if strip_word(&mut text, &["代码", "片段"]) {
        f.types.push("code");
    } else if strip_word(&mut text, &["笔记", "速记"]) {
        f.types.push("note");
        f.types.push("text");
    }

    f.text = text
        .replace('的', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    f
}

fn build_snippet(m: &Memory, query: &str) -> String {
    for candidate in [&m.title, &m.summary, &m.ai_summary, &m.content, &m.ocr_text] {
        if !candidate.is_empty() && candidate.to_lowercase().contains(&query.to_lowercase()) {
            return make_snippet(candidate, query, 140);
        }
    }
    if !m.summary.is_empty() {
        return make_snippet(&m.summary, query, 140);
    }
    make_snippet(&m.title, query, 140)
}

#[tauri::command]
pub fn search_memories(
    query: String,
    record: Option<bool>,
    state: State<AppState>,
) -> Result<Vec<SearchResult>, String> {
    let raw = query.trim().to_string();
    if raw.is_empty() {
        return Ok(vec![]);
    }
    let filters = parse_filters(&raw);
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut base_filter = String::from(" AND COALESCE(m.deleted_at,'') = ''");
    if let Some(from) = &filters.from {
        base_filter.push_str(&format!(" AND m.created_at >= '{}'", from));
    }
    if let Some(to) = &filters.to {
        base_filter.push_str(&format!(" AND m.created_at < '{}'", to));
    }
    if !filters.types.is_empty() {
        let list = filters
            .types
            .iter()
            .map(|t| format!("'{}'", t))
            .collect::<Vec<_>>()
            .join(",");
        base_filter.push_str(&format!(" AND m.type IN ({})", list));
    }

    let has_text = !filters.text.is_empty();
    // trigram 分词要求每个词至少 3 个字，否则走 LIKE 兜底
    let fts_ok = !filters.text.is_empty()
        && filters
            .text
            .split_whitespace()
            .all(|t| t.chars().count() >= 3);
    let terms: Vec<String> = filters
        .text
        .split_whitespace()
        .map(|t| t.to_lowercase())
        .collect();
    let mut ranked: Vec<(i64, f64)> = Vec::new();

    if has_text && fts_ok {
        let match_expr = filters
            .text
            .split_whitespace()
            .map(|t| format!("\"{}\"", t.replace('"', " ")))
            .collect::<Vec<_>>()
            .join(" ");
        let sql = format!(
            "SELECT f.rowid, bm25(memories_fts) AS rank
             FROM memories_fts f JOIN memories m ON m.id = f.rowid
             WHERE memories_fts MATCH ?1 {} ORDER BY rank LIMIT 80",
            base_filter
        );
        if let Ok(mut stmt) = conn.prepare(&sql) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![match_expr], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?))
            }) {
                ranked = rows.filter_map(|r| r.ok()).collect();
            }
        }
    }

    // 2 字中文 / FTS 未命中：回退到 LIKE 打分（同时覆盖标签）
    if ranked.is_empty() && has_text {
        let sql = format!(
            "SELECT m.id, m.title, m.summary, m.ai_summary, m.content, m.ocr_text
             FROM memories m WHERE 1=1 {}",
            base_filter
        );
        if let Ok(mut stmt) = conn.prepare(&sql) {
            if let Ok(rows) = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                ))
            }) {
                for (id, title, summary, ai_summary, content, ocr) in rows.flatten() {
                    let t = title.to_lowercase();
                    let sm = summary.to_lowercase();
                    let ai = ai_summary.to_lowercase();
                    let ct = content.to_lowercase();
                    let oc = ocr.to_lowercase();
                    let all_present = terms.iter().all(|term| {
                        t.contains(term)
                            || sm.contains(term)
                            || ai.contains(term)
                            || ct.contains(term)
                            || oc.contains(term)
                    });
                    if !all_present {
                        continue;
                    }
                    let mut score = 0.0f64;
                    for term in &terms {
                        if t.contains(term) {
                            score += 5.0;
                        }
                        if sm.contains(term) || ai.contains(term) {
                            score += 2.5;
                        }
                        if ct.contains(term) {
                            score += 1.5;
                        }
                        if oc.contains(term) {
                            score += 1.0;
                        }
                    }
                    ranked.push((id, -(score)));
                }
            }
        }
        // 标签命中
        let tag_sql = format!(
            "SELECT DISTINCT mt.memory_id, t.name FROM memory_tags mt
             JOIN tags t ON t.id = mt.tag_id
             JOIN memories m ON m.id = mt.memory_id
             WHERE 1=1 {}",
            base_filter
        );
        if let Ok(mut stmt) = conn.prepare(&tag_sql) {
            if let Ok(rows) = stmt.query_map([], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            }) {
                for (id, tag) in rows.flatten() {
                    let tl = tag.to_lowercase();
                    if terms.iter().all(|term| tl.contains(term))
                        && !ranked.iter().any(|(rid, _)| *rid == id)
                    {
                        ranked.push((id, -3.0));
                    }
                }
            }
        }
    }

    // 只有时间/类型条件、没有关键词：按时间列最新
    if !has_text {
        let sql = format!(
            "SELECT m.id FROM memories m WHERE 1=1 {} ORDER BY m.created_at DESC LIMIT 60",
            base_filter
        );
        if let Ok(mut stmt) = conn.prepare(&sql) {
            if let Ok(rows) = stmt.query_map([], |r| r.get::<_, i64>(0)) {
                for id in rows.flatten() {
                    ranked.push((id, -1.0));
                }
            }
        }
    }

    let max_abs = ranked
        .iter()
        .map(|(_, r)| r.abs())
        .fold(0.0f64, f64::max)
        .max(1e-9);
    let mut results: Vec<SearchResult> = ranked
        .into_iter()
        .filter_map(|(id, rank)| {
            let m = memory_by_id(&conn, id)?;
            let score = (rank.abs() / max_abs).clamp(0.05, 1.0);
            let snippet = if has_text {
                build_snippet(&m, &filters.text)
            } else {
                m.summary.clone()
            };
            Some(SearchResult { memory: m, score, snippet })
        })
        .collect();

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results.dedup_by(|a, b| a.memory.id == b.memory.id);
    results.truncate(30);

    if record.unwrap_or(true) && raw.chars().count() >= 2 {
        let _ = conn.execute(
            "INSERT INTO search_history(query, result_count) VALUES (?1, ?2)",
            rusqlite::params![raw, results.len() as i64],
        );
    }
    Ok(results)
}

fn make_snippet(text: &str, query: &str, max_len: usize) -> String {
    let clean: String = text.chars().filter(|&c| c != '\n' && c != '\r').collect();
    let lower = clean.to_lowercase();
    let q_lower = query.to_lowercase();
    let char_pos = lower.find(&q_lower).map(|byte_pos| lower[..byte_pos].chars().count());
    match char_pos {
        Some(p) => {
            let start = p.saturating_sub(max_len / 3);
            let chars: Vec<char> = clean.chars().collect();
            let s = start.min(chars.len());
            let e = (s + max_len).min(chars.len());
            let mut snip: String = chars[s..e].iter().collect();
            if s > 0 { snip.insert(0, '…'); }
            if e < chars.len() { snip.push('…'); }
            snip
        }
        None => clean.chars().take(max_len).collect(),
    }
}

// ============ 合集 ============

#[tauri::command]
pub fn list_collections(state: State<AppState>) -> Result<Vec<Collection>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.name, c.description, c.color, c.created_at, c.updated_at,
             (SELECT COUNT(DISTINCT m.id) FROM memories m
                LEFT JOIN collection_memories cm ON cm.memory_id = m.id
                WHERE (m.collection_id = c.id OR (cm.collection_id = c.id AND cm.status = 'confirmed'))
                  AND COALESCE(m.deleted_at,'') = '') AS cnt,
             c.goal, c.summary, c.summary_at
             FROM collections c ORDER BY c.sort_order, c.id",
        )
        .map_err(|e| e.to_string())?;
    let list = stmt
        .query_map([], |r| {
            Ok(Collection {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                color: r.get(3)?,
                goal: r.get(7)?,
                summary: r.get(8)?,
                summary_at: r.get(9)?,
                count: r.get(6)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(list)
}

#[tauri::command]
pub fn reorder_collections(ids: Vec<i64>, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE collections SET sort_order = ?1, updated_at = datetime('now','localtime') WHERE id = ?2",
            rusqlite::params![i as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn create_collection(name: String, color: String, description: String, goal: Option<String>, state: State<AppState>) -> Result<Collection, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let goal = goal.unwrap_or_default();
    conn.execute(
        "INSERT INTO collections(name, color, description, goal, sort_order)
         VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM collections))",
        rusqlite::params![name, color, description, goal],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    Ok(Collection {
        id,
        name,
        description,
        color,
        goal,
        summary: String::new(),
        summary_at: String::new(),
        count: 0,
        created_at: String::new(),
        updated_at: String::new(),
    })
}

#[tauri::command]
pub fn rename_collection(id: i64, name: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE collections SET name = ?1, updated_at = datetime('now','localtime') WHERE id = ?2",
        rusqlite::params![name, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_collection_color(id: i64, color: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE collections SET color = ?1, updated_at = datetime('now','localtime') WHERE id = ?2",
        rusqlite::params![color, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_collection_desc(id: i64, description: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE collections SET description = ?1, updated_at = datetime('now','localtime') WHERE id = ?2",
        rusqlite::params![description, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_collection(id: i64, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    // 记忆移入「待整理」合集；若该合集不存在（被用户删过）再退回未分类
    let pending_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM collections WHERE name = '待整理' LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();
    if let Some(pid) = pending_id {
        if pid != id {
            conn.execute(
                "UPDATE memories SET collection_id = ?1 WHERE collection_id = ?2",
                rusqlite::params![pid, id],
            )
            .map_err(|e| e.to_string())?;
        } else {
            conn.execute(
                "UPDATE memories SET collection_id = NULL WHERE collection_id = ?1",
                rusqlite::params![id],
            )
            .map_err(|e| e.to_string())?;
        }
    } else {
        conn.execute(
            "UPDATE memories SET collection_id = NULL WHERE collection_id = ?1",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
    }
    conn.execute("DELETE FROM collections WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ============ AI 问答（基于检索记忆，严禁编造） ============

#[tauri::command]
pub async fn ai_ask(question: String, state: State<'_, AppState>) -> Result<AiAnswer, String> {
    // 1. 先读取 AI 配置（释放锁后再搜索，避免重复加锁）
    let config = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        crate::state::load_ai_config(&conn)
    };

    if config.api_key.trim().is_empty() {
        return Err("API Key 未配置，请前往设置页填写 DeepSeek API Key".into());
    }

    // 2. 本地搜索 top 8（此时锁已释放）；问答不写入搜索历史
    let results = search_memories(question.clone(), Some(false), state)?;

    // 3. 构造上下文
    let contexts: Vec<String> = results
        .iter()
        .take(8)
        .map(|r| {
            format!(
                "[{}] 标题：{}\n摘要：{}\n内容片段：{}\n时间：{}",
                r.memory.id,
                r.memory.title,
                if r.memory.summary.is_empty() { &r.memory.ai_summary } else { &r.memory.summary },
                &r.memory.content.chars().take(400).collect::<String>(),
                r.memory.created_at
            )
        })
        .collect();

    let n = contexts.len().min(8);
    let citations: Vec<Citation> = results
        .iter()
        .take(n)
        .enumerate()
        .map(|(i, r)| Citation {
            index: i + 1,
            memory_id: r.memory.id,
            title: r.memory.title.clone(),
        })
        .collect();

    // 4. 调用 AI
    let provider = AiService::provider(config);
    let messages = prompts::answer_question(&question, &contexts);
    let answer = provider
        .chat(&messages, Some(900))
        .map_err(|e| e.to_string())?;

    let mode = if n == 0 { "none" } else { "memory" };

    Ok(AiAnswer { answer, citations, mode: mode.to_string() })
}

#[tauri::command]
pub async fn ai_test_connection(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let config = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        crate::state::load_ai_config(&conn)
    };
    let provider = AiService::provider(config);
    match provider.test_connection() {
        Ok(_) => Ok(serde_json::json!({ "ok": true, "message": "已连接" })),
        Err(e) => Ok(serde_json::json!({ "ok": false, "message": e.to_string() })),
    }
}

// ============ 设置 ============

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<AppSettings, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let s_search = {
        let v = get_setting(&conn, "shortcut_search");
        if v.is_empty() { "Ctrl+K".to_string() } else { v }
    };
    let close_tray = {
        let v = get_setting(&conn, "close_to_tray");
        if v.is_empty() { "true".to_string() } else { v }
    };
    let configured_key = {
        let k = get_setting(&conn, "api_key");
        if k.trim().is_empty() {
            std::env::var("DEEPSEEK_API_KEY").unwrap_or_default()
        } else {
            k
        }
    };
    let api_key_set = !configured_key.trim().is_empty();
    Ok(AppSettings {
        // 不再把完整 Key 回传前端；前端只知道是否已配置，更新时留空表示保持不变
        api_key: String::new(),
        api_key_set,
        base_url: get_setting(&conn, "base_url"),
        model: get_setting(&conn, "model"),
        shortcut_screenshot: get_setting(&conn, "shortcut_screenshot"),
        shortcut_quick_note: get_setting(&conn, "shortcut_quick_note"),
        shortcut_search: s_search,
        auto_analyze: get_setting(&conn, "auto_analyze") == "true",
        launch_at_login: get_setting(&conn, "launch_at_login") == "true",
        minimize_to_tray: get_setting(&conn, "minimize_to_tray") == "true",
        close_to_tray: close_tray == "true",
        clipboard_watch: get_setting(&conn, "clipboard_watch") == "true",
        daily_review: {
            let v = get_setting(&conn, "daily_review");
            if v.is_empty() { true } else { v == "true" }
        },
        onboarding_done: get_setting(&conn, "onboarding_done") == "true",
    })
}

fn apply_windows_autostart(enable: bool) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if let Ok(exe) = std::env::current_exe() {
            let exe_str = exe.to_string_lossy().to_string();
            let reg_path = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
            if enable {
                let _ = std::process::Command::new("reg")
                    .creation_flags(0x08000000)
                    .args(["add", reg_path, "/v", "YueyiDesktop", "/t", "REG_SZ", "/d", &format!("\"{}\"", exe_str), "/f"])
                    .output();
            } else {
                let _ = std::process::Command::new("reg")
                    .creation_flags(0x08000000)
                    .args(["delete", reg_path, "/v", "YueyiDesktop", "/f"])
                    .output();
            }
        }
    }
}

#[tauri::command]
pub fn save_settings(app: AppHandle, patch: serde_json::Value, state: State<AppState>) -> Result<AppSettings, String> {
    let mut rebind = false;
    let mut retry_ai = false;
    let (shot_sc, note_sc, search_sc) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        if let Some(obj) = patch.as_object() {
            for (k, v) in obj {
                // 旧前端在 Key 已配置时可能回传空字符串，不能让空值覆盖已保存的 Key
                if k == "api_key" && v.as_str().map(|x| x.trim().is_empty()).unwrap_or(false) {
                    continue;
                }
                let value = match v {
                    serde_json::Value::Bool(b) => if *b { "true" } else { "false" }.to_string(),
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                set_setting(&conn, k, &value).map_err(|e| e.to_string())?;
                if k == "launch_at_login" {
                    apply_windows_autostart(value == "true");
                }
                if k == "shortcut_screenshot" || k == "shortcut_quick_note" || k == "shortcut_search" {
                    rebind = true;
                }
                if (k == "api_key" && !value.trim().is_empty()) || (k == "auto_analyze" && value == "true") {
                    retry_ai = true;
                }
            }
        }
        let s3 = {
            let v = get_setting(&conn, "shortcut_search");
            if v.is_empty() { "Ctrl+K".to_string() } else { v }
        };
        (
            get_setting(&conn, "shortcut_screenshot"),
            get_setting(&conn, "shortcut_quick_note"),
            s3,
        )
    };
    if retry_ai {
        worker::spawn_retry_failed_memories(app.clone());
    }
    if rebind {
        let errs = crate::register_global_shortcuts(&app, &shot_sc, &note_sc, &search_sc);
        if !errs.is_empty() {
            return Err(errs.join("；"));
        }
    }
    get_settings(state)
}

#[tauri::command]
pub fn open_data_dir(_app: AppHandle) -> Result<(), String> {
    let dir = data_dir();
    crate::open_in_explorer(&dir);
    Ok(())
}

#[tauri::command]
pub fn storage_info(state: State<AppState>) -> Result<serde_json::Value, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let memories: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM memories WHERE COALESCE(deleted_at,'') = ''",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let screenshots: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM memories WHERE COALESCE(deleted_at,'') = '' AND type IN ('screenshot','image')",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    drop(conn);

    let db_size = std::fs::metadata(db_path()).map(|m| m.len()).unwrap_or(0);
    let mut attachments: u64 = 0;
    for sub in ["screenshots", "attachments"] {
        if let Ok(entries) = std::fs::read_dir(data_dir().join(sub)) {
            for e in entries.flatten() {
                if let Ok(md) = e.metadata() {
                    attachments += md.len();
                }
            }
        }
    }
    Ok(serde_json::json!({
        "memories": memories,
        "screenshots": screenshots,
        "attachmentsSize": attachments,
        "dbSize": db_size,
    }))
}

#[tauri::command]
pub async fn pick_export_path(app: AppHandle, default_name: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file_path = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("JSON", &["json"])
        .blocking_save_file();
    Ok(file_path.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn pick_import_path(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file_path = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file();
    Ok(file_path.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn pick_backup_path(app: AppHandle, default_name: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file_path = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("SQLite Database", &["db", "sqlite"])
        .blocking_save_file();
    Ok(file_path.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn pick_attachment_file(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file_path = app
        .dialog()
        .file()
        .add_filter("文件 / 图片 / 文档", &["png", "jpg", "jpeg", "webp", "gif", "pdf", "md", "txt", "doc", "docx", "csv", "json"])
        .blocking_pick_file();
    Ok(file_path.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string()))
}


#[tauri::command]
pub fn clear_all_data(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        for table in ["memory_tags", "ai_tasks", "search_history", "attachments", "memories", "tags"] {
            let _ = conn.execute(&format!("DELETE FROM {}", table), []);
        }
        let _ = conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('memories','tags','collections')", []);
    }
    // 清空截图文件
    if let Ok(entries) = std::fs::read_dir(data_dir().join("screenshots")) {
        for e in entries.flatten() {
            let _ = std::fs::remove_file(e.path());
        }
    }
    use tauri::Emitter;
    let _ = app.emit(
        "memory-updated",
        worker::MemoryUpdated { id: 0, reason: "deleted".into(), title: None, collection_name: None },
    );
    Ok(())
}

// ---------- 标签管理 ----------

#[derive(serde::Serialize)]
pub struct TagInfo {
    pub name: String,
    pub count: i64,
}

#[tauri::command]
pub fn list_tags(state: State<AppState>) -> Result<Vec<TagInfo>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT t.name, COUNT(m.id) AS c
             FROM tags t
             JOIN memory_tags mt ON mt.tag_id = t.id
             JOIN memories m ON m.id = mt.memory_id
             WHERE COALESCE(m.deleted_at,'') = ''
             GROUP BY t.id
             ORDER BY c DESC, t.name
             LIMIT 500",
        )
        .map_err(|e| e.to_string())?;
    let list = stmt
        .query_map([], |r| {
            Ok(TagInfo {
                name: r.get(0)?,
                count: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(list)
}

/// 重命名标签；若目标名已存在则自动合并（把关联迁到目标标签后删掉旧标签）
#[tauri::command]
pub fn rename_tag(old: String, new: String, state: State<AppState>) -> Result<(), String> {
    let old = old.trim().to_string();
    let new = new.trim().to_string();
    if old.is_empty() || new.is_empty() {
        return Err("标签名不能为空".into());
    }
    if old == new {
        return Ok(());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let old_id: i64 = conn
        .query_row("SELECT id FROM tags WHERE name = ?1", rusqlite::params![old], |r| r.get(0))
        .map_err(|_| "标签不存在".to_string())?;
    conn.execute("INSERT OR IGNORE INTO tags(name) VALUES (?1)", rusqlite::params![new])
        .map_err(|e| e.to_string())?;
    let new_id: i64 = conn
        .query_row("SELECT id FROM tags WHERE name = ?1", rusqlite::params![new], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO memory_tags(memory_id, tag_id)
         SELECT memory_id, ?1 FROM memory_tags WHERE tag_id = ?2",
        rusqlite::params![new_id, old_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM memory_tags WHERE tag_id = ?1", rusqlite::params![old_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tags WHERE id = ?1", rusqlite::params![old_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_tag(name: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    if let Ok(tid) = conn.query_row("SELECT id FROM tags WHERE name = ?1", rusqlite::params![name], |r| r.get::<_, i64>(0)) {
        let _ = conn.execute("DELETE FROM memory_tags WHERE tag_id = ?1", rusqlite::params![tid]);
        let _ = conn.execute("DELETE FROM tags WHERE id = ?1", rusqlite::params![tid]);
    }
    Ok(())
}

// ---------- 搜索历史 ----------

#[derive(serde::Serialize)]
pub struct SearchHistoryItem {
    pub query: String,
    pub result_count: i64,
    pub created_at: String,
}

#[tauri::command]
pub fn list_search_history(
    limit: Option<i64>,
    state: State<AppState>,
) -> Result<Vec<SearchHistoryItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let n = limit.unwrap_or(8).clamp(1, 50);
    let mut stmt = conn
        .prepare(
            "SELECT query, result_count, MAX(created_at) AS last
             FROM search_history
             GROUP BY query
             ORDER BY last DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let list = stmt
        .query_map(rusqlite::params![n], |r| {
            Ok(SearchHistoryItem {
                query: r.get(0)?,
                result_count: r.get(1)?,
                created_at: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(list)
}

#[tauri::command]
pub fn clear_search_history(state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let _ = conn.execute("DELETE FROM search_history", []);
    Ok(())
}

// ============ 提醒 ============

#[derive(Serialize, Clone)]
pub struct Reminder {
    pub id: i64,
    pub memory_id: Option<i64>,
    pub title: String,
    pub remind_at: String,
    pub done: bool,
    pub fired: bool,
}

fn reminder_from_row(r: &rusqlite::Row) -> rusqlite::Result<Reminder> {
    Ok(Reminder {
        id: r.get(0)?,
        memory_id: r.get(1)?,
        title: r.get(2)?,
        remind_at: r.get(3)?,
        done: r.get::<_, i64>(4)? != 0,
        fired: r.get::<_, i64>(5)? != 0,
    })
}

#[tauri::command]
pub fn list_reminders(state: State<AppState>) -> Result<Vec<Reminder>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, memory_id, title, remind_at, done, fired FROM reminders
             WHERE done = 0 ORDER BY remind_at LIMIT 100",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], reminder_from_row)
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn create_reminder(
    memory_id: Option<i64>,
    title: String,
    remind_at: String,
    state: State<AppState>,
) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO reminders(memory_id, title, remind_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![memory_id, title, remind_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn complete_reminder(id: i64, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE reminders SET done = 1 WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_reminder(id: i64, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM reminders WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ============ 智能合集 ============

#[derive(Serialize)]
pub struct CollectionSuggestion {
    pub memory: Memory,
    pub score: f64,
    pub reason: String,
}

fn collection_candidates(
    conn: &Connection,
    collection_id: i64,
) -> Result<Vec<(Memory, f64, String)>, String> {
    let (name, goal): (String, String) = conn
        .query_row(
            "SELECT name, goal FROM collections WHERE id = ?1",
            rusqlite::params![collection_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let mut terms: Vec<String> = vec![name.clone()];
    for part in goal.split(|c: char| {
        c.is_whitespace() || "，,。.、；;:：/|()（）".contains(c)
    }) {
        let p = part.trim();
        if p.chars().count() >= 2 {
            terms.push(p.to_string());
        }
    }
    terms.sort();
    terms.dedup();

    let linked: std::collections::HashSet<i64> = {
        let mut set = std::collections::HashSet::new();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT memory_id FROM collection_memories WHERE collection_id = ?1 AND status = 'confirmed'
             UNION SELECT id FROM memories WHERE collection_id = ?1",
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![collection_id], |r| r.get::<_, i64>(0))
            {
                for id in rows.flatten() {
                    set.insert(id);
                }
            }
        }
        set
    };

    let ids: Vec<i64> = {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM memories WHERE COALESCE(deleted_at,'') = ''
                 ORDER BY created_at DESC LIMIT 1200",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| r.get::<_, i64>(0)).map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let mut out = Vec::new();
    for id in ids {
        if linked.contains(&id) {
            continue;
        }
        let Some(m) = memory_by_id(conn, id) else { continue };
        let mut score = 0.0f64;
        let mut reason = String::new();
        for term in &terms {
            let t = term.to_lowercase();
            if m.title.to_lowercase().contains(&t) {
                score += 4.0;
                if reason.is_empty() {
                    reason = format!("标题含「{}」", term);
                }
            }
            if m.summary.to_lowercase().contains(&t) || m.ai_summary.to_lowercase().contains(&t) {
                score += 2.0;
                if reason.is_empty() {
                    reason = format!("摘要含「{}」", term);
                }
            }
            if m.ocr_text.to_lowercase().contains(&t) {
                score += 1.0;
            }
            if m.content.to_lowercase().contains(&t) {
                score += 1.5;
                if reason.is_empty() {
                    reason = format!("正文含「{}」", term);
                }
            }
            if m.fields.iter().any(|f| f.value.to_lowercase().contains(&t)) {
                score += 1.0;
            }
            if m.tags.iter().any(|tag| tag.to_lowercase().contains(&t)) {
                score += 3.0;
                if reason.is_empty() {
                    reason = format!("标签含「{}」", term);
                }
            }
        }
        if score > 0.0 {
            out.push((m, score, reason));
        }
    }
    out.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    out.truncate(24);
    Ok(out)
}

#[tauri::command]
pub fn suggest_collection_memories(
    collection_id: i64,
    state: State<AppState>,
) -> Result<Vec<CollectionSuggestion>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(collection_candidates(&conn, collection_id)?
        .into_iter()
        .map(|(memory, score, reason)| CollectionSuggestion { memory, score, reason })
        .collect())
}

#[tauri::command]
pub fn smart_fill_collection(
    collection_id: i64,
    auto: Option<bool>,
    state: State<AppState>,
) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let candidates = collection_candidates(&conn, collection_id)?;
    let auto = auto.unwrap_or(false);
    let mut linked = 0usize;
    for (m, score, _) in candidates.iter() {
        if *score < 2.0 {
            continue;
        }
        let status = if auto { "confirmed" } else { "suggested" };
        let _ = conn.execute(
            "INSERT OR IGNORE INTO collection_memories(collection_id, memory_id, score, source, status)
             VALUES (?1, ?2, ?3, 'smart', ?4)",
            rusqlite::params![collection_id, m.id, score, status],
        );
        linked += 1;
        if linked >= 12 {
            break;
        }
    }
    Ok(linked)
}

#[tauri::command]
pub fn unlink_collection_memory(
    collection_id: i64,
    memory_id: i64,
    state: State<AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE memories SET collection_id = NULL, updated_at = datetime('now','localtime')
         WHERE id = ?1 AND collection_id = ?2",
        rusqlite::params![memory_id, collection_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM collection_memories WHERE collection_id = ?1 AND memory_id = ?2",
        rusqlite::params![collection_id, memory_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn generate_collection_summary(
    collection_id: i64,
    state: State<AppState>,
) -> Result<String, String> {
    let (name, goal, items, config) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let (name, goal): (String, String) = conn
            .query_row(
                "SELECT name, goal FROM collections WHERE id = ?1",
                rusqlite::params![collection_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT m.title, m.summary, m.ai_summary
                 FROM memories m
                 WHERE COALESCE(m.deleted_at,'') = ''
                   AND (m.collection_id = ?1
                        OR EXISTS(SELECT 1 FROM collection_memories cm
                                  WHERE cm.collection_id = ?1 AND cm.memory_id = m.id AND cm.status = 'confirmed'))
                 ORDER BY m.created_at DESC LIMIT 40",
            )
            .map_err(|e| e.to_string())?;
        let items: Vec<String> = stmt
            .query_map(rusqlite::params![collection_id], |r| {
                let title: String = r.get(0)?;
                let summary: String = r.get(1)?;
                let ai: String = r.get(2)?;
                Ok(if !summary.is_empty() { format!("{}｜{}", title, summary) }
                   else if !ai.is_empty() { format!("{}｜{}", title, ai) }
                   else { title })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        let config = crate::state::load_ai_config(&conn);
        (name, goal, items, config)
    };

    if config.api_key.trim().is_empty() {
        return Err("请先在设置页填写 API Key".into());
    }
    let provider = AiService::provider(config);
    let text = provider
        .chat(&prompts::collection_summary(&name, &goal, &items), Some(700))
        .map_err(|e| e.to_string())?;
    let clean = text.trim().to_string();
    if clean.is_empty() {
        return Err("AI 返回为空".into());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE collections SET summary = ?1, summary_at = datetime('now','localtime'),
         updated_at = datetime('now','localtime') WHERE id = ?2",
        rusqlite::params![clean, collection_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(clean)
}

// ============ 导入 / 导出 ============

#[derive(Serialize)]
pub struct ImportOutcome {
    pub imported: usize,
    pub duplicates: usize,
    pub memories: Vec<Memory>,
}

fn ext_of(path: &std::path::Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

fn classify_file(ext: &str) -> (&'static str, bool) {
    match ext {
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" => ("image", false),
        "pdf" => ("pdf", false),
        "doc" | "docx" | "odt" | "rtf" => ("document", false),
        "rs" | "py" | "js" | "ts" | "tsx" | "jsx" | "go" | "java" | "c" | "cpp" | "h"
        | "css" | "html" | "json" | "yaml" | "yml" | "sh" | "sql" => ("code", true),
        "md" | "markdown" | "txt" | "rst" => ("text", true),
        _ => ("document", false),
    }
}

#[tauri::command]
pub fn import_files(
    app: AppHandle,
    paths: Vec<String>,
    state: State<AppState>,
) -> Result<ImportOutcome, String> {
    let mut imported = 0usize;
    let mut duplicates = 0usize;
    let mut memories = Vec::new();
    let attach_dir = data_dir().join("attachments");
    let _ = std::fs::create_dir_all(&attach_dir);

    for raw in paths {
        let src = std::path::PathBuf::from(&raw);
        if !src.is_file() {
            continue;
        }
        let ext = ext_of(&src);
        let (mtype, is_text) = classify_file(&ext);
        let _file_name = src
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("未命名文件")
            .to_string();
        let stem = src
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("未命名文件")
            .to_string();

        let hash = content_hash_of(&format!("file:{}", src.to_string_lossy()));
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        if let Ok(id) = conn.query_row(
            "SELECT id FROM memories WHERE content_hash = ?1 AND COALESCE(deleted_at,'') = '' LIMIT 1",
            rusqlite::params![hash],
            |r| r.get::<_, i64>(0),
        ) {
            duplicates += 1;
            if let Some(m) = memory_by_id(&conn, id) {
                memories.push(m);
            }
            continue;
        }

        let dest = attach_dir.join(format!(
            "{}.{}",
            uuid::Uuid::new_v4(),
            if ext.is_empty() { "bin" } else { &ext }
        ));
        if std::fs::copy(&src, &dest).is_err() {
            continue;
        }
        let content = if is_text {
            std::fs::read_to_string(&dest)
                .map(|s| s.chars().take(20000).collect::<String>())
                .unwrap_or_default()
        } else {
            String::new()
        };
        let kind = match mtype {
            "image" => "note",
            "pdf" | "document" => "file",
            "code" => "snippet",
            _ => "note",
        };
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        conn.execute(
            "INSERT INTO memories(title, content, type, kind, source, file_path, content_hash,
             created_at, updated_at, ai_status, metadata)
             VALUES (?1, ?2, ?3, ?4, 'drag', ?5, ?6, ?7, ?7, 'pending', '{}')",
            rusqlite::params![
                stem,
                content,
                mtype,
                kind,
                dest.to_string_lossy().to_string(),
                hash,
                now
            ],
        )
        .map_err(|e| e.to_string())?;
        let id = conn.last_insert_rowid();
        if let Some(m) = memory_by_id(&conn, id) {
            memories.push(m);
        }
        imported += 1;
        drop(conn);
        worker::spawn_analyze(app.clone(), id);
    }
    Ok(ImportOutcome { imported, duplicates, memories })
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() { "记忆".to_string() } else { trimmed.chars().take(60).collect() }
}

fn export_dir() -> std::path::PathBuf {
    dirs::download_dir()
        .unwrap_or_else(data_dir)
        .join("月忆导出")
}

#[tauri::command]
pub fn export_memory_markdown(id: i64, state: State<AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let m = memory_by_id(&conn, id).ok_or("记忆不存在")?;
    let dir = export_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut md = format!("# {}\n\n", if m.title.is_empty() { "未命名记忆" } else { &m.title });
    md.push_str(&format!("- 时间：{}\n- 类型：{}\n", m.created_at, m.r#type));
    if !m.source_url.is_empty() {
        md.push_str(&format!("- 来源：{}\n", m.source_url));
    }
    if !m.tags.is_empty() {
        md.push_str(&format!("- 标签：{}\n", m.tags.join("、")));
    }
    md.push_str("\n");
    if !m.summary.is_empty() {
        md.push_str(&format!("> {}\n\n", m.summary));
    }
    if !m.content.is_empty() {
        md.push_str(&format!("{}\n", m.content));
    }
    if !m.fields.is_empty() {
        md.push_str("\n## 关键信息\n\n");
        for f in &m.fields {
            md.push_str(&format!("- **{}**：{}\n", f.key, f.value));
        }
    }
    let path = dir.join(format!("{}.md", sanitize_filename(&m.title)));
    std::fs::write(&path, md).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn export_collection_markdown(id: i64, state: State<AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let (name, summary, goal): (String, String, String) = conn
        .query_row(
            "SELECT name, summary, goal FROM collections WHERE id = ?1",
            rusqlite::params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT m.id FROM memories m
             WHERE COALESCE(m.deleted_at,'') = ''
               AND (m.collection_id = ?1 OR EXISTS(
                    SELECT 1 FROM collection_memories cm
                    WHERE cm.collection_id = ?1 AND cm.memory_id = m.id AND cm.status = 'confirmed'))
             ORDER BY m.created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let ids: Vec<i64> = stmt
        .query_map(rusqlite::params![id], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    let mut md = format!("# 合集：{}\n\n", name);
    if !goal.trim().is_empty() {
        md.push_str(&format!("> 目标：{}\n\n", goal));
    }
    if !summary.trim().is_empty() {
        md.push_str(&format!("## 摘要\n\n{}\n\n", summary));
    }
    md.push_str("## 记忆\n\n");
    for mid in ids {
        if let Some(m) = memory_by_id(&conn, mid) {
            md.push_str(&format!(
                "### {}\n\n- 时间：{}\n- 类型：{}\n",
                if m.title.is_empty() { "未命名" } else { &m.title },
                m.created_at,
                m.r#type
            ));
            if !m.summary.is_empty() {
                md.push_str(&format!("- 摘要：{}\n", m.summary));
            }
            if !m.source_url.is_empty() {
                md.push_str(&format!("- 链接：{}\n", m.source_url));
            }
            md.push('\n');
        }
    }
    let dir = export_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("合集-{}.md", sanitize_filename(&name)));
    std::fs::write(&path, md).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// ============ 回顾 ============

#[derive(Serialize)]
pub struct ReviewOverview {
    pub today_count: i64,
    pub week_count: i64,
    pub pending_count: i64,
    pub upcoming: Vec<Reminder>,
    pub recent: Vec<Memory>,
    pub stale: Vec<Memory>,
}

#[tauri::command]
pub fn review_overview(state: State<AppState>) -> Result<ReviewOverview, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let count = |sql: &str| -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0)
    };
    let today_count = count(
        "SELECT COUNT(*) FROM memories WHERE COALESCE(deleted_at,'') = ''
         AND created_at >= date('now','localtime','start of day')",
    );
    let week_count = count(
        "SELECT COUNT(*) FROM memories WHERE COALESCE(deleted_at,'') = ''
         AND created_at >= date('now','localtime','-6 days','start of day')",
    );
    let pending_count = count(
        "SELECT COUNT(*) FROM memories WHERE COALESCE(deleted_at,'') = ''
         AND ai_status IN ('pending','processing','failed')",
    );

    let mut upcoming = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, memory_id, title, remind_at, done, fired FROM reminders
         WHERE done = 0 ORDER BY remind_at LIMIT 8",
    ) {
        if let Ok(rows) = stmt.query_map([], reminder_from_row) {
            upcoming = rows.filter_map(|r| r.ok()).collect();
        }
    }

    let recent_ids: Vec<i64> = {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM memories WHERE COALESCE(deleted_at,'') = ''
                 ORDER BY created_at DESC LIMIT 5",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| r.get::<_, i64>(0)).map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };
    let stale_ids: Vec<i64> = {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM memories WHERE COALESCE(deleted_at,'') = ''
                 AND created_at < date('now','localtime','-60 days')
                 ORDER BY RANDOM() LIMIT 4",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| r.get::<_, i64>(0)).map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };
    let recent = recent_ids
        .into_iter()
        .filter_map(|id| memory_by_id(&conn, id))
        .collect();
    let stale = stale_ids
        .into_iter()
        .filter_map(|id| memory_by_id(&conn, id))
        .collect();

    Ok(ReviewOverview {
        today_count,
        week_count,
        pending_count,
        upcoming,
        recent,
        stale,
    })
}

#[tauri::command]
pub fn generate_weekly_review(state: State<AppState>) -> Result<String, String> {
    let (titles, config) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT title FROM memories WHERE COALESCE(deleted_at,'') = ''
                 AND created_at >= date('now','localtime','-6 days','start of day')
                 ORDER BY created_at DESC LIMIT 60",
            )
            .map_err(|e| e.to_string())?;
        let titles: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .filter(|t| !t.trim().is_empty())
            .collect();
        (titles, crate::state::load_ai_config(&conn))
    };
    if config.api_key.trim().is_empty() {
        return Err("请先在设置页填写 API Key".into());
    }
    let provider = AiService::provider(config);
    let text = provider
        .chat(&prompts::weekly_review(&titles), Some(700))
        .map_err(|e| e.to_string())?;
    Ok(text.trim().to_string())
}

#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

/// 生成 .ics 日历文件并返回路径（前端再调用 open_path 用系统日历打开）
#[tauri::command]
pub fn export_ics(
    title: String,
    start: String,
    end: Option<String>,
    description: Option<String>,
) -> Result<String, String> {
    use chrono::NaiveDateTime;
    let parse = |s: &str| -> Option<NaiveDateTime> {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M")
            .ok()
            .or_else(|| {
                chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                    .ok()
                    .map(|d| d.and_hms_opt(9, 0, 0).unwrap_or_default())
            })
    };
    let start_dt = parse(&start).ok_or("开始时间格式应为 YYYY-MM-DD HH:MM")?;
    let end_dt = end
        .as_deref()
        .and_then(parse)
        .unwrap_or_else(|| start_dt + chrono::Duration::hours(1));
    let fmt = |d: NaiveDateTime| d.format("%Y%m%dT%H%M%S").to_string();
    let stamp = chrono::Local::now().format("%Y%m%dT%H%M%S").to_string();
    let uid = uuid::Uuid::new_v4();
    let desc = description.unwrap_or_default().replace('\n', "\\n");
    let ics = format!(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Yueyi//CN\r\nBEGIN:VEVENT\r\nUID:{}\r\nDTSTAMP:{}\r\nDTSTART:{}\r\nDTEND:{}\r\nSUMMARY:{}\r\nDESCRIPTION:{}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        uid,
        stamp,
        fmt(start_dt),
        fmt(end_dt),
        title.replace('\n', " "),
        desc
    );
    let dir = data_dir().join("exports");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.ics", sanitize_filename(&title)));
    std::fs::write(&path, ics).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod hash_tests {
    use super::content_hash_of;

    #[test]
    fn hash_is_trim_stable_and_discriminating() {
        assert_eq!(content_hash_of("  hello  "), content_hash_of("hello"));
        assert_ne!(content_hash_of("hello"), content_hash_of("hello2"));
        assert!(!content_hash_of("").is_empty());
    }
}
