// ============ AI Prompt 系统（集中管理，支持中文） ============

pub struct PromptInput<'a> {
    pub content: &'a str,      // 原文 / OCR 文本
    pub ocr_text: &'a str,     // OCR 原文（可为空）
    pub memory_type: &'a str,  // text/image/screenshot/link/code...
    pub collections: &'a str,  // 可选合集列表（逗号分隔）
}

/// 生成标题
pub fn generate_title(input: &PromptInput) -> Vec<(String, String)> {
    vec![
        ("system".into(),
            "你是「月忆」的记忆整理助手。为用户保存的内容生成一个简洁、准确的中文标题，不超过 20 个字。只输出标题本身，不要任何前缀、引号或解释。".into(),
        ),
        ("user".into(), format!("内容：\n{}", preview(input, 1500))),
    ]
}

/// 生成摘要
pub fn summarize(input: &PromptInput) -> Vec<(String, String)> {
    vec![
        ("system".into(),
            "你是「月忆」的记忆整理助手。用 1~3 句中文概括以下内容的核心信息，简洁客观。只输出摘要，不要前缀。".into(),
        ),
        ("user".into(), format!("内容：\n{}", preview(input, 2500))),
    ]
}

/// 提取标签
pub fn extract_tags(input: &PromptInput) -> Vec<(String, String)> {
    vec![
        ("system".into(),
            "你是「月忆」的记忆整理助手。从以下内容提取 2~6 个简短标签（每标签 1~6 个字，中文优先）。只输出一个 JSON 数组，如 [\"AI\",\"学习\"]，不要其他文字。".into(),
        ),
        ("user".into(), format!("内容：\n{}", preview(input, 1500))),
    ]
}

/// 自动分类（判断属于哪个合集）
pub fn classify_memory(input: &PromptInput) -> Vec<(String, String)> {
    vec![
        ("system".into(),
            format!(
                "你是「月忆」的记忆整理助手。判断以下内容最属于哪个合集。可选合集：{}。只输出合集名称本身，不要其他文字。",
                if input.collections.is_empty() {
                    "学习资料, 工作记录, 灵感碎片, 生活日常, 待整理"
                } else {
                    input.collections
                }
            ),
        ),
        ("user".into(), format!("内容：\n{}", preview(input, 1200))),
    ]
}

/// 分析截图（OCR + 理解）
pub fn analyze_screenshot(input: &PromptInput) -> Vec<(String, String)> {
    vec![
        ("system".into(),
            "你是「月忆」的记忆整理助手。这是一张用户截屏的 OCR 识别结果。请分析截图主题与关键信息（2~4 句中文），说明它关于什么、有什么要点。只输出分析内容。".into(),
        ),
        ("user".into(),
            format!("OCR 识别文本：\n{}", if input.ocr_text.is_empty() { "（OCR 未识别到文字）" } else { input.ocr_text }),
        ),
    ]
}

/// 分析通用内容（文本 / 链接 / 代码 / 文档的深度要点提炼）
pub fn analyze_content(input: &PromptInput) -> Vec<(String, String)> {
    vec![
        ("system".into(),
            "你是「月忆」的记忆整理助手。请对以下用户记录的内容进行要点分析（2~4 句中文），提炼其核心背景、关键结论或后续可执行的行动建议。只输出分析内容，不要前缀。".into(),
        ),
        ("user".into(), format!("类型：{}\n内容：\n{}", input.memory_type, preview(input, 2000))),
    ]
}

