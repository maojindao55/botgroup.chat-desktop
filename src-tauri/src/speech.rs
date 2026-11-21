//! 千问 / 阿里云百炼实时语音（CosyVoice TTS、Fun-ASR 实时识别）的 WebSocket 代理。
//!
//! 鉴权需要在握手时带 `Authorization` 头，浏览器 WebSocket 做不到，所以连接放在 Rust 里；
//! API Key 只在这里从保险箱读出，不会回到前端。接入地址限定在阿里云 / 千问的域名。

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderValue, Uri};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use crate::db::get_db_path;
use crate::{provider, vault};

pub const DEFAULT_ENDPOINT: &str = "wss://maas.qianwenaiapi.com/api-ws/v1/inference";
/// 单独为语音配置的 API Key 在保险箱里的名字
pub const SPEECH_SECRET_NAME: &str = "SPEECH_DASHSCOPE_API_KEY";
const ALLOWED_HOST_SUFFIXES: [&str; 2] = [".qianwenaiapi.com", ".aliyuncs.com"];
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TTS_TIMEOUT: Duration = Duration::from_secs(40);
/// 服务端 23 秒收不到数据会断开，按住说话不会这么久，这里留一点余量
const ASR_IDLE_TIMEOUT: Duration = Duration::from_secs(20);

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

// ============ 地址与凭据 ============

/// 只允许 wss 和阿里云 / 千问域名，避免把 Key 发到别的地方
pub fn validate_endpoint(endpoint: Option<&str>) -> Result<String, String> {
    let raw = endpoint.map(str::trim).filter(|s| !s.is_empty()).unwrap_or(DEFAULT_ENDPOINT);
    let uri: Uri = raw.parse().map_err(|_| format!("语音接入地址无效：{raw}"))?;
    if uri.scheme_str() != Some("wss") {
        return Err("语音接入地址必须以 wss:// 开头".into());
    }
    let host = uri.host().unwrap_or_default().to_ascii_lowercase();
    if !ALLOWED_HOST_SUFFIXES.iter().any(|suffix| host.ends_with(suffix)) {
        return Err(format!("不支持的语音接入地址：{host}"));
    }
    Ok(raw.to_string())
}

/// providerId 为空时用单独配置的语音 Key，否则复用该模型服务的 Key
fn resolve_api_key(app: &AppHandle, provider_id: Option<&str>) -> Result<String, String> {
    let conn = Connection::open(get_db_path(app)).map_err(|e| e.to_string())?;
    let master = vault::load_master_key(app)?;
    let key = match provider_id.map(str::trim).filter(|s| !s.is_empty()) {
        Some(id) => provider::load_provider_endpoint(&conn, &master, id)?.1,
        None => vault::get(&conn, &master, SPEECH_SECRET_NAME)
            .map_err(|e| e.to_string())?
            .unwrap_or_default(),
    };
    if key.trim().is_empty() {
        return Err("还没有配置语音服务的 API Key".into());
    }
    Ok(key)
}

pub async fn connect(endpoint: &str, api_key: &str) -> Result<Ws, String> {
    let mut request = endpoint.into_client_request().map_err(|e| e.to_string())?;
    let auth = HeaderValue::from_str(&format!("bearer {}", api_key.trim()))
        .map_err(|_| "API Key 含有非法字符".to_string())?;
    request.headers_mut().insert("Authorization", auth);
    let (ws, _) = timeout(CONNECT_TIMEOUT, tokio_tungstenite::connect_async(request))
        .await
        .map_err(|_| "连接语音服务超时".to_string())?
        .map_err(describe_connect_error)?;
    Ok(ws)
}

fn describe_connect_error(error: tokio_tungstenite::tungstenite::Error) -> String {
    use tokio_tungstenite::tungstenite::Error;
    match error {
        Error::Http(resp) if matches!(resp.status().as_u16(), 401 | 403) => format!(
            "API Key 无效，或这个 Key 没有开通语音服务（HTTP {}）",
            resp.status().as_u16()
        ),
        Error::Http(resp) => format!("连接语音服务失败（HTTP {}）", resp.status().as_u16()),
        other => format!("连接语音服务失败：{other}"),
    }
}

