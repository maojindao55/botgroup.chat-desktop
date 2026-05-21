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
    /// "codex" | "opencode" | "claude" | "generic"
    pub adapter: String,
    pub prompt: String,
    pub cwd: Option<String>,
    pub extra_args: Option<Vec<String>>,
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
                "Starting task execution. Adapter: {}, Cwd: {:?}, Approval: {:?}, Show stderr: {:?}",
                args.adapter,
                args.cwd,
                args.approval_mode,
                args.show_stderr
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
        let timeout_duration = timeout_ms.map(std::time::Duration::from_millis);

        let wait_result = if let Some(dur) = timeout_duration {
            match tokio::time::timeout(dur, child.wait()).await {
                Ok(Ok(status)) => Ok(status.code().unwrap_or(-1)),
                Ok(Err(e)) => Err(format!("wait failed: {}", e)),
                Err(_) => {
                    let _ = child.kill().await;
                    Err("timeout".to_string())
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

fn adapter_binary(adapter: &str) -> Option<&'static str> {
    match adapter {
        "codex" => Some("codex"),
        "opencode" => Some("opencode"),
        "claude" => Some("claude"),
        "aider" => Some("aider"),
        "gemini" => Some("gemini"),
        "generic" => None, // requires explicit binary override
        _ => None,
    }
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
        // codex exec [flags] "<prompt>"
        // Non-interactive mode; final result on stdout, progress on stderr.
        "codex" => {
            cmd.arg("exec");
            if let Some(extra) = &args.extra_args {
                for a in extra {
                    cmd.arg(a);
                }
            }
            cmd.arg(&args.prompt);
        }

        // opencode run [flags] "<prompt>"
        // Headless mode; positional prompt at the end, no stdin support.
        "opencode" => {
            cmd.arg("run");
            if let Some(extra) = &args.extra_args {
                for a in extra {
                    cmd.arg(a);
                }
            }
            cmd.arg(&args.prompt);
        }

        // claude -p "<prompt>" [flags]
        // Print mode (non-interactive). Streams answer to stdout.
        "claude" => {
            cmd.arg("-p").arg(&args.prompt);
            if args.approval_mode.as_deref() == Some("auto") {
                cmd.arg("--dangerously-skip-permissions");
            }
            if let Some(extra) = &args.extra_args {
                for a in extra {
                    cmd.arg(a);
                }
            }
        }

        // aider --message "<prompt>" --yes-always [flags]
        "aider" => {
            cmd.arg("--message").arg(&args.prompt).arg("--yes-always");
            if let Some(extra) = &args.extra_args {
                for a in extra {
                    cmd.arg(a);
                }
            }
        }

        // gemini -p "<prompt>"
        "gemini" => {
            cmd.arg("-p").arg(&args.prompt);
            if let Some(extra) = &args.extra_args {
                for a in extra {
                    cmd.arg(a);
                }
            }
        }

        // generic: caller supplies binary and optional extra_args; prompt is appended last.
        "generic" => {
            if let Some(extra) = &args.extra_args {
                for a in extra {
                    cmd.arg(a);
                }
            }
            cmd.arg(&args.prompt);
        }

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

#[cfg(test)]
mod tests {
    use super::prompt_summary;

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

fn sanitize_path_segment(input: &str) -> String {
    input
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}
