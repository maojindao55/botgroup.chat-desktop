use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::AppHandle;

use crate::db::get_db_path;
use crate::vault;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key_ref: String,
    pub models: Vec<String>,
    pub source: String,
    pub icon_url: Option<String>,
    pub description: Option<String>,
    pub enabled: bool,
    /// Default model params (JSON object) merged into chat request bodies.
    #[serde(default)]
    pub params: Option<serde_json::Value>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

pub(crate) mod db {
    use super::*;

    const SELECT_COLS: &str =
        "id, name, base_url, api_key_ref, models, source, icon_url, description, enabled, params, created_at, updated_at";

    fn row_to_provider(row: &rusqlite::Row<'_>) -> rusqlite::Result<Provider> {
        let models_json: String = row.get(4)?;
        let models: Vec<String> = serde_json::from_str(&models_json).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e))
        })?;
        let enabled_int: i32 = row.get(8)?;
        let params_json: Option<String> = row.get(9)?;
        let params = params_json
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| serde_json::from_str::<serde_json::Value>(s))
            .transpose()
            .map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    9,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?;
        Ok(Provider {
            id: row.get(0)?,
            name: row.get(1)?,
            base_url: row.get(2)?,
            api_key_ref: row.get(3)?,
            models,
            source: row.get(5)?,
            icon_url: row.get(6)?,
            description: row.get(7)?,
            enabled: enabled_int != 0,
            params,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
        })
    }

    pub fn list_providers(conn: &Connection) -> Result<Vec<Provider>, String> {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {SELECT_COLS} FROM providers ORDER BY created_at ASC"
            ))
            .map_err(|e| e.to_string())?;

        let providers = stmt
            .query_map([], row_to_provider)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(providers)
    }

    pub fn get_provider(conn: &Connection, id: &str) -> Result<Option<Provider>, String> {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {SELECT_COLS} FROM providers WHERE id = ?1"
            ))
            .map_err(|e| e.to_string())?;

        let mut rows = stmt
            .query_map(params![id], row_to_provider)
            .map_err(|e| e.to_string())?;

        match rows.next() {
            Some(row) => Ok(Some(row.map_err(|e| e.to_string())?)),
            None => Ok(None),
        }
    }

    pub fn upsert_provider(conn: &Connection, p: &Provider) -> Result<(), String> {
        let models_json = serde_json::to_string(&p.models).map_err(|e| e.to_string())?;
        let enabled_int: i32 = if p.enabled { 1 } else { 0 };
        let params_json: Option<String> = match &p.params {
            Some(v) if !v.is_null() => Some(serde_json::to_string(v).map_err(|e| e.to_string())?),
            _ => None,
        };

        conn.execute(
        "INSERT INTO providers (id, name, base_url, api_key_ref, models, source, icon_url, description, enabled, params, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            base_url = excluded.base_url,
            api_key_ref = excluded.api_key_ref,
            models = excluded.models,
            source = excluded.source,
            icon_url = excluded.icon_url,
            description = excluded.description,
            enabled = excluded.enabled,
            params = excluded.params,
            updated_at = CURRENT_TIMESTAMP",
        params![
            p.id,
            p.name,
            p.base_url,
            p.api_key_ref,
            models_json,
            p.source,
            p.icon_url,
            p.description,
            enabled_int,
            params_json,
        ],
    )
    .map_err(|e| e.to_string())?;

        Ok(())
    }

    fn config_references_provider(config: &str, provider_id: &str) -> bool {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(config) else {
            return false;
        };
        value
            .get("providerId")
            .and_then(|v| v.as_str())
            .is_some_and(|pid| pid == provider_id)
    }

    pub fn delete_provider(conn: &Connection, id: &str) -> Result<(), String> {
        let mut stmt = conn
            .prepare("SELECT name, config FROM ai_members")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            let (name, config) = row.map_err(|e| e.to_string())?;
            if config_references_provider(&config, id) {
                return Err(format!("Provider is referenced by member {name}"));
            }
        }

        conn.execute("DELETE FROM providers WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub fn seed_builtin_providers(
        conn: &mut Connection,
        providers: Vec<Provider>,
    ) -> Result<(), String> {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for p in providers {
            let models_json = serde_json::to_string(&p.models).map_err(|e| e.to_string())?;
            let enabled_int: i32 = if p.enabled { 1 } else { 0 };
            let params_json: Option<String> = match &p.params {
                Some(v) if !v.is_null() => {
                    Some(serde_json::to_string(v).map_err(|e| e.to_string())?)
                }
                _ => None,
            };
            tx.execute(
                "INSERT OR IGNORE INTO providers (id, name, base_url, api_key_ref, models, source, icon_url, description, enabled, params)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    p.id,
                    p.name,
                    p.base_url,
                    p.api_key_ref,
                    models_json,
                    p.source,
                    p.icon_url,
                    p.description,
                    enabled_int,
                    params_json,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;

        Ok(())
    }
}

/// Resolve `(base_url, api_key)` for a provider from DB + vault.
pub(crate) fn load_provider_endpoint(
    conn: &Connection,
    master: &[u8; crate::vault::KEY_LEN],
    provider_id: &str,
) -> Result<(String, String), String> {
    let provider = db::get_provider(conn, provider_id)?
        .ok_or_else(|| format!("provider '{provider_id}' not found"))?;

    let base_url = provider.base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err("provider baseUrl is empty".into());
    }

    let api_key = crate::vault::get(conn, master, &provider.api_key_ref)
        .map_err(|e| e.to_string())?
        .unwrap_or_default();

    Ok((base_url, api_key))
}