/// AI 问答：基于检索到的记忆回答（严禁编造）
pub fn answer_question(question: &str, contexts: &[String]) -> Vec<(String, String)> {
    let ctx = if contexts.is_empty() {
        "（未检索到相关记忆）".to_string()
    } else {
        contexts
            .iter()
            .enumerate()
            .map(|(i, c)| format!("[{}] {}", i + 1, c))
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    vec![
        ("system".into(),
            format!(
                "你是「月忆」的问答助手。你只能根据下方「用户记忆上下文」中真实存在的记忆回答用户问题。

规则：
1. 回答必须基于上下文中列出的记忆，用 [编号] 引用来源，如 [1]。
2. 如果上下文没有相关记忆，必须明确回答：我没有在你的记忆中找到相关内容。绝不编造用户做过的事情。
3. 用中文回答，简洁清晰。先给结论，再列出相关记忆（带编号引用）。
4. 你的推测（如果上下文不充分需要推断时）必须明确标注「AI 推测」，与「来自你的记忆」区分。

用户记忆上下文：
{}",
                ctx
            ),
        ),
        ("user".into(), question.to_string()),
    ]
}

/// 找相关记忆（用于 embedding 留接口，当前基于标签/关键词）
#[allow(dead_code)]
pub fn find_related_memories(title: &str, tags: &[String]) -> Vec<(String, String)> {
    vec![
        ("system".into(),
            "根据给定记忆的标题和标签，从候选列表中选出语义最相关的记忆编号。只输出 JSON 数组如 [1,3,5]，不要其他文字。".into(),
        ),
        ("user".into(),
            format!("当前记忆标题：{}\n标签：{}\n\n候选记忆：{}", title, tags.join(", "), "{}"), // 候选由调用方拼接
        ),
    ]
}

/// 每日总结（预留）
#[allow(dead_code)]
pub fn daily_summary(memory_titles: &[String]) -> Vec<(String, String)> {
    vec![
        ("system".into(),
            "你是「月忆」的助手。根据用户今天保存的记忆标题，生成一段简短的今日回顾（2~3 句中文）。只输出回顾内容。".into(),
        ),
        ("user".into(),
            format!("今日记忆：\n{}", memory_titles.join("\n")),
        ),
    ]
}

/// 结构化信息抽取：只抽显式存在的信息，不猜测
pub fn extract_fields(input: &PromptInput, today: &str) -> Vec<(String, String)> {
    vec![
        (
            "system".into(),
            format!(
                r#"你是「月忆」的信息抽取助手。今天是 {today}。请从内容中抽取可执行的结构化信息，输出严格 JSON（不要 markdown 代码块）：
{{
  "kind": "note|link|snippet|file|schedule|task|contact|reference",
  "deadline": "YYYY-MM-DD HH:MM 或 null",
  "event_start": "YYYY-MM-DD HH:MM 或 null",
  "event_end": "YYYY-MM-DD HH:MM 或 null",
  "project": "项目/课程名或 null",
  "people": ["人名或角色"],
  "todo": "明确的待办或 null",
  "url": "链接或 null",
  "file_path": "本地路径或 null",
  "code_lang": "编程语言或 null",
  "version": "版本号或 null",
  "email": "邮箱或 null",
  "phone": "电话或 null",
  "confidence": 0.0
}}
规则：只抽取原文明确出现的信息；相对时间（明天、下周一、周五下午）按今天换算成绝对时间；没有的字段一律 null；不要编造。"#
            ),
        ),
        (
            "user".into(),
            format!(
                "内容类型：{}\n内容：\n{}",
                input.memory_type,
                preview(input, 3000)
            ),
        ),
    ]
}

/// 智能合集摘要：把关联记忆提炼成结构化精华
pub fn collection_summary(name: &str, goal: &str, items: &[String]) -> Vec<(String, String)> {
    let list = items
        .iter()
        .enumerate()
        .map(|(i, it)| format!("{}. {}", i + 1, it))
        .collect::<Vec<_>>()
        .join("\n");
    vec![
        (
            "system".into(),
            "你是「月忆」的合集整理助手。根据合集名称、目标和下面的记忆条目，写一段 150~300 字的中文总结。\
             要求：先一句话概括主题，再列出关键资料/结论，最后给 1~3 条待办或下一步建议。\
             只输出正文，不要标题、不要 markdown 标记。"
                .into(),
        ),
        (
            "user".into(),
            format!(
                "合集名称：{}\n合集目标：{}\n记忆条目：\n{}",
                name,
                if goal.trim().is_empty() { "（未填写）" } else { goal },
                if list.is_empty() { "（暂无）" } else { &list }
            ),
        ),
    ]
}

/// 周复盘：把一周的记忆标题归纳成简报
pub fn weekly_review(items: &[String]) -> Vec<(String, String)> {
    let list = items.join("\n");
    vec![
        (
            "system".into(),
            "你是「月忆」的周报助手。根据本周保存的记忆标题，输出一段中文周报草稿：\
             1) 本周主题（2~3 条）；2) 重要资料；3) 未完成/待跟进；4) 下周建议。\
             每条一行，简洁，不要编造不存在的细节。"
                .into(),
        ),
        (
            "user".into(),
            format!("本周记忆：\n{}", if list.is_empty() { "（本周没有新增）" } else { &list }),
        ),
    ]
}

fn preview(input: &PromptInput, max: usize) -> String {
    let mut text = String::new();
    if !input.content.is_empty() {
        text.push_str(input.content);
    }
    if !input.ocr_text.is_empty() && input.ocr_text != input.content {
        if !text.is_empty() {
            text.push_str("\n---\nOCR 文本：\n");
        }
        text.push_str(input.ocr_text);
    }
    if text.is_empty() {
        text = format!("（{} 类型，无文本内容）", input.memory_type);
    }
    if text.len() > max {
        let mut cut = text.char_indices().nth(max).map(|(i, _)| i).unwrap_or(text.len());
        // 对齐字符边界
        while cut > 0 && !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
        text.push_str("…");
    }
    text
}
