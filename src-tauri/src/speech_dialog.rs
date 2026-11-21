//! 千问实时语音对话（qwen-audio-3.0-realtime-plus）代理。
//!
//! 一次按住说话 = 一个会话：建连 → session.update（push-to-talk）→ 注入历史 → 推送麦克风音频 →
//! 松手 commit + response.create → 流式转发回复音频和文字 → response.done 后关闭。
//! 每轮新建会话，历史以本地聊天记录为准，也不用处理空闲断线。

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::http::Uri;
use tokio_tungstenite::tungstenite::Message;

use crate::speech::{connect, resolve_api_key, send_json, validate_endpoint, Ws};

pub const DIALOG_ENDPOINT: &str = "wss://token-plan.maas.qianwenaiapi.com/api-ws/v1/realtime";
const IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_HISTORY_TURNS: usize = 20;
const MAX_HISTORY_CHARS: usize = 500;
const MAX_INSTRUCTIONS_CHARS: usize = 6000;

#[derive(Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryTurn {
    /// user / assistant
    pub role: String,
    pub text: String,
}

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DialogArgs {
    pub session_id: String,
    pub model: String,
    #[serde(default)]
    pub voice: Option<String>,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub speech_rate: Option<f32>,
    #[serde(default)]
    pub history: Vec<HistoryTurn>,
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
}

fn truncate(text: &str, max: usize) -> String {
    text.trim().chars().take(max).collect()
}

/// 只接受白名单域名的 wss 地址，并把模型名放进查询参数
pub fn dialog_url(endpoint: Option<&str>, model: &str) -> Result<String, String> {
    if model.is_empty() || !model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')) {
        return Err(format!("实时对话模型名无效：{model}"));
    }
    let raw = endpoint.map(str::trim).filter(|s| !s.is_empty()).unwrap_or(DIALOG_ENDPOINT);
    let base = validate_endpoint(Some(raw))?;
    let uri: Uri = base.parse().map_err(|_| format!("实时对话地址无效：{base}"))?;
    if uri.query().is_some() {
        return Err("实时对话地址不能带查询参数".into());
    }
    Ok(format!("{base}?model={model}"))
}

pub fn session_update(args: &DialogArgs) -> Value {
    let mut session = json!({
        "modalities": ["text", "audio"],
        "instructions": truncate(&args.instructions, MAX_INSTRUCTIONS_CHARS),
        "input_audio_format": "pcm",
        "output_audio_format": "pcm",
        "turn_detection": Value::Null,
        "max_history_turns": MAX_HISTORY_TURNS,
        "enable_search": false,
    });
    if let Some(voice) = args.voice.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        session["voice"] = json!(voice);
    }
    if let Some(rate) = args.speech_rate {
        session["speech_rate"] = json!(rate.clamp(0.5, 2.0));
    }
    json!({ "type": "session.update", "session": session })
}

/// 本地聊天记录注入为对话项：孩子是 user/input_text，伙伴是 assistant/output_text
pub fn history_items(history: &[HistoryTurn]) -> Vec<Value> {
    let start = history.len().saturating_sub(MAX_HISTORY_TURNS * 2);
    history[start..]
        .iter()
        .filter_map(|turn| {
            let text = truncate(&turn.text, MAX_HISTORY_CHARS);
            let (role, kind) = match turn.role.as_str() {
                "user" => ("user", "input_text"),
                "assistant" => ("assistant", "output_text"),
                _ => return None,
            };
            (!text.is_empty()).then(|| {
                json!({
                    "type": "conversation.item.create",
                    "item": { "type": "message", "role": role, "content": [{ "type": kind, "text": text }] }
                })
            })
        })
        .collect()
}

