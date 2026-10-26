// ============ 后台 AI 处理流水线：截图→OCR→AI→更新，不阻塞 UI ============

#[allow(unused_imports)]
use crate::ai::{AiProvider, AiService};
use crate::prompts;
use crate::state::{data_dir, get_setting, load_ai_config, AppState};
use std::collections::HashSet;
use std::sync::{Condvar, Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

const MAX_AI_CONCURRENCY: usize = 2;
static ACTIVE_ANALYSES: OnceLock<Mutex<HashSet<i64>>> = OnceLock::new();
static AI_SLOTS: OnceLock<(Mutex<usize>, Condvar)> = OnceLock::new();

fn active_analyses() -> &'static Mutex<HashSet<i64>> {
    ACTIVE_ANALYSES.get_or_init(|| Mutex::new(HashSet::new()))
}

fn ai_slots() -> &'static (Mutex<usize>, Condvar) {
    AI_SLOTS.get_or_init(|| (Mutex::new(0), Condvar::new()))
}

struct AiSlot;
impl AiSlot {
    fn acquire() -> Self {
        let (lock, cv) = ai_slots();
        let mut running = lock.lock().unwrap_or_else(|e| e.into_inner());
        while *running >= MAX_AI_CONCURRENCY {
            running = cv.wait(running).unwrap_or_else(|e| e.into_inner());
        }
        *running += 1;
        AiSlot
    }
}
impl Drop for AiSlot {
    fn drop(&mut self) {
        let (lock, cv) = ai_slots();
        let mut running = lock.lock().unwrap_or_else(|e| e.into_inner());
        *running = running.saturating_sub(1);
        cv.notify_one();
    }
}

struct ActiveAnalysis(i64);
impl Drop for ActiveAnalysis {
    fn drop(&mut self) {
        if let Ok(mut set) = active_analyses().lock() {
            set.remove(&self.0);
        }
    }
}

#[derive(Clone, serde::Serialize)]
pub struct MemoryUpdated {
    pub id: i64,
    pub reason: String,
    pub title: Option<String>,
    pub collection_name: Option<String>,
}

pub fn emit_update(app: &AppHandle, payload: MemoryUpdated) {
    let _ = app.emit("memory-updated", payload);
}

#[derive(Debug, Default, serde::Deserialize)]
struct ExtractedFields {
    kind: Option<String>,
    deadline: Option<String>,
    event_start: Option<String>,
    event_end: Option<String>,
    project: Option<String>,
    people: Option<Vec<String>>,
    todo: Option<String>,
    url: Option<String>,
    file_path: Option<String>,
    code_lang: Option<String>,
    version: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    confidence: Option<f64>,
}

fn clean_opt(v: &Option<String>) -> Option<String> {
    v.as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != "null" && s != "无")
}

/// 检查设置：自动分析是否开启
pub fn auto_analyze_on(conn: &rusqlite::Connection) -> bool {
    get_setting(conn, "auto_analyze") == "true"
}

/// 仅允许公网 http(s)；拒绝 localhost、内网、链路本地和私有 IPv6。
fn url_is_private(url: &reqwest::Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return true;
    }
    let Some(host) = url.host_str() else {
        return true;
    };
    let host = host.to_lowercase();
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host == "localhost" || host.ends_with(".local") || host == "::1" {
        return true;
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(v4) => {
                v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || v4.is_unspecified()
                    || v4.is_broadcast()
            }
            std::net::IpAddr::V6(v6) => {
                let seg = v6.segments()[0];
                v6.is_loopback()
                    || v6.is_unspecified()
                    || (seg & 0xfe00) == 0xfc00
                    || (seg & 0xffc0) == 0xfe80
            }
        };
    }
    false
}

/// 提取网页标题与正文摘要（用于链接类型记忆）
pub fn fetch_url_metadata(url: &str) -> Option<(String, String)> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if url_is_private(&parsed) {
        return None;
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) YueyiDesktop/0.1")
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 5 || url_is_private(attempt.url()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .ok()?;
    let resp = client.get(parsed).send().ok()?;
    if !resp.status().is_success() {
        return None;
    }
    if resp.content_length().unwrap_or(0) > 512 * 1024 {
        return None;
    }
    let body = resp.bytes().ok()?;
    if body.len() > 512 * 1024 {
        return None;
    }
    let html = String::from_utf8_lossy(&body).to_string();
    let title = extract_html_tag(&html, "title").unwrap_or_default();
    let desc = extract_meta_desc(&html).unwrap_or_default();
    let body_text = strip_html_tags(&html);
    let mut combined = String::new();
    if !desc.is_empty() {
        combined.push_str(&desc);
        combined.push('\n');
    }
    if !body_text.is_empty() {
        let snippet: String = body_text.chars().take(1200).collect();
        combined.push_str(&snippet);
    }
    Some((title.trim().to_string(), combined.trim().to_string()))
}

