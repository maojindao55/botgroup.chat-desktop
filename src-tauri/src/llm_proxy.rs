//! OpenAI-compatible chat/completions proxy with SSE streaming.
//!
//! Events emit on `llm://{session_id}`. See design doc §2.4.
//!
//! ## PR4 follow-up
//! - Replace inline `apiKey` with `vault::get(conn, master, provider.api_key_ref)`
//! - Implement `provider_id` resolution via `providers` table
//! - Remove plaintext key crossing IPC boundary

use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LlmEvent {
    Token { content: String },
    Done,
    Error { message: String, status: Option<u16> },
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
use tauri::{AppHandle, Emitter};
use tokio::time::timeout;

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

/// Resolve endpoint credentials. PR2: inline baseURL+apiKey only.
pub fn resolve_endpoint(args: &LlmChatStreamArgs) -> Result<(String, String), LlmProxyError> {
    if let Some(pid) = &args.provider_id {
        if args.base_url.is_none() && args.api_key.is_none() {
            return Err(LlmProxyError::BadRequest(format!(
                "providerId '{}' resolution is not implemented until PR3/PR4; pass baseUrl+apiKey",
                pid
            )));
        }
    }
    let base_url = args
        .base_url
        .as_ref()
        .map(|s| s.trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| LlmProxyError::BadRequest("baseUrl is required".into()))?;
    let api_key = args.api_key.clone().unwrap_or_default();
    Ok((base_url, api_key))
}

pub fn build_chat_body(args: &LlmChatStreamArgs) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": args.model,
        "messages": args.messages,
        "stream": true,
    });
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
    let (base_url, api_key) = resolve_endpoint(&args)?;
    let url = format!("{}/chat/completions", base_url);
    let body = build_chat_body(&args);

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
        let _ = app.emit(
            &event_name,
            LlmEvent::Error {
                message: body_text.clone(),
                status: Some(status.as_u16()),
            },
        );
        let _ = app.emit(&event_name, LlmEvent::Done);
        return Err(LlmProxyError::Http {
            status: status.as_u16(),
            body: body_text,
        });
    }

    let mut byte_stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = byte_stream.next().await {
        let chunk = chunk.map_err(|e| LlmProxyError::Network(e.to_string()))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].to_string();
            buffer = buffer[pos + 1..].to_string();

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
    resolve_endpoint(&args).map_err(|e| e.to_string())?;

    let session_id = args.session_id.clone();
    let event_name = format!("llm://{}", session_id);
    let app_bg = app.clone();

    tokio::spawn(async move {
        let result = timeout(STREAM_TIMEOUT, stream_chat_completions(app_bg.clone(), args)).await;
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                let _ = app_bg.emit(
                    &event_name,
                    LlmEvent::Error {
                        message: e.to_string(),
                        status: match &e {
                            LlmProxyError::Http { status, .. } => Some(*status),
                            _ => None,
                        },
                    },
                );
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

    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[test]
    fn resolve_endpoint_rejects_provider_only() {
        let args = LlmChatStreamArgs {
            session_id: "s".into(),
            model: "m".into(),
            messages: vec![],
            temperature: None,
            tools: None,
            base_url: None,
            api_key: None,
            provider_id: Some("qwen".into()),
        };
        assert!(resolve_endpoint(&args).is_err());
    }

    #[tokio::test]
    async fn stream_chat_completions_http_layer() {
        let server = MockServer::start().await;
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}}]}\n\n\
                   data: [DONE]\n\n";
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200).set_body_raw(sse, "text/event-stream"),
            )
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
            base_url: Some(server.uri()),
            api_key: Some("sk-test".into()),
            provider_id: None,
        };

        let (base, key) = resolve_endpoint(&args).unwrap();
        assert_eq!(base, server.uri());
        assert_eq!(key, "sk-test");
        let body = build_chat_body(&args);
        assert_eq!(body["stream"], true);
    }
}