#[derive(Debug)]
pub enum DialogCommand {
    Audio(Vec<u8>),
    /// 松手：提交音频并请求回复
    Commit,
    Close,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DialogEvent {
    Ready,
    /// 孩子说的话；识别失败时 text 为空
    UserText { text: String },
    /// 伙伴回复的文字（目前为止的全文）
    ReplyText { text: String },
    /// 24kHz 16-bit 单声道 PCM，Base64
    Audio { pcm: String },
    ReplyDone { text: String, status: String },
    Error { message: String },
    End,
}

#[derive(Debug, PartialEq)]
pub enum ServerEvent {
    SessionUpdated,
    UserText(String),
    UserTextFailed,
    ReplyDelta(String),
    Audio(String),
    ResponseDone(String),
    Error(String),
    Other,
}

pub fn parse_server_event(text: &str) -> ServerEvent {
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return ServerEvent::Other;
    };
    let str_of = |key: &str| v[key].as_str().unwrap_or_default().to_string();
    match v["type"].as_str().unwrap_or_default() {
        "session.updated" => ServerEvent::SessionUpdated,
        "conversation.item.input_audio_transcription.completed" => ServerEvent::UserText(str_of("transcript")),
        "conversation.item.input_audio_transcription.failed" => ServerEvent::UserTextFailed,
        "response.audio_transcript.delta" | "response.text.delta" => ServerEvent::ReplyDelta(str_of("delta")),
        "response.audio.delta" => ServerEvent::Audio(str_of("delta")),
        "response.done" => ServerEvent::ResponseDone(
            v["response"]["status"].as_str().unwrap_or("completed").to_string(),
        ),
        "error" => {
            let message = v["error"]["message"].as_str().or(v["message"].as_str()).unwrap_or("实时对话出错");
            ServerEvent::Error(message.to_string())
        }
        _ => ServerEvent::Other,
    }
}

/// 会话主循环；无论如何结束都会推送 End
pub async fn run_dialog_session<F: Fn(DialogEvent)>(
    mut ws: Ws,
    args: DialogArgs,
    mut rx: mpsc::UnboundedReceiver<DialogCommand>,
    emit: F,
) {
    let result = async {
        send_json(&mut ws, &session_update(&args)).await?;
        for item in history_items(&args.history) {
            send_json(&mut ws, &item).await?;
        }
        // session.updated 之前的音频先攒着，确保 push-to-talk 配置先生效
        let mut configured = false;
        let mut pending_audio: Vec<Vec<u8>> = Vec::new();
        let mut commit_requested = false;
        let mut committed = false;
        let mut reply = String::new();
        loop {
            let step = timeout(IDLE_TIMEOUT, async {
                tokio::select! {
                    cmd = rx.recv() => Err(cmd),
                    msg = ws.next() => Ok(msg),
                }
            })
            .await
            .map_err(|_| "实时对话超时".to_string())?;
            match step {
                Err(Some(DialogCommand::Audio(bytes))) => {
                    if committed {
                        continue;
                    }
                    if configured {
                        send_audio(&mut ws, &bytes).await?;
                    } else {
                        pending_audio.push(bytes);
                    }
                }
                Err(Some(DialogCommand::Commit)) => {
                    commit_requested = true;
                    if configured && !committed {
                        committed = true;
                        commit(&mut ws).await?;
                    }
                }
                Err(Some(DialogCommand::Close)) | Err(None) => return Ok(()),
                Ok(None) => return Err("实时对话连接已关闭".to_string()),
                Ok(Some(Err(e))) => return Err(e.to_string()),
                Ok(Some(Ok(Message::Close(_)))) => return Err("实时对话连接已关闭".to_string()),
                Ok(Some(Ok(Message::Text(text)))) => match parse_server_event(&text) {
                    ServerEvent::SessionUpdated if !configured => {
                        configured = true;
                        emit(DialogEvent::Ready);
                        for bytes in pending_audio.drain(..) {
                            send_audio(&mut ws, &bytes).await?;
                        }
                        if commit_requested && !committed {
                            committed = true;
                            commit(&mut ws).await?;
                        }
                    }
                    ServerEvent::UserText(text) => emit(DialogEvent::UserText { text: text.trim().to_string() }),
                    ServerEvent::UserTextFailed => emit(DialogEvent::UserText { text: String::new() }),
                    ServerEvent::ReplyDelta(delta) => {
                        reply.push_str(&delta);
                        emit(DialogEvent::ReplyText { text: reply.clone() });
                    }
                    ServerEvent::Audio(pcm) if !pcm.is_empty() => emit(DialogEvent::Audio { pcm }),
                    ServerEvent::ResponseDone(status) => {
                        emit(DialogEvent::ReplyDone { text: reply.clone(), status });
                        return Ok(());
                    }
                    ServerEvent::Error(message) => return Err(message),
                    _ => {}
                },
                Ok(Some(Ok(_))) => {}
            }
        }
    }
    .await;
    if let Err(message) = result {
        emit(DialogEvent::Error { message });
    }
    let _ = ws.close(None).await;
    emit(DialogEvent::End);
}