fn extract_html_tag(html: &str, tag: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let start_tag = lower.find(&open)?;
    let gt = lower[start_tag..].find('>')? + start_tag + 1;
    let end_tag = lower[gt..].find(&close)? + gt;
    Some(html[gt..end_tag].replace('\n', " ").replace('\r', " ").trim().to_string())
}

fn extract_meta_desc(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    for marker in ["name=\"description\"", "name='description'", "property=\"og:description\""] {
        if let Some(pos) = lower.find(marker) {
            let region_start = pos.saturating_sub(150);
            let region_end = (pos + 350).min(html.len());
            let slice = &html[region_start..region_end];
            let slice_lower = slice.to_lowercase();
            if let Some(cpos) = slice_lower.find("content=") {
                let after = &slice[cpos + 8..];
                let quote = after.chars().next()?;
                if quote == '"' || quote == '\'' {
                    let rest = &after[1..];
                    if let Some(end_q) = rest.find(quote) {
                        return Some(rest[..end_q].trim().to_string());
                    }
                }
            }
        }
    }
    None
}

fn strip_html_tags(html: &str) -> String {
    // 剔除 script / style 块
    let mut cleaned = html.to_string();
    for tag in ["script", "style", "noscript", "svg"] {
        let open_pat = format!("<{}", tag);
        let close_pat = format!("</{}>", tag);
        loop {
            let lower = cleaned.to_lowercase();
            if let Some(s) = lower.find(&open_pat) {
                if let Some(e) = lower[s..].find(&close_pat) {
                    cleaned.replace_range(s..(s + e + close_pat.len()), " ");
                    continue;
                }
            }
            break;
        }
    }
    let mut out = String::with_capacity(cleaned.len() / 2);
    let mut in_tag = false;
    let mut last_space = false;
    for ch in cleaned.chars() {
        if ch == '<' {
            in_tag = true;
            continue;
        }
        if ch == '>' {
            in_tag = false;
            if !last_space {
                out.push(' ');
                last_space = true;
            }
            continue;
        }
        if !in_tag {
            if ch.is_whitespace() {
                if !last_space {
                    out.push(' ');
                    last_space = true;
                }
            } else {
                out.push(ch);
                last_space = false;
            }
        }
    }
    out.trim().to_string()
}

/// 单次 AI 调用带轻量退避重试（网络抖动 / 5xx 自动重试 1 次，鉴权/余额错误直接返回）
fn chat_with_retry(
    provider: &dyn AiProvider,
    messages: &crate::ai::Messages,
    max_tokens: Option<u32>,
) -> Result<String, crate::ai::AiError> {
    match provider.chat(messages, max_tokens) {
        Ok(res) => Ok(res),
        Err(e) => {
            let msg = e.to_string();
            // 参数/鉴权/余额错误重试没有意义；429 与 5xx 做一次短退避
            if msg.contains("400")
                || msg.contains("401")
                || msg.contains("402")
                || msg.contains("403")
                || msg.contains("404")
                || msg.contains("422")
                || msg.contains("未配置")
            {
                return Err(e);
            }
            let delay = if msg.contains("429") { 2500 } else { 1200 };
            std::thread::sleep(std::time::Duration::from_millis(delay));
            provider.chat(messages, max_tokens)
        }
    }
}

/// 后台分析一条记忆（默认遵循 auto_analyze 设置）
pub fn spawn_analyze(app: AppHandle, memory_id: i64) {
    spawn_analyze_with_opts(app, memory_id, false);
}

