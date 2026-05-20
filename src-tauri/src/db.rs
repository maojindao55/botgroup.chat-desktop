use std::fs;
use std::path::PathBuf;
use rusqlite::{Connection, Result};
use tauri::AppHandle;
use tauri::Manager;

pub fn get_db_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    fs::create_dir_all(&path).ok();
    path.push("botgroup.db");
    path
}

pub fn init_db(app: &AppHandle) -> Result<()> {
    let db_path = get_db_path(app);
    let conn = Connection::open(&db_path)?;

    // Enable foreign keys
    conn.execute("PRAGMA foreign_keys = ON;", [])?;

    // Create users table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone VARCHAR(11) NOT NULL UNIQUE,
            nickname VARCHAR(50),
            avatar_url TEXT,
            status INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );",
        [],
    )?;

    // Create claw_groups table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS claw_groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            max_rounds INTEGER DEFAULT 3,
            max_responders INTEGER DEFAULT 3,
            created_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );",
        [],
    )?;

    // Create claw_members table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS claw_members (
            id TEXT PRIMARY KEY,
            group_id TEXT NOT NULL,
            name TEXT NOT NULL,
            avatar_url TEXT,
            api_token TEXT NOT NULL,
            status INTEGER DEFAULT 1,
            last_seen_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (group_id) REFERENCES claw_groups(id)
        );",
        [],
    )?;

    // Create claw_messages table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS claw_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            sender_name TEXT NOT NULL,
            sender_type TEXT NOT NULL CHECK(sender_type IN ('claw', 'user')),
            content TEXT NOT NULL,
            round INTEGER DEFAULT 0,
            trigger_msg_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (group_id) REFERENCES claw_groups(id)
        );",
        [],
    )?;

    // Create claw_group_users table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS claw_group_users (
            group_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT DEFAULT 'member',
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (group_id, user_id),
            FOREIGN KEY (group_id) REFERENCES claw_groups(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );",
        [],
    )?;

    // Create indices
    conn.execute("CREATE INDEX IF NOT EXISTS idx_claw_members_group ON claw_members(group_id);", [])?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_claw_messages_group_time ON claw_messages(group_id, created_at);", [])?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_claw_messages_round ON claw_messages(group_id, round);", [])?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_claw_group_users_user ON claw_group_users(user_id);", [])?;

    // Create AI game tables
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_game_rooms (
            id TEXT PRIMARY KEY,
            mode TEXT NOT NULL DEFAULT 'classic',
            status TEXT NOT NULL DEFAULT 'waiting',
            title TEXT,
            max_players INTEGER DEFAULT 6,
            ai_count INTEGER DEFAULT 2,
            duration_seconds INTEGER DEFAULT 180,
            message_limit INTEGER DEFAULT 50,
            created_by INTEGER,
            started_at TIMESTAMP,
            ended_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_game_players (
            id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL,
            user_id INTEGER,
            display_name TEXT NOT NULL,
            player_type TEXT NOT NULL CHECK(player_type IN ('human', 'ai', 'observer')),
            secret_role TEXT NOT NULL CHECK(secret_role IN ('human', 'ai', 'observer')),
            ai_persona TEXT,
            seat_index INTEGER,
            is_online INTEGER DEFAULT 1,
            last_seen_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (room_id) REFERENCES ai_game_rooms(id)
        );",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_game_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL,
            player_id TEXT NOT NULL,
            sender_name TEXT NOT NULL,
            sender_type TEXT NOT NULL CHECK(sender_type IN ('human', 'ai', 'system')),
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (room_id) REFERENCES ai_game_rooms(id)
        );",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_game_votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL,
            voter_player_id TEXT NOT NULL,
            target_player_id TEXT NOT NULL,
            reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(room_id, voter_player_id)
        );",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_game_results (
            room_id TEXT PRIMARY KEY,
            human_accuracy REAL,
            ai_escape_rate REAL,
            best_disguised_player_id TEXT,
            summary TEXT,
            share_text TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );",
        [],
    )?;

    conn.execute("CREATE INDEX IF NOT EXISTS idx_ai_game_players_room ON ai_game_players(room_id);", [])?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ai_game_messages_room_id ON ai_game_messages(room_id, id);", [])?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ai_game_votes_room ON ai_game_votes(room_id);", [])?;

    // Insert default group if empty
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM claw_groups WHERE id = 'claw-g1'",
        [],
        |row| row.get(0),
    )?;

    if count == 0 {
        conn.execute(
            "INSERT INTO claw_groups (id, name, description, max_rounds, max_responders)
             VALUES ('claw-g1', '🦞龙虾交流群', '多个 OpenClaw 龙虾在一起聊天互动的群', 3, 3);",
            [],
        )?;
    }

    Ok(())
}
