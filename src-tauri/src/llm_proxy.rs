//! OpenAI-compatible chat/completions proxy with SSE streaming.
//!
//! Events emit on `llm://{session_id}`. See design doc §2.4.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LlmEvent {
    Token {
        content: String,
    },
    Done,
    Error {
        message: String,
        status: Option<u16>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SseItem {
    Data(String),
    Done,
    Ignore,
}

/// Parse one trimmed SSE line from an OpenAI-compatible stream.
pub fn parse_sse_line(line: &str) -> SseItem {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return SseItem::Ignore;
    }
    if !trimmed.starts_with("data: ") {
        return SseItem::Ignore;
    }
    let payload = trimmed["data: ".len()..].trim();
    if payload == "[DONE]" {
        return SseItem::Done;
    }
    SseItem::Data(payload.to_string())
}

/// Extract `choices[0].delta.content` from one SSE JSON payload string.
pub fn extract_delta_content(data_json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(data_json).ok()?;
    let content = v
        .pointer("/choices/0/delta/content")
        .and_then(|c| c.as_str())
        .filter(|s| !s.is_empty());
    content.map(|s| s.to_string())
}

use std::time::Duration;

use futures_util::StreamExt;
use reqwest::Client;
use rusqlite::Connection;
use tauri::{AppHandle, Emitter};
use tokio::time::timeout;

use crate::db::get_db_path;
use crate::provider;
use crate::vault;

#[derive(Deserialize, Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LlmChatStreamArgs {
    pub session_id: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f64>,
    pub tools: Option<serde_json::Value>,
    /// Default model params (JSON object) for the inline/legacy path.
    /// For the provider path these are resolved server-side from the DB.
    #[serde(default)]
    pub params: Option<serde_json::Value>,
    /// Legacy path (PR2): frontend passes plaintext key from localStorage
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    /// Reserved for PR4 — reject in PR2 if sole source
    pub provider_id: Option<String>,
}

#[derive(Debug)]
pub enum LlmProxyError {
    BadRequest(String),
    Http { status: u16, body: String },
    Network(String),
}

impl std::fmt::Display for LlmProxyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LlmProxyError::BadRequest(s) => write!(f, "{}", s),
            LlmProxyError::Http { status, body } => write!(f, "HTTP {}: {}", status, body),
            LlmProxyError::Network(s) => write!(f, "network: {}", s),
        }
    }
}

fn inline_credentials_provided(args: &LlmChatStreamArgs) -> bool {
    args.provider_id.is_none()
        && args.base_url.as_ref().is_some_and(|s| !s.trim().is_empty())
        && args.api_key.as_ref().is_some_and(|k| !k.is_empty())
}

fn resolve_endpoint_inline(args: &LlmChatStreamArgs) -> Result<(String, String), LlmProxyError> {
    let base_url = args
        .base_url
        .as_ref()
        .map(|s| s.trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| LlmProxyError::BadRequest("baseUrl is required".into()))?;
    let api_key = args.api_key.clone().unwrap_or_default();
    Ok((base_url, api_key))
}

/// Resolve endpoint credentials from inline args or provider DB + vault.
pub fn resolve_endpoint_with_provider(
    app: &AppHandle,
    args: &LlmChatStreamArgs,
) -> Result<(String, String), LlmProxyError> {
    if inline_credentials_provided(args) {
        return resolve_endpoint_inline(args);
    }

    if let Some(provider_id) = &args.provider_id {
        let db_path = get_db_path(app);
        let conn =
            Connection::open(&db_path).map_err(|e| LlmProxyError::BadRequest(e.to_string()))?;
        let master = vault::load_master_key(app).map_err(LlmProxyError::BadRequest)?;
        return provider::load_provider_endpoint(&conn, &master, provider_id)
            .map_err(LlmProxyError::BadRequest);
    }

    resolve_endpoint_inline(args)
}

/// Resolve default model params: from the provider DB (provider path) or from
/// inline args (legacy path). Returns a JSON object or `None`.
pub fn resolve_provider_params(
    app: &AppHandle,
    args: &LlmChatStreamArgs,
) -> Option<serde_json::Value> {
    if !inline_credentials_provided(args) {
        if let Some(provider_id) = &args.provider_id {
            let db_path = get_db_path(app);
            if let Ok(conn) = Connection::open(&db_path) {
                if let Some(params) = provider::load_provider_params(&conn, provider_id) {
                    return Some(params);
                }
            }
        }
    }
    args.params.as_ref().filter(|v| v.is_object()).cloned()
}

/// Keys that callers must never override via params (managed by the proxy).
const RESERVED_BODY_KEYS: [&str; 4] = ["model", "messages", "stream", "tools"];

pub fn build_chat_body(
    args: &LlmChatStreamArgs,
    provider_params: Option<&serde_json::Value>,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": args.model,
        "messages": args.messages,
        "stream": true,
    });
    // Provider/default params act as a baseline and are merged first.
    if let Some(serde_json::Value::Object(map)) = provider_params {
        for (k, v) in map {
            if v.is_null() || RESERVED_BODY_KEYS.contains(&k.as_str()) {
                continue;
            }
            body[k] = v.clone();
        }
    }
    // An explicit per-call temperature (e.g. agent setting) overrides the default.
    if let Some(t) = args.temperature {
        body["temperature"] = serde_json::json!(t);
    }
    if let Some(tools) = &args.tools {
        if !tools.is_null() {
            body["tools"] = tools.clone();
        }
    }
    body
}