async fn send_audio(ws: &mut Ws, bytes: &[u8]) -> Result<(), String> {
    use base64::Engine;
    let audio = base64::engine::general_purpose::STANDARD.encode(bytes);
    send_json(ws, &json!({ "type": "input_audio_buffer.append", "audio": audio })).await
}

async fn commit(ws: &mut Ws) -> Result<(), String> {
    send_json(ws, &json!({ "type": "input_audio_buffer.commit" })).await?;
    send_json(ws, &json!({ "type": "response.create" })).await
}

static SESSIONS: LazyLock<Mutex<HashMap<String, mpsc::UnboundedSender<DialogCommand>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn sender(session_id: &str) -> Option<mpsc::UnboundedSender<DialogCommand>> {
    SESSIONS.lock().ok()?.get(session_id).cloned()
}

/// 立即返回；连接在后台建立，期间的音频和松手指令会排队。事件通过 `dialog://{sessionId}` 推送
#[tauri::command]
pub async fn speech_dialog_start(app: AppHandle, args: DialogArgs) -> Result<(), String> {
    if args.session_id.trim().is_empty() {
        return Err("sessionId is required".into());
    }
    let url = dialog_url(args.endpoint.as_deref(), args.model.trim())?;
    let api_key = resolve_api_key(&app, args.provider_id.as_deref())?;
    let (tx, rx) = mpsc::unbounded_channel();
    SESSIONS
        .lock()
        .map_err(|e| e.to_string())?
        .insert(args.session_id.clone(), tx);

    let session_id = args.session_id.clone();
    let event_name = format!("dialog://{session_id}");
    tokio::spawn(async move {
        let emitter = app.clone();
        let emit = move |event: DialogEvent| {
            let _ = emitter.emit(&event_name, event);
        };
        match connect(&url, &api_key).await {
            Ok(ws) => run_dialog_session(ws, args, rx, emit).await,
            Err(message) => {
                emit(DialogEvent::Error { message });
                emit(DialogEvent::End);
            }
        }
        if let Ok(mut sessions) = SESSIONS.lock() {
            sessions.remove(&session_id);
        }
    });
    Ok(())
}

/// 音频以原始字节发送（16kHz 16-bit 单声道 PCM），会话 id 放在 `x-dialog-session` 请求头
#[tauri::command]
pub fn speech_dialog_send(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let session_id = request
        .headers()
        .get("x-dialog-session")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing x-dialog-session header")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("audio must be sent as raw bytes".into());
    };
    sender(session_id)
        .ok_or("对话已结束")?
        .send(DialogCommand::Audio(bytes.clone()))
        .map_err(|_| "对话已结束".to_string())
}

#[tauri::command]
pub fn speech_dialog_commit(session_id: String) -> Result<(), String> {
    if let Some(tx) = sender(&session_id) {
        let _ = tx.send(DialogCommand::Commit);
    }
    Ok(())
}

