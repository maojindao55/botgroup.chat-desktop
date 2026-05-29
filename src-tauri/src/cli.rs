// CLI Agent runtime: spawns local coding CLIs (codex, opencode, claude, ...) as
// first-class group chat members. Each invocation streams stdout/stderr to the
// frontend over a unique Tauri event channel keyed by session_id.
//
// IPC commands exposed:
//   cli_run    — spawn an adapter and stream output (returns immediately)
//   cli_kill   — terminate a running session (drop the Child triggers SIGKILL)
//   cli_check  — detect whether an adapter binary is installed + path/version

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};
use std::io::Write;
use rusqlite::{params, Connection};
use crate::db::get_db_path;

// ---------- Event payload sent over `cli://{session_id}` ------------------

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CliEvent {
    Started { pid: u32 },
    Stdout { content: String },
    Stderr { content: String },
    Done { exit_code: i32 },
    Error { message: String },
}

// ---------- Shared state: track running sessions for kill ----------------

#[derive(Default)]
pub struct CliState {
    /// session_id -> running session. We keep both the supervisor abort
    /// handle and the OS pid so cancellation can force-kill stuck CLIs.
    sessions: Arc<Mutex<HashMap<String, RunningCliSession>>>,
}

pub struct RunningCliSession {
    abort_handle: tokio::task::AbortHandle,
    pid: u32,
}

