// ============ 数据备份 / 导入导出 ============

use crate::state::AppState;
use crate::worker;
use rusqlite::Connection;
use std::collections::HashMap;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn backup_database(target_path: String, state: State<AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    if std::path::Path::new(&target_path).exists() {
        std::fs::remove_file(&target_path).map_err(|e| format!("清理旧备份失败: {}", e))?;
    }
    let escaped = target_path.replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{}'", escaped))
        .map_err(|e| format!("数据库备份失败: {}", e))?;
    let check: String = Connection::open(&target_path)
        .and_then(|c| c.query_row("PRAGMA quick_check", [], |r| r.get(0)))
        .map_err(|e| format!("备份校验失败: {}", e))?;
    if check != "ok" {
        return Err(format!("备份校验失败: {}", check));
    }
    Ok(target_path)
}

#[tauri::command]
pub fn export_data(target_path: String, state: State<AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let export = serde_json::json!({
        "version": "0.1.0",
        "exported_at": chrono::Local::now().to_rfc3339(),
        "memories": {
            "collections": dump_table(&conn, "collections"),
            "memories": dump_table(&conn, "memories"),
            "tags": dump_table(&conn, "tags"),
            "memory_tags": dump_table(&conn, "memory_tags"),
            "memory_fields": dump_table(&conn, "memory_fields"),
            "collection_memories": dump_table(&conn, "collection_memories"),
            "reminders": dump_table(&conn, "reminders"),
            "attachments": dump_table(&conn, "attachments"),
        }
    });
    let json = serde_json::to_string_pretty(&export).map_err(|e| e.to_string())?;
    std::fs::write(&target_path, json).map_err(|e| e.to_string())?;
    Ok(target_path)
}