#[tauri::command]
pub fn speech_dialog_close(session_id: String) -> Result<(), String> {
    if let Some(tx) = sender(&session_id) {
        let _ = tx.send(DialogCommand::Close);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::SinkExt;
    use std::sync::Arc;
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

    #[test]
    fn url_and_payloads() {
        assert_eq!(
            dialog_url(None, "qwen-audio-3.0-realtime-plus").unwrap(),
            "wss://token-plan.maas.qianwenaiapi.com/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-plus"
        );
        assert!(dialog_url(None, "bad model&x=1").is_err());
        assert!(dialog_url(Some("wss://evil.example.com/realtime"), "m").is_err());
        assert!(dialog_url(Some("wss://token-plan.maas.qianwenaiapi.com/x?model=a"), "m").is_err());

        let args = DialogArgs {
            voice: Some(" longanlufeng ".into()),
            instructions: "你是数学小熊".into(),
            speech_rate: Some(5.0),
            ..Default::default()
        };
        let update = session_update(&args);
        assert_eq!(update["type"], "session.update");
        assert!(update["session"]["turn_detection"].is_null(), "push-to-talk");
        assert_eq!(update["session"]["voice"], "longanlufeng");
        assert_eq!(update["session"]["speech_rate"], 2.0);
        assert_eq!(update["session"]["instructions"], "你是数学小熊");
        assert!(session_update(&DialogArgs::default())["session"].get("voice").is_none());

        let history: Vec<HistoryTurn> = (0..50)
            .map(|i| HistoryTurn { role: if i % 2 == 0 { "user".into() } else { "assistant".into() }, text: format!("第{i}句") })
            .chain([HistoryTurn { role: "system".into(), text: "ignored".into() }, HistoryTurn { role: "user".into(), text: "  ".into() }])
            .collect();
        let items = history_items(&history);
        assert_eq!(items.len(), MAX_HISTORY_TURNS * 2 - 2, "keeps the latest turns, drops unknown roles and blanks");
        assert_eq!(items[0]["item"]["role"], "user");
        assert_eq!(items[0]["item"]["content"][0]["type"], "input_text");
        assert_eq!(items[1]["item"]["content"][0]["type"], "output_text");
        assert_eq!(items.last().unwrap()["item"]["content"][0]["text"], "第49句");
    }

    #[test]
    fn parses_server_events() {
        assert_eq!(parse_server_event(r#"{"type":"session.updated","session":{}}"#), ServerEvent::SessionUpdated);
        assert_eq!(
            parse_server_event(r#"{"type":"conversation.item.input_audio_transcription.completed","transcript":"你好"}"#),
            ServerEvent::UserText("你好".into())
        );
        assert_eq!(parse_server_event(r#"{"type":"response.audio_transcript.delta","delta":"我"}"#), ServerEvent::ReplyDelta("我".into()));
        assert_eq!(parse_server_event(r#"{"type":"response.audio.delta","delta":"AAA="}"#), ServerEvent::Audio("AAA=".into()));
        assert_eq!(
            parse_server_event(r#"{"type":"response.done","response":{"status":"cancelled"}}"#),
            ServerEvent::ResponseDone("cancelled".into())
        );
        assert_eq!(
            parse_server_event(r#"{"type":"error","error":{"type":"invalid_request_error","message":"bad"}}"#),
            ServerEvent::Error("bad".into())
        );
        assert_eq!(parse_server_event("not json"), ServerEvent::Other);
    }

    /// 假的实时对话服务：记录收到的事件，commit + response.create 后回一段文字和音频
    async fn fake_realtime() -> (String, Arc<Mutex<Vec<Value>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let log = Arc::new(Mutex::new(Vec::<Value>::new()));
        let log_bg = log.clone();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_hdr_async(stream, |req: &Request, resp: Response| {
                assert!(req.uri().query().unwrap_or_default().contains("model=qwen-audio-3.0-realtime-plus"));
                Ok(resp)
            })
            .await
            .unwrap();
            ws.send(Message::Text(json!({"type":"session.created"}).to_string().into())).await.unwrap();
            while let Some(Ok(Message::Text(text))) = ws.next().await {
                let v: Value = serde_json::from_str(&text).unwrap();
                log_bg.lock().unwrap().push(v.clone());
                let send = |value: Value| Message::Text(value.to_string().into());
                match v["type"].as_str().unwrap() {
                    "session.update" => {
                        // 故意晚一点确认，验证之前的音频会被攒着
                        tokio::time::sleep(Duration::from_millis(80)).await;
                        ws.send(send(json!({"type":"session.updated","session":{}}))).await.unwrap();
                    }
                    "response.create" => {
                        ws.send(send(json!({"type":"conversation.item.input_audio_transcription.completed","transcript":"小熊你好"}))).await.unwrap();
                        ws.send(send(json!({"type":"response.audio_transcript.delta","delta":"你好呀！"}))).await.unwrap();
                        ws.send(send(json!({"type":"response.audio.delta","delta":"AQID"}))).await.unwrap();
                        ws.send(send(json!({"type":"response.audio_transcript.delta","delta":"一起数数吧。"}))).await.unwrap();
                        ws.send(send(json!({"type":"response.done","response":{"status":"completed"}}))).await.unwrap();
                    }
                    _ => {}
                }
            }
        });
        (format!("ws://{addr}/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-plus"), log)
    }

    #[tokio::test]
    async fn push_to_talk_turn_roundtrip() {
        let (url, log) = fake_realtime().await;
        let ws = connect(&url, "sk-sp-test").await.unwrap();
        let (tx, rx) = mpsc::unbounded_channel();
        tx.send(DialogCommand::Audio(vec![1, 2, 3, 4])).unwrap();
        tx.send(DialogCommand::Audio(vec![5, 6])).unwrap();
        tx.send(DialogCommand::Commit).unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let events_cb = events.clone();
        let args = DialogArgs {
            model: "qwen-audio-3.0-realtime-plus".into(),
            instructions: "守则".into(),
            history: vec![HistoryTurn { role: "assistant".into(), text: "我是数学小熊！".into() }],
            ..Default::default()
        };
        timeout(Duration::from_secs(5), run_dialog_session(ws, args, rx, move |e| events_cb.lock().unwrap().push(e)))
            .await
            .unwrap();

        let events = events.lock().unwrap().clone();
        assert_eq!(
            events,
            vec![
                DialogEvent::Ready,
                DialogEvent::UserText { text: "小熊你好".into() },
                DialogEvent::ReplyText { text: "你好呀！".into() },
                DialogEvent::Audio { pcm: "AQID".into() },
                DialogEvent::ReplyText { text: "你好呀！一起数数吧。".into() },
                DialogEvent::ReplyDone { text: "你好呀！一起数数吧。".into(), status: "completed".into() },
                DialogEvent::End,
            ]
        );
        let types: Vec<String> = log.lock().unwrap().iter().map(|v| v["type"].as_str().unwrap().to_string()).collect();
        assert_eq!(
            types,
            [
                "session.update",
                "conversation.item.create",
                "input_audio_buffer.append",
                "input_audio_buffer.append",
                "input_audio_buffer.commit",
                "response.create"
            ],
            "audio waits for session.updated, commit follows the audio"
        );
        let log = log.lock().unwrap();
        assert_eq!(log[2]["audio"], "AQIDBA==");
    }

    #[tokio::test]
    async fn server_error_ends_session() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            let _ = ws.next().await;
            let error = json!({"type":"error","error":{"type":"server_error","message":"model overloaded"}});
            ws.send(Message::Text(error.to_string().into())).await.unwrap();
        });
        let ws = connect(&format!("ws://{addr}/realtime"), "k").await.unwrap();
        let (_tx, rx) = mpsc::unbounded_channel();
        let events = Arc::new(Mutex::new(Vec::new()));
        let events_cb = events.clone();
        run_dialog_session(ws, DialogArgs::default(), rx, move |e| events_cb.lock().unwrap().push(e)).await;
        assert_eq!(
            *events.lock().unwrap(),
            vec![DialogEvent::Error { message: "model overloaded".into() }, DialogEvent::End]
        );
    }

    /// 需要外网、ffmpeg 和真实 Key（TOKEN_PLAN_API_KEY 或 TOKEN_PLAN_KEY）：
    /// `cargo test dialog_live_with_real_key -- --ignored --nocapture`
    /// 设置 TOKEN_PLAN_TEST_PCM 时使用该 16k 16-bit 单声道 PCM，否则先用合成接口生成一句中文再转码。
    #[tokio::test]
    #[ignore]
    async fn dialog_live_with_real_key() {
        let key = std::env::var("TOKEN_PLAN_API_KEY")
            .or_else(|_| std::env::var("TOKEN_PLAN_KEY"))
            .expect("TOKEN_PLAN_API_KEY or TOKEN_PLAN_KEY");
        let pcm = match std::env::var("TOKEN_PLAN_TEST_PCM") {
            Ok(path) => std::fs::read(path).unwrap(),
            Err(_) => synthesize_prompt_pcm(&key).await,
        };
        assert!(pcm.len() >= 16_000, "prompt pcm too short: {} bytes", pcm.len());

        let url = dialog_url(None, "qwen-audio-3.0-realtime-plus").unwrap();
        let started = std::time::Instant::now();
        let ws = connect(&url, &key).await.unwrap();
        println!("connected in {:?}", started.elapsed());
        let (tx, rx) = mpsc::unbounded_channel();
        for chunk in pcm.chunks(3200) {
            tx.send(DialogCommand::Audio(chunk.to_vec())).unwrap();
        }
        tx.send(DialogCommand::Commit).unwrap();
        let commit_at = std::time::Instant::now();
        let first_audio = Arc::new(Mutex::new(None));
        let audio_bytes = Arc::new(Mutex::new(0usize));
        let user_text = Arc::new(Mutex::new(String::new()));
        let reply_text = Arc::new(Mutex::new(String::new()));
        let error = Arc::new(Mutex::new(None));
        let (fa, ab, ut, rt, err) = (
            first_audio.clone(),
            audio_bytes.clone(),
            user_text.clone(),
            reply_text.clone(),
            error.clone(),
        );
        let args = DialogArgs {
            model: "qwen-audio-3.0-realtime-plus".into(),
            voice: Some("longanlingxin".into()),
            instructions: "你是陪小朋友聊天的数学小熊。只回答一个很短的句子。".into(),
            ..Default::default()
        };
        run_dialog_session(ws, args, rx, move |event| match &event {
            DialogEvent::Audio { pcm } => {
                fa.lock().unwrap().get_or_insert(commit_at.elapsed());
                *ab.lock().unwrap() += pcm.len() * 3 / 4;
            }
            DialogEvent::UserText { text } => *ut.lock().unwrap() = text.clone(),
            DialogEvent::ReplyDone { text, status } => {
                println!("reply done status={status} text={text}");
                *rt.lock().unwrap() = text.clone();
            }
            DialogEvent::Error { message } => {
                println!("error: {message}");
                *err.lock().unwrap() = Some(message.clone());
            }
            _ => {}
        })
        .await;

        let first = *first_audio.lock().unwrap();
        let bytes = *audio_bytes.lock().unwrap();
        let heard = user_text.lock().unwrap().clone();
        let reply = reply_text.lock().unwrap().clone();
        println!("user={heard:?} first audio after release: {first:?}, audio bytes {bytes}");
        assert!(error.lock().unwrap().is_none(), "server error: {:?}", error.lock().unwrap());
        assert!(bytes > 1000, "no reply audio");
        assert!(!reply.trim().is_empty(), "empty reply text");
        assert!(first.is_some(), "reply audio never started");
    }

    /// 用已验证的 HTTP 合成生成一句中文，再转成实时接口要的 16k PCM。
    async fn synthesize_prompt_pcm(key: &str) -> Vec<u8> {
        use crate::speech_http::{self, HttpTtsArgs};
        let client = speech_http::client().unwrap();
        let base = speech_http::validate_base_url(None).unwrap();
        let args = HttpTtsArgs {
            text: "小熊，一加一等于几？".into(),
            model: "qwen-audio-3.0-tts-plus".into(),
            voice: "longanlingxin".into(),
            sample_rate: Some(16000),
            ..Default::default()
        };
        let mp3 = speech_http::synthesize(&client, &base, key, &args, true).await.expect("prompt tts");
        let dir = std::env::temp_dir();
        let mp3_path = dir.join("dialog_live_prompt.mp3");
        let pcm_path = dir.join("dialog_live_prompt.pcm");
        std::fs::write(&mp3_path, &mp3).unwrap();
        let output = std::process::Command::new("ffmpeg")
            .args([
                "-y",
                "-loglevel",
                "error",
                "-i",
                mp3_path.to_str().unwrap(),
                "-f",
                "s16le",
                "-acodec",
                "pcm_s16le",
                "-ac",
                "1",
                "-ar",
                "16000",
                pcm_path.to_str().unwrap(),
            ])
            .output()
            .expect("ffmpeg is required to decode the synthesized prompt");
        assert!(
            output.status.success(),
            "ffmpeg: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let pcm = std::fs::read(&pcm_path).unwrap();
        println!("prompt pcm {} bytes from {} mp3 bytes", pcm.len(), mp3.len());
        pcm
    }
}
