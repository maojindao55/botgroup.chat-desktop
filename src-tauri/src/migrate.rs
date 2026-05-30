//! One-shot PR4 migration: localStorage API keys → vault, ai_members config → providerId/model.
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::db::get_db_path;
use crate::provider::{self, Provider};
use crate::vault;

pub const MIGRATION_MARKER: &str = "migration:ai_member_a_complete";
pub const SCHEMA_VERSION_KEY: &str = "schema_version";
pub const TARGET_SCHEMA_VERSION: &str = "3";

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalStorageKey {
    pub name: String,
    pub value: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MigrationInput {
    pub local_storage_keys: Vec<LocalStorageKey>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    pub migrated: bool,
    pub already_done: bool,
    pub message: Option<String>,
}

pub fn ensure_app_meta_table(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_meta(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    ensure_app_meta_table(conn)?;
    conn.query_row(
        "SELECT value FROM app_meta WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .map(Some)
    .or_else(|e| {
        if e == rusqlite::Error::QueryReturnedNoRows {
            Ok(None)
        } else {
            Err(e.to_string())
        }
    })
}

fn set_meta(tx: &Transaction<'_>, key: &str, value: &str) -> Result<(), String> {
    tx.execute(
        "INSERT INTO app_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn migration_is_done(conn: &Connection) -> Result<bool, String> {
    Ok(get_meta(conn, MIGRATION_MARKER)?.is_some())
}

fn timestamp_suffix() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn backup_db(db_path: &Path) -> Result<PathBuf, String> {
    let parent = db_path
        .parent()
        .ok_or_else(|| "db path has no parent".to_string())?;
    let backup_dir = parent.join("backups");
    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    let dest = backup_dir.join(format!("pre-migration-{}.db", timestamp_suffix()));
    fs::copy(db_path, &dest).map_err(|e| e.to_string())?;
    Ok(dest)
}

fn backup_keys(app_data: &Path, keys: &[LocalStorageKey]) -> Result<PathBuf, String> {
    let backup_dir = app_data.join("backups");
    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    let dest = backup_dir.join(format!("keys-pre-migration-{}.json", timestamp_suffix()));
    let json = serde_json::to_string_pretty(keys).map_err(|e| e.to_string())?;
    fs::write(&dest, json).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(&dest) {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = fs::set_permissions(&dest, perms);
        }
    }
    Ok(dest)
}

fn looks_like_real_key(value: &str) -> bool {
    if value.starts_with("API_KEY_") {
        return false;
    }
    if value.len() <= 20 {
        return false;
    }
    let all_env_style = value
        .chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
    !all_env_style
}

fn env_name_to_provider_id(env_name: &str) -> String {
    let mut s = env_name.trim().to_string();
    if let Some(stripped) = s.strip_prefix("API_KEY_") {
        s = stripped.to_string();
    }
    for suffix in ["_API_KEY1", "_API_KEY"] {
        if s.ends_with(suffix) {
            s.truncate(s.len() - suffix.len());
            break;
        }
    }
    let lower = s.to_lowercase();
    match lower.as_str() {
        "dashscope" => "qwen".into(),
        "ark" => "volcengine".into(),
        "hunyuan" => "hunyuan".into(),
        "glm" => "glm".into(),
        "deepseek" => "deepseek".into(),
        "kimi" => "kimi".into(),
        "baidu" => "baidu".into(),
        "ollama_url" | "ollama" => "ollama".into(),
        _ => format!("unmapped-{}", env_name),
    }
}

fn vault_name_for_provider(provider_id: &str) -> String {
    format!("provider:{provider_id}")
}

fn lookup_provider_by_model(conn: &Connection, model: &str) -> Option<String> {
    let providers = provider::db::list_providers(conn).ok()?;
    let mut candidates: Vec<&Provider> = providers
        .iter()
        .filter(|p| p.enabled && p.models.iter().any(|m| m == model))
        .collect();
    candidates.sort_by(|a, b| {
        let a_builtin = a.source == "builtin";
        let b_builtin = b.source == "builtin";
        match (a_builtin, b_builtin) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.id.cmp(&b.id),
        }
    });
    candidates.first().map(|p| p.id.clone())
}

fn lookup_provider_by_env_name(conn: &Connection, env_name: &str) -> String {
    let target_id = env_name_to_provider_id(env_name);
    if target_id.starts_with("unmapped-") {
        return target_id;
    }
    if provider::db::get_provider(conn, &target_id)
        .ok()
        .flatten()
        .is_some()
    {
        return target_id;
    }
    format!("unmapped-{}", env_name)
}

fn append_model_if_missing(tx: &Transaction<'_>, provider_id: &str, model: &str) -> Result<(), String> {
    let Some(mut p) = provider::db::get_provider(tx, provider_id)? else {
        return Ok(());
    };
    if !p.models.iter().any(|m| m == model) {
        p.models.push(model.to_string());
        provider::db::upsert_provider(tx, &p)?;
    }
    Ok(())
}

fn canonicalize_storage_key(raw_name: &str) -> (String, bool) {
    // Returns (provider_id, is_ollama_url)
    let stripped = raw_name.trim_start_matches("API_KEY_");
    if stripped == "OLLAMA_URL" {
        return ("ollama".into(), true);
    }
    (env_name_to_provider_id(stripped), false)
}

fn migrate_local_storage_keys(
    tx: &Transaction<'_>,
    master: &[u8; vault::KEY_LEN],
    keys: &[LocalStorageKey],
) -> Result<(), String> {
    for entry in keys {
        let (provider_id, is_ollama_url) = canonicalize_storage_key(&entry.name);
        if is_ollama_url {
            if let Some(mut p) = provider::db::get_provider(tx, "ollama")? {
                p.base_url = entry.value.trim().trim_end_matches('/').to_string();
                provider::db::upsert_provider(tx, &p)?;
            }
            continue;
        }
        if provider_id.starts_with("unmapped-") {
            continue;
        }
        let vault_name = vault_name_for_provider(&provider_id);
        vault::set(tx, master, &vault_name, &entry.value).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn migrate_llm_config(
    tx: &Transaction<'_>,
    config: &mut serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    if config.contains_key("providerId") {
        if let Some(personality) = config.remove("personality") {
            if !config.contains_key("schedulerTag") {
                config.insert("schedulerTag".into(), personality);
            }
        }
        return Ok(());
    }

    let model = config
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let provider_id = lookup_provider_by_model(tx, &model)
        .unwrap_or_else(|| format!("unmapped-{}", model));

    config.insert(
        "providerId".into(),
        serde_json::Value::String(provider_id),
    );

    if let Some(personality) = config.remove("personality") {
        config.insert("schedulerTag".into(), personality);
    }

    Ok(())
}

fn migrate_agent_config(
    tx: &Transaction<'_>,
    master: &[u8; vault::KEY_LEN],
    member_id: &str,
    config: &mut serde_json::Map<String, serde_json::Value>,
    shared: &mut HashMap<(String, String), String>,
) -> Result<(), String> {
    if config.contains_key("providerId") {
        config.remove("llm");
        return Ok(());
    }

    let llm = match config.get("llm").cloned() {
        Some(v) => v,
        None => return Ok(()),
    };
    let llm_obj = match llm.as_object() {
        Some(o) => o.clone(),
        None => return Ok(()),
    };

    let base_url = llm_obj
        .get("baseURL")
        .or_else(|| llm_obj.get("baseUrl"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .trim_end_matches('/')
        .to_string();
    let api_key = llm_obj
        .get("apiKey")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let model = llm_obj
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("deepseek-chat")
        .to_string();

    let provider_id = if looks_like_real_key(&api_key) {
        let dedupe_key = (base_url.clone(), api_key.clone());
        if let Some(existing) = shared.get(&dedupe_key) {
            append_model_if_missing(tx, existing, &model)?;
            existing.clone()
        } else {
            let pid = format!("user-{member_id}");
            let vault_name = vault_name_for_provider(&pid);
            vault::set(tx, master, &vault_name, &api_key).map_err(|e| e.to_string())?;
            let provider = Provider {
                id: pid.clone(),
                name: format!("自定义 ({base_url})"),
                base_url: base_url.clone(),
                api_key_ref: vault_name,
                models: vec![model.clone()],
                source: "user".into(),
                icon_url: None,
                description: None,
                enabled: true,
                params: None,
                created_at: None,
                updated_at: None,
            };
            provider::db::upsert_provider(tx, &provider)?;
            shared.insert(dedupe_key, pid.clone());
            pid
        }
    } else {
        let pid = lookup_provider_by_env_name(tx, &api_key);
        if !pid.starts_with("unmapped-") {
            append_model_if_missing(tx, &pid, &model)?;
        }
        pid
    };

    config.insert(
        "providerId".into(),
        serde_json::Value::String(provider_id),
    );
    config.insert("model".into(), serde_json::Value::String(model));
    config.remove("llm");

    Ok(())
}

fn migrate_ai_members(
    tx: &Transaction<'_>,
    master: &[u8; vault::KEY_LEN],
) -> Result<(), String> {
    let mut stmt = tx
        .prepare("SELECT id, kind, config FROM ai_members")
        .map_err(|e| e.to_string())?;

    let rows: Vec<(String, String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    let mut shared: HashMap<(String, String), String> = HashMap::new();

    for (id, kind, config_str) in rows {
        let mut config: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&config_str).unwrap_or_default();

        match kind.as_str() {
            "llm" => migrate_llm_config(tx, &mut config)?,
            "agent" => migrate_agent_config(tx, master, &id, &mut config, &mut shared)?,
            _ => {}
        }

        let new_config = serde_json::Value::Object(config);
        tx.execute(
            "UPDATE ai_members SET config = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![new_config.to_string(), id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub fn run_migration(app: &AppHandle, input: MigrationInput) -> Result<MigrationResult, String> {
    let db_path = get_db_path(app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    ensure_app_meta_table(&conn)?;

    if migration_is_done(&conn)? {
        return Ok(MigrationResult {
            migrated: false,
            already_done: true,
            message: Some("Migration already completed".into()),
        });
    }

    let app_data = db_path
        .parent()
        .ok_or_else(|| "db path has no parent".to_string())?
        .to_path_buf();

    let _db_backup = backup_db(&db_path)?;
    if !input.local_storage_keys.is_empty() {
        let _keys_backup = backup_keys(&app_data, &input.local_storage_keys)?;
    }

    let master = vault::load_master_key(app)?;

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    migrate_local_storage_keys(&tx, &master, &input.local_storage_keys)?;
    migrate_ai_members(&tx, &master)?;

    set_meta(&tx, MIGRATION_MARKER, "1")?;
    set_meta(&tx, SCHEMA_VERSION_KEY, TARGET_SCHEMA_VERSION)?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(MigrationResult {
        migrated: true,
        already_done: false,
        message: Some("Migration completed successfully".into()),
    })
}

#[tauri::command]
pub fn migrate_a_complete(app: AppHandle, input: MigrationInput) -> Result<MigrationResult, String> {
    run_migration(&app, input)
}

#[tauri::command]
pub fn migration_status(app: AppHandle) -> Result<bool, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    migration_is_done(&conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_looks_like_real_key() {
        assert!(!looks_like_real_key("DEEPSEEK_API_KEY"));
        assert!(!looks_like_real_key("API_KEY_foo"));
        assert!(!looks_like_real_key("short"));
        assert!(looks_like_real_key(
            "sk-abcdefghijklmnopqrstuvwxyz1234567890"
        ));
    }

    #[test]
    fn test_env_name_to_provider_id() {
        assert_eq!(env_name_to_provider_id("DEEPSEEK_API_KEY"), "deepseek");
        assert_eq!(env_name_to_provider_id("DASHSCOPE_API_KEY"), "qwen");
        assert_eq!(env_name_to_provider_id("API_KEY_OLLAMA_URL"), "ollama");
    }
}
