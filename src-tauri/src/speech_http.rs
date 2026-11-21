//! 千问 Token Plan 语音（qwen-audio-3.0-tts-plus 合成、qwen-audio-3.0-asr-flash 识别）。
//!
//! Token Plan 的 `sk-sp-` Key 只能调用 HTTP 接口：合成返回音频下载地址，识别一次提交整段音频。
//! 和实时 WebSocket 一样，Key 只在 Rust 里读出，接入地址限定在千问 / 阿里云域名。

use std::time::Duration;

use base64::Engine as _;
use reqwest::{Client, Url};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::speech::{is_allowed_host, resolve_api_key};

pub const TOKEN_PLAN_BASE: &str = "https://token-plan.maas.qianwenaiapi.com";
const TTS_PATH: &str = "/api/v1/services/audio/tts/SpeechSynthesizer";
const ASR_PATH: &str = "/api/v1/services/aigc/multimodal-generation/generation";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(40);
const MAX_AUDIO_BYTES: usize = 20 * 1024 * 1024;
/// 文档限制单次 5 分钟，16k 16-bit 单声道约 9.6MB
const MAX_UPLOAD_BYTES: usize = 10 * 1024 * 1024;

pub fn validate_base_url(base: Option<&str>) -> Result<Url, String> {
    let raw = base.map(str::trim).filter(|s| !s.is_empty()).unwrap_or(TOKEN_PLAN_BASE);
    let url = Url::parse(raw).map_err(|_| format!("语音服务地址无效：{raw}"))?;
    if url.scheme() != "https" {
        return Err("语音服务地址必须以 https:// 开头".into());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if !is_allowed_host(&host) {
        return Err(format!("不支持的语音服务地址：{host}"));
    }
    Ok(url)
}

fn endpoint(base: &Url, path: &str) -> Result<Url, String> {
    let mut url = base.clone();
    url.set_path(&format!("{}{}", base.path().trim_end_matches('/'), path));
    Ok(url)
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct HttpTtsArgs {
    pub text: String,
    pub model: String,
    pub voice: String,
    #[serde(default)]
    pub rate: Option<f64>,
    #[serde(default)]
    pub sample_rate: Option<u32>,
    /// 自然语言语气指令，例如「像给小朋友讲故事一样说」
    #[serde(default)]
    pub instruction: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
}

pub fn tts_body(args: &HttpTtsArgs) -> Value {
    let mut input = json!({
        "text": args.text,
        "voice": args.voice,
        "format": "mp3",
        "sample_rate": args.sample_rate.unwrap_or(24000),
    });
    if let Some(rate) = args.rate {
        input["rate"] = json!(rate.clamp(0.5, 2.0));
    }
    if let Some(instruction) = args.instruction.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        input["instruction"] = json!(instruction.chars().take(200).collect::<String>());
    }
    json!({ "model": args.model, "input": input })
}

/// Token Plan 返回的 OSS 地址是 http，阿里云域名升级成 https 下载，其他 http 地址拒绝
pub fn secure_audio_url(mut url: Url, require_https: bool) -> Result<Url, String> {
    if !require_https || url.scheme() == "https" {
        return Ok(url);
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if url.scheme() == "http" && is_allowed_host(&host) && url.set_scheme("https").is_ok() {
        return Ok(url);
    }
    Err("语音服务返回的音频地址不是 https".into())
}

pub enum TtsAudio {
    Url(String),
    Inline(Vec<u8>),
}

pub fn parse_tts_response(value: &Value) -> Result<TtsAudio, String> {
    let audio = &value["output"]["audio"];
    if let Some(data) = audio["data"].as_str().filter(|s| !s.is_empty()) {
        return base64::engine::general_purpose::STANDARD
            .decode(data)
            .map(TtsAudio::Inline)
            .map_err(|_| "语音服务返回的音频无法解析".to_string());
    }
    audio["url"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| TtsAudio::Url(s.to_string()))
        .ok_or_else(|| "语音服务没有返回音频".to_string())
}

pub fn asr_body(model: &str, wav: &[u8]) -> Value {
    let data = format!("data:audio/wav;base64,{}", base64::engine::general_purpose::STANDARD.encode(wav));
    json!({
        "model": model,
        "input": {
            "messages": [{
                "role": "user",
                "content": [{ "type": "input_audio", "input_audio": { "data": data } }]
            }]
        },
        "parameters": { "format": "wav", "sample_rate": "16000", "language_hints": ["zh"] }
    })
}

pub fn parse_asr_text(value: &Value) -> String {
    let output = &value["output"];
    if let Some(text) = output["text"].as_str() {
        return text.trim().to_string();
    }
    if let Some(text) = output["sentence"]["text"].as_str() {
        return text.trim().to_string();
    }
    if let Some(text) = value["text"].as_str() {
        return text.trim().to_string();
    }
    let content = &output["choices"][0]["message"]["content"];
    if let Some(items) = content.as_array() {
        return items.iter().filter_map(|i| i["text"].as_str()).collect::<String>().trim().to_string();
    }
    content.as_str().unwrap_or_default().trim().to_string()
}

pub fn describe_http_error(status: u16, body: &str) -> String {
    let parsed: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let code = parsed["code"].as_str().unwrap_or_default();
    let message = parsed["message"].as_str().unwrap_or_default();
    if status == 401 || status == 403 || code == "InvalidApiKey" {
        return format!("API Key 无效，或这个 Key 没有开通语音服务（HTTP {status}）");
    }
    match (code.is_empty(), message.is_empty()) {
        (false, false) => format!("{code}: {message}"),
        (true, false) => message.to_string(),
        _ => format!("语音服务请求失败（HTTP {status}）"),
    }
}

fn client() -> Result<Client, String> {
    Client::builder().timeout(REQUEST_TIMEOUT).build().map_err(|e| e.to_string())
}

pub async fn post_json(client: &Client, url: Url, api_key: &str, body: &Value) -> Result<Value, String> {
    let response = client
        .post(url)
        .bearer_auth(api_key.trim())
        .json(body)
        .send()
        .await
        .map_err(|e| format!("连接语音服务失败：{e}"))?;
    let status = response.status().as_u16();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) {
        return Err(describe_http_error(status, &text));
    }
    serde_json::from_str(&text).map_err(|_| "语音服务返回的内容无法解析".to_string())
}

pub async fn download(client: &Client, url: Url) -> Result<Vec<u8>, String> {
    let response = client.get(url).send().await.map_err(|e| format!("下载合成音频失败：{e}"))?;
    if !response.status().is_success() {
        return Err(format!("下载合成音频失败（HTTP {}）", response.status().as_u16()));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_AUDIO_BYTES {
        return Err("合成音频过大".into());
    }
    Ok(bytes.to_vec())
}

async fn synthesize(client: &Client, base: &Url, api_key: &str, args: &HttpTtsArgs, require_https: bool) -> Result<Vec<u8>, String> {
    let value = post_json(client, endpoint(base, TTS_PATH)?, api_key, &tts_body(args)).await?;
    match parse_tts_response(&value)? {
        TtsAudio::Inline(bytes) => Ok(bytes),
        TtsAudio::Url(raw) => {
            let url = Url::parse(&raw).map_err(|_| "语音服务返回的音频地址无效".to_string())?;
            download(client, secure_audio_url(url, require_https)?).await
        }
    }
}

/// 合成一段文本，返回 mp3 字节
#[tauri::command]
pub async fn speech_http_tts(app: AppHandle, args: HttpTtsArgs) -> Result<tauri::ipc::Response, String> {
    let text = args.text.trim();
    if text.is_empty() {
        return Err("没有要朗读的文字".into());
    }
    if text.chars().count() > 2000 {
        return Err("单次朗读文字过长".into());
    }
    if args.model.trim().is_empty() || args.voice.trim().is_empty() {
        return Err("请先选择语音合成模型和音色".into());
    }
    let base = validate_base_url(args.base_url.as_deref())?;
    let api_key = resolve_api_key(&app, args.provider_id.as_deref())?;
    let bytes = synthesize(&client()?, &base, &api_key, &args, true).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// 识别一段 WAV（16k 单声道），音频放在原始请求体，模型等参数放在请求头
#[tauri::command]
pub async fn speech_http_asr(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
            .filter(|s| !s.trim().is_empty())
    };
    let model = header("x-speech-model").ok_or("请先选择语音识别模型")?;
    let base = validate_base_url(header("x-speech-base").as_deref())?;
    let provider_id = header("x-speech-provider");
    let tauri::ipc::InvokeBody::Raw(wav) = request.body() else {
        return Err("audio must be sent as raw bytes".into());
    };
    if wav.len() <= 44 {
        return Ok(String::new());
    }
    if wav.len() > MAX_UPLOAD_BYTES {
        return Err("录音太长了".into());
    }
    let api_key = resolve_api_key(&app, provider_id.as_deref())?;
    let value = post_json(&client()?, endpoint(&base, ASR_PATH)?, &api_key, &asr_body(&model, wav)).await?;
    Ok(parse_asr_text(&value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn base_url_allowlist() {
        assert_eq!(validate_base_url(None).unwrap().as_str(), "https://token-plan.maas.qianwenaiapi.com/");
        assert!(validate_base_url(Some("https://dashscope.aliyuncs.com")).is_ok());
        assert!(validate_base_url(Some("http://token-plan.maas.qianwenaiapi.com")).is_err());
        assert!(validate_base_url(Some("https://evil.example.com")).is_err());
        assert!(validate_base_url(Some("https://qianwenaiapi.com.evil.io")).is_err());
        let base = validate_base_url(Some("https://token-plan.maas.qianwenaiapi.com/")).unwrap();
        assert_eq!(
            endpoint(&base, TTS_PATH).unwrap().as_str(),
            "https://token-plan.maas.qianwenaiapi.com/api/v1/services/audio/tts/SpeechSynthesizer"
        );
    }

    #[test]
    fn request_bodies() {
        let args = HttpTtsArgs {
            text: "你好".into(),
            model: "qwen-audio-3.0-tts-plus".into(),
            voice: "longanlingxin".into(),
            rate: Some(5.0),
            ..Default::default()
        };
        let tts = tts_body(&args);
        assert_eq!(tts["model"], "qwen-audio-3.0-tts-plus");
        assert_eq!(tts["input"]["voice"], "longanlingxin");
        assert_eq!(tts["input"]["format"], "mp3");
        assert_eq!(tts["input"]["rate"], 2.0);
        assert!(tts["input"].get("instruction").is_none());
        let with_tone = tts_body(&HttpTtsArgs { instruction: Some(" 像讲故事一样 ".into()), ..Default::default() });
        assert_eq!(with_tone["input"]["instruction"], "像讲故事一样");

        let asr = asr_body("qwen-audio-3.0-asr-flash", b"RIFF");
        assert_eq!(asr["model"], "qwen-audio-3.0-asr-flash");
        assert_eq!(asr["input"]["messages"][0]["content"][0]["type"], "input_audio");
        assert_eq!(asr["input"]["messages"][0]["content"][0]["input_audio"]["data"], "data:audio/wav;base64,UklGRg==");
        assert_eq!(asr["parameters"]["format"], "wav");
    }

    #[test]
    fn parses_responses() {
        let url = json!({ "output": { "audio": { "url": "https://oss.example/a.mp3", "expires_at": 1 } } });
        assert!(matches!(parse_tts_response(&url).unwrap(), TtsAudio::Url(u) if u == "https://oss.example/a.mp3"));
        let inline = json!({ "output": { "audio": { "data": "AQID", "url": "" } } });
        assert!(matches!(parse_tts_response(&inline).unwrap(), TtsAudio::Inline(b) if b == vec![1, 2, 3]));
        assert!(parse_tts_response(&json!({ "output": {} })).is_err());

        assert_eq!(parse_asr_text(&json!({ "output": { "text": " 你好呀 ", "sentence": { "text": "x" } } })), "你好呀");
        assert_eq!(parse_asr_text(&json!({ "output": { "sentence": { "text": "小熊" } } })), "小熊");
        assert_eq!(
            parse_asr_text(&json!({ "output": { "choices": [{ "message": { "content": [{ "text": "数到" }, { "text": "十" }] } }] } })),
            "数到十"
        );
        assert_eq!(parse_asr_text(&json!({ "output": {} })), "");
    }

    #[test]
    fn audio_url_is_upgraded_to_https() {
        let oss = Url::parse("http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/prod/a.mp3?Expires=1&Signature=x%3D").unwrap();
        let upgraded = secure_audio_url(oss, true).unwrap();
        assert_eq!(upgraded.as_str(), "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/prod/a.mp3?Expires=1&Signature=x%3D");
        assert!(secure_audio_url(Url::parse("http://evil.example.com/a.mp3").unwrap(), true).is_err());
        assert!(secure_audio_url(Url::parse("https://cdn.example.com/a.mp3").unwrap(), true).is_ok());
    }

    #[test]
    fn readable_errors() {
        let bad_key = r#"{"code":"InvalidApiKey","message":"Invalid API-key provided."}"#;
        assert!(describe_http_error(401, bad_key).contains("API Key 无效"));
        assert_eq!(
            describe_http_error(400, r#"{"code":"InvalidParameter","message":"voice not found"}"#),
            "InvalidParameter: voice not found"
        );
        assert_eq!(describe_http_error(502, "<html>"), "语音服务请求失败（HTTP 502）");
    }

    /// 极简 HTTP 服务：记录请求，按路径返回固定内容
    async fn fake_server() -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let log = Arc::new(Mutex::new(Vec::new()));
        let log_bg = log.clone();
        let base = format!("http://{addr}");
        let audio_url = format!("{base}/files/a.mp3");
        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else { break };
                let mut buf = vec![0u8; 64 * 1024];
                let mut read = 0;
                loop {
                    let n = stream.read(&mut buf[read..]).await.unwrap();
                    read += n;
                    let req = String::from_utf8_lossy(&buf[..read]).to_string();
                    if let Some(head_end) = req.find("\r\n\r\n") {
                        let len = req[..head_end]
                            .lines()
                            .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap()))
                            .unwrap_or(0);
                        if read >= head_end + 4 + len || n == 0 {
                            break;
                        }
                    }
                }
                let req = String::from_utf8_lossy(&buf[..read]).to_string();
                log_bg.lock().unwrap().push(req.clone());
                let (status, content_type, body): (&str, &str, Vec<u8>) = if req.starts_with("GET /files/a.mp3") {
                    ("200 OK", "audio/mpeg", vec![9, 8, 7])
                } else if !req.contains("authorization: Bearer sk-sp-good") && !req.contains("Authorization: Bearer sk-sp-good") {
                    ("401 Unauthorized", "application/json", br#"{"code":"InvalidApiKey","message":"Invalid API-key provided."}"#.to_vec())
                } else if req.contains(TTS_PATH) {
                    ("200 OK", "application/json", json!({ "output": { "audio": { "url": audio_url } } }).to_string().into_bytes())
                } else {
                    ("200 OK", "application/json", br#"{"output":{"text":"ok"}}"#.to_vec())
                };
                let head = format!("HTTP/1.1 {status}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len());
                stream.write_all(head.as_bytes()).await.unwrap();
                stream.write_all(&body).await.unwrap();
            }
        });
        (base, log)
    }

    #[tokio::test]
    async fn tts_roundtrip_downloads_audio_url() {
        let (base, log) = fake_server().await;
        let base = Url::parse(&base).unwrap();
        let args = HttpTtsArgs { text: "你好".into(), model: "qwen-audio-3.0-tts-plus".into(), voice: "longanlingxin".into(), ..Default::default() };
        let bytes = synthesize(&client().unwrap(), &base, "sk-sp-good", &args, false).await.unwrap();
        assert_eq!(bytes, vec![9, 8, 7]);
        let log = log.lock().unwrap();
        assert!(log[0].starts_with(&format!("POST {TTS_PATH}")));
        assert!(log[0].contains("\"voice\":\"longanlingxin\""));
        assert!(log[1].starts_with("GET /files/a.mp3"));
        assert!(!log[1].to_ascii_lowercase().contains("authorization"), "Key 不发给音频下载地址");
    }

    #[tokio::test]
    async fn https_is_required_for_audio_download() {
        let (base, _) = fake_server().await;
        let base = Url::parse(&base).unwrap();
        let args = HttpTtsArgs { text: "你好".into(), model: "m".into(), voice: "v".into(), ..Default::default() };
        let err = synthesize(&client().unwrap(), &base, "sk-sp-good", &args, true).await.unwrap_err();
        assert!(err.contains("https"), "{err}");
    }

    #[tokio::test]
    async fn asr_posts_audio_and_reports_bad_key() {
        let (base, log) = fake_server().await;
        let url = endpoint(&Url::parse(&base).unwrap(), ASR_PATH).unwrap();
        let body = asr_body("qwen-audio-3.0-asr-flash", &[0u8; 100]);
        let value = post_json(&client().unwrap(), url.clone(), "sk-sp-good", &body).await.unwrap();
        assert_eq!(parse_asr_text(&value), "ok");
        assert!(log.lock().unwrap()[0].contains("data:audio/wav;base64,"));
        let err = post_json(&client().unwrap(), url, "sk-sp-bad", &body).await.unwrap_err();
        assert!(err.contains("API Key 无效") && err.contains("401"), "{err}");
    }

    /// 需要外网和真实 Key：TOKEN_PLAN_API_KEY=sk-sp-... cargo test token_plan_roundtrip -- --ignored
    #[tokio::test]
    #[ignore]
    async fn token_plan_roundtrip_with_real_key() {
        let key = std::env::var("TOKEN_PLAN_API_KEY").expect("TOKEN_PLAN_API_KEY");
        let base = validate_base_url(None).unwrap();
        let client = client().unwrap();
        let args = HttpTtsArgs {
            text: "小熊你好，我们一起数到十吧！".into(),
            model: "qwen-audio-3.0-tts-plus".into(),
            voice: "longanlingxin".into(),
            rate: Some(1.0),
            sample_rate: Some(16000),
            ..Default::default()
        };
        let mp3 = synthesize(&client, &base, &key, &args, true).await.unwrap();
        assert!(mp3.len() > 10_000, "mp3 bytes: {}", mp3.len());
        let path = std::env::temp_dir().join("token_plan_roundtrip.mp3");
        std::fs::write(&path, &mp3).unwrap();
        println!("tts ok: {} bytes -> {}", mp3.len(), path.display());

        if let Ok(wav_path) = std::env::var("TOKEN_PLAN_TEST_WAV") {
            let wav = std::fs::read(wav_path).unwrap();
            let url = endpoint(&base, ASR_PATH).unwrap();
            let value = post_json(&client, url, &key, &asr_body("qwen-audio-3.0-asr-flash", &wav)).await.unwrap();
            let text = parse_asr_text(&value);
            println!("asr ok: {text}");
            assert!(text.contains("小熊"), "{text}");
        }
    }

    /// 需要外网：cargo test token_plan_live -- --ignored
    #[tokio::test]
    #[ignore]
    async fn token_plan_live_rejects_bad_key() {
        let base = validate_base_url(None).unwrap();
        let args = HttpTtsArgs { text: "你好".into(), model: "qwen-audio-3.0-tts-plus".into(), voice: "longanlingxin".into(), ..Default::default() };
        let err = synthesize(&client().unwrap(), &base, "sk-sp-invalid", &args, true).await.unwrap_err();
        assert!(err.contains("401"), "{err}");
        let url = endpoint(&base, ASR_PATH).unwrap();
        let err = post_json(&client().unwrap(), url, "sk-sp-invalid", &asr_body("qwen-audio-3.0-asr-flash", &[0; 64])).await.unwrap_err();
        assert!(err.contains("401"), "{err}");
    }
}
