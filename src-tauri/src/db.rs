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
    init_db_schemas(&conn)?;

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

pub fn init_db_schemas(conn: &Connection) -> Result<()> {
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
    
    // Create CLI task and profile tables
    conn.execute(
        "CREATE TABLE IF NOT EXISTS cli_tasks (
            id TEXT PRIMARY KEY,
            group_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            agent_name TEXT NOT NULL,
            adapter TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'timeout')),
            cwd TEXT,
            prompt TEXT NOT NULL,
            prompt_summary TEXT,
            session_id TEXT,
            pid INTEGER,
            exit_code INTEGER,
            error_message TEXT,
            log_path TEXT,
            started_at TIMESTAMP,
            ended_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS cli_runtimes (
            adapter TEXT PRIMARY KEY,
            installed INTEGER NOT NULL DEFAULT 0,
            binary_path TEXT,
            version TEXT,
            last_check_at TIMESTAMP,
            last_run_at TIMESTAMP,
            last_error TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS cli_agent_profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            adapter TEXT NOT NULL,
            avatar TEXT,
            tags TEXT,
            binary TEXT,
            extra_args TEXT,
            env TEXT,
            default_cwd TEXT,
            approval_mode TEXT DEFAULT 'auto',
            show_stderr INTEGER DEFAULT 1,
            max_concurrent_tasks INTEGER DEFAULT 1,
            enabled INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS cli_skill_packs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            root_path TEXT NOT NULL,
            entry_file TEXT DEFAULT 'SKILL.md',
            enabled INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS cli_agent_skill_packs (
            agent_id TEXT NOT NULL,
            skill_id TEXT NOT NULL,
            PRIMARY KEY (agent_id, skill_id),
            FOREIGN KEY (agent_id) REFERENCES cli_agent_profiles(id),
            FOREIGN KEY (skill_id) REFERENCES cli_skill_packs(id)
        );",
        [],
    )?;

    // Create AI members table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_members (
            id          TEXT PRIMARY KEY,
            kind        TEXT NOT NULL CHECK (kind IN ('llm','agent','cli')),
            name        TEXT NOT NULL,
            avatar      TEXT,
            description TEXT,
            tags        TEXT,                              -- JSON array
            source      TEXT NOT NULL DEFAULT 'user',      -- builtin | user
            config      TEXT NOT NULL,                     -- JSON config
            enabled     INTEGER NOT NULL DEFAULT 1,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );",
        [],
    )?;

    // Create secrets table for AI member API keys (encrypted with AES-256-GCM,
    // AAD = name to prevent ciphertext swap attacks). See vault.rs for crypto.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS secrets (
            name        TEXT PRIMARY KEY,
            ciphertext  BLOB NOT NULL,
            nonce       BLOB NOT NULL,
            updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );",
        [],
    )?;

    // Create indices
    conn.execute("CREATE INDEX IF NOT EXISTS idx_cli_tasks_group_created ON cli_tasks(group_id, created_at DESC);", [])?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_cli_tasks_status ON cli_tasks(status);", [])?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_cli_tasks_agent ON cli_tasks(agent_id, created_at DESC);", [])?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ai_members_kind ON ai_members(kind);", [])?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_db_schemas() {
        let conn = Connection::open_in_memory().unwrap();
        let result = init_db_schemas(&conn);
        assert!(result.is_ok());

        // Verify that the table structures are created correctly
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        assert!(tables.contains(&"users".to_string()));
        assert!(tables.contains(&"claw_groups".to_string()));
        assert!(tables.contains(&"cli_tasks".to_string()));
        assert!(tables.contains(&"cli_runtimes".to_string()));
        assert!(tables.contains(&"cli_agent_profiles".to_string()));
        assert!(tables.contains(&"cli_skill_packs".to_string()));
        assert!(tables.contains(&"cli_agent_skill_packs".to_string()));
        assert!(tables.contains(&"ai_members".to_string()));
        assert!(tables.contains(&"secrets".to_string()));

        // Verify we can insert a CLI task and retrieve it
        let task_id = "test-task-123";
        conn.execute(
            "INSERT INTO cli_tasks (id, group_id, agent_id, agent_name, adapter, status, prompt)
             VALUES (?, 'group-1', 'agent-1', 'Agent 1', 'codex', 'running', 'hello world')",
            rusqlite::params![task_id],
        ).unwrap();

        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM cli_tasks WHERE id = ?",
            rusqlite::params![task_id],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 1);
    }
}