/// Load default model params (JSON object) for a provider, if any.
pub(crate) fn load_provider_params(
    conn: &Connection,
    provider_id: &str,
) -> Option<serde_json::Value> {
    db::get_provider(conn, provider_id)
        .ok()
        .flatten()
        .and_then(|p| p.params)
        .filter(|v| v.is_object())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub model_echo: Option<String>,
    pub error_class: Option<String>,
    pub message: Option<String>,
}

fn classify_http_error(status: u16) -> &'static str {
    if status == 401 || status == 403 {
        "auth"
    } else if (500..600).contains(&status) {
        "5xx"
    } else if (400..500).contains(&status) {
        "4xx"
    } else {
        "4xx"
    }
}

pub(crate) async fn ping_provider(
    base_url: &str,
    api_key: &str,
    models: &[String],
) -> ProviderTestResult {
    if api_key.is_empty() {
        return ProviderTestResult {
            ok: false,
            latency_ms: 0,
            model_echo: None,
            error_class: Some("auth".into()),
            message: Some(
                "未配置 API 密钥（vault 中无对应 secret）。请在 Provider 编辑器输入密钥，或从左下角导入后重试。"
                    .into(),
            ),
        };
    }

    let model = models
        .first()
        .cloned()
        .unwrap_or_else(|| "gpt-3.5-turbo".to_string());
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 1,
        "stream": false,
    });

    let started = Instant::now();
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return ProviderTestResult {
                ok: false,
                latency_ms: started.elapsed().as_millis() as u64,
                model_echo: None,
                error_class: Some("network".into()),
                message: Some(e.to_string()),
            };
        }
    };

    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body);
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {api_key}"));
    }

    match req.send().await {
        Err(e) => ProviderTestResult {
            ok: false,
            latency_ms: started.elapsed().as_millis() as u64,
            model_echo: None,
            error_class: Some("network".into()),
            message: Some(e.to_string()),
        },
        Ok(resp) => {
            let latency_ms = started.elapsed().as_millis() as u64;
            let status = resp.status().as_u16();
            if !resp.status().is_success() {
                let body_text = resp.text().await.unwrap_or_default();
                return ProviderTestResult {
                    ok: false,
                    latency_ms,
                    model_echo: None,
                    error_class: Some(classify_http_error(status).into()),
                    message: Some(body_text),
                };
            }

            let body_text = resp.text().await.unwrap_or_default();
            let model_echo = serde_json::from_str::<serde_json::Value>(&body_text)
                .ok()
                .and_then(|v| v.get("model").and_then(|m| m.as_str()).map(String::from));

            ProviderTestResult {
                ok: true,
                latency_ms,
                model_echo,
                error_class: Some("ok".into()),
                message: None,
            }
        }
    }
}

#[tauri::command]
pub async fn provider_ping(
    base_url: String,
    api_key: String,
    model: Option<String>,
) -> Result<ProviderTestResult, String> {
    let models: Vec<String> = model.into_iter().collect();
    Ok(ping_provider(&base_url, &api_key, &models).await)
}

#[tauri::command]
pub async fn provider_test(
    app: AppHandle,
    provider_id: String,
) -> Result<ProviderTestResult, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let master = vault::load_master_key(&app)?;
    let provider = db::get_provider(&conn, &provider_id)?
        .ok_or_else(|| format!("provider '{provider_id}' not found"))?;
    let (base_url, api_key) = load_provider_endpoint(&conn, &master, &provider_id)?;
    Ok(ping_provider(&base_url, &api_key, &provider.models).await)
}

#[tauri::command]
pub fn list_providers(app: AppHandle) -> Result<Vec<Provider>, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    db::list_providers(&conn)
}

#[tauri::command]
pub fn get_provider(app: AppHandle, id: String) -> Result<Option<Provider>, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    db::get_provider(&conn, &id)
}

#[tauri::command]
pub fn upsert_provider(app: AppHandle, provider: Provider) -> Result<(), String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    let existing_source: Option<String> = conn
        .query_row(
            "SELECT source FROM providers WHERE id = ?1",
            params![provider.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if existing_source.as_deref() == Some("builtin") {
        return Err("Cannot modify builtin provider. Clone it first.".into());
    }
    if existing_source.is_none() && provider.source == "builtin" {
        return Err("Cannot upsert builtin-source provider from UI path.".into());
    }

    db::upsert_provider(&conn, &provider)
}

#[tauri::command]
pub fn delete_provider(app: AppHandle, id: String) -> Result<(), String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    db::delete_provider(&conn, &id)
}

#[tauri::command]
pub fn seed_builtin_providers(app: AppHandle, providers: Vec<Provider>) -> Result<(), String> {
    let db_path = get_db_path(&app);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    db::seed_builtin_providers(&mut conn, providers)
}