// ============ 协议消息 ============

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct TtsOptions {
    pub model: String,
    pub voice: String,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub sample_rate: Option<u32>,
    #[serde(default)]
    pub rate: Option<f64>,
    #[serde(default)]
    pub pitch: Option<f64>,
    #[serde(default)]
    pub volume: Option<u32>,
    #[serde(default)]
    pub instruction: Option<String>,
}

pub fn tts_run_task(task_id: &str, opts: &TtsOptions) -> Value {
    let mut parameters = json!({
        "text_type": "PlainText",
        "voice": opts.voice,
        "format": opts.format.clone().unwrap_or_else(|| "mp3".into()),
        "sample_rate": opts.sample_rate.unwrap_or(24000),
        "enable_markdown_filter": true,
    });
    if let Some(rate) = opts.rate {
        parameters["rate"] = json!(rate.clamp(0.5, 2.0));
    }
    if let Some(pitch) = opts.pitch {
        parameters["pitch"] = json!(pitch.clamp(0.5, 2.0));
    }
    if let Some(volume) = opts.volume {
        parameters["volume"] = json!(volume.min(100));
    }
    if let Some(instruction) = opts.instruction.as_ref().filter(|s| !s.trim().is_empty()) {
        parameters["instruction"] = json!(instruction);
    }
    json!({
        "header": { "action": "run-task", "task_id": task_id, "streaming": "duplex" },
        "payload": {
            "task_group": "audio",
            "task": "tts",
            "function": "SpeechSynthesizer",
            "model": opts.model,
            "parameters": parameters,
            "input": {}
        }
    })
}

pub fn asr_run_task(task_id: &str, model: &str, sample_rate: u32, language_hints: &[String]) -> Value {
    let mut parameters = json!({ "format": "pcm", "sample_rate": sample_rate });
    if let Some(lang) = language_hints.first() {
        parameters["language_hints"] = json!([lang]);
    }
    json!({
        "header": { "action": "run-task", "task_id": task_id, "streaming": "duplex" },
        "payload": {
            "task_group": "audio",
            "task": "asr",
            "function": "recognition",
            "model": model,
            "parameters": parameters,
            "input": {}
        }
    })
}

pub fn continue_task(task_id: &str, text: &str) -> Value {
    json!({
        "header": { "action": "continue-task", "task_id": task_id, "streaming": "duplex" },
        "payload": { "input": { "text": text } }
    })
}

pub fn finish_task(task_id: &str) -> Value {
    json!({
        "header": { "action": "finish-task", "task_id": task_id, "streaming": "duplex" },
        "payload": { "input": {} }
    })
}

#[derive(Debug, PartialEq)]
pub enum ServerEvent {
    Started,
    Result { text: String, sentence_id: i64, sentence_end: bool },
    Heartbeat,
    Finished,
    Failed(String),
    Other,
}

pub fn parse_server_event(text: &str) -> ServerEvent {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return ServerEvent::Other;
    };
    let header = &value["header"];
    match header["event"].as_str().unwrap_or_default() {
        "task-started" => ServerEvent::Started,
        "task-finished" => ServerEvent::Finished,
        "task-failed" => {
            let code = header["error_code"].as_str().unwrap_or("UNKNOWN");
            let message = header["error_message"].as_str().unwrap_or("语音服务出错");
            ServerEvent::Failed(format!("{code}: {message}"))
        }
        "result-generated" => {
            let sentence = &value["payload"]["output"]["sentence"];
            if sentence.is_null() {
                return ServerEvent::Other;
            }
            if sentence["heartbeat"].as_bool() == Some(true) {
                return ServerEvent::Heartbeat;
            }
            ServerEvent::Result {
                text: sentence["text"].as_str().unwrap_or_default().to_string(),
                sentence_id: sentence["sentence_id"].as_i64().unwrap_or(0),
                sentence_end: sentence["sentence_end"].as_bool().unwrap_or(false),
            }
        }
        _ => ServerEvent::Other,
    }
}

async fn send_json(ws: &mut Ws, value: &Value) -> Result<(), String> {
    ws.send(Message::Text(value.to_string().into()))
        .await
        .map_err(|e| format!("发送失败：{e}"))
}

