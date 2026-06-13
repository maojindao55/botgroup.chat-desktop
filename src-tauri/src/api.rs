use std::fs;
use std::path::PathBuf;

use crate::db::get_db_path;
use crate::vault;
use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

pub const LOCAL_AVATAR_PREFIX: &str = "local:";

const MAX_AVATAR_BYTES: usize = 5 * 1024 * 1024;

fn get_avatars_dir(app: &AppHandle) -> PathBuf {
    let mut path = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    path.push("avatars");
    fs::create_dir_all(&path).ok();
    path
}

fn avatar_extension(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

fn remove_local_avatar_file(avatar_url: &str) {
    if let Some(path) = avatar_url.strip_prefix(LOCAL_AVATAR_PREFIX) {
        let _ = fs::remove_file(path);
    }
}

fn resolve_local_avatar_path(app: &AppHandle, avatar_url: &str) -> Result<PathBuf, String> {
    if !avatar_url.starts_with(LOCAL_AVATAR_PREFIX) {
        return Err("不是本地头像".into());
    }
    let raw = avatar_url.strip_prefix(LOCAL_AVATAR_PREFIX).unwrap_or("");
    if raw.is_empty() {
        return Err("无效头像路径".into());
    }

    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("无效头像路径".into());
    }

    let avatars_dir = get_avatars_dir(app);
    let avatars_root = avatars_dir
        .canonicalize()
        .unwrap_or_else(|_| avatars_dir.clone());
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("读取头像失败: {}", e))?;

    if !canonical.starts_with(&avatars_root) {
        return Err("头像路径不在允许目录内".into());
    }

    Ok(canonical)
}

fn mime_from_avatar_path(path: &PathBuf) -> &'static str {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    }
}

#[derive(Serialize)]
pub struct LocalAvatarPayload {
    pub mime_type: String,
    pub data: Vec<u8>,
}