#[tauri::command]
pub fn import_data(app: AppHandle, source_path: String, state: State<AppState>) -> Result<usize, String> {
    let raw = std::fs::read_to_string(&source_path)
        .map_err(|e| format!("读取导入文件失败: {}", e))?;
    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("JSON 格式无效: {}", e))?;
    let root = parsed.get("memories").unwrap_or(&parsed);
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut imported = 0usize;

    let jstr = |v: &serde_json::Value, k: &str| -> String {
        v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
    };
    let ji64 = |v: &serde_json::Value, k: &str| -> Option<i64> {
        v.get(k).and_then(|x| x.as_i64())
    };

    // 1. 合集：按 name 合并，建立旧 ID -> 新 ID 映射
    let mut coll_map: HashMap<i64, i64> = HashMap::new();
    if let Some(colls) = root.get("collections").and_then(|v| v.as_array()) {
        for c in colls {
            let name = jstr(c, "name");
            if name.is_empty() {
                continue;
            }
            let color = {
                let v = jstr(c, "color");
                if v.is_empty() { "#68A8FF".to_string() } else { v }
            };
            tx.execute(
                "INSERT OR IGNORE INTO collections(name, color, description, goal, summary, summary_at, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    name, color, jstr(c, "description"), jstr(c, "goal"),
                    jstr(c, "summary"), jstr(c, "summary_at"), ji64(c, "sort_order").unwrap_or(0)
                ],
            )
            .map_err(|e| e.to_string())?;
            let new_id: i64 = tx
                .query_row("SELECT id FROM collections WHERE name = ?1", [&name], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            if let Some(old) = ji64(c, "id") {
                coll_map.insert(old, new_id);
            }
        }
    }

    // 2. 标签映射
    let mut tag_map: HashMap<i64, i64> = HashMap::new();
    if let Some(tags) = root.get("tags").and_then(|v| v.as_array()) {
        for t in tags {
            let name = jstr(t, "name");
            if name.is_empty() {
                continue;
            }
            tx.execute("INSERT OR IGNORE INTO tags(name) VALUES (?1)", [&name])
                .map_err(|e| e.to_string())?;
            let new_id: i64 = tx
                .query_row("SELECT id FROM tags WHERE name = ?1", [&name], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            if let Some(old) = ji64(t, "id") {
                tag_map.insert(old, new_id);
            }
        }
    }

    // 3. 记忆
    let mut mem_map: HashMap<i64, i64> = HashMap::new();
    if let Some(mems) = root.get("memories").and_then(|v| v.as_array()) {
        for m in mems {
            let old_id = ji64(m, "id");
            let mapped_coll = ji64(m, "collection_id").and_then(|old| coll_map.get(&old).copied());
            let metadata = m
                .get("metadata")
                .map(|v| v.to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "{}".to_string());
            let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
            let created = {
                let v = jstr(m, "created_at");
                if v.is_empty() { now.clone() } else { v }
            };
            let updated = {
                let v = jstr(m, "updated_at");
                if v.is_empty() { now.clone() } else { v }
            };
            tx.execute(
                "INSERT INTO memories(title, content, summary, type, kind, source, source_url, file_path,
                 ocr_text, created_at, updated_at, collection_id, ai_status, ai_summary, ai_category,
                 content_hash, metadata, deleted_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
                rusqlite::params![
                    jstr(m, "title"), jstr(m, "content"), jstr(m, "summary"),
                    { let v = jstr(m, "type"); if v.is_empty() { "note".to_string() } else { v } },
                    { let v = jstr(m, "kind"); if v.is_empty() { "note".to_string() } else { v } },
                    { let v = jstr(m, "source"); if v.is_empty() { "import".to_string() } else { v } },
                    jstr(m, "source_url"), jstr(m, "file_path"), jstr(m, "ocr_text"),
                    created, updated, mapped_coll,
                    { let v = jstr(m, "ai_status"); if v.is_empty() { "done".to_string() } else { v } },
                    jstr(m, "ai_summary"), jstr(m, "ai_category"),
                    jstr(m, "content_hash"), metadata, jstr(m, "deleted_at")
                ],
            )
            .map_err(|e| e.to_string())?;
            let new_id = tx.last_insert_rowid();
            if let Some(old) = old_id {
                mem_map.insert(old, new_id);
            }
            imported += 1;
        }
    }

    // 4. 标签关系
    if let Some(rows) = root.get("memory_tags").and_then(|v| v.as_array()) {
        for r in rows {
            let mid = ji64(r, "memory_id").and_then(|old| mem_map.get(&old).copied());
            let tid = ji64(r, "tag_id").and_then(|old| tag_map.get(&old).copied());
            if let (Some(mid), Some(tid)) = (mid, tid) {
                tx.execute(
                    "INSERT OR IGNORE INTO memory_tags(memory_id, tag_id) VALUES (?1, ?2)",
                    rusqlite::params![mid, tid],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    // 5. 结构化字段
    if let Some(rows) = root.get("memory_fields").and_then(|v| v.as_array()) {
        for r in rows {
            if let Some(mid) = ji64(r, "memory_id").and_then(|old| mem_map.get(&old).copied()) {
                tx.execute(
                    "INSERT OR REPLACE INTO memory_fields(memory_id, key, value, normalized, confidence)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![
                        mid, jstr(r, "key"), jstr(r, "value"), jstr(r, "normalized"),
                        r.get("confidence").and_then(|v| v.as_f64()).unwrap_or(0.6)
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    // 6. 合集关系
    if let Some(rows) = root.get("collection_memories").and_then(|v| v.as_array()) {
        for r in rows {
            let cid = ji64(r, "collection_id").and_then(|old| coll_map.get(&old).copied());
            let mid = ji64(r, "memory_id").and_then(|old| mem_map.get(&old).copied());
            if let (Some(cid), Some(mid)) = (cid, mid) {
                tx.execute(
                    "INSERT OR IGNORE INTO collection_memories(collection_id, memory_id, score, source, status)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![
                        cid, mid,
                        r.get("score").and_then(|v| v.as_f64()).unwrap_or(0.8),
                        { let v = jstr(r, "source"); if v.is_empty() { "import".to_string() } else { v } },
                        { let v = jstr(r, "status"); if v.is_empty() { "confirmed".to_string() } else { v } }
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    // 7. 提醒（只导入未完成，避免历史通知重新弹出）
    if let Some(rows) = root.get("reminders").and_then(|v| v.as_array()) {
        for r in rows {
            let mid = ji64(r, "memory_id").and_then(|old| mem_map.get(&old).copied());
            if let Some(mid) = mid {
                let done = r.get("done").and_then(|v| v.as_i64()).unwrap_or(0);
                if done == 0 {
                    tx.execute(
                        "INSERT INTO reminders(memory_id, title, remind_at, done, fired, created_at)
                         VALUES (?1, ?2, ?3, 0, 0, ?4)",
                        rusqlite::params![mid, jstr(r, "title"), jstr(r, "remind_at"), jstr(r, "created_at")],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);
    use tauri::Emitter;
    let _ = app.emit(
        "memory-updated",
        worker::MemoryUpdated { id: 0, reason: "updated".into(), title: None, collection_name: None },
    );
    Ok(imported)
}

fn dump_table(conn: &Connection, table: &str) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    let ok = (|| -> Result<(), rusqlite::Error> {
        let mut stmt = conn.prepare(&format!("SELECT * FROM {}", table))?;
        let col_count = stmt.column_count();
        let col_names: Vec<String> = (0..col_count).map(|i| stmt.column_name(i).unwrap_or("").to_string()).collect();
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let mut obj = serde_json::Map::new();
            for (i, name) in col_names.iter().enumerate() {
                let v: serde_json::Value = match row.get_ref(i)? {
                    rusqlite::types::ValueRef::Null => serde_json::Value::Null,
                    rusqlite::types::ValueRef::Integer(n) => serde_json::json!(n),
                    rusqlite::types::ValueRef::Real(f) => serde_json::json!(f),
                    rusqlite::types::ValueRef::Text(t) => serde_json::json!(String::from_utf8_lossy(t)),
                    rusqlite::types::ValueRef::Blob(b) => serde_json::json!(format!("<blob {} bytes>", b.len())),
                };
                obj.insert(name.clone(), v);
            }
            out.push(serde_json::Value::Object(obj));
        }
        Ok(())
    })();
    let _ = ok;
    out
}