// ---------- DB Structs ---------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CliTask {
    pub id: String,
    pub group_id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub adapter: String,
    pub status: String,
    pub cwd: Option<String>,
    pub prompt: String,
    pub prompt_summary: Option<String>,
    pub session_id: Option<String>,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub error_message: Option<String>,
    pub log_path: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CliTaskLogEntry {
    pub ts: String,
    pub r#type: String, // 'stdout' | 'stderr' | 'system'
    pub content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliTaskLogPage {
    pub lines: Vec<CliTaskLogEntry>,
    pub total_lines: usize,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CliRuntime {
    pub adapter: String,
    pub installed: bool,
    pub binary_path: Option<String>,
    pub version: Option<String>,
    pub last_check_at: Option<String>,
    pub last_run_at: Option<String>,
    pub last_error: Option<String>,
    pub updated_at: String,
}

// ---------- Public IPC commands -----------------------------------------

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliRunArgs {
    pub session_id: String,
    pub group_id: String,
    pub agent_id: String,
    pub agent_name: String,
    /// "codex" | "opencode" | "claude" | "cursor"
    pub adapter: String,
    pub prompt: String,
    pub cwd: Option<String>,
    pub extra_args: Option<Vec<String>>,
    #[serde(rename = "toolSessionId")]
    pub tool_session_id: Option<String>,
    /// Optional binary override (default: looked up from adapter)
    pub binary: Option<String>,
    /// Extra env vars to set on the spawned process
    pub env: Option<HashMap<String, String>>,
    pub timeout_ms: Option<u64>,
    pub approval_mode: Option<String>,
    pub show_stderr: Option<bool>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliCheckResult {
    pub installed: bool,
    pub path: Option<String>,
    /// Best-effort version string (first line of `--version`, ignored on failure)
    pub version: Option<String>,
}

fn insert_task(app: &AppHandle, args: &CliRunArgs, log_path: &str) -> Result<(), String> {
    let db_path = get_db_path(app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let summary = prompt_summary(&args.prompt, 60);
    conn.execute(
        "INSERT INTO cli_tasks (id, group_id, agent_id, agent_name, adapter, status, cwd, prompt, prompt_summary, session_id, log_path, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
        params![
            args.session_id,
            args.group_id,
            args.agent_id,
            args.agent_name,
            args.adapter,
            "running",
            args.cwd,
            args.prompt,
            summary,
            args.session_id,
            log_path
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn prompt_summary(prompt: &str, max_chars: usize) -> String {
    if prompt.chars().count() <= max_chars {
        return prompt.to_string();
    }

    let keep = max_chars.saturating_sub(3);
    let mut s: String = prompt.chars().take(keep).collect();
    s.push_str("...");
    s
}

fn update_task_status(
    app: &AppHandle,
    id: &str,
    status: &str,
    exit_code: Option<i32>,
    error_message: Option<&str>,
) -> Result<(), String> {
    let db_path = get_db_path(app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE cli_tasks 
         SET status = ?, exit_code = ?, error_message = ?, ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?",
        params![status, exit_code, error_message, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn get_task_pid(app: &AppHandle, id: &str) -> Option<u32> {
    let db_path = get_db_path(app);
    let conn = Connection::open(&db_path).ok()?;
    conn.query_row(
        "SELECT pid FROM cli_tasks WHERE id = ?1",
        params![id],
        |row| row.get::<_, Option<u32>>(0),
    )
    .ok()
    .flatten()
}

fn upsert_runtime_check(
    app: &AppHandle,
    adapter: &str,
    installed: bool,
    path: Option<&str>,
    version: Option<&str>,
    last_error: Option<&str>,
) {
    let db_path = get_db_path(app);
    if let Ok(conn) = Connection::open(&db_path) {
        let _ = conn.execute(
            "INSERT INTO cli_runtimes (adapter, installed, binary_path, version, last_check_at, last_error, updated_at)
             VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, ?5, CURRENT_TIMESTAMP)
             ON CONFLICT(adapter) DO UPDATE SET
               installed = excluded.installed,
               binary_path = excluded.binary_path,
               version = excluded.version,
               last_check_at = CURRENT_TIMESTAMP,
               last_error = excluded.last_error,
               updated_at = CURRENT_TIMESTAMP",
            params![adapter, if installed { 1 } else { 0 }, path, version, last_error],
        );
    }
}

fn update_runtime_run(
    app: &AppHandle,
    adapter: &str,
    last_error: Option<&str>,
    installed_hint: Option<bool>,
) {
    let db_path = get_db_path(app);
    if let Ok(conn) = Connection::open(&db_path) {
        let installed_value = installed_hint.map(|v| if v { 1 } else { 0 });
        let _ = conn.execute(
            "INSERT INTO cli_runtimes (adapter, installed, last_run_at, last_error, updated_at)
             VALUES (?1, COALESCE(?3, 0), CURRENT_TIMESTAMP, ?2, CURRENT_TIMESTAMP)
             ON CONFLICT(adapter) DO UPDATE SET
               last_run_at = CURRENT_TIMESTAMP,
               last_error = ?2,
               installed = COALESCE(?3, installed),
               updated_at = CURRENT_TIMESTAMP",
            params![adapter, last_error, installed_value],
        );
    }
}

async fn kill_process_tree(pid: u32) {
    if pid == 0 {
        return;
    }

    #[cfg(unix)]
    {
        let pid_str = pid.to_string();
        let _ = Command::new("pkill")
            .arg("-TERM")
            .arg("-P")
            .arg(&pid_str)
            .output()
            .await;
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(&pid_str)
            .output()
            .await;
        sleep(Duration::from_millis(300)).await;
        let _ = Command::new("pkill")
            .arg("-KILL")
            .arg("-P")
            .arg(&pid_str)
            .output()
            .await;
        let _ = Command::new("kill")
            .arg("-KILL")
            .arg(&pid_str)
            .output()
            .await;
    }

    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .arg("/PID")
            .arg(pid.to_string())
            .arg("/T")
            .arg("/F")
            .output()
            .await;
    }
}

#[tauri::command]
pub async fn cli_run(
    app: AppHandle,
    state: State<'_, CliState>,
    args: CliRunArgs,
) -> Result<(), String> {
    let event_name = format!("cli://{}", args.session_id);
    let session_id = args.session_id.clone();
    let timeout_ms = args.timeout_ms;
    let adapter_for_status = args.adapter.clone();

    let log_path = {
        let mut path = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        path.push("cli-logs");
        let _ = std::fs::create_dir_all(&path);
        path.push(format!("{}.jsonl", args.session_id));
        path
    };
    let log_path_str = log_path.to_string_lossy().to_string();

    // Write initial log
    if let Some(mut f) = std::fs::OpenOptions::new().create(true).write(true).truncate(true).open(&log_path).ok() {
        let log_entry = serde_json::json!({
            "ts": chrono::Utc::now().to_rfc3339(),
            "type": "system",
            "content": format!(
                "Starting task execution. Adapter: {}, Cwd: {:?}, Approval: {:?}, Show stderr: {:?}, TimeoutMs: {:?}",
                args.adapter,
                args.cwd,
                args.approval_mode,
                args.show_stderr,
                args.timeout_ms
            )
        });
        if let Ok(serialized) = serde_json::to_string(&log_entry) {
            let _ = writeln!(f, "{}", serialized);
        }
    }

    if let Err(e) = insert_task(&app, &args, &log_path_str) {
        let _ = app.emit(&event_name, CliEvent::Error { message: format!("DB error: {}", e) });
        return Err(e);
    }

    let mut cmd = match build_command(&args) {
        Ok(cmd) => cmd,
        Err(e) => {
            let msg = format!("build command failed: {}", e);
            let _ = app.emit(&event_name, CliEvent::Error { message: msg.clone() });
            let _ = app.emit(&event_name, CliEvent::Done { exit_code: -1 });

            if let Some(mut f) = std::fs::OpenOptions::new().append(true).open(&log_path).ok() {
                let log_entry = serde_json::json!({
                    "ts": chrono::Utc::now().to_rfc3339(),
                    "type": "system",
                    "content": msg.clone()
                });
                if let Ok(serialized) = serde_json::to_string(&log_entry) {
                    let _ = writeln!(f, "{}", serialized);
                }
            }

            let _ = update_task_status(&app, &session_id, "failed", Some(-1), Some(&msg));
            update_runtime_run(&app, &adapter_for_status, Some(&msg), None);
            return Err(msg);
        }
    };
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("spawn failed: {}", e);
            let _ = app.emit(&event_name, CliEvent::Error { message: msg.clone() });
            let _ = app.emit(&event_name, CliEvent::Done { exit_code: -1 });

            // Log spawn failure
            if let Some(mut f) = std::fs::OpenOptions::new().append(true).open(&log_path).ok() {
                let log_entry = serde_json::json!({
                    "ts": chrono::Utc::now().to_rfc3339(),
                    "type": "system",
                    "content": format!("Spawn failed: {}", e)
                });
                if let Ok(serialized) = serde_json::to_string(&log_entry) {
                    let _ = writeln!(f, "{}", serialized);
                }
            }

            let _ = update_task_status(&app, &session_id, "failed", Some(-1), Some(&msg));
            update_runtime_run(&app, &adapter_for_status, Some(&msg), None);
            return Err(msg);
        }
    };

    let pid = child.id().unwrap_or(0);
    // Update task with PID
    {
        let db_path = get_db_path(&app);
        if let Ok(conn) = Connection::open(&db_path) {
            let _ = conn.execute("UPDATE cli_tasks SET pid = ? WHERE id = ?", params![pid, args.session_id]);
        }
    }

    let _ = app.emit(&event_name, CliEvent::Started { pid });

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "child has no stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "child has no stderr".to_string())?;

    // Stdout reader task
    let app_out = app.clone();
    let evt_out = event_name.clone();
    let log_path_out = log_path.clone();
    let last_activity = Arc::new(Mutex::new(Instant::now()));
    let last_activity_out = last_activity.clone();
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path_out)
            .ok();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    *last_activity_out.lock().await = Instant::now();
                    let _ = app_out.emit(&evt_out, CliEvent::Stdout { content: line.clone() });
                    if let Some(ref mut f) = file {
                        let log_entry = serde_json::json!({
                            "ts": chrono::Utc::now().to_rfc3339(),
                            "type": "stdout",
                            "content": line
                        });
                        if let Ok(serialized) = serde_json::to_string(&log_entry) {
                            let _ = writeln!(f, "{}", serialized);
                        }
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    let _ = app_out.emit(
                        &evt_out,
                        CliEvent::Error {
                            message: format!("stdout read error: {}", e),
                        },
                    );
                    break;
                }
            }
        }
    });

    // Stderr reader task
    let app_err = app.clone();
    let evt_err = event_name.clone();
    let log_path_err = log_path.clone();
    let last_activity_err = last_activity.clone();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path_err)
            .ok();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    *last_activity_err.lock().await = Instant::now();
                    let _ = app_err.emit(&evt_err, CliEvent::Stderr { content: line.clone() });
                    if let Some(ref mut f) = file {
                        let log_entry = serde_json::json!({
                            "ts": chrono::Utc::now().to_rfc3339(),
                            "type": "stderr",
                            "content": line
                        });
                        if let Ok(serialized) = serde_json::to_string(&log_entry) {
                            let _ = writeln!(f, "{}", serialized);
                        }
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    let _ = app_err.emit(
                        &evt_err,
                        CliEvent::Error {
                            message: format!("stderr read error: {}", e),
                        },
                    );
                    break;
                }
            }
        }
    });

    let mut sessions = state.sessions.lock().await;

    // Supervisor task: owns Child and waits for exit. Aborting it drops the
    // Child handle which, thanks to kill_on_drop, also kills the OS process.
    let app_wait = app.clone();
    let evt_wait = event_name.clone();
    let sessions_arc = state.sessions.clone();
    let session_id_for_task = session_id.clone();
    let log_path_wait = log_path.clone();
    let adapter_for_task = adapter_for_status.clone();

    let supervisor = tokio::spawn(async move {
        let wait_result = if let Some(ms) = timeout_ms {
            let base_timeout = Duration::from_millis(ms);
            // 无输出 idle 超时 = 配置值；有持续输出时最多跑到 hard_cap
            let idle_limit = base_timeout;
            let hard_cap = base_timeout.saturating_mul(3).min(Duration::from_secs(3600));
            let started = Instant::now();

            'wait: loop {
                tokio::select! {
                    result = child.wait() => {
                        break 'wait match result {
                            Ok(status) => Ok(status.code().unwrap_or(-1)),
                            Err(e) => Err(format!("wait failed: {}", e)),
                        };
                    }
                    _ = sleep(Duration::from_millis(500)) => {
                        let idle = last_activity.lock().await.elapsed();
                        let elapsed = started.elapsed();
                        if idle >= idle_limit || elapsed >= hard_cap {
                            let _ = child.kill().await;
                            break 'wait Err("timeout".to_string());
                        }
                    }
                }
            }
        } else {
            match child.wait().await {
                Ok(status) => Ok(status.code().unwrap_or(-1)),
                Err(e) => Err(format!("wait failed: {}", e)),
            }
        };

        // Drain any remaining buffered output
        let _ = stdout_task.await;
        let _ = stderr_task.await;

        let (status, exit_code, err_msg) = match wait_result {
            Ok(code) => {
                let status = if code == 0 { "completed" } else { "failed" };
                let err_msg = if code == 0 { None } else { Some("CLI non-zero exit code".to_string()) };
                let _ = app_wait.emit(&evt_wait, CliEvent::Done { exit_code: code });
                (status, Some(code), err_msg)
            }
            Err(ref e) if e == "timeout" => {
                let _ = app_wait.emit(&evt_wait, CliEvent::Error { message: "timeout".to_string() });
                let _ = app_wait.emit(&evt_wait, CliEvent::Done { exit_code: -3 });
                ("timeout", Some(-3), Some("Task execution timed out".to_string()))
            }
            Err(e) => {
                let _ = app_wait.emit(&evt_wait, CliEvent::Error { message: e.clone() });
                let _ = app_wait.emit(&evt_wait, CliEvent::Done { exit_code: -1 });
                ("failed", Some(-1), Some(e))
            }
        };

        // Log completion details
        if let Some(mut f) = std::fs::OpenOptions::new().append(true).open(&log_path_wait).ok() {
            let log_entry = serde_json::json!({
                "ts": chrono::Utc::now().to_rfc3339(),
                "type": "system",
                "content": format!("Process finished. Status: {}, exit_code: {:?}", status, exit_code)
            });
            if let Ok(serialized) = serde_json::to_string(&log_entry) {
                let _ = writeln!(f, "{}", serialized);
            }
        }

        // Update DB task entry
        let _ = update_task_status(&app_wait, &session_id_for_task, status, exit_code, err_msg.as_deref());
        update_runtime_run(&app_wait, &adapter_for_task, err_msg.as_deref(), Some(true));

        // Remove ourselves from the registry on natural exit
        let mut sessions = sessions_arc.lock().await;
        sessions.remove(&session_id_for_task);
    });

    sessions.insert(
        session_id,
        RunningCliSession {
            abort_handle: supervisor.abort_handle(),
            pid,
        },
    );
    drop(sessions);

    Ok(())
}