/// 后台分析一条记忆（OCR 补全 / URL 抓取 + AI 标题/摘要/分析/标签/分类）
/// - `force_reanalyze`: 用户手动点击「重新分析」时为 true，强制执行且在失败时完整保留原数据（P0-2）
/// - 全部 AI 步骤失败时必须标记 `ai_status = 'failed'` 并记录错误，绝不伪造 `done`（P0-1）
pub fn spawn_analyze_with_opts(app: AppHandle, memory_id: i64, force_reanalyze: bool) {
    {
        let Ok(mut active) = active_analyses().lock() else {
            return;
        };
        if !active.insert(memory_id) {
            return;
        }
    }
    thread::spawn(move || {
        let _active = ActiveAnalysis(memory_id);
        let _slot = AiSlot::acquire();
        type MemRow = (
            i64,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            Option<i64>,
        );

        let state = app.state::<AppState>();
        let (
            id,
            mut title,
            mut content,
            old_summary,
            old_ai_summary,
            old_ai_category,
            mtype,
            _source,
            mut source_url,
            file_path,
            mut ocr_text,
            snapshot_updated,
        ) = {
            let conn = match state.db.lock() {
                Ok(c) => c,
                Err(_) => return,
            };

            let row: rusqlite::Result<MemRow> = conn.query_row(
                "SELECT id, title, content, summary, ai_summary, ai_category, type, source, source_url, file_path, ocr_text, collection_id
                 FROM memories WHERE id = ?1",
                rusqlite::params![memory_id],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, String>(4)?,
                        r.get::<_, String>(5)?,
                        r.get::<_, String>(6)?,
                        r.get::<_, String>(7)?,
                        r.get::<_, String>(8)?,
                        r.get::<_, String>(9)?,
                        r.get::<_, String>(10)?,
                        r.get::<_, Option<i64>>(11)?,
                    ))
                },
            );

            let row = match row {
                Ok(v) => v,
                Err(_) => return,
            };

            if !force_reanalyze && !auto_analyze_on(&conn) {
                return;
            }

            let snapshot_updated: String = conn
                .query_row(
                    "SELECT COALESCE(updated_at,'') FROM memories WHERE id = ?1",
                    rusqlite::params![row.0],
                    |r| r.get(0),
                )
                .unwrap_or_default();

            // 原子认领：已经 processing 的记忆不重复执行
            let claimed = conn
                .execute(
                    "UPDATE memories SET ai_status = 'processing' WHERE id = ?1 AND ai_status != 'processing'",
                    rusqlite::params![row.0],
                )
                .unwrap_or(0);
            if claimed == 0 {
                return;
            }

            (
                row.0, row.1, row.2, row.3, row.4, row.5, row.6, row.7, row.8, row.9, row.10,
                snapshot_updated,
            )
        };

        // ---- 1. 本地 OCR（截图/图片且尚无 OCR 文本，或强制重分析时尝试刷新 OCR，失败保留原文本） ----
        if (mtype == "screenshot" || mtype == "image")
            && !file_path.is_empty()
            && (ocr_text.is_empty() || force_reanalyze)
        {
            #[cfg(windows)]
            {
                if std::path::Path::new(&file_path).exists() {
                    match crate::ocr::ocr_image_file(&file_path) {
                        Ok(text) if !text.is_empty() => {
                            ocr_text = text.clone();
                            if source_url.is_empty() {
                                // 优先用标题反查浏览器历史拿完整 URL——
                                // 直接 OCR 提取地址栏常因 OCR 在字符间插入空格而被截断
                                // （例如 "BV11aaz6iEgN" 被识别成 "BV11 aaz6iEgN"，只取到 "BV11"）。
                                // 后台任务运行时 Chrome History 通常已写入该 URL，反查命中率远高于 OCR。
                                let mut found = crate::capture::lookup_url_from_browser_history(
                                    &title, "chrome",
                                );
                                if found.is_none() {
                                    found = extract_url_from_ocr(&ocr_text);
                                }
                                if let Some(found_url) = found {
                                    source_url = found_url;
                                }
                            }
                            if let Ok(conn) = state.db.lock() {
                                let _ = conn.execute(
                                    "UPDATE memories SET ocr_text = ?1, source_url = CASE WHEN source_url = '' THEN ?2 ELSE source_url END WHERE id = ?3",
                                    rusqlite::params![text, source_url, id],
                                );
                            }
                            if content.is_empty() {
                                content = ocr_text.clone();
                            }
                        }
                        Ok(_) => {}
                        Err(e) => {
                            eprintln!("[yueyi] OCR 降级: {}", e);
                        }
                    }
                }
            }
        }

        // ---- 2. 网页链接抓取（若为 link 且无富文本内容） ----
        let target_url = if !source_url.is_empty() {
            source_url.clone()
        } else if mtype == "link"
            && (content.starts_with("http://") || content.starts_with("https://"))
        {
            content.lines().next().unwrap_or("").trim().to_string()
        } else {
            String::new()
        };

        if !target_url.is_empty() && mtype == "link" {
            if let Some((fetched_title, fetched_body)) = fetch_url_metadata(&target_url) {
                if title.is_empty() && !fetched_title.is_empty() {
                    title = fetched_title;
                }
                if (content.is_empty() || content.trim() == target_url) && !fetched_body.is_empty()
                {
                    content = format!("{}\n\n{}", target_url, fetched_body);
                }
                if let Ok(conn) = state.db.lock() {
                    let _ = conn.execute(
                        "UPDATE memories SET title = CASE WHEN title = '' THEN ?1 ELSE title END,
                         content = ?2, source_url = CASE WHEN source_url = '' THEN ?3 ELSE source_url END
                         WHERE id = ?4",
                        rusqlite::params![title, content, target_url, id],
                    );
                }
            }
        }

        // ---- 3. 文档读取（若为 document/pdf 且指向本地可读文本文件） ----
        if (mtype == "document" || mtype == "pdf") && !file_path.is_empty() && content.is_empty() {
            if let Ok(raw_text) = std::fs::read_to_string(&file_path) {
                let snippet: String = raw_text.chars().take(4000).collect();
                if !snippet.trim().is_empty() {
                    content = snippet;
                    if let Ok(conn) = state.db.lock() {
                        let _ = conn.execute(
                            "UPDATE memories SET content = ?1 WHERE id = ?2",
                            rusqlite::params![content, id],
                        );
                    }
                }
            }
        }

        // ---- 4. AI 分析（在释放数据库锁的情况下执行网络请求，避免阻塞 UI 线程） ----
        let (config, collections_list) = {
            let conn = match state.db.lock() {
                Ok(c) => c,
                Err(_) => return,
            };
            let cfg = load_ai_config(&conn);
            let colls: Vec<String> = conn
                .prepare("SELECT name FROM collections")
                .ok()
                .and_then(|mut s| {
                    s.query_map([], |r| r.get::<_, String>(0))
                        .ok()
                        .map(|rows| rows.filter_map(|r| r.ok()).collect())
                })
                .unwrap_or_default();
            (cfg, colls)
        };

        if config.api_key.trim().is_empty() {
            if let Ok(conn) = state.db.lock() {
                let _ = conn.execute(
                    "UPDATE memories SET ai_status = 'failed' WHERE id = ?1",
                    rusqlite::params![id],
                );
                let _ = conn.execute(
                    "INSERT INTO ai_tasks(memory_id, task_type, status, error, finished_at)
                     VALUES (?1, 'analyze', 'failed', 'API Key 未配置', datetime('now','localtime'))",
                    rusqlite::params![id],
                );
            }
            emit_update(
                &app,
                MemoryUpdated {
                    id,
                    reason: "ai-failed".into(),
                    title: None,
                    collection_name: None,
                },
            );
            return;
        }

        let provider = AiService::provider(config);
        let collections_joined = collections_list.join(", ");
        let input = prompts::PromptInput {
            content: &content,
            ocr_text: &ocr_text,
            memory_type: &mtype,
            collections: &collections_joined,
        };

        let mut ai_success_count = 0usize;
        let mut last_error = String::new();
        let today = chrono::Local::now().format("%Y-%m-%d %A").to_string();
        let mut extracted: Option<ExtractedFields> = None;

        let mut new_title: Option<String> = None;
        let mut new_summary: Option<String> = None;
        let mut tags: Vec<String> = Vec::new();
        let mut new_category: Option<String> = None;
        let mut new_analysis: Option<String> = None;

        // (a) 标题：仅在无标题或手动点击「重新分析」时调用 AI
        if title.is_empty() || force_reanalyze {
            match chat_with_retry(&*provider, &prompts::generate_title(&input), Some(60)) {
                Ok(t) => {
                    let clean = t.trim().trim_matches('"').to_string();
                    if !clean.is_empty() {
                        new_title = Some(clean);
                        ai_success_count += 1;
                    }
                }
                Err(e) => {
                    last_error = e.to_string();
                    eprintln!("[yueyi] 标题生成失败: {}", e);
                }
            }
        }

        // (b) 摘要
        match chat_with_retry(&*provider, &prompts::summarize(&input), Some(200)) {
            Ok(s) => {
                let clean = s.trim().to_string();
                if !clean.is_empty() {
                    new_summary = Some(clean);
                    ai_success_count += 1;
                }
            }
            Err(e) => {
                last_error = e.to_string();
                eprintln!("[yueyi] 摘要失败: {}", e);
            }
        }

        // (c) 标签
        match chat_with_retry(&*provider, &prompts::extract_tags(&input), Some(100)) {
            Ok(t) => {
                ai_success_count += 1;
                if let Ok(list) = AiService::parse_json_loose::<Vec<String>>(&t) {
                    tags = list.into_iter().filter(|s| !s.is_empty()).take(8).collect();
                }
            }
            Err(e) => {
                last_error = e.to_string();
                eprintln!("[yueyi] 标签失败: {}", e);
            }
        }

        // (d) 深度分析（截图分析或通用内容分析）
        let analysis_prompt = if mtype == "screenshot" || mtype == "image" {
            prompts::analyze_screenshot(&input)
        } else {
            prompts::analyze_content(&input)
        };
        match chat_with_retry(&*provider, &analysis_prompt, Some(300)) {
            Ok(a) => {
                let clean = a.trim().to_string();
                if !clean.is_empty() {
                    new_analysis = Some(clean);
                    ai_success_count += 1;
                }
            }
            Err(e) => {
                last_error = e.to_string();
                eprintln!("[yueyi] AI 深度分析失败: {}", e);
            }
        }

        // (e) 自动分类
        match chat_with_retry(&*provider, &prompts::classify_memory(&input), Some(30)) {
            Ok(c) => {
                let clean = c.trim().trim_matches('"').to_string();
                if !clean.is_empty() {
                    new_category = Some(clean);
                    ai_success_count += 1;
                }
            }
            Err(e) => {
                last_error = e.to_string();
                eprintln!("[yueyi] AI 分类失败: {}", e);
            }
        }

        // (f) 结构化字段抽取（kind / 时间 / 路径 / 链接 / 待办）
        match chat_with_retry(&*provider, &prompts::extract_fields(&input, &today), Some(500)) {
            Ok(t) => {
                if let Ok(v) = AiService::parse_json_loose::<ExtractedFields>(&t) {
                    extracted = Some(v);
                    ai_success_count += 1;
                }
            }
            Err(e) => {
                last_error = e.to_string();
                eprintln!("[yueyi] 结构化字段抽取失败: {}", e);
            }
        }

        // ---- 5. 写回数据库（重新获取锁） ----
        let conn = match state.db.lock() {
            Ok(c) => c,
            Err(_) => return,
        };

        // P0-1 & P0-2：若全部 AI 请求均失败，绝不能伪造 done，必须标记 failed 且完整保留原有标题/摘要
        if ai_success_count == 0 {
            let fallback_title = if !title.is_empty() {
                title.clone()
            } else if !content.trim().is_empty() {
                content.chars().take(24).collect()
            } else {
                String::new()
            };
            let _ = conn.execute(
                "UPDATE memories SET
                 title = CASE WHEN title = '' THEN ?1 ELSE title END,
                 ai_status = 'failed',
                 updated_at = datetime('now','localtime')
                 WHERE id = ?2",
                rusqlite::params![fallback_title, id],
            );
            let _ = conn.execute(
                "INSERT INTO ai_tasks(memory_id, task_type, status, error, finished_at)
                 VALUES (?1, 'analyze', 'failed', ?2, datetime('now','localtime'))",
                rusqlite::params![id, last_error],
            );
            emit_update(
                &app,
                MemoryUpdated {
                    id,
                    reason: "ai-failed".into(),
                    title: None,
                    collection_name: None,
                },
            );
            return;
        }

        // 至少有一项 AI 分析成功：仅用新生成非空字段覆盖，单项失败的字段保留旧值（P0-2）
        let tx = match conn.unchecked_transaction() {
            Ok(t) => t,
            Err(_) => return,
        };
        let final_title = new_title.unwrap_or_else(|| {
            if !title.is_empty() {
                title.clone()
            } else if !content.trim().is_empty() {
                content.chars().take(24).collect()
            } else {
                "未命名记忆".to_string()
            }
        });
        let final_analysis = new_analysis.unwrap_or(old_ai_summary);
        let display_summary = new_summary.unwrap_or_else(|| {
            if !old_summary.is_empty() {
                old_summary
            } else {
                final_analysis.clone()
            }
        });
        let final_category = new_category.unwrap_or(old_ai_category);

        let new_collection_id: Option<i64> = {
            let current: Option<i64> = conn
                .query_row(
                    "SELECT collection_id FROM memories WHERE id = ?1",
                    rusqlite::params![id],
                    |r| r.get::<_, Option<i64>>(0),
                )
                .unwrap_or(None);
            if current.is_none() && !final_category.is_empty() {
                tx.query_row(
                    "SELECT id FROM collections WHERE name = ?1",
                    rusqlite::params![final_category],
                    |r| r.get::<_, i64>(0),
                )
                .map(Some)
                .unwrap_or(None)
            } else {
                current
            }
        };

        let kind_opt = extracted.as_ref().and_then(|e| clean_opt(&e.kind));
        let changed = tx.execute(
            "UPDATE memories SET title = ?1, summary = ?2, ai_summary = ?3, ai_category = ?4,
             ai_status = 'done', collection_id = COALESCE(?5, collection_id),
             kind = COALESCE(?6, kind),
             updated_at = datetime('now','localtime')
             WHERE id = ?7 AND updated_at = ?8",
            rusqlite::params![
                final_title,
                display_summary,
                final_analysis,
                final_category,
                new_collection_id,
                kind_opt,
                id,
                snapshot_updated
            ],
        ).unwrap_or(0);

        if changed == 0 {
            let _ = tx.execute(
                "UPDATE memories SET ai_status = 'done' WHERE id = ?1",
                rusqlite::params![id],
            );
            let _ = tx.commit();
            emit_update(
                &app,
                MemoryUpdated {
                    id,
                    reason: "ai-stale".into(),
                    title: None,
                    collection_name: None,
                },
            );
            return;
        }

        // 标题更新后同步提醒标题，避免提醒里还留着旧标题
        let _ = tx.execute(
            "UPDATE reminders SET title = ?1 WHERE memory_id = ?2 AND done = 0",
            rusqlite::params![final_title, id],
        );

        // 结构化字段落库（整体替换，避免旧字段残留）
        if let Some(ex) = &extracted {
            let confidence = ex.confidence.unwrap_or(0.6).clamp(0.0, 1.0);
            let mut values: Vec<(&str, String)> = Vec::new();
            for (key, val) in [
                ("deadline", clean_opt(&ex.deadline)),
                ("event_start", clean_opt(&ex.event_start)),
                ("event_end", clean_opt(&ex.event_end)),
                ("project", clean_opt(&ex.project)),
                ("todo", clean_opt(&ex.todo)),
                ("url", clean_opt(&ex.url)),
                ("file_path", clean_opt(&ex.file_path)),
                ("code_lang", clean_opt(&ex.code_lang)),
                ("version", clean_opt(&ex.version)),
                ("email", clean_opt(&ex.email)),
                ("phone", clean_opt(&ex.phone)),
            ] {
                if let Some(v) = val {
                    values.push((key, v));
                }
            }
            if let Some(people) = &ex.people {
                let joined = people
                    .iter()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join(", ");
                if !joined.is_empty() {
                    values.push(("people", joined));
                }
            }
            let _ = tx.execute(
                "DELETE FROM memory_fields WHERE memory_id = ?1",
                rusqlite::params![id],
            );
            for (key, value) in &values {
                let _ = tx.execute(
                    "INSERT INTO memory_fields(memory_id, key, value, normalized, confidence)
                     VALUES (?1, ?2, ?3, ?3, ?4)",
                    rusqlite::params![id, key, value, confidence],
                );
            }

            // 先清掉旧待办提醒，避免改期后留下失效提醒
            let _ = tx.execute(
                "DELETE FROM reminders WHERE memory_id = ?1 AND done = 0",
                rusqlite::params![id],
            );

            // 有明确时间就生成提醒（去重，只排未来）
            let remind_raw = clean_opt(&ex.deadline).or_else(|| clean_opt(&ex.event_start));
            if let Some(raw) = remind_raw {
                let parsed = chrono::NaiveDateTime::parse_from_str(&raw, "%Y-%m-%d %H:%M")
                    .or_else(|_| {
                        chrono::NaiveDate::parse_from_str(&raw, "%Y-%m-%d").map(|d| {
                            d.and_hms_opt(9, 0, 0).unwrap_or_default()
                        })
                    });
                if let Ok(dt) = parsed {
                    if dt > chrono::Local::now().naive_local() {
                        let at = dt.format("%Y-%m-%d %H:%M").to_string();
                        let exists: i64 = conn
                            .query_row(
                                "SELECT COUNT(*) FROM reminders WHERE memory_id = ?1 AND remind_at = ?2",
                                rusqlite::params![id, at],
                                |r| r.get(0),
                            )
                            .unwrap_or(0);
                        if exists == 0 {
                            let _ = tx.execute(
                                "INSERT INTO reminders(memory_id, title, remind_at) VALUES (?1, ?2, ?3)",
                                rusqlite::params![id, final_title, at],
                            );
                        }
                    }
                }
            }
        }

        // 智能合集：AI 归属的合集也写入关联表
        if let Some(cid) = new_collection_id {
            let _ = tx.execute(
                "INSERT OR IGNORE INTO collection_memories(collection_id, memory_id, score, source, status)
                 VALUES (?1, ?2, 0.8, 'ai', 'confirmed')",
                rusqlite::params![cid, id],
            );
        }

        // 标签写入
        for tag in &tags {
            let _ = tx.execute(
                "INSERT OR IGNORE INTO tags(name) VALUES (?1)",
                rusqlite::params![tag],
            );
            let tag_id: Result<i64, _> = tx.query_row(
                "SELECT id FROM tags WHERE name = ?1",
                rusqlite::params![tag],
                |r| r.get(0),
            );
            if let Ok(tid) = tag_id {
                let _ = tx.execute(
                    "INSERT OR IGNORE INTO memory_tags(memory_id, tag_id) VALUES (?1, ?2)",
                    rusqlite::params![id, tid],
                );
            }
        }

        // 记录 ai_tasks
        let _ = tx.execute(
            "INSERT INTO ai_tasks(memory_id, task_type, status, finished_at)
             VALUES (?1, 'analyze', 'done', datetime('now','localtime'))",
            rusqlite::params![id],
        );

        let coll_name = new_collection_id.and_then(|cid| {
            tx.query_row(
                "SELECT name FROM collections WHERE id = ?1",
                rusqlite::params![cid],
                |r| r.get::<_, String>(0),
            )
            .ok()
        });

        let _ = tx.commit();

        emit_update(
            &app,
            MemoryUpdated {
                id,
                reason: "ai-done".into(),
                title: Some(final_title.clone()),
                collection_name: coll_name.clone(),
            },
        );

        // ---- 系统通知 ----
        let body = match coll_name {
            Some(name) => format!("「{}」已加入「{}」", final_title, name),
            None => format!("「{}」整理完成", final_title),
        };
        notify(&app, "记忆整理完成", &body);
    });
}