const STREAM_TIMEOUT: Duration = Duration::from_secs(120);

pub async fn stream_chat_completions(
    app: AppHandle,
    args: LlmChatStreamArgs,
) -> Result<(), LlmProxyError> {
    let event_name = format!("llm://{}", args.session_id);
    let (base_url, api_key) = resolve_endpoint_with_provider(&app, &args)?;
    let url = format!("{}/chat/completions", base_url);
    let provider_params = resolve_provider_params(&app, &args);
    let body = build_chat_body(&args, provider_params.as_ref());

    let client = Client::builder()
        .timeout(STREAM_TIMEOUT)
        .build()
        .map_err(|e| LlmProxyError::Network(e.to_string()))?;

    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body);

    // Ollama may use empty bearer; others need Authorization when key present
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }

    let resp = req
        .send()
        .await
        .map_err(|e| LlmProxyError::Network(e.to_string()))?;

    let status = resp.status();
    if !status.is_success() {
        let body_text = resp.text().await.unwrap_or_default();
        return Err(LlmProxyError::Http {
            status: status.as_u16(),
            body: body_text,
        });
    }

    let mut byte_stream = resp.bytes_stream();
    let mut byte_buffer: Vec<u8> = Vec::new();

    while let Some(chunk) = byte_stream.next().await {
        let chunk = chunk.map_err(|e| LlmProxyError::Network(e.to_string()))?;
        byte_buffer.extend_from_slice(&chunk);

        while let Some(newline_pos) = byte_buffer.iter().position(|&b| b == b'\n') {
            let mut line_bytes: Vec<u8> = byte_buffer.drain(..=newline_pos).collect();
            if line_bytes.last() == Some(&b'\n') {
                line_bytes.pop();
            }
            if line_bytes.ends_with(&[b'\r']) {
                line_bytes.pop();
            }
            let line = match std::str::from_utf8(&line_bytes) {
                Ok(s) => s.to_string(),
                Err(_) => continue,
            };

            match parse_sse_line(&line) {
                SseItem::Ignore => {}
                SseItem::Done => {
                    let _ = app.emit(&event_name, LlmEvent::Done);
                    return Ok(());
                }
                SseItem::Data(json) => {
                    if let Some(content) = extract_delta_content(&json) {
                        let _ = app.emit(&event_name, LlmEvent::Token { content });
                    }
                }
            }
        }
    }

    let _ = app.emit(&event_name, LlmEvent::Done);
    Ok(())
}

