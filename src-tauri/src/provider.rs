use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::db::get_db_path;

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
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

mod db {
    use super::*;

    const SELECT_COLS: &str =
        "id, name, base_url, api_key_ref, models, source, icon_url, description, enabled, created_at, updated_at";

    fn row_to_provider(row: &rusqlite::Row<'_>) -> rusqlite::Result<Provider> {
    let models_json: String = row.get(4)?;
    let models: Vec<String> = serde_json::from_str(&models_json).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            4,
            rusqlite::types::Type::Text,
            Box::new(e),
        )
    })?;
    let enabled_int: i32 = row.get(8)?;
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
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
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

    conn.execute(
        "INSERT INTO providers (id, name, base_url, api_key_ref, models, source, icon_url, description, enabled, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            base_url = excluded.base_url,
            api_key_ref = excluded.api_key_ref,
            models = excluded.models,
            source = excluded.source,
            icon_url = excluded.icon_url,
            description = excluded.description,
            enabled = excluded.enabled,
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
            tx.execute(
                "INSERT OR IGNORE INTO providers (id, name, base_url, api_key_ref, models, source, icon_url, description, enabled)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
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
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;

        Ok(())
    }
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
        assert_eq!(
            stored_json,
            r#"["deepseek-v3","doubao-pro-32k","ep-2024"]"#
        );

        let got = get_provider(&conn, "volcengine").unwrap().unwrap();
        assert_eq!(got.models, p.models);
    }
}
