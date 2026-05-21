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
    /// session_id -> abort handle for the supervising task.
    /// Aborting the task drops the Child, which (via kill_on_drop) SIGKILLs the process.
    sessions: Arc<Mutex<HashMap<String, tokio::task::AbortHandle>>>,
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
    let summary = if args.prompt.len() > 60 {
        format!("{}...", &args.prompt[..57])
    } else {
        args.prompt.clone()
    };
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

#[tauri::command]
pub async fn cli_run(
    app: AppHandle,
    state: State<'_, CliState>,
    args: CliRunArgs,
) -> Result<(), String> {
    let event_name = format!("cli://{}", args.session_id);
    let session_id = args.session_id.clone();
    let timeout_ms = args.timeout_ms;

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
            "content": format!("Starting task execution. Adapter: {}, Cwd: {:?}", args.adapter, args.cwd)
        });
        if let Ok(serialized) = serde_json::to_string(&log_entry) {
            let _ = writeln!(f, "{}", serialized);
        }
    }

    if let Err(e) = insert_task(&app, &args, &log_path_str) {
        let _ = app.emit(&event_name, CliEvent::Error { message: format!("DB error: {}", e) });
        return Err(e);
    }

    let mut cmd = build_command(&args)?;
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
                let _ = app_wait.emit(&evt_wait, CliEvent::Done { exit_code: -1 });
                ("timeout", Some(-1), Some("Task execution timed out".to_string()))
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

        // Remove ourselves from the registry on natural exit
        let mut sessions = sessions_arc.lock().await;
        sessions.remove(&session_id_for_task);
    });

    sessions.insert(session_id, supervisor.abort_handle());
    drop(sessions);

    Ok(())
}

#[tauri::command]
pub async fn cli_kill(
    app: AppHandle,
    state: State<'_, CliState>,
    session_id: String,
) -> Result<bool, String> {
    let mut sessions = state.sessions.lock().await;
    if let Some(handle) = sessions.remove(&session_id) {
        handle.abort();

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
        let _ = update_task_status(&app, &session_id, "cancelled", Some(-1), Some("Task cancelled by user"));
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
    let mut query = "SELECT id, group_id, agent_id, agent_name, adapter, status, cwd, prompt, prompt_summary, session_id, pid, exit_code, error_message, log_path, started_at, ended_at, created_at, updated_at 
                     FROM cli_tasks WHERE group_id = ?1".to_string();

    let mut params_vec: Vec<rusqlite::types::Value> = vec![rusqlite::types::Value::Text(group_id)];

    if let Some(before_time) = before {
        query.push_str(" AND created_at < ?2");
        params_vec.push(rusqlite::types::Value::Text(before_time));
    }

    query.push_str(" ORDER BY created_at DESC LIMIT ?3");
    params_vec.push(rusqlite::types::Value::Integer(limit_val));

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
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
pub async fn cli_check(adapter: String) -> Result<CliCheckResult, String> {
    let bin = adapter_binary(&adapter)
        .ok_or_else(|| format!("unknown adapter: {}", adapter))?;
    let path = match which::which(bin) {
        Ok(p) => p,
        Err(_) => {
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

    Ok(CliCheckResult {
        installed: true,
        path: Some(path.to_string_lossy().into_owned()),
        version,
    })
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