#[tauri::command]
pub fn read_local_avatar(app: AppHandle, avatar_url: String) -> Result<LocalAvatarPayload, String> {
    let path = resolve_local_avatar_path(&app, &avatar_url)?;
    let data = fs::read(&path).map_err(|e| format!("读取头像失败: {}", e))?;
    if data.is_empty() {
        return Err("头像文件为空".into());
    }
    if data.len() > MAX_AVATAR_BYTES {
        return Err("头像文件过大".into());
    }
    Ok(LocalAvatarPayload {
        mime_type: mime_from_avatar_path(&path).to_string(),
        data,
    })
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct User {
    pub id: i64,
    pub phone: String,
    pub nickname: Option<String>,
    pub avatar_url: Option<String>,
    pub status: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClawGroup {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub max_rounds: i32,
    pub max_responders: i32,
    pub created_by: Option<i64>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClawMessage {
    pub id: i64,
    pub group_id: String,
    pub sender_id: String,
    pub sender_name: String,
    pub sender_type: String, // 'claw' or 'user'
    pub content: String,
    pub round: i32,
    pub trigger_msg_id: Option<i64>,
    pub created_at: String,
}

// 1. User commands
#[tauri::command]
pub fn get_current_user(app: AppHandle) -> Result<Option<User>, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    // For local desktop version, we just get the first user in the DB.
    // If no user exists, returns None, indicating that the frontend should trigger nickname setup.
    let mut stmt = conn
        .prepare("SELECT id, phone, nickname, avatar_url, status, created_at, updated_at FROM users LIMIT 1")
        .map_err(|e| e.to_string())?;

    let mut user_iter = stmt
        .query_map([], |row| {
            Ok(User {
                id: row.get(0)?,
                phone: row.get(1)?,
                nickname: row.get(2)?,
                avatar_url: row.get(3)?,
                status: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    if let Some(user_res) = user_iter.next() {
        let user = user_res.map_err(|e| e.to_string())?;
        Ok(Some(user))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn create_local_user(app: AppHandle, nickname: String) -> Result<User, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    // Generate a dummy phone number for compatibility
    let random_digits: String = Uuid::new_v4()
        .to_string()
        .chars()
        .filter(|c| c.is_digit(10))
        .take(8)
        .collect();
    let phone = format!("138{}", random_digits);

    conn.execute(
        "INSERT INTO users (phone, nickname, status) VALUES (?, ?, 1)",
        params![phone, nickname],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    let user = conn
        .query_row(
            "SELECT id, phone, nickname, avatar_url, status, created_at, updated_at FROM users WHERE id = ?",
            params![id],
            |row| {
                Ok(User {
                    id: row.get(0)?,
                    phone: row.get(1)?,
                    nickname: row.get(2)?,
                    avatar_url: row.get(3)?,
                    status: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(user)
}

#[tauri::command]
pub fn update_user_info(
    app: AppHandle,
    user_id: i64,
    nickname: String,
    avatar_url: Option<String>,
) -> Result<User, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE users SET nickname = ?, avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        params![nickname, avatar_url, user_id],
    )
    .map_err(|e| e.to_string())?;

    let user = conn
        .query_row(
            "SELECT id, phone, nickname, avatar_url, status, created_at, updated_at FROM users WHERE id = ?",
            params![user_id],
            |row| {
                Ok(User {
                    id: row.get(0)?,
                    phone: row.get(1)?,
                    nickname: row.get(2)?,
                    avatar_url: row.get(3)?,
                    status: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(user)
}

#[tauri::command]
pub fn upload_user_avatar(
    app: AppHandle,
    user_id: i64,
    data: Vec<u8>,
    mime_type: String,
) -> Result<User, String> {
    if data.is_empty() {
        return Err("空文件".into());
    }
    if data.len() > MAX_AVATAR_BYTES {
        return Err("图片不能超过 5MB".into());
    }

    let ext = avatar_extension(mime_type.trim())
        .ok_or_else(|| format!("不支持的图片格式: {}", mime_type))?;

    let avatars_dir = get_avatars_dir(&app);
    let filename = format!("{}.{}", Uuid::new_v4(), ext);
    let dest = avatars_dir.join(&filename);
    fs::write(&dest, &data).map_err(|e| e.to_string())?;

    let avatar_url = format!("{}{}", LOCAL_AVATAR_PREFIX, dest.to_string_lossy());

    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    let old_avatar: Option<String> = conn
        .query_row(
            "SELECT avatar_url FROM users WHERE id = ?",
            params![user_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();

    if let Some(ref old) = old_avatar {
        remove_local_avatar_file(old);
    }

    conn.execute(
        "UPDATE users SET avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        params![avatar_url, user_id],
    )
    .map_err(|e| e.to_string())?;

    let user = conn
        .query_row(
            "SELECT id, phone, nickname, avatar_url, status, created_at, updated_at FROM users WHERE id = ?",
            params![user_id],
            |row| {
                Ok(User {
                    id: row.get(0)?,
                    phone: row.get(1)?,
                    nickname: row.get(2)?,
                    avatar_url: row.get(3)?,
                    status: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(user)
}

// 2. Claw Group commands
#[tauri::command]
pub fn get_claw_groups(app: AppHandle, user_id: i64) -> Result<Vec<ClawGroup>, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT g.id, g.name, g.description, g.max_rounds, g.max_responders, g.created_by, g.created_at
             FROM claw_groups g
             LEFT JOIN claw_group_users gu ON g.id = gu.group_id
             WHERE g.created_by = ?2 OR gu.user_id = ?2
             UNION
             SELECT id, name, description, max_rounds, max_responders, created_by, created_at
             FROM claw_groups WHERE id = 'claw-g1'
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let groups_iter = stmt
        .query_map(params![user_id, user_id], |row| {
            Ok(ClawGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                max_rounds: row.get(3)?,
                max_responders: row.get(4)?,
                created_by: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut groups = Vec::new();
    for group in groups_iter {
        groups.push(group.map_err(|e| e.to_string())?);
    }
    Ok(groups)
}

#[tauri::command]
pub fn create_claw_group(
    app: AppHandle,
    user_id: i64,
    name: String,
    description: Option<String>,
) -> Result<ClawGroup, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    let group_id = format!("claw-{}", &Uuid::new_v4().to_string().replace("-", "")[..8]);

    conn.execute(
        "INSERT INTO claw_groups (id, name, description, created_by) VALUES (?, ?, ?, ?)",
        params![group_id, name, description, user_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO claw_group_users (group_id, user_id, role) VALUES (?, ?, 'owner')",
        params![group_id, user_id],
    )
    .map_err(|e| e.to_string())?;

    let group = conn
        .query_row(
            "SELECT id, name, description, max_rounds, max_responders, created_by, created_at FROM claw_groups WHERE id = ?",
            params![group_id],
            |row| {
                Ok(ClawGroup {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    max_rounds: row.get(3)?,
                    max_responders: row.get(4)?,
                    created_by: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(group)
}

#[tauri::command]
pub fn join_claw_group(app: AppHandle, user_id: i64, group_id: String) -> Result<(), String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR IGNORE INTO claw_group_users (group_id, user_id, role) VALUES (?, ?, 'member')",
        params![group_id, user_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// 3. Claw Message commands
#[tauri::command]
pub fn get_claw_messages(
    app: AppHandle,
    group_id: String,
    limit: Option<i64>,
    since: Option<i64>,
    before: Option<i64>,
) -> Result<Vec<ClawMessage>, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    let limit_val = limit.unwrap_or(30);

    let mut query = "SELECT id, group_id, sender_id, sender_name, sender_type, content, round, trigger_msg_id, created_at 
                     FROM claw_messages WHERE group_id = ?1".to_string();

    let mut params_vec: Vec<rusqlite::types::Value> = vec![rusqlite::types::Value::Text(group_id)];

    if let Some(since_id) = since {
        query.push_str(" AND id > ?2");
        params_vec.push(rusqlite::types::Value::Integer(since_id));
    } else if let Some(before_id) = before {
        query.push_str(" AND id < ?2");
        params_vec.push(rusqlite::types::Value::Integer(before_id));
    }

    query.push_str(" ORDER BY id DESC LIMIT ?3");
    params_vec.push(rusqlite::types::Value::Integer(limit_val));

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    // We bind parameters dynamically
    let messages_iter = stmt
        .query_map(rusqlite::params_from_iter(params_vec), |row| {
            Ok(ClawMessage {
                id: row.get(0)?,
                group_id: row.get(1)?,
                sender_id: row.get(2)?,
                sender_name: row.get(3)?,
                sender_type: row.get(4)?,
                content: row.get(5)?,
                round: row.get(6)?,
                trigger_msg_id: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut messages = Vec::new();
    for msg in messages_iter {
        messages.push(msg.map_err(|e| e.to_string())?);
    }

    // Reverse to get chronological order (since we queried DESC)
    messages.reverse();

    Ok(messages)
}

#[tauri::command]
pub fn send_claw_message(
    app: AppHandle,
    group_id: String,
    sender_id: String,
    sender_name: String,
    sender_type: String,
    content: String,
) -> Result<ClawMessage, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO claw_messages (group_id, sender_id, sender_name, sender_type, content) VALUES (?, ?, ?, ?, ?)",
        params![group_id, sender_id, sender_name, sender_type, content],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    let msg = conn
        .query_row(
            "SELECT id, group_id, sender_id, sender_name, sender_type, content, round, trigger_msg_id, created_at 
             FROM claw_messages WHERE id = ?",
            params![id],
            |row| {
                Ok(ClawMessage {
                    id: row.get(0)?,
                    group_id: row.get(1)?,
                    sender_id: row.get(2)?,
                    sender_name: row.get(3)?,
                    sender_type: row.get(4)?,
                    content: row.get(5)?,
                    round: row.get(6)?,
                    trigger_msg_id: row.get(7)?,
                    created_at: row.get(8)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(msg)
}

#[tauri::command]
pub fn select_directory() -> Result<Option<String>, String> {
    let result = rfd::FileDialog::new().pick_folder();
    match result {
        Some(path) => Ok(Some(path.to_string_lossy().to_string())),
        None => Ok(None),
    }
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatAttachmentCandidate {
    pub path: String,
    pub name: String,
    pub size: Option<u64>,
    pub extension: Option<String>,
    pub mime_type: String,
}

fn attachment_extension(path: &PathBuf) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .filter(|ext| !ext.is_empty())
}

fn attachment_mime_from_extension(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "pdf" => "application/pdf",
        "txt" | "log" => "text/plain",
        "md" => "text/markdown",
        "json" => "application/json",
        "csv" => "text/csv",
        "ts" | "tsx" | "js" | "jsx" | "py" | "rs" | "go" | "java" | "php" | "html" | "css"
        | "scss" | "yaml" | "yml" | "toml" | "xml" | "sh" => "text/plain",
        _ => "application/octet-stream",
    }
}

fn chat_attachment_candidate(path: PathBuf) -> ChatAttachmentCandidate {
    let extension = attachment_extension(&path);
    let mime_type = extension
        .as_deref()
        .map(attachment_mime_from_extension)
        .unwrap_or("application/octet-stream")
        .to_string();
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    let size = fs::metadata(&path).ok().map(|metadata| metadata.len());

    ChatAttachmentCandidate {
        path: path.to_string_lossy().to_string(),
        name,
        size,
        extension,
        mime_type,
    }
}

fn chat_attachment_path_exists(path: &str) -> bool {
    PathBuf::from(path.trim()).is_file()
}

#[tauri::command]
pub fn select_chat_attachments() -> Result<Vec<ChatAttachmentCandidate>, String> {
    let allowed_extensions = [
        "png", "jpg", "jpeg", "webp", "gif", "pdf", "txt", "log", "md", "json", "csv", "ts",
        "tsx", "js", "jsx", "py", "rs", "go", "java", "php", "html", "css", "scss", "yaml",
        "yml", "toml", "xml", "sh",
    ];
    let files = rfd::FileDialog::new()
        .add_filter("Supported attachments", &allowed_extensions)
        .add_filter("All files", &["*"])
        .pick_files()
        .unwrap_or_default();

    Ok(files
        .into_iter()
        .filter(|path| path.is_file())
        .map(chat_attachment_candidate)
        .collect())
}

#[tauri::command]
pub fn chat_attachment_exists(path: String) -> bool {
    chat_attachment_path_exists(&path)
}

#[tauri::command]
pub fn save_image_as(source_path: String) -> Result<Option<String>, String> {
    let src = PathBuf::from(source_path.trim());
    if !src.is_file() {
        return Err(format!("source not found: {}", src.display()));
    }
    let filename = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "image.png".to_string());
    let ext = src
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_else(|| "png".to_string());

    let mut dialog = rfd::FileDialog::new().set_file_name(&filename);
    dialog = dialog.add_filter("Image", &[ext.as_str()]).add_filter("All files", &["*"]);
    let Some(dest) = dialog.save_file() else { return Ok(None); };

    fs::copy(&src, &dest).map_err(|e| format!("copy failed: {}", e))?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn create_workspace_directory(parent: String, name: String) -> Result<String, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("directory name is required".to_string());
    }
    if trimmed_name.contains('/') || trimmed_name.contains('\\') {
        return Err("directory name must not contain path separators".to_string());
    }
    if trimmed_name == "." || trimmed_name == ".." {
        return Err("invalid directory name".to_string());
    }

    let parent_path = std::path::PathBuf::from(parent.trim());
    if !parent_path.is_dir() {
        return Err(format!(
            "parent directory does not exist: {}",
            parent_path.display()
        ));
    }

    let target = parent_path.join(trimmed_name);
    if target.exists() {
        return Err(format!("directory already exists: {}", target.display()));
    }

    std::fs::create_dir(&target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[cfg(test)]
mod workspace_directory_tests {
    use super::create_workspace_directory;

    #[test]
    fn create_workspace_directory_creates_folder_under_parent() {
        let parent = std::env::temp_dir().join(format!(
            "botgroup-create-workspace-parent-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&parent).expect("create temp parent");

        let created = create_workspace_directory(
            parent.to_string_lossy().to_string(),
            "new-dev-task".to_string(),
        )
        .expect("create workspace directory");

        let created_path = std::path::PathBuf::from(&created);
        assert!(created_path.is_dir());
        assert_eq!(
            created_path.file_name().and_then(|s| s.to_str()),
            Some("new-dev-task")
        );

        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn create_workspace_directory_rejects_existing_path() {
        let parent = std::env::temp_dir().join(format!(
            "botgroup-create-workspace-existing-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&parent).expect("create temp parent");

        let err = create_workspace_directory(parent.to_string_lossy().to_string(), ".".to_string())
            .expect_err("reject invalid directory name");
        assert!(err.contains("invalid"));

        let _ = std::fs::remove_dir_all(&parent);
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AIMember {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub avatar: Option<String>,
    pub description: Option<String>,
    pub tags: Option<String>, // JSON Array string
    pub source: String,
    pub config: String, // JSON config string
    pub enabled: i32,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[tauri::command]
pub fn list_ai_members(app: AppHandle, kind: Option<String>) -> Result<Vec<AIMember>, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    let mut query = "SELECT id, kind, name, avatar, description, tags, source, config, enabled, created_at, updated_at FROM ai_members".to_string();
    let mut params_vec: Vec<rusqlite::types::Value> = Vec::new();

    if let Some(ref k) = kind {
        query.push_str(" WHERE kind = ?1");
        params_vec.push(rusqlite::types::Value::Text(k.clone()));
    }

    query.push_str(" ORDER BY created_at ASC");

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let members_iter = stmt
        .query_map(rusqlite::params_from_iter(params_vec), |row| {
            Ok(AIMember {
                id: row.get(0)?,
                kind: row.get(1)?,
                name: row.get(2)?,
                avatar: row.get(3)?,
                description: row.get(4)?,
                tags: row.get(5)?,
                source: row.get(6)?,
                config: row.get(7)?,
                enabled: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut members = Vec::new();
    for member in members_iter {
        members.push(member.map_err(|e| e.to_string())?);
    }
    Ok(members)
}

#[tauri::command]
pub fn get_ai_member(app: AppHandle, id: String) -> Result<Option<AIMember>, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, kind, name, avatar, description, tags, source, config, enabled, created_at, updated_at FROM ai_members WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let mut iter = stmt
        .query_map(params![id], |row| {
            Ok(AIMember {
                id: row.get(0)?,
                kind: row.get(1)?,
                name: row.get(2)?,
                avatar: row.get(3)?,
                description: row.get(4)?,
                tags: row.get(5)?,
                source: row.get(6)?,
                config: row.get(7)?,
                enabled: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;

    if let Some(res) = iter.next() {
        let m = res.map_err(|e| e.to_string())?;
        Ok(Some(m))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn upsert_ai_member(app: AppHandle, member: AIMember) -> Result<(), String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    let existing_source: Option<String> = conn
        .query_row(
            "SELECT source FROM ai_members WHERE id = ?1",
            params![member.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if existing_source.as_deref() == Some("builtin") {
        return Err("Cannot modify builtin member. Clone it first.".into());
    }
    if existing_source.is_none() && member.source == "builtin" {
        return Err("Cannot upsert builtin-source member from UI path.".into());
    }

    conn.execute(
        "INSERT INTO ai_members (id, kind, name, avatar, description, tags, source, config, enabled, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
            kind = excluded.kind,
            name = excluded.name,
            avatar = excluded.avatar,
            description = excluded.description,
            tags = excluded.tags,
            source = excluded.source,
            config = excluded.config,
            enabled = excluded.enabled,
            updated_at = CURRENT_TIMESTAMP",
        params![
            member.id,
            member.kind,
            member.name,
            member.avatar,
            member.description,
            member.tags,
            member.source,
            member.config,
            member.enabled
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_ai_member(app: AppHandle, id: String) -> Result<(), String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    // 后端兜底：禁止删除内置预设成员（前端 UI 也会拦截，这里防绕过）
    let source: Option<String> = conn
        .query_row(
            "SELECT source FROM ai_members WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .ok();

    match source.as_deref() {
        Some("builtin") => Err(format!(
            "内置预设成员不允许删除 (id={}), 请先 fork 为自建副本再修改",
            id
        )),
        _ => {
            conn.execute("DELETE FROM ai_members WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}

#[tauri::command]
pub fn seed_builtin_ai_members(app: AppHandle, members: Vec<AIMember>) -> Result<(), String> {
    let db_path = get_db_path(&app);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for member in members {
        tx.execute(
            "INSERT OR IGNORE INTO ai_members (id, kind, name, avatar, description, tags, source, config, enabled)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                member.id,
                member.kind,
                member.name,
                member.avatar,
                member.description,
                member.tags,
                member.source,
                member.config,
                member.enabled
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

// ───── Secrets Vault IPC ─────
// See `vault.rs` for design notes. Intentionally there is NO `secret_get`
// command — plaintext values never cross the Tauri boundary.

#[tauri::command]
pub fn secret_set(app: AppHandle, name: String, value: String) -> std::result::Result<(), String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let master = vault::load_master_key(&app)?;
    vault::set(&conn, &master, &name, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_has(app: AppHandle, name: String) -> std::result::Result<bool, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    vault::has(&conn, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_copy(
    app: AppHandle,
    from_name: String,
    to_name: String,
) -> std::result::Result<bool, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let master = vault::load_master_key(&app)?;
    match vault::get(&conn, &master, &from_name).map_err(|e| e.to_string())? {
        Some(value) => {
            vault::set(&conn, &master, &to_name, &value).map_err(|e| e.to_string())?;
            Ok(true)
        }
        None => Ok(false),
    }
}

#[tauri::command]
pub fn secret_delete(app: AppHandle, name: String) -> std::result::Result<(), String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    vault::delete(&conn, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_list_names(app: AppHandle) -> std::result::Result<Vec<String>, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    vault::list_names(&conn).map_err(|e| e.to_string())
}

#[cfg(test)]
mod attachment_tests {
    use super::*;

    #[test]
    fn attachment_mime_from_extension_supports_allowed_types() {
        assert_eq!(attachment_mime_from_extension("png"), "image/png");
        assert_eq!(attachment_mime_from_extension("jpg"), "image/jpeg");
        assert_eq!(attachment_mime_from_extension("md"), "text/markdown");
        assert_eq!(attachment_mime_from_extension("pdf"), "application/pdf");
        assert_eq!(attachment_mime_from_extension("tsx"), "text/plain");
    }

    #[test]
    fn attachment_extension_is_lowercase() {
        let path = PathBuf::from("/tmp/Screen.PNG");
        assert_eq!(attachment_extension(&path), Some("png".to_string()));
    }

    #[test]
    fn chat_attachment_path_exists_reports_files() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sample.txt");
        fs::write(&file, "hello").unwrap();
        assert!(chat_attachment_path_exists(file.to_string_lossy().as_ref()));
        assert!(!chat_attachment_path_exists(
            dir.path().join("missing.txt").to_string_lossy().as_ref()
        ));
    }
}