/// 扫描并重试处于 pending / failed 状态且重试次数未超上限的记忆（配置 API Key 后或后台定频触发）
pub fn spawn_retry_failed_memories(app: AppHandle) {
    thread::spawn(move || {
        let state = app.state::<AppState>();
        let ids: Vec<i64> = {
            let conn = match state.db.lock() {
                Ok(c) => c,
                Err(_) => return,
            };
            if !auto_analyze_on(&conn) {
                return;
            }
            let cfg = load_ai_config(&conn);
            if cfg.api_key.trim().is_empty() {
                return;
            }
            // 选择 pending 或 failed，且累计失败次数 < 5 次的记忆
            conn.prepare(
                "SELECT m.id FROM memories m
                 WHERE m.ai_status IN ('pending', 'failed')
                   AND (SELECT COUNT(*) FROM ai_tasks t WHERE t.memory_id = m.id AND t.status = 'failed') < 5
                 ORDER BY m.id DESC LIMIT 8",
            )
            .ok()
            .and_then(|mut s| {
                s.query_map([], |r| r.get::<_, i64>(0))
                    .ok()
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
            })
            .unwrap_or_default()
        };

        for id in ids {
            spawn_analyze(app.clone(), id);
            thread::sleep(std::time::Duration::from_millis(600));
        }
    });
}