#[cfg(test)]
mod tests {
    use super::db::{delete_provider, get_provider, list_providers, upsert_provider};
    use super::*;
    use crate::db::init_db_schemas;
    use rusqlite::Connection;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_db_schemas(&conn).unwrap();
        conn
    }

    fn sample_provider(id: &str) -> Provider {
        Provider {
            id: id.to_string(),
            name: "DeepSeek".to_string(),
            base_url: "https://api.deepseek.com/v1".to_string(),
            api_key_ref: format!("provider:{id}"),
            models: vec!["deepseek-chat".to_string(), "deepseek-reasoner".to_string()],
            source: "user".to_string(),
            icon_url: None,
            description: Some("Test provider".to_string()),
            enabled: true,
            params: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn upsert_list_get_roundtrip() {
        let conn = test_conn();
        let p = sample_provider("deepseek");

        upsert_provider(&conn, &p).unwrap();

        let listed = list_providers(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "deepseek");
        assert_eq!(listed[0].name, "DeepSeek");

        let got = get_provider(&conn, "deepseek").unwrap().unwrap();
        assert_eq!(got.base_url, p.base_url);
        assert_eq!(got.api_key_ref, p.api_key_ref);
        assert_eq!(got.models, p.models);
        assert_eq!(got.source, "user");
        assert_eq!(got.description, p.description);
        assert!(got.enabled);
    }

    #[test]
    fn delete_unreferenced_ok() {
        let conn = test_conn();
        let p = sample_provider("qwen");
        upsert_provider(&conn, &p).unwrap();

        delete_provider(&conn, "qwen").unwrap();

        assert!(get_provider(&conn, "qwen").unwrap().is_none());
        assert!(list_providers(&conn).unwrap().is_empty());
    }

    #[test]
    fn delete_referenced_fails() {
        let conn = test_conn();
        upsert_provider(&conn, &sample_provider("deepseek")).unwrap();

        conn.execute(
            "INSERT INTO ai_members (id, kind, name, source, config, enabled)
             VALUES ('m1', 'llm', 'My LLM', 'user', '{\"providerId\":\"deepseek\",\"model\":\"deepseek-chat\"}', 1)",
            [],
        )
        .unwrap();

        let err = delete_provider(&conn, "deepseek").unwrap_err();
        assert!(err.contains("referenced by member My LLM"));
        assert!(get_provider(&conn, "deepseek").unwrap().is_some());
    }

    #[test]
    fn models_json_roundtrip() {
        let conn = test_conn();
        let mut p = sample_provider("volcengine");
        p.models = vec![
            "deepseek-v3".to_string(),
            "doubao-pro-32k".to_string(),
            "ep-2024".to_string(),
        ];

        upsert_provider(&conn, &p).unwrap();

        let stored_json: String = conn
            .query_row(
                "SELECT models FROM providers WHERE id = ?1",
                params!["volcengine"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored_json, r#"["deepseek-v3","doubao-pro-32k","ep-2024"]"#);

        let got = get_provider(&conn, "volcengine").unwrap().unwrap();
        assert_eq!(got.models, p.models);
    }

    #[test]
    fn params_roundtrip_and_loader() {
        let conn = test_conn();
        let mut p = sample_provider("with-params");
        p.params = Some(serde_json::json!({
            "temperature": 0.6,
            "top_p": 0.9,
            "top_k": 50,
            "max_tokens": 1024
        }));
        upsert_provider(&conn, &p).unwrap();

        let got = get_provider(&conn, "with-params").unwrap().unwrap();
        assert_eq!(got.params, p.params);

        let loaded = super::load_provider_params(&conn, "with-params").unwrap();
        assert_eq!(loaded["temperature"], 0.6);
        assert_eq!(loaded["top_k"], 50);

        // Provider without params yields None
        let plain = sample_provider("no-params");
        upsert_provider(&conn, &plain).unwrap();
        assert!(get_provider(&conn, "no-params")
            .unwrap()
            .unwrap()
            .params
            .is_none());
        assert!(super::load_provider_params(&conn, "no-params").is_none());
    }

    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn provider_test_ping_success() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .and(header("Authorization", "Bearer sk-test"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "model": "deepseek-chat",
                "choices": [{"message": {"role": "assistant", "content": "Hi"}}]
            })))
            .mount(&server)
            .await;

        let result = ping_provider(&server.uri(), "sk-test", &["deepseek-chat".to_string()]).await;

        assert!(result.ok);
        assert_eq!(result.error_class.as_deref(), Some("ok"));
        assert_eq!(result.model_echo.as_deref(), Some("deepseek-chat"));
    }

    #[tokio::test]
    async fn provider_test_ping_auth_error() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(401).set_body_string("invalid key"))
            .mount(&server)
            .await;

        let result = ping_provider(&server.uri(), "bad-key", &[]).await;

        assert!(!result.ok);
        assert_eq!(result.error_class.as_deref(), Some("auth"));
        assert!(result
            .message
            .as_deref()
            .unwrap_or("")
            .contains("invalid key"));
    }
}