/// 等到 task-started；期间收到 task-failed 直接返回错误
async fn wait_started(ws: &mut Ws) -> Result<(), String> {
    let wait = async {
        while let Some(msg) = ws.next().await {
            match msg.map_err(|e| e.to_string())? {
                Message::Text(text) => match parse_server_event(&text) {
                    ServerEvent::Started => return Ok(()),
                    ServerEvent::Failed(err) => return Err(err),
                    _ => {}
                },
                Message::Close(_) => return Err("语音服务关闭了连接".into()),
                _ => {}
            }
        }
        Err("语音服务关闭了连接".into())
    };
    timeout(CONNECT_TIMEOUT, wait)
        .await
        .map_err(|_| "等待语音服务响应超时".to_string())?
}

// ============ 语音合成 ============

/// 一次合成一段文本，收集全部音频帧后返回
pub async fn synthesize(ws: &mut Ws, task_id: &str, opts: &TtsOptions, text: &str) -> Result<Vec<u8>, String> {
    send_json(ws, &tts_run_task(task_id, opts)).await?;
    wait_started(ws).await?;
    send_json(ws, &continue_task(task_id, text)).await?;
    send_json(ws, &finish_task(task_id)).await?;

    let mut audio = Vec::new();
    while let Some(msg) = ws.next().await {
        match msg.map_err(|e| e.to_string())? {
            Message::Binary(bytes) => audio.extend_from_slice(&bytes),
            Message::Text(text) => match parse_server_event(&text) {
                ServerEvent::Finished => {
                    let _ = ws.close(None).await;
                    return Ok(audio);
                }
                ServerEvent::Failed(err) => return Err(err),
                _ => {}
            },
            Message::Close(_) => break,
            _ => {}
        }
    }
    if audio.is_empty() {
        Err("语音服务没有返回音频".into())
    } else {
        Ok(audio)
    }
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TtsArgs {
    pub text: String,
    #[serde(flatten)]
    pub options: TtsOptions,
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
}

fn validate_tts(args: &TtsArgs) -> Result<(), String> {
    if args.text.trim().is_empty() {
        return Err("text is required".into());
    }
    if args.text.chars().count() > 2000 {
        return Err("text is too long".into());
    }
    if args.options.model.trim().is_empty() || args.options.voice.trim().is_empty() {
        return Err("model and voice are required".into());
    }
    Ok(())
}

/// 返回原始音频字节（默认 mp3），前端拿到的是 ArrayBuffer
#[tauri::command]
pub async fn speech_tts_synthesize(app: AppHandle, args: TtsArgs) -> Result<tauri::ipc::Response, String> {
    validate_tts(&args)?;
    let endpoint = validate_endpoint(args.endpoint.as_deref())?;
    let api_key = resolve_api_key(&app, args.provider_id.as_deref())?;
    let task_id = uuid::Uuid::new_v4().to_string();
    let audio = timeout(TTS_TIMEOUT, async {
        let mut ws = connect(&endpoint, &api_key).await?;
        synthesize(&mut ws, &task_id, &args.options, &args.text).await
    })
    .await
    .map_err(|_| "语音合成超时".to_string())??;
    Ok(tauri::ipc::Response::new(audio))
}

// ============ 实时识别 ============

#[derive(Debug)]
pub enum AsrCommand {
    Audio(Vec<u8>),
    Finish,
    Abort,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AsrEvent {
    Partial { text: String },
    Final { text: String },
    Error { message: String },
    End,
}

/// 把逐句的识别结果拼成完整文本：已结束的句子 + 当前句子的中间结果
#[derive(Default)]
pub struct TranscriptBuilder {
    finals: Vec<(i64, String)>,
    partial: Option<(i64, String)>,
}

impl TranscriptBuilder {
    pub fn push(&mut self, sentence_id: i64, text: &str, sentence_end: bool) {
        if sentence_end {
            self.finals.retain(|(id, _)| *id != sentence_id);
            self.finals.push((sentence_id, text.to_string()));
            if self.partial.as_ref().is_some_and(|(id, _)| *id == sentence_id) {
                self.partial = None;
            }
        } else {
            self.partial = Some((sentence_id, text.to_string()));
        }
    }

    pub fn text(&self) -> String {
        let mut out: String = self.finals.iter().map(|(_, t)| t.as_str()).collect();
        if let Some((_, partial)) = &self.partial {
            out.push_str(partial);
        }
        out
    }
}

/// 识别会话主循环：转发音频，按结果推送事件，结束时总会推送 End
pub async fn run_asr_session<F: Fn(AsrEvent)>(mut ws: Ws, task_id: String, mut rx: mpsc::UnboundedReceiver<AsrCommand>, emit: F) {
    let mut transcript = TranscriptBuilder::default();
    let mut finishing = false;
    let mut aborted = false;
    loop {
        let step = timeout(ASR_IDLE_TIMEOUT, async {
            tokio::select! {
                cmd = rx.recv(), if !finishing => Err(cmd),
                msg = ws.next() => Ok(msg),
            }
        })
        .await;
        match step {
            Err(_) => {
                emit(AsrEvent::Error { message: "语音识别超时".into() });
                break;
            }
            Ok(Err(cmd)) => match cmd {
                Some(AsrCommand::Audio(bytes)) => {
                    if let Err(e) = ws.send(Message::Binary(bytes.into())).await {
                        emit(AsrEvent::Error { message: format!("发送音频失败：{e}") });
                        break;
                    }
                }
                Some(AsrCommand::Finish) => {
                    finishing = true;
                    if let Err(e) = send_json(&mut ws, &finish_task(&task_id)).await {
                        emit(AsrEvent::Error { message: e });
                        break;
                    }
                }
                Some(AsrCommand::Abort) | None => {
                    aborted = true;
                    break;
                }
            },
            Ok(Ok(None)) => break,
            Ok(Ok(Some(Err(e)))) => {
                emit(AsrEvent::Error { message: e.to_string() });
                break;
            }
            Ok(Ok(Some(Ok(msg)))) => match msg {
                Message::Text(text) => match parse_server_event(&text) {
                    ServerEvent::Result { text, sentence_id, sentence_end } => {
                        transcript.push(sentence_id, &text, sentence_end);
                        emit(AsrEvent::Partial { text: transcript.text() });
                    }
                    ServerEvent::Finished => break,
                    ServerEvent::Failed(err) => {
                        emit(AsrEvent::Error { message: err });
                        break;
                    }
                    _ => {}
                },
                Message::Close(_) => break,
                _ => {}
            },
        }
    }
    if !aborted {
        emit(AsrEvent::Final { text: transcript.text() });
    }
    let _ = ws.close(None).await;
    emit(AsrEvent::End);
}

static ASR_SESSIONS: LazyLock<Mutex<HashMap<String, mpsc::UnboundedSender<AsrCommand>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn session_sender(session_id: &str) -> Option<mpsc::UnboundedSender<AsrCommand>> {
    ASR_SESSIONS.lock().ok()?.get(session_id).cloned()
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AsrStartArgs {
    pub session_id: String,
    pub model: String,
    #[serde(default)]
    pub sample_rate: Option<u32>,
    #[serde(default)]
    pub language_hints: Vec<String>,
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
}

/// 建立连接并等到 task-started 才返回，之后识别结果通过 `asr://{sessionId}` 事件推送
#[tauri::command]
pub async fn speech_asr_start(app: AppHandle, args: AsrStartArgs) -> Result<(), String> {
    if args.session_id.trim().is_empty() || args.model.trim().is_empty() {
        return Err("sessionId and model are required".into());
    }
    let endpoint = validate_endpoint(args.endpoint.as_deref())?;
    let api_key = resolve_api_key(&app, args.provider_id.as_deref())?;
    let task_id = uuid::Uuid::new_v4().to_string();
    let mut ws = connect(&endpoint, &api_key).await?;
    send_json(
        &mut ws,
        &asr_run_task(&task_id, &args.model, args.sample_rate.unwrap_or(16000), &args.language_hints),
    )
    .await?;
    wait_started(&mut ws).await?;

    let (tx, rx) = mpsc::unbounded_channel();
    ASR_SESSIONS
        .lock()
        .map_err(|e| e.to_string())?
        .insert(args.session_id.clone(), tx);

    let session_id = args.session_id;
    let event_name = format!("asr://{session_id}");
    tokio::spawn(async move {
        let emitter = app.clone();
        run_asr_session(ws, task_id, rx, move |event| {
            let _ = emitter.emit(&event_name, event);
        })
        .await;
        if let Ok(mut sessions) = ASR_SESSIONS.lock() {
            sessions.remove(&session_id);
        }
    });
    Ok(())
}

/// 音频以原始字节发送（16-bit PCM 单声道），会话 id 放在 `x-asr-session` 请求头
#[tauri::command]
pub fn speech_asr_send(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let session_id = request
        .headers()
        .get("x-asr-session")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing x-asr-session header")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("audio must be sent as raw bytes".into());
    };
    let sender = session_sender(session_id).ok_or("识别会话已结束")?;
    sender
        .send(AsrCommand::Audio(bytes.clone()))
        .map_err(|_| "识别会话已结束".to_string())
}

#[tauri::command]
pub fn speech_asr_stop(session_id: String) -> Result<(), String> {
    if let Some(sender) = session_sender(&session_id) {
        let _ = sender.send(AsrCommand::Finish);
    }
    Ok(())
}

#[tauri::command]
pub fn speech_asr_abort(session_id: String) -> Result<(), String> {
    if let Some(sender) = session_sender(&session_id) {
        let _ = sender.send(AsrCommand::Abort);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

    #[test]
    fn endpoint_allowlist() {
        assert_eq!(validate_endpoint(None).unwrap(), DEFAULT_ENDPOINT);
        assert_eq!(validate_endpoint(Some("  ")).unwrap(), DEFAULT_ENDPOINT);
        assert!(validate_endpoint(Some("wss://dashscope.aliyuncs.com/api-ws/v1/inference")).is_ok());
        assert!(validate_endpoint(Some("wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference")).is_ok());
        assert!(validate_endpoint(Some("ws://dashscope.aliyuncs.com/api-ws/v1/inference")).is_err());
        assert!(validate_endpoint(Some("wss://evil.example.com/aliyuncs.com")).is_err());
        assert!(validate_endpoint(Some("wss://aliyuncs.com.evil.com/")).is_err());
        assert!(validate_endpoint(Some("not a url")).is_err());
    }

    #[test]
    fn run_task_payloads() {
        let opts = TtsOptions {
            model: "cosyvoice-v3-flash".into(),
            voice: "longhuhu_v3".into(),
            rate: Some(3.0),
            instruction: Some("  ".into()),
            ..Default::default()
        };
        let tts = tts_run_task("t1", &opts);
        assert_eq!(tts["header"]["action"], "run-task");
        assert_eq!(tts["header"]["streaming"], "duplex");
        assert_eq!(tts["payload"]["task"], "tts");
        assert_eq!(tts["payload"]["function"], "SpeechSynthesizer");
        assert_eq!(tts["payload"]["parameters"]["voice"], "longhuhu_v3");
        assert_eq!(tts["payload"]["parameters"]["format"], "mp3");
        assert_eq!(tts["payload"]["parameters"]["rate"], 2.0, "rate is clamped");
        assert!(tts["payload"]["parameters"].get("instruction").is_none(), "blank instruction is omitted");
        assert_eq!(tts["payload"]["input"], json!({}));

        let asr = asr_run_task("t2", "fun-asr-realtime", 16000, &["zh".into(), "en".into()]);
        assert_eq!(asr["payload"]["task"], "asr");
        assert_eq!(asr["payload"]["function"], "recognition");
        assert_eq!(asr["payload"]["parameters"]["format"], "pcm");
        assert_eq!(asr["payload"]["parameters"]["language_hints"], json!(["zh"]));

        assert_eq!(continue_task("t1", "你好")["payload"]["input"]["text"], "你好");
        assert_eq!(finish_task("t1")["header"]["action"], "finish-task");
    }

    #[test]
    fn parses_server_events() {
        assert_eq!(parse_server_event(r#"{"header":{"event":"task-started"},"payload":{}}"#), ServerEvent::Started);
        assert_eq!(parse_server_event(r#"{"header":{"event":"task-finished"}}"#), ServerEvent::Finished);
        assert_eq!(
            parse_server_event(r#"{"header":{"event":"task-failed","error_code":"CLIENT_ERROR","error_message":"timeout"}}"#),
            ServerEvent::Failed("CLIENT_ERROR: timeout".into())
        );
        assert_eq!(
            parse_server_event(r#"{"header":{"event":"result-generated"},"payload":{"output":{"sentence":{"text":"你好","sentence_id":1,"sentence_end":true}}}}"#),
            ServerEvent::Result { text: "你好".into(), sentence_id: 1, sentence_end: true }
        );
        assert_eq!(
            parse_server_event(r#"{"header":{"event":"result-generated"},"payload":{"output":{"sentence":{"heartbeat":true,"sentence_id":0}}}}"#),
            ServerEvent::Heartbeat
        );
        assert_eq!(parse_server_event(r#"{"header":{"event":"result-generated"},"payload":{"output":{}}}"#), ServerEvent::Other);
        assert_eq!(parse_server_event("nope"), ServerEvent::Other);
    }

    #[test]
    fn transcript_joins_sentences() {
        let mut t = TranscriptBuilder::default();
        t.push(1, "我喜", false);
        assert_eq!(t.text(), "我喜");
        t.push(1, "我喜欢恐龙。", true);
        t.push(2, "它们", false);
        assert_eq!(t.text(), "我喜欢恐龙。它们");
        t.push(2, "它们很大。", true);
        assert_eq!(t.text(), "我喜欢恐龙。它们很大。");
        t.push(2, "它们特别大。", true);
        assert_eq!(t.text(), "我喜欢恐龙。它们特别大。", "a re-sent final replaces the old one");
    }

    /// 本地假服务器：校验 Authorization 头，按 DashScope duplex 协议回应
    async fn fake_server(kind: &'static str) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        let log_bg = log.clone();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let auth = Arc::new(Mutex::new(String::new()));
            let auth_cb = auth.clone();
            let mut ws = tokio_tungstenite::accept_hdr_async(stream, move |req: &Request, resp: Response| {
                *auth_cb.lock().unwrap() = req
                    .headers()
                    .get("Authorization")
                    .map(|v| v.to_str().unwrap().to_string())
                    .unwrap_or_default();
                Ok(resp)
            })
            .await
            .unwrap();
            log_bg.lock().unwrap().push(format!("auth:{}", auth.lock().unwrap()));
            let mut audio_bytes = 0usize;
            while let Some(Ok(msg)) = ws.next().await {
                match msg {
                    Message::Text(text) => {
                        let v: Value = serde_json::from_str(&text).unwrap();
                        let action = v["header"]["action"].as_str().unwrap().to_string();
                        let task_id = v["header"]["task_id"].as_str().unwrap().to_string();
                        log_bg.lock().unwrap().push(action.clone());
                        let event = |name: &str| json!({"header":{"task_id":task_id,"event":name},"payload":{}}).to_string();
                        match (kind, action.as_str()) {
                            (_, "run-task") => ws.send(Message::Text(event("task-started").into())).await.unwrap(),
                            ("tts", "continue-task") => {
                                ws.send(Message::Binary(vec![1u8, 2, 3].into())).await.unwrap();
                                ws.send(Message::Binary(vec![4u8, 5].into())).await.unwrap();
                            }
                            ("tts", "finish-task") => ws.send(Message::Text(event("task-finished").into())).await.unwrap(),
                            ("tts-fail", "continue-task") => {
                                let failed = json!({"header":{"task_id":task_id,"event":"task-failed","error_code":"InvalidParameter","error_message":"bad voice"}});
                                ws.send(Message::Text(failed.to_string().into())).await.unwrap();
                            }
                            ("asr", "finish-task") => {
                                log_bg.lock().unwrap().push(format!("audio:{audio_bytes}"));
                                let result = |text: &str, id: i64, end: bool| {
                                    json!({"header":{"task_id":task_id,"event":"result-generated"},"payload":{"output":{"sentence":{"text":text,"sentence_id":id,"sentence_end":end}}}}).to_string()
                                };
                                ws.send(Message::Text(result("我喜欢", 1, false).into())).await.unwrap();
                                ws.send(Message::Text(result("我喜欢恐龙。", 1, true).into())).await.unwrap();
                                ws.send(Message::Text(event("task-finished").into())).await.unwrap();
                            }
                            _ => {}
                        }
                    }
                    Message::Binary(bytes) => audio_bytes += bytes.len(),
                    Message::Close(_) => break,
                    _ => {}
                }
            }
        });
        (format!("ws://{addr}/api-ws/v1/inference"), log)
    }

    #[tokio::test]
    async fn tts_roundtrip_collects_audio() {
        let (url, log) = fake_server("tts").await;
        let mut ws = connect(&url, "sk-test").await.unwrap();
        let opts = TtsOptions { model: "cosyvoice-v3-flash".into(), voice: "longhuhu_v3".into(), ..Default::default() };
        let audio = synthesize(&mut ws, "task-1", &opts, "你好").await.unwrap();
        assert_eq!(audio, vec![1, 2, 3, 4, 5]);
        tokio::time::sleep(Duration::from_millis(50)).await;
        let log = log.lock().unwrap().clone();
        assert_eq!(log[0], "auth:bearer sk-test");
        assert_eq!(&log[1..4], &["run-task", "continue-task", "finish-task"]);
    }

    /// 需要外网：cargo test live_endpoint -- --ignored
    #[tokio::test]
    #[ignore]
    async fn live_endpoint_rejects_bad_key() {
        for endpoint in [DEFAULT_ENDPOINT, "wss://dashscope.aliyuncs.com/api-ws/v1/inference"] {
            let err = connect(endpoint, "sk-invalid").await.unwrap_err();
            assert!(err.contains("401"), "{endpoint}: {err}");
        }
    }

    #[tokio::test]
    async fn rejected_key_has_readable_error() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let _ = tokio_tungstenite::accept_hdr_async(stream, |_: &Request, _: Response| {
                let mut reject = tokio_tungstenite::tungstenite::handshake::server::ErrorResponse::new(None);
                *reject.status_mut() = tokio_tungstenite::tungstenite::http::StatusCode::UNAUTHORIZED;
                Err(reject)
            })
            .await;
        });
        let err = connect(&format!("ws://{addr}/api-ws/v1/inference"), "sk-bad").await.unwrap_err();
        assert!(err.contains("API Key 无效") && err.contains("401"), "{err}");
    }

    #[tokio::test]
    async fn tts_failure_is_reported() {
        let (url, _) = fake_server("tts-fail").await;
        let mut ws = connect(&url, "sk-test").await.unwrap();
        let opts = TtsOptions { model: "m".into(), voice: "v".into(), ..Default::default() };
        let err = synthesize(&mut ws, "task-1", &opts, "你好").await.unwrap_err();
        assert_eq!(err, "InvalidParameter: bad voice");
    }

    #[tokio::test]
    async fn asr_session_streams_audio_and_emits_transcript() {
        let (url, log) = fake_server("asr").await;
        let mut ws = connect(&url, "sk-test").await.unwrap();
        send_json(&mut ws, &asr_run_task("task-2", "fun-asr-realtime", 16000, &[])).await.unwrap();
        wait_started(&mut ws).await.unwrap();

        let (tx, rx) = mpsc::unbounded_channel();
        let events = Arc::new(Mutex::new(Vec::new()));
        let events_cb = events.clone();
        let session = tokio::spawn(run_asr_session(ws, "task-2".into(), rx, move |e| events_cb.lock().unwrap().push(e)));
        tx.send(AsrCommand::Audio(vec![0u8; 3200])).unwrap();
        tx.send(AsrCommand::Audio(vec![0u8; 1600])).unwrap();
        tx.send(AsrCommand::Finish).unwrap();
        timeout(Duration::from_secs(5), session).await.unwrap().unwrap();

        let events = events.lock().unwrap().clone();
        assert_eq!(
            events,
            vec![
                AsrEvent::Partial { text: "我喜欢".into() },
                AsrEvent::Partial { text: "我喜欢恐龙。".into() },
                AsrEvent::Final { text: "我喜欢恐龙。".into() },
                AsrEvent::End,
            ]
        );
        assert!(log.lock().unwrap().contains(&"audio:4800".to_string()), "all audio forwarded before finish");
    }

    #[tokio::test]
    async fn asr_abort_skips_final() {
        let (url, _) = fake_server("asr").await;
        let mut ws = connect(&url, "sk-test").await.unwrap();
        send_json(&mut ws, &asr_run_task("task-3", "fun-asr-realtime", 16000, &[])).await.unwrap();
        wait_started(&mut ws).await.unwrap();
        let (tx, rx) = mpsc::unbounded_channel();
        let events = Arc::new(Mutex::new(Vec::new()));
        let events_cb = events.clone();
        let session = tokio::spawn(run_asr_session(ws, "task-3".into(), rx, move |e| events_cb.lock().unwrap().push(e)));
        tx.send(AsrCommand::Abort).unwrap();
        timeout(Duration::from_secs(5), session).await.unwrap().unwrap();
        assert_eq!(events.lock().unwrap().clone(), vec![AsrEvent::End]);
    }
}