/// 启动后台守护线程：每 3 分钟检查一次本地数据库是否有因断网/超时而滞留在 pending/failed 的记忆，有则自动重试
/// （纯本地 SQLite 查询，无待重试任务时 0 网络请求）
pub fn start_periodic_retry_worker(app: AppHandle) {
    thread::spawn(move || {
        loop {
            thread::sleep(std::time::Duration::from_secs(180));
            spawn_retry_failed_memories(app.clone());
        }
    });
}

pub fn notify(app: &AppHandle, title: &str, body: &str) {
    let app = app.clone();
    let title = title.to_string();
    let body = body.to_string();
    std::thread::spawn(move || {
        use tauri_plugin_notification::NotificationExt;
        let _ = app
            .notification()
            .builder()
            .title(&title)
            .body(&body)
            .show();
    });
}

/// 截图后立即调用的通知
pub fn notify_captured(app: &AppHandle) {
    notify(app, "月忆", "已捕获一条新记忆\n正在进行 AI 整理…");
}

/// 从截图 OCR 文本中提取可能存在的浏览器地址栏 URL（作为浏览器历史反查的兜底）
fn extract_url_from_ocr(ocr_text: &str) -> Option<String> {
    // 紧凑化 OCR 在符号两侧插入的空格 + 全角符号转半角
    let compact = ocr_text
        .replace(" / ", "/")
        .replace("/ ", "/")
        .replace(" /", "/")
        .replace(" . ", ".")
        .replace(". ", ".")
        .replace(" .", ".")
        .replace('．', ".")
        .replace('＝', "=")
        .replace('（', "(")
        .replace('）', ")");

    let tokens: Vec<&str> = compact.split_whitespace().collect();
    let domains: [&str; 18] = [
        "bilibili.com/",
        "www.bilibili.com/",
        "b23.tv/",
        "youtube.com/",
        "www.youtube.com/",
        "youtu.be/",
        "v.qq.com/",
        "douyin.com/",
        "www.douyin.com/",
        "ixigua.com/",
        "zhihu.com/",
        "www.zhihu.com/",
        "github.com/",
        "chatgpt.com/",
        "arxiv.org/",
        "juejin.cn/",
        "csdn.net/",
        "xiaohongshu.com/",
    ];

    for (i, token) in tokens.iter().enumerate() {
        let t = token.trim_matches(|c: char| "()[]<>\"'，。；！？".contains(c));
        let mut url = if (t.starts_with("https://") || t.starts_with("http://"))
            && t.len() > 10
            && t.contains('.')
        {
            t.to_string()
        } else if domains.iter().any(|d| t.starts_with(*d) && t.len() > d.len()) {
            format!("https://{}", t)
        } else {
            continue;
        };

        // 向后合并被 OCR 空格分割的 URL 片段（例如 "BV11" + "aaz6iEgN/?spm"），
        // 避免只取到截断的 BV 号。片段判定：纯 ASCII 的 URL 合法字符。
        for next in tokens[i + 1..].iter().take(8) {
            let nt = next.trim_matches(|c: char| "()[]<>\"'，。；！？".contains(c));
            let is_frag = !nt.is_empty()
                && nt.chars().all(|c| c.is_ascii())
                && nt.chars().any(|c| c.is_ascii_alphanumeric())
                && nt
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || ":/?=&%._-~+#@!$'*,;".contains(c));
            if is_frag {
                url.push_str(nt);
            } else {
                break;
            }
        }
        return Some(url);
    }
    None
}

