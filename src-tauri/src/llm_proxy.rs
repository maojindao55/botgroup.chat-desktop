//! OpenAI-compatible chat/completions proxy with SSE streaming.
//!
//! Events emit on `llm://{session_id}`. See design doc §2.4.

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
}