#[tauri::command]
pub async fn llm_chat_stream(app: AppHandle, args: LlmChatStreamArgs) -> Result<(), String> {
    if args.session_id.is_empty() {
        return Err("sessionId is required".into());
    }
    if args.model.is_empty() {
        return Err("model is required".into());
    }
    if args.messages.is_empty() {
        return Err("messages must not be empty".into());
    }
    resolve_endpoint_with_provider(&app, &args).map_err(|e| e.to_string())?;

    let session_id = args.session_id.clone();
    let event_name = format!("llm://{}", session_id);
    let app_bg = app.clone();

    tokio::spawn(async move {
        let result = timeout(
            STREAM_TIMEOUT,
            stream_chat_completions(app_bg.clone(), args),
        )
        .await;
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                let (message, status) = match &e {
                    LlmProxyError::Http { status, body } => (body.clone(), Some(*status)),
                    other => (other.to_string(), None),
                };
                let _ = app_bg.emit(&event_name, LlmEvent::Error { message, status });
                let _ = app_bg.emit(&event_name, LlmEvent::Done);
            }
            Err(_) => {
                let _ = app_bg.emit(
                    &event_name,
                    LlmEvent::Error {
                        message: "stream timeout".into(),
                        status: None,
                    },
                );
                let _ = app_bg.emit(&event_name, LlmEvent::Done);
            }
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sse_line_data_and_done() {
        assert_eq!(
            parse_sse_line("data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}"),
            SseItem::Data("{\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}".into())
        );
        assert_eq!(parse_sse_line("data: [DONE]"), SseItem::Done);
        assert_eq!(parse_sse_line(""), SseItem::Ignore);
        assert_eq!(parse_sse_line(": ping"), SseItem::Ignore);
    }

    #[test]
    fn extract_delta_content_parses_openai_shape() {
        let json = r#"{"choices":[{"delta":{"content":"你好"}}]}"#;
        assert_eq!(extract_delta_content(json), Some("你好".into()));
        assert_eq!(extract_delta_content(r#"{"choices":[{"delta":{}}]}"#), None);
        assert_eq!(extract_delta_content("not-json"), None);
    }

    fn args_with_params(
        temperature: Option<f64>,
        params: Option<serde_json::Value>,
    ) -> LlmChatStreamArgs {
        LlmChatStreamArgs {
            session_id: "s".into(),
            model: "m".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "hi".into(),
                name: None,
            }],
            temperature,
            tools: None,
            params,
            base_url: Some("http://x".into()),
            api_key: Some("k".into()),
            provider_id: None,
        }
    }

    #[test]
    fn build_chat_body_merges_provider_params() {
        let args = args_with_params(None, None);
        let provider_params = serde_json::json!({
            "temperature": 0.3,
            "top_p": 0.9,
            "top_k": 40,
            "max_tokens": 256,
            "repetition_penalty": 1.1
        });
        let body = build_chat_body(&args, Some(&provider_params));
        assert_eq!(body["temperature"], 0.3);
        assert_eq!(body["top_p"], 0.9);
        assert_eq!(body["top_k"], 40);
        assert_eq!(body["max_tokens"], 256);
        assert_eq!(body["repetition_penalty"], 1.1);
        assert_eq!(body["stream"], true);
    }

    #[test]
    fn explicit_temperature_overrides_provider_default() {
        let args = args_with_params(Some(1.5), None);
        let provider_params = serde_json::json!({ "temperature": 0.2, "top_p": 0.8 });
        let body = build_chat_body(&args, Some(&provider_params));
        assert_eq!(body["temperature"], 1.5);
        assert_eq!(body["top_p"], 0.8);
    }

    #[test]
    fn provider_params_cannot_override_reserved_keys() {
        let args = args_with_params(None, None);
        let provider_params = serde_json::json!({
            "model": "evil",
            "messages": [],
            "stream": false,
            "top_p": 0.7
        });
        let body = build_chat_body(&args, Some(&provider_params));
        assert_eq!(body["model"], "m");
        assert_eq!(body["stream"], true);
        assert!(body["messages"].as_array().unwrap().len() == 1);
        assert_eq!(body["top_p"], 0.7);
    }

    #[test]
    fn utf8_multibyte_line_decodes_from_byte_chunks() {
        let line = "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}";
        let full: Vec<u8> = line.as_bytes().to_vec();
        let split_at = full.iter().position(|&b| b > 0x7f).unwrap();

        let mut byte_buffer = full[..split_at].to_vec();
        byte_buffer.extend_from_slice(&full[split_at..]);
        byte_buffer.push(b'\n');

        let newline_pos = byte_buffer.iter().position(|&b| b == b'\n').unwrap();
        let mut line_bytes: Vec<u8> = byte_buffer.drain(..=newline_pos).collect();
        if line_bytes.last() == Some(&b'\n') {
            line_bytes.pop();
        }
        let decoded = std::str::from_utf8(&line_bytes).unwrap();
        let json = match parse_sse_line(decoded) {
            SseItem::Data(json) => json,
            other => panic!("expected Data, got {:?}", other),
        };
        assert_eq!(extract_delta_content(&json), Some("你好".into()));
    }

    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[test]
    fn resolve_endpoint_from_db_uses_vault_secret() {
        use crate::db::init_db_schemas;
        use crate::provider::db::upsert_provider;
        use crate::provider::Provider;
        use crate::vault::{self, KEY_LEN};

        let conn = Connection::open_in_memory().unwrap();
        init_db_schemas(&conn).unwrap();

        let mut master = [0u8; KEY_LEN];
        for (i, b) in master.iter_mut().enumerate() {
            *b = i as u8;
        }

        let provider = Provider {
            id: "deepseek".into(),
            name: "DeepSeek".into(),
            base_url: "https://api.deepseek.com/v1/".into(),
            api_key_ref: "provider:deepseek".into(),
            models: vec!["deepseek-chat".into()],
            source: "user".into(),
            icon_url: None,
            description: None,
            enabled: true,
            params: None,
            created_at: None,
            updated_at: None,
        };
        upsert_provider(&conn, &provider).unwrap();
        vault::set(&conn, &master, "provider:deepseek", "sk-from-vault").unwrap();

        let (base_url, api_key) =
            provider::load_provider_endpoint(&conn, &master, "deepseek").unwrap();
        assert_eq!(base_url, "https://api.deepseek.com/v1");
        assert_eq!(api_key, "sk-from-vault");
    }

    #[tokio::test]
    async fn stream_chat_completions_http_layer() {
        let server = MockServer::start().await;
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}}]}\n\n\
                   data: [DONE]\n\n";
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(sse, "text/event-stream"))
            .mount(&server)
            .await;

        let session_id = "test-session".to_string();
        let args = LlmChatStreamArgs {
            session_id: session_id.clone(),
            model: "gpt-test".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "hi".into(),
                name: None,
            }],
            temperature: None,
            tools: None,
            params: None,
            base_url: Some(server.uri()),
            api_key: Some("sk-test".into()),
            provider_id: None,
        };

        let (base, key) = resolve_endpoint_inline(&args).unwrap();
        assert_eq!(base, server.uri());
        assert_eq!(key, "sk-test");
        let body = build_chat_body(&args, None);
        assert_eq!(body["stream"], true);
    }
}
