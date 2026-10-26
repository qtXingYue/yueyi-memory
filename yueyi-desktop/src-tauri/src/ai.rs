// ============ AI Provider 抽象层 + DeepSeek 实现 ============
// 统一入口：AIService::chat() —— 业务代码不直接接触 HTTP 细节

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            base_url: "https://api.deepseek.com".into(),
            model: "deepseek-chat".into(),
        }
    }
}

pub type Messages = Vec<(String, String)>;

#[derive(Debug, thiserror::Error)]
#[allow(dead_code)]
pub enum AiError {
    #[error("API Key 未配置，请前往设置页填写 DeepSeek API Key")]
    NoApiKey,
    #[error("AI 服务连接失败（{code}）：{message}")]
    ApiError { code: u16, message: String },
    #[error("网络请求失败：{0}")]
    Network(String),
    #[error("AI 返回异常：{0}")]
    BadResponse(String),
}

impl serde::Serialize for AiError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// AIProvider trait —— 未来可替换/扩展其他模型供应商
pub trait AiProvider: Send + Sync {
    #[allow(dead_code)]
    fn name(&self) -> &str;
    fn chat(&self, messages: &Messages, max_tokens: Option<u32>) -> Result<String, AiError>;
    fn test_connection(&self) -> Result<(), AiError>;
}

// ---------- DeepSeek Provider（OpenAI 兼容协议） ----------

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    temperature: f32,
    stream: bool,
}

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: RespMessage,
}

#[derive(Deserialize)]
struct RespMessage {
    content: String,
}

pub struct DeepSeekProvider {
    pub config: AiConfig,
    client: reqwest::blocking::Client,
}

impl DeepSeekProvider {
    pub fn new(config: AiConfig) -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(90))
            .build()
            .expect("HTTP client 构建失败");
        Self { config, client }
    }

    fn endpoint(&self) -> String {
        let base = self.config.base_url.trim_end_matches('/');
        // 兼容用户填 https://api.deepseek.com 或 https://api.deepseek.com/v1
        if base.ends_with("/v1") {
            format!("{}/chat/completions", base)
        } else {
            format!("{}/v1/chat/completions", base)
        }
    }
}

impl AiProvider for DeepSeekProvider {
    fn name(&self) -> &str {
        "DeepSeek"
    }

    fn chat(&self, messages: &Messages, max_tokens: Option<u32>) -> Result<String, AiError> {
        if self.config.api_key.trim().is_empty() {
            return Err(AiError::NoApiKey);
        }
        let req = ChatRequest {
            model: &self.config.model,
            messages: messages
                .iter()
                .map(|(role, content)| ChatMessage { role, content })
                .collect(),
            max_tokens,
            temperature: 0.3,
            stream: false,
        };

        let resp = self
            .client
            .post(self.endpoint())
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .header("Content-Type", "application/json")
            .json(&req)
            .send()
            .map_err(|e| AiError::Network(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().unwrap_or_default();
            return Err(AiError::ApiError {
                code: status.as_u16(),
                message: body.chars().take(300).collect(),
            });
        }

        let parsed: ChatResponse = resp
            .json()
            .map_err(|e| AiError::BadResponse(format!("JSON 解析失败: {}", e)))?;
        parsed
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .ok_or_else(|| AiError::BadResponse("choices 为空".into()))
    }

    fn test_connection(&self) -> Result<(), AiError> {
        let msg = vec![("user".to_string(), "ping".to_string())];
        let _ = self.chat(&msg, Some(8))?;
        Ok(())
    }
}

// ---------- AI Service 门面 ----------

pub struct AiService;

impl AiService {
    /// 用配置构造 provider
    pub fn provider(config: AiConfig) -> Box<dyn AiProvider> {
        Box::new(DeepSeekProvider::new(config))
    }

    /// 容错解析 AI 返回的 JSON（剥离 ```json 包裹、找首个 [ 或 {）
    pub fn parse_json_loose<T: serde::de::DeserializeOwned>(text: &str) -> Result<T, AiError> {
        let mut t = text.trim();
        // 剥离 markdown 代码块
        if t.starts_with("```") {
            t = t.trim_start_matches("```json").trim_start_matches("```");
            t = t.trim_end_matches("```").trim();
        }
        // 找到第一个 [ 或 {
        if let Some(start) = t.find(|c| c == '[' || c == '{') {
            if let Some(end) = t.rfind(|c| c == ']' || c == '}') {
                if end > start {
                    t = &t[start..=end];
                }
            }
        }
        serde_json::from_str(t).map_err(|e| AiError::BadResponse(format!("JSON 容错解析失败: {} | 原文: {}", e, &text.chars().take(200).collect::<String>())))
    }
}
