use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use uuid::Uuid;
use crate::db::get_db_path;

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
    let random_digits: String = Uuid::new_v4().to_string().chars().filter(|c| c.is_digit(10)).take(8).collect();
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
pub fn update_user_info(app: AppHandle, user_id: i64, nickname: String, avatar_url: Option<String>) -> Result<User, String> {
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
pub fn create_claw_group(app: AppHandle, user_id: i64, name: String, description: Option<String>) -> Result<ClawGroup, String> {
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
    let result = rfd::FileDialog::new()
        .pick_folder();
    match result {
        Some(path) => Ok(Some(path.to_string_lossy().to_string())),
        None => Ok(None),
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