#[tauri::command]
pub async fn cli_kill(
    app: AppHandle,
    state: State<'_, CliState>,
    session_id: String,
) -> Result<bool, String> {
    let session = {
        let mut sessions = state.sessions.lock().await;
        sessions.remove(&session_id)
    };

    if let Some(session) = session {
        kill_process_tree(session.pid).await;
        session.abort_handle.abort();

        // Write system log about cancellation
        let mut log_path = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        log_path.push("cli-logs");
        log_path.push(format!("{}.jsonl", session_id));
        if let Some(mut f) = std::fs::OpenOptions::new().append(true).open(&log_path).ok() {
            let log_entry = serde_json::json!({
                "ts": chrono::Utc::now().to_rfc3339(),
                "type": "system",
                "content": "Process cancelled by user"
            });
            if let Ok(serialized) = serde_json::to_string(&log_entry) {
                let _ = writeln!(f, "{}", serialized);
            }
        }

        // Update task status in DB to cancelled
        let event_name = format!("cli://{}", session_id);
        let _ = app.emit(&event_name, CliEvent::Error { message: "cancelled".to_string() });
        let _ = app.emit(&event_name, CliEvent::Done { exit_code: -2 });
        let _ = update_task_status(&app, &session_id, "cancelled", Some(-2), Some("Task cancelled by user"));
        Ok(true)
    }

    else if let Some(pid) = get_task_pid(&app, &session_id) {
        kill_process_tree(pid).await;
        let event_name = format!("cli://{}", session_id);
        let _ = app.emit(&event_name, CliEvent::Error { message: "cancelled".to_string() });
        let _ = app.emit(&event_name, CliEvent::Done { exit_code: -2 });
        let _ = update_task_status(&app, &session_id, "cancelled", Some(-2), Some("Task cancelled by user"));
        Ok(true)
    } else {
        Ok(false)
    }
}
#[tauri::command]
pub async fn cli_task_list(
    app: AppHandle,
    group_id: String,
    limit: Option<i64>,
    before: Option<String>,
) -> Result<Vec<CliTask>, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    let limit_val = limit.unwrap_or(50);
    let query = "SELECT id, group_id, agent_id, agent_name, adapter, status, cwd, prompt, prompt_summary, session_id, pid, exit_code, error_message, log_path, started_at, ended_at, created_at, updated_at 
                 FROM cli_tasks 
                 WHERE group_id = ?1 AND (?2 IS NULL OR created_at < ?2)
                 ORDER BY created_at DESC LIMIT ?3";
    let mut params_vec: Vec<rusqlite::types::Value> = vec![
        rusqlite::types::Value::Text(group_id),
        before.map_or(rusqlite::types::Value::Null, rusqlite::types::Value::Text),
    ];
    params_vec.push(rusqlite::types::Value::Integer(limit_val));

    let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
    let task_iter = stmt
        .query_map(rusqlite::params_from_iter(params_vec), |row| {
            Ok(CliTask {
                id: row.get(0)?,
                group_id: row.get(1)?,
                agent_id: row.get(2)?,
                agent_name: row.get(3)?,
                adapter: row.get(4)?,
                status: row.get(5)?,
                cwd: row.get(6)?,
                prompt: row.get(7)?,
                prompt_summary: row.get(8)?,
                session_id: row.get(9)?,
                pid: row.get(10)?,
                exit_code: row.get(11)?,
                error_message: row.get(12)?,
                log_path: row.get(13)?,
                started_at: row.get(14)?,
                ended_at: row.get(15)?,
                created_at: row.get(16)?,
                updated_at: row.get(17)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut tasks = Vec::new();
    for task in task_iter {
        tasks.push(task.map_err(|e| e.to_string())?);
    }
    Ok(tasks)
}

#[tauri::command]
pub async fn cli_task_get(app: AppHandle, task_id: String) -> Result<Option<CliTask>, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, group_id, agent_id, agent_name, adapter, status, cwd, prompt, prompt_summary, session_id, pid, exit_code, error_message, log_path, started_at, ended_at, created_at, updated_at 
         FROM cli_tasks WHERE id = ?1"
    ).map_err(|e| e.to_string())?;

    let mut task_iter = stmt.query_map(params![task_id], |row| {
        Ok(CliTask {
            id: row.get(0)?,
            group_id: row.get(1)?,
            agent_id: row.get(2)?,
            agent_name: row.get(3)?,
            adapter: row.get(4)?,
            status: row.get(5)?,
            cwd: row.get(6)?,
            prompt: row.get(7)?,
            prompt_summary: row.get(8)?,
            session_id: row.get(9)?,
            pid: row.get(10)?,
            exit_code: row.get(11)?,
            error_message: row.get(12)?,
            log_path: row.get(13)?,
            started_at: row.get(14)?,
            ended_at: row.get(15)?,
            created_at: row.get(16)?,
            updated_at: row.get(17)?,
        })
    }).map_err(|e| e.to_string())?;

    if let Some(task_res) = task_iter.next() {
        let task = task_res.map_err(|e| e.to_string())?;
        Ok(Some(task))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn cli_task_read_log(
    app: AppHandle,
    task_id: String,
    since_line: Option<usize>,
) -> Result<CliTaskLogPage, String> {
    let mut log_path = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    log_path.push("cli-logs");
    log_path.push(format!("{}.jsonl", task_id));

    if !log_path.exists() {
        return Ok(CliTaskLogPage {
            lines: vec![],
            total_lines: 0,
        });
    }

    let file = std::fs::File::open(log_path).map_err(|e| e.to_string())?;
    let reader = std::io::BufReader::new(file);
    let mut lines = vec![];

    let start_idx = since_line.unwrap_or(0);
    let mut current_idx = 0;

    for line_res in std::io::BufRead::lines(reader) {
        let line = line_res.map_err(|e| e.to_string())?;
        if current_idx >= start_idx {
            if let Ok(entry) = serde_json::from_str::<CliTaskLogEntry>(&line) {
                lines.push(entry);
            }
        }
        current_idx += 1;
    }

    Ok(CliTaskLogPage {
        lines,
        total_lines: current_idx,
    })
}

#[tauri::command]
pub async fn cli_runtime_list(app: AppHandle) -> Result<Vec<CliRuntime>, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT adapter, installed, binary_path, version, last_check_at, last_run_at, last_error, updated_at
         FROM cli_runtimes ORDER BY adapter"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        let installed: i64 = row.get(1)?;
        Ok(CliRuntime {
            adapter: row.get(0)?,
            installed: installed != 0,
            binary_path: row.get(2)?,
            version: row.get(3)?,
            last_check_at: row.get(4)?,
            last_run_at: row.get(5)?,
            last_error: row.get(6)?,
            updated_at: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut runtimes = Vec::new();
    for row in rows {
        runtimes.push(row.map_err(|e| e.to_string())?);
    }
    Ok(runtimes)
}


#[tauri::command]
pub async fn cli_check(app: AppHandle, adapter: String) -> Result<CliCheckResult, String> {
    let bin = adapter_binary(&adapter)
        .ok_or_else(|| format!("unknown adapter: {}", adapter))?;
    let path = match which::which(bin) {
        Ok(p) => p,
        Err(_) => {
            upsert_runtime_check(&app, &adapter, false, None, None, Some("binary not found"));
            return Ok(CliCheckResult {
                installed: false,
                path: None,
                version: None,
            });
        }
    };

    // Best-effort version detection (5s timeout to avoid hangs).
    let version = match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        Command::new(&path).arg("--version").output(),
    )
    .await
    {
        Ok(Ok(out)) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if s.is_empty() {
                None
            } else {
                Some(s.lines().next().unwrap_or("").to_string())
            }
        }
        _ => None,
    };

    let result = CliCheckResult {
        installed: true,
        path: Some(path.to_string_lossy().into_owned()),
        version,
    };
    upsert_runtime_check(
        &app,
        &adapter,
        true,
        result.path.as_deref(),
        result.version.as_deref(),
        None,
    );
    Ok(result)
}

// ---------- Adapters: how each CLI is invoked in headless mode -----------

#[derive(Clone, Copy)]
struct CliAdapterDefinition {
    id: &'static str,
    default_binary: Option<&'static str>,
}

const CLI_ADAPTER_DEFINITIONS: &[CliAdapterDefinition] = &[
    CliAdapterDefinition { id: "codex", default_binary: Some("codex") },
    CliAdapterDefinition { id: "opencode", default_binary: Some("opencode") },
    CliAdapterDefinition { id: "claude", default_binary: Some("claude") },
    CliAdapterDefinition { id: "cursor", default_binary: Some("cursor") },
];

fn adapter_definition(adapter: &str) -> Option<CliAdapterDefinition> {
    CLI_ADAPTER_DEFINITIONS
        .iter()
        .copied()
        .find(|definition| definition.id == adapter)
}

fn adapter_binary(adapter: &str) -> Option<&'static str> {
    adapter_definition(adapter).and_then(|definition| definition.default_binary)
}

fn has_extra_arg(args: &CliRunArgs, needle: &str) -> bool {
    args.extra_args
        .as_ref()
        .map_or(false, |extra| extra.iter().any(|arg| arg == needle))
}

fn has_any_extra_arg(args: &CliRunArgs, needles: &[&str]) -> bool {
    args.extra_args.as_ref().map_or(false, |extra| {
        extra.iter().any(|arg| needles.iter().any(|needle| arg == needle))
    })
}

fn has_extra_arg_prefix(args: &CliRunArgs, prefix: &str) -> bool {
    args.extra_args
        .as_ref()
        .map_or(false, |extra| extra.iter().any(|arg| arg.starts_with(prefix)))
}

fn has_any_extra_arg_prefix(args: &CliRunArgs, prefixes: &[&str]) -> bool {
    args.extra_args.as_ref().map_or(false, |extra| {
        extra.iter().any(|arg| prefixes.iter().any(|prefix| arg.starts_with(prefix)))
    })
}

fn append_extra_args(cmd: &mut Command, args: &CliRunArgs) {
    if let Some(extra) = &args.extra_args {
        for a in extra {
            cmd.arg(a);
        }
    }
}

fn append_tool_session(cmd: &mut Command, args: &CliRunArgs, flag: &str) {
    if let Some(tool_session_id) = &args.tool_session_id {
        if !tool_session_id.is_empty() {
            cmd.arg(flag).arg(tool_session_id);
        }
    }
}

fn build_codex_command(cmd: &mut Command, args: &CliRunArgs) {
    cmd.arg("exec");
    if !has_extra_arg(args, "--skip-git-repo-check") {
        cmd.arg("--skip-git-repo-check");
    }
    append_extra_args(cmd, args);
    if !has_any_extra_arg(args, &["resume", "--last"]) {
        if let Some(tool_session_id) = &args.tool_session_id {
            if !tool_session_id.is_empty() {
                cmd.arg("resume").arg(tool_session_id);
            }
        }
    }
    cmd.arg(&args.prompt);
}

fn build_opencode_command(cmd: &mut Command, args: &CliRunArgs) {
    cmd.arg("run");
    if !has_extra_arg(args, "--format") && !has_extra_arg_prefix(args, "--format=") {
        cmd.arg("--format").arg("json");
    }
    append_extra_args(cmd, args);
    if !has_any_extra_arg(args, &["--session", "-s", "--continue", "-c"])
        && !has_extra_arg_prefix(args, "--session=")
    {
        append_tool_session(cmd, args, "--session");
    }
    if !has_extra_arg(args, "--title") && !has_extra_arg_prefix(args, "--title=") {
        cmd.arg("--title").arg(prompt_summary(&args.prompt, 48));
    }
    cmd.arg(&args.prompt);
}

fn build_claude_command(cmd: &mut Command, args: &CliRunArgs) {
    cmd.arg("-p");
    if !has_extra_arg(args, "--output-format") && !has_extra_arg_prefix(args, "--output-format=") {
        cmd.arg("--output-format").arg("stream-json");
    }
    if !has_extra_arg(args, "--include-partial-messages") {
        cmd.arg("--include-partial-messages");
    }
    if args.approval_mode.as_deref() == Some("auto") {
        cmd.arg("--dangerously-skip-permissions");
    }
    append_extra_args(cmd, args);
    if !has_any_extra_arg(args, &["--resume", "-r", "--continue", "-c", "--session-id"])
        && !has_any_extra_arg_prefix(args, &["--resume=", "--session-id="])
    {
        append_tool_session(cmd, args, "--resume");
    }
    cmd.arg(&args.prompt);
}

fn build_cursor_command(cmd: &mut Command, args: &CliRunArgs) {
    cmd.arg("agent");
    cmd.arg("-p");
    if !has_extra_arg(args, "--output-format") && !has_extra_arg_prefix(args, "--output-format=") {
        cmd.arg("--output-format").arg("stream-json");
    }
    if !has_extra_arg(args, "--trust") {
        cmd.arg("--trust");
    }
    if args.approval_mode.as_deref() == Some("auto")
        && !has_any_extra_arg(args, &["--force", "--yolo"])
    {
        cmd.arg("--force");
    }
    if let Some(cwd) = &args.cwd {
        if !cwd.is_empty()
            && !has_extra_arg(args, "--workspace")
            && !has_extra_arg_prefix(args, "--workspace=")
        {
            cmd.arg("--workspace").arg(cwd);
        }
    }
    append_extra_args(cmd, args);
    if !has_any_extra_arg(args, &["--resume", "--continue"])
        && !has_extra_arg_prefix(args, "--resume=")
    {
        append_tool_session(cmd, args, "--resume");
    }
    cmd.arg(&args.prompt);
}

fn build_command(args: &CliRunArgs) -> Result<Command, String> {
    let binary = args
        .binary
        .clone()
        .or_else(|| adapter_binary(&args.adapter).map(|s| s.to_string()))
        .ok_or_else(|| {
            format!(
                "adapter '{}' has no default binary; pass `binary`",
                args.adapter
            )
        })?;

    let mut cmd = Command::new(&binary);

    match args.adapter.as_str() {
        "codex" => build_codex_command(&mut cmd, args),
        "opencode" => build_opencode_command(&mut cmd, args),
        "claude" => build_claude_command(&mut cmd, args),
        "cursor" => build_cursor_command(&mut cmd, args),
        other => return Err(format!("unknown adapter: {}", other)),
    }

    if let Some(cwd) = &args.cwd {
        if !cwd.is_empty() {
            cmd.current_dir(cwd);
        }
    }

    if let Some(env) = &args.env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    // Codex fix: if the user's ~/.codex/config.toml is not readable (a
    // common issue when the file was created by a different process with
    // root ownership), we override CODEX_HOME to a writable temp
    // directory. If the user's config IS readable, we leave CODEX_HOME
    // alone so their existing auth and settings are picked up.
    if args.adapter == "codex" && args.env.as_ref().map_or(true, |e| !e.contains_key("CODEX_HOME")) {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let user_cfg = std::path::PathBuf::from(&home).join(".codex").join("config.toml");
        let needs_override = if user_cfg.exists() {
            std::fs::File::open(&user_cfg).is_err()
        } else {
            // If ~/.codex doesn't exist at all, codex will create it, which
            // is fine as long as $HOME is writable. Don't override.
            false
        };
        if needs_override {
            let codex_home = std::env::temp_dir().join("botgroup-codex-home");
            let _ = std::fs::create_dir_all(&codex_home);
            let cfg_path = codex_home.join("config.toml");
            if !cfg_path.exists() {
                let _ = std::fs::write(&cfg_path, "");
            }
            // Copy the auth.json if it exists and is readable
            let user_auth = std::path::PathBuf::from(&home).join(".codex").join("auth.json");
            let dest_auth = codex_home.join("auth.json");
            if user_auth.exists() && !dest_auth.exists() {
                let _ = std::fs::copy(&user_auth, &dest_auth);
            }
            cmd.env("CODEX_HOME", &codex_home);
        }
    }

    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    Ok(cmd)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeSessionTitleResult {
    pub title: Option<String>,
}

#[tauri::command]
pub async fn cli_opencode_session_title(
    session_id: String,
    binary: Option<String>,
) -> Result<OpenCodeSessionTitleResult, String> {
    let bin = binary.unwrap_or_else(|| "opencode".to_string());
    let path = which::which(&bin).map_err(|_| format!("{bin} binary not found"))?;

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        Command::new(&path)
            .arg("export")
            .arg(&session_id)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| "opencode export timed out".to_string())?
    .map_err(|e| format!("opencode export failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "opencode export exited with {}: {}",
            output.status, stderr.trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("invalid opencode export json: {e}"))?;

    let title = json
        .get("info")
        .and_then(|info| info.get("title"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    Ok(OpenCodeSessionTitleResult { title })
}

#[cfg(test)]
mod tests {
    use super::{adapter_definition, build_command, prompt_summary, CliRunArgs};
    use std::collections::HashMap;

    #[test]
    fn prompt_summary_does_not_split_utf8() {
        let prompt = "以下是上一阶段输出：写一个冒泡排序，请继续执行审查阶段。";
        let summary = prompt_summary(prompt, 20);

        assert!(summary.ends_with("..."));
        assert!(summary.chars().count() <= 20);
        assert!(std::str::from_utf8(summary.as_bytes()).is_ok());
    }

    #[test]
    fn prompt_summary_keeps_short_prompt() {
        let prompt = "写一个冒泡排序";
        assert_eq!(prompt_summary(prompt, 60), prompt);
    }

    #[test]
    fn adapter_definition_centralizes_default_binary_lookup() {
        assert_eq!(adapter_definition("codex").and_then(|d| d.default_binary), Some("codex"));
        assert_eq!(adapter_definition("opencode").and_then(|d| d.default_binary), Some("opencode"));
        assert_eq!(adapter_definition("claude").and_then(|d| d.default_binary), Some("claude"));
        assert_eq!(adapter_definition("cursor").and_then(|d| d.default_binary), Some("cursor"));
        assert!(adapter_definition("unknown").is_none());
    }

    #[test]
    fn codex_exec_allows_user_selected_non_git_workspaces() {
        let cmd = build_command(&CliRunArgs {
            session_id: "session-1".to_string(),
            group_id: "group-1".to_string(),
            agent_id: "cli-codex".to_string(),
            agent_name: "Codex".to_string(),
            adapter: "codex".to_string(),
            prompt: "写一个冒泡排序文件".to_string(),
            cwd: Some("/tmp/not-a-git-repo".to_string()),
            extra_args: None,
            tool_session_id: None,
            binary: None,
            env: Some(HashMap::new()),
            timeout_ms: Some(300000),
            approval_mode: Some("auto".to_string()),
            show_stderr: Some(true),
        })
        .expect("codex command should build");

        let rendered = format!("{:?}", cmd);

        assert!(rendered.contains("\"exec\""));
        assert!(rendered.contains("\"--skip-git-repo-check\""));
        assert!(rendered.contains("\"写一个冒泡排序文件\""));
    }

    #[test]
    fn codex_exec_resumes_tool_session_when_available() {
        let cmd = build_command(&CliRunArgs {
            session_id: "session-1".to_string(),
            group_id: "group-1".to_string(),
            agent_id: "cli-codex".to_string(),
            agent_name: "Codex".to_string(),
            adapter: "codex".to_string(),
            prompt: "继续刚才的任务".to_string(),
            cwd: Some("/tmp/not-a-git-repo".to_string()),
            extra_args: Some(vec![
                "--json".to_string(),
                "--sandbox".to_string(),
                "workspace-write".to_string(),
            ]),
            tool_session_id: Some("019e1234-abcd".to_string()),
            binary: None,
            env: Some(HashMap::new()),
            timeout_ms: Some(300000),
            approval_mode: Some("auto".to_string()),
            show_stderr: Some(true),
        })
        .expect("codex resume command should build");

        let rendered = format!("{:?}", cmd);

        assert!(rendered.contains("\"exec\""));
        assert!(rendered.contains("\"resume\""));
        assert!(rendered.contains("\"019e1234-abcd\""));
        assert!(rendered.contains("\"继续刚才的任务\""));
    }

    #[test]
    fn codex_exec_respects_explicit_resume_arg() {
        let cmd = build_command(&CliRunArgs {
            session_id: "session-1".to_string(),
            group_id: "group-1".to_string(),
            agent_id: "cli-codex".to_string(),
            agent_name: "Codex".to_string(),
            adapter: "codex".to_string(),
            prompt: "继续刚才的任务".to_string(),
            cwd: Some("/tmp/not-a-git-repo".to_string()),
            extra_args: Some(vec!["resume".to_string(), "manual-session".to_string()]),
            tool_session_id: Some("stored-session".to_string()),
            binary: None,
            env: Some(HashMap::new()),
            timeout_ms: Some(300000),
            approval_mode: Some("auto".to_string()),
            show_stderr: Some(true),
        })
        .expect("codex command should build");

        let rendered = format!("{:?}", cmd);

        assert!(rendered.contains("\"manual-session\""));
        assert!(!rendered.contains("\"stored-session\""));
    }

    #[test]
    fn claude_print_defaults_to_stream_json() {
        let cmd = build_command(&CliRunArgs {
            session_id: "session-1".to_string(),
            group_id: "group-1".to_string(),
            agent_id: "cli-claude-code".to_string(),
            agent_name: "ClaudeCode".to_string(),
            adapter: "claude".to_string(),
            prompt: "审查代码".to_string(),
            cwd: Some("/tmp/project".to_string()),
            extra_args: None,
            tool_session_id: None,
            binary: None,
            env: Some(HashMap::new()),
            timeout_ms: Some(300000),
            approval_mode: Some("auto".to_string()),
            show_stderr: Some(false),
        })
        .expect("claude command should build");

        let rendered = format!("{:?}", cmd);

        assert!(rendered.contains("\"-p\""));
        assert!(rendered.contains("\"--output-format\""));
        assert!(rendered.contains("\"stream-json\""));
        assert!(rendered.contains("\"--include-partial-messages\""));
        assert!(rendered.contains("\"--dangerously-skip-permissions\""));
        assert!(rendered.contains("\"审查代码\""));
    }

    #[test]
    fn claude_print_resumes_tool_session_when_available() {
        let cmd = build_command(&CliRunArgs {
            session_id: "session-1".to_string(),
            group_id: "group-1".to_string(),
            agent_id: "cli-claude-code".to_string(),
            agent_name: "ClaudeCode".to_string(),
            adapter: "claude".to_string(),
            prompt: "继续审查".to_string(),
            cwd: Some("/tmp/project".to_string()),
            extra_args: None,
            tool_session_id: Some("7d9c0000-0000-4000-8000-000000000001".to_string()),
            binary: None,
            env: Some(HashMap::new()),
            timeout_ms: Some(300000),
            approval_mode: Some("auto".to_string()),
            show_stderr: Some(false),
        })
        .expect("claude resume command should build");

        let rendered = format!("{:?}", cmd);

        assert!(rendered.contains("\"--resume\""));
        assert!(rendered.contains("\"7d9c0000-0000-4000-8000-000000000001\""));
        assert!(rendered.contains("\"继续审查\""));
    }

    #[test]
    fn claude_print_respects_explicit_resume_arg() {
        let cmd = build_command(&CliRunArgs {
            session_id: "session-1".to_string(),
            group_id: "group-1".to_string(),
            agent_id: "cli-claude-code".to_string(),
            agent_name: "ClaudeCode".to_string(),
            adapter: "claude".to_string(),
            prompt: "继续审查".to_string(),
            cwd: Some("/tmp/project".to_string()),
            extra_args: Some(vec!["--resume".to_string(), "manual-session".to_string()]),
            tool_session_id: Some("stored-session".to_string()),
            binary: None,
            env: Some(HashMap::new()),
            timeout_ms: Some(300000),
            approval_mode: Some("auto".to_string()),
            show_stderr: Some(false),
        })
        .expect("claude command should build");

        let rendered = format!("{:?}", cmd);

        assert!(rendered.contains("\"manual-session\""));
        assert!(!rendered.contains("\"stored-session\""));
    }

    #[test]
    fn opencode_run_defaults_to_json_format() {
        let cmd = build_command(&CliRunArgs {
            session_id: "session-1".to_string(),
            group_id: "group-1".to_string(),
            agent_id: "cli-opencode".to_string(),
            agent_name: "OpenCode".to_string(),
            adapter: "opencode".to_string(),
            prompt: "继续刚才的任务".to_string(),
            cwd: Some("/tmp/project".to_string()),
            extra_args: Some(vec!["--pure".to_string()]),
            tool_session_id: None,
            binary: None,
            env: Some(HashMap::new()),
            timeout_ms: Some(300000),
            approval_mode: Some("auto".to_string()),
            show_stderr: Some(true),
        })
        .expect("opencode command should build");

        let rendered = format!("{:?}", cmd);

        assert!(rendered.contains("\"run\""));
        assert!(rendered.contains("\"--format\""));
        assert!(rendered.contains("\"json\""));
        assert!(rendered.contains("\"--pure\""));
        assert!(rendered.contains("\"--title\""));
        assert!(rendered.contains("\"继续刚才的任务\""));
    }

    #[test]
    fn opencode_run_respects_explicit_format_arg() {
        let cmd = build_command(&CliRunArgs {
            session_id: "session-1".to_string(),
            group_id: "group-1".to_string(),
            agent_id: "cli-opencode".to_string(),
            agent_name: "OpenCode".to_string(),
            adapter: "opencode".to_string(),
            prompt: "继续刚才的任务".to_string(),
            cwd: Some("/tmp/project".to_string()),
            extra_args: Some(vec!["--format".to_string(), "default".to_string()]),
            tool_session_id: None,
            binary: None,
            env: Some(HashMap::new()),
            timeout_ms: Some(300000),
            approval_mode: Some("auto".to_string()),
            show_stderr: Some(true),
        })
        .expect("opencode command should build");

        let rendered = format!("{:?}", cmd);

        assert!(rendered.contains("\"--format\" \"default\""));
        assert!(!rendered.contains("\"--format\" \"json\""));
    }

    #[test]
    fn cursor_agent_defaults_to_stream_json() {
        let cmd = build_command(&CliRunArgs {
            session_id: "session-1".to_string(),
            group_id: "group-1".to_string(),
            agent_id: "cli-cursor".to_string(),
            agent_name: "Cursor".to_string(),
            adapter: "cursor".to_string(),
            prompt: "审查代码".to_string(),
            cwd: Some("/tmp/project".to_string()),
            extra_args: None,
            tool_session_id: None,
            binary: None,
            env: Some(HashMap::new()),
            timeout_ms: Some(300000),
            approval_mode: Some("auto".to_string()),
            show_stderr: Some(false),
        })
        .expect("cursor command should build");

        let rendered = format!("{:?}", cmd);

        assert!(rendered.contains("\"agent\""));
        assert!(rendered.contains("\"-p\""));
        assert!(rendered.contains("\"--output-format\""));
        assert!(rendered.contains("\"stream-json\""));
        assert!(rendered.contains("\"--trust\""));
        assert!(rendered.contains("\"--force\""));
        assert!(rendered.contains("\"--workspace\""));
        assert!(rendered.contains("\"/tmp/project\""));
        assert!(rendered.contains("\"审查代码\""));
    }

    #[test]
    fn cursor_agent_resumes_tool_session_when_available() {
        let cmd = build_command(&CliRunArgs {
            session_id: "session-1".to_string(),
            group_id: "group-1".to_string(),
            agent_id: "cli-cursor".to_string(),
            agent_name: "Cursor".to_string(),
            adapter: "cursor".to_string(),
            prompt: "继续审查".to_string(),
            cwd: Some("/tmp/project".to_string()),
            extra_args: None,
            tool_session_id: Some("0f373dc8-07f8-4c79-8953-9d30ccb34053".to_string()),
            binary: None,
            env: Some(HashMap::new()),
            timeout_ms: Some(300000),
            approval_mode: Some("auto".to_string()),
            show_stderr: Some(false),
        })
        .expect("cursor resume command should build");

        let rendered = format!("{:?}", cmd);

        assert!(rendered.contains("\"--resume\""));
        assert!(rendered.contains("\"0f373dc8-07f8-4c79-8953-9d30ccb34053\""));
        assert!(rendered.contains("\"继续审查\""));
    }

    #[test]
    fn cursor_agent_respects_explicit_resume_arg() {
        let cmd = build_command(&CliRunArgs {
            session_id: "session-1".to_string(),
            group_id: "group-1".to_string(),
            agent_id: "cli-cursor".to_string(),
            agent_name: "Cursor".to_string(),
            adapter: "cursor".to_string(),
            prompt: "继续审查".to_string(),
            cwd: Some("/tmp/project".to_string()),
            extra_args: Some(vec!["--resume".to_string(), "manual-session".to_string()]),
            tool_session_id: Some("stored-session".to_string()),
            binary: None,
            env: Some(HashMap::new()),
            timeout_ms: Some(300000),
            approval_mode: Some("auto".to_string()),
            show_stderr: Some(false),
        })
        .expect("cursor command should build");

        let rendered = format!("{:?}", cmd);

        assert!(rendered.contains("\"manual-session\""));
        assert!(!rendered.contains("\"stored-session\""));
    }

    #[test]
    fn opencode_run_respects_equals_format_arg() {
        let cmd = build_command(&CliRunArgs {
            session_id: "session-1".to_string(),
            group_id: "group-1".to_string(),
            agent_id: "cli-opencode".to_string(),
            agent_name: "OpenCode".to_string(),
            adapter: "opencode".to_string(),
            prompt: "继续刚才的任务".to_string(),
            cwd: Some("/tmp/project".to_string()),
            extra_args: Some(vec!["--format=default".to_string()]),
            tool_session_id: None,
            binary: None,
            env: Some(HashMap::new()),
            timeout_ms: Some(300000),
            approval_mode: Some("auto".to_string()),
            show_stderr: Some(true),
        })
        .expect("opencode command should build");

        let rendered = format!("{:?}", cmd);

        assert!(rendered.contains("\"--format=default\""));
        assert!(!rendered.contains("\"--format\" \"json\""));
    }
}


// =====================================================================
// Worktree IPC: support for `race` strategy isolation per agent.
//
// We use `git worktree` so multiple CLI agents can compete on the same
// task without trampling each other's writes. Worktrees are created
// under `{app_data_dir}/cli-worktrees/{group_id}/{run_id}/{agent_id}`.
//
// First version:
//   - require a clean git repo (no uncommitted changes); we do NOT auto
//     stash/commit
//   - do NOT auto-cleanup on completion; the user can inspect results
//   - cleanup IPC is exposed for future UI
// =====================================================================

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliWorktreePrepareArgs {
    pub group_id: String,
    pub cwd: String,
    pub agent_ids: Vec<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CliWorktreeInfo {
    pub agent_id: String,
    pub path: String,
    pub branch_name: Option<String>,
    pub base_sha: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliWorktreePrepareResult {
    pub run_id: String,
    pub worktrees: Vec<CliWorktreeInfo>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliWorktreeCleanupArgs {
    pub paths: Vec<String>,
}

fn run_git_capture(cwd: &std::path::Path, args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git {}: {}", args.join(" "), e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "git {} failed (exit {:?}): {}",
            args.join(" "),
            output.status.code(),
            stderr
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn ensure_git_repo_clean(cwd: &std::path::Path) -> Result<String, String> {
    if !cwd.exists() {
        return Err(format!("workspace 不存在：{}", cwd.display()));
    }

    // Verify it's a git repo
    run_git_capture(cwd, &["rev-parse", "--is-inside-work-tree"])
        .map_err(|_| "当前 workspace 不是 git 仓库，无法使用竞争模式（需要 git 仓库以创建 worktree）".to_string())?;

    // Check working tree cleanliness; we refuse to create worktrees when
    // the user has uncommitted/untracked work because `git worktree add`
    // does not carry those changes over.
    let porcelain = run_git_capture(cwd, &["status", "--porcelain"])?;
    if !porcelain.is_empty() {
        return Err(
            "当前 workspace 有未提交改动，worktree 不会包含这些改动。请先提交、清理或改用顺序执行模式。".to_string(),
        );
    }

    // Resolve current HEAD sha as the base
    let head_sha = run_git_capture(cwd, &["rev-parse", "HEAD"])?;
    Ok(head_sha)
}

#[tauri::command]
pub async fn cli_worktree_prepare(
    app: AppHandle,
    args: CliWorktreePrepareArgs,
) -> Result<CliWorktreePrepareResult, String> {
    if args.cwd.is_empty() {
        return Err("workspacePath 不能为空".to_string());
    }
    if args.agent_ids.is_empty() {
        return Err("agentIds 不能为空".to_string());
    }

    let workspace = std::path::PathBuf::from(&args.cwd);
    let base_sha = ensure_git_repo_clean(&workspace)?;

    // Use a millisecond-grained run_id; collisions are extremely unlikely
    // in practice and the run_id only namespaces worktree paths.
    let run_id = format!(
        "{}-{}",
        chrono::Utc::now().format("%Y%m%d-%H%M%S"),
        uuid::Uuid::new_v4().to_string().split('-').next().unwrap_or("xxxx")
    );

    let mut root = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    root.push("cli-worktrees");
    root.push(sanitize_path_segment(&args.group_id));
    root.push(&run_id);
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("创建 worktree 根目录失败：{}", e))?;

    let mut worktrees: Vec<CliWorktreeInfo> = Vec::with_capacity(args.agent_ids.len());
    let mut created: Vec<std::path::PathBuf> = Vec::new();

    for agent_id in &args.agent_ids {
        let safe = sanitize_path_segment(agent_id);
        let mut wt_path = root.clone();
        wt_path.push(&safe);
        let branch_name = format!("botgroup/race/{}/{}", run_id, safe);

        // Defensive: worktree add fails if path exists
        if wt_path.exists() {
            let _ = std::fs::remove_dir_all(&wt_path);
        }

        // Create a new branch for this worktree based on current HEAD.
        // `-b` ensures we don't reuse an existing branch.
        let wt_path_str = wt_path.to_string_lossy().to_string();
        match run_git_capture(
            &workspace,
            &["worktree", "add", "-b", &branch_name, &wt_path_str, &base_sha],
        ) {
            Ok(_) => {
                created.push(wt_path.clone());
                worktrees.push(CliWorktreeInfo {
                    agent_id: agent_id.clone(),
                    path: wt_path_str,
                    branch_name: Some(branch_name),
                    base_sha: Some(base_sha.clone()),
                });
            }
            Err(e) => {
                // Roll back any previously created worktrees so we don't
                // leave half-prepared state when one agent fails.
                for p in &created {
                    let p_str = p.to_string_lossy().to_string();
                    let _ = run_git_capture(
                        &workspace,
                        &["worktree", "remove", "--force", &p_str],
                    );
                }
                return Err(format!("为 agent {} 创建 worktree 失败：{}", agent_id, e));
            }
        }
    }

    Ok(CliWorktreePrepareResult { run_id, worktrees })
}

#[tauri::command]
pub async fn cli_worktree_cleanup(args: CliWorktreeCleanupArgs) -> Result<(), String> {
    // Cleanup is best-effort; we collect errors but try every path so a
    // single broken worktree doesn't strand the rest.
    let mut errors: Vec<String> = Vec::new();

    for path_str in args.paths {
        let path = std::path::PathBuf::from(&path_str);
        if !path.exists() {
            continue;
        }

        // Find the worktree's parent repo by walking up to a real .git dir
        // is not reliable; instead we infer the source repo from `git
        // rev-parse --git-common-dir` inside the worktree.
        let common_dir = match run_git_capture(&path, &["rev-parse", "--git-common-dir"]) {
            Ok(s) => s,
            Err(e) => {
                errors.push(format!("{}: {}", path_str, e));
                continue;
            }
        };
        // git-common-dir points at the source repo's `.git` directory; its
        // parent is the source workspace.
        let common = std::path::PathBuf::from(&common_dir);
        let source = common.parent().map(|p| p.to_path_buf()).unwrap_or(common);

        if let Err(e) =
            run_git_capture(&source, &["worktree", "remove", "--force", &path_str])
        {
            errors.push(format!("{}: {}", path_str, e));
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliGitDiffArgs {
    pub cwd: String,
    pub base_sha: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliGitDiffResult {
    pub stat: String,
    pub diff: String,
    pub truncated: bool,
}

const MAX_GIT_DIFF_BYTES: usize = 120_000;

#[tauri::command]
pub async fn cli_git_diff(args: CliGitDiffArgs) -> Result<CliGitDiffResult, String> {
    if args.cwd.is_empty() {
        return Err("cwd 不能为空".to_string());
    }
    if args.base_sha.is_empty() {
        return Err("baseSha 不能为空".to_string());
    }

    let cwd = std::path::PathBuf::from(&args.cwd);
    if !cwd.exists() {
        return Err(format!("路径不存在：{}", args.cwd));
    }

    let stat = run_git_capture(&cwd, &["diff", "--stat", &args.base_sha]).unwrap_or_default();
    let mut diff = run_git_capture(&cwd, &["diff", &args.base_sha])?;
    let truncated = diff.len() > MAX_GIT_DIFF_BYTES;
    if truncated {
        diff.truncate(MAX_GIT_DIFF_BYTES);
        diff.push_str("\n\n... diff 过长，已截断 ...");
    }

    Ok(CliGitDiffResult {
        stat,
        diff,
        truncated,
    })
}

fn sanitize_path_segment(input: &str) -> String {
    input
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}



// =====================================================================
// Temp Copy IPC: support for `discussion` (V2.5) read-only isolation.
//
// Instead of relying solely on prompt constraints, we create a temporary
// shallow copy of the workspace for each agent. The discussion engine
// runs each agent in its own temp copy. After execution, temp copies are
// automatically cleaned up by `cli_tempcopy_cleanup`.
// =====================================================================

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliTempCopyPrepareArgs {
    pub group_id: String,
    pub cwd: String,
    pub agent_ids: Vec<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CliTempCopyInfo {
    pub agent_id: String,
    pub path: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliTempCopyPrepareResult {
    pub copies: Vec<CliTempCopyInfo>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliTempCopyCleanupArgs {
    pub paths: Vec<String>,
}

/// Creates shallow temporary copies of `cwd` for each agent.
/// Uses `cp -a` on unix (preserves symlinks), `robocopy /mir` on Windows.
/// Copies are placed under `{app_data_dir}/cli-tempcopy/{group_id}/{timestamp}/{agent_id}`.
#[tauri::command]
pub async fn cli_tempcopy_prepare(
    app: AppHandle,
    args: CliTempCopyPrepareArgs,
) -> Result<CliTempCopyPrepareResult, String> {
    if args.cwd.is_empty() {
        return Err("workspacePath 不能为空".to_string());
    }
    if args.agent_ids.is_empty() {
        return Err("agentIds 不能为空".to_string());
    }

    let workspace = std::path::PathBuf::from(&args.cwd);
    if !workspace.exists() {
        return Err(format!("workspace 不存在：{}", workspace.display()));
    }

    let ts = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let mut root = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    root.push("cli-tempcopy");
    root.push(sanitize_path_segment(&args.group_id));
    root.push(&ts);
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("创建临时目录根失败：{}", e))?;

    let mut copies: Vec<CliTempCopyInfo> = Vec::with_capacity(args.agent_ids.len());
    let mut created: Vec<std::path::PathBuf> = Vec::new();

    for agent_id in &args.agent_ids {
        let safe = sanitize_path_segment(agent_id);
        let dest = root.join(&safe);
        let dest_str = dest.to_string_lossy().to_string();

        // Use rsync if available (fast, respects .gitignore-like patterns with --exclude),
        // otherwise fall back to cp -a.
        let copy_result = {
            let src_str = format!("{}/", args.cwd); // trailing slash = copy contents
            let _ = std::fs::create_dir_all(&dest);
            let output = std::process::Command::new("rsync")
                .args(&[
                    "-a",
                    "--exclude", ".git",
                    "--exclude", "node_modules",
                    "--exclude", "target",
                    "--exclude", ".next",
                    "--exclude", "dist",
                    &src_str,
                    &dest_str,
                ])
                .output();

            match output {
                Ok(o) if o.status.success() => Ok(()),
                Ok(_o) => {
                    // rsync failed, try cp -a as fallback
                    let _ = std::fs::create_dir_all(&dest);
                    let cp_source = format!("{}/.", args.cwd.trim_end_matches('/'));
                    let cp_output = std::process::Command::new("cp")
                        .args(&["-a", &cp_source, &dest_str])
                        .output();
                    match cp_output {
                        Ok(co) if co.status.success() => Ok(()),
                        Ok(co) => Err(format!(
                            "cp failed: {}",
                            String::from_utf8_lossy(&co.stderr)
                        )),
                        Err(e) => Err(format!("cp spawn failed: {}", e)),
                    }
                }
                Err(_) => {
                    // rsync not found, use cp -a
                    let _ = std::fs::create_dir_all(&dest);
                    let cp_source = format!("{}/.", args.cwd.trim_end_matches('/'));
                    let cp_output = std::process::Command::new("cp")
                        .args(&["-a", &cp_source, &dest_str])
                        .output();
                    match cp_output {
                        Ok(co) if co.status.success() => Ok(()),
                        Ok(co) => Err(format!(
                            "cp failed: {}",
                            String::from_utf8_lossy(&co.stderr)
                        )),
                        Err(e) => Err(format!("cp spawn failed: {}", e)),
                    }
                }
            }
        };

        match copy_result {
            Ok(()) => {
                created.push(dest.clone());
                copies.push(CliTempCopyInfo {
                    agent_id: agent_id.clone(),
                    path: dest_str,
                });
            }
            Err(e) => {
                // Roll back previously created copies
                for p in &created {
                    let _ = std::fs::remove_dir_all(p);
                }
                return Err(format!(
                    "为 agent {} 创建只读副本失败：{}",
                    agent_id, e
                ));
            }
        }
    }

    Ok(CliTempCopyPrepareResult { copies })
}

/// Cleans up temp copy directories. Best-effort: tries all paths.
#[tauri::command]
pub async fn cli_tempcopy_cleanup(args: CliTempCopyCleanupArgs) -> Result<(), String> {
    let mut errors: Vec<String> = Vec::new();
    for path_str in args.paths {
        let path = std::path::PathBuf::from(&path_str);
        if !path.exists() {
            continue;
        }
        if let Err(e) = std::fs::remove_dir_all(&path) {
            errors.push(format!("{}: {}", path_str, e));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}