/// 屏幕截图路径
pub fn screenshot_path() -> std::path::PathBuf {
    data_dir()
        .join("screenshots")
        .join(format!("{}.png", uuid::Uuid::new_v4()))
}

/// 每 60 秒检查：到期提醒 + 18 点后的每日回顾（当日只发一次）
pub fn start_reminder_worker(app: AppHandle) {
    use chrono::Timelike;
    thread::spawn(move || loop {
        thread::sleep(std::time::Duration::from_secs(60));

        let mut due: Vec<(i64, String)> = Vec::new();
        let mut review: Option<String> = None;

        {
            let state = app.state::<AppState>();
            if let Ok(conn) = state.db.lock() {
                if let Ok(mut stmt) = conn.prepare(
                    "SELECT id, title FROM reminders
                     WHERE done = 0 AND fired = 0 AND remind_at <= datetime('now','localtime')
                     ORDER BY remind_at LIMIT 5",
                ) {
                    if let Ok(rows) = stmt.query_map([], |r| {
                        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
                    }) {
                        due = rows.filter_map(|r| r.ok()).collect();
                    }
                }

                let now = chrono::Local::now();
                let today = now.format("%Y-%m-%d").to_string();
                let last = get_setting(&conn, "last_review_date");
                let enabled = get_setting(&conn, "daily_review");
                if enabled != "false" && last != today && now.hour() >= 18 {
                    let today_count: i64 = conn
                        .query_row(
                            "SELECT COUNT(*) FROM memories WHERE COALESCE(deleted_at,'') = ''
                             AND created_at >= date('now','localtime','start of day')",
                            [],
                            |r| r.get(0),
                        )
                        .unwrap_or(0);
                    let pending: i64 = conn
                        .query_row(
                            "SELECT COUNT(*) FROM memories WHERE COALESCE(deleted_at,'') = ''
                             AND ai_status IN ('pending','processing','failed')",
                            [],
                            |r| r.get(0),
                        )
                        .unwrap_or(0);
                    review = Some(format!(
                        "今天保存了 {} 条记忆，{} 条待整理。点开月忆看看。",
                        today_count, pending
                    ));
                }
            };
        }

        for (id, title) in &due {
            notify(&app, "月忆提醒", title);
            if let Ok(conn) = app.state::<AppState>().db.lock() {
                let _ = conn.execute(
                    "UPDATE reminders SET fired = 1 WHERE id = ?1",
                    rusqlite::params![id],
                );
            }
        }

        if let Some(body) = review {
            notify(&app, "月忆 · 今日回顾", &body);
            if let Ok(conn) = app.state::<AppState>().db.lock() {
                let _ = crate::state::set_setting(
                    &conn,
                    "last_review_date",
                    &chrono::Local::now().format("%Y-%m-%d").to_string(),
                );
            }
        }
    });
}

#[cfg(test)]
mod security_tests {
    use super::url_is_private;
    use reqwest::Url;

    #[test]
    fn blocks_private_and_local_hosts() {
        for u in [
            "http://127.0.0.1/x",
            "http://10.0.0.8/",
            "http://192.168.1.10/",
            "http://172.16.0.2/",
            "http://169.254.1.1/",
            "http://localhost/",
            "http://foo.local/",
            "http://[::1]/",
            "file:///C:/Windows/win.ini",
        ] {
            assert!(url_is_private(&Url::parse(u).unwrap()), "should block {u}");
        }
    }

    #[test]
    fn allows_public_hosts() {
        for u in ["https://example.com/a?b=1", "http://8.8.8.8/"] {
            assert!(!url_is_private(&Url::parse(u).unwrap()), "should allow {u}");
        }
    }
}
