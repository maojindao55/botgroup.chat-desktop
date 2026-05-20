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
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

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

// ---------- Public IPC commands -----------------------------------------

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliRunArgs {
    pub session_id: String,
    /// "codex" | "opencode" | "claude" | "generic"
    pub adapter: String,
    pub prompt: String,
    pub cwd: Option<String>,
    pub extra_args: Option<Vec<String>>,
    /// Optional binary override (default: looked up from adapter)
    pub binary: Option<String>,
    /// Extra env vars to set on the spawned process
    pub env: Option<HashMap<String, String>>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliCheckResult {
    pub installed: bool,
    pub path: Option<String>,
    /// Best-effort version string (first line of `--version`, ignored on failure)
    pub version: Option<String>,
}

#[tauri::command]
pub async fn cli_run(
    app: AppHandle,
    state: State<'_, CliState>,
    args: CliRunArgs,
) -> Result<(), String> {
    let event_name = format!("cli://{}", args.session_id);
    let session_id = args.session_id.clone();

    let mut cmd = build_command(&args)?;
    let mut child = cmd.spawn().map_err(|e| {
        let msg = format!("spawn failed: {}", e);
        let _ = app.emit(&event_name, CliEvent::Error { message: msg.clone() });
        let _ = app.emit(&event_name, CliEvent::Done { exit_code: -1 });
        msg
    })?;

    let pid = child.id().unwrap_or(0);
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
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    let _ = app_out.emit(&evt_out, CliEvent::Stdout { content: line });
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
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    let _ = app_err.emit(&evt_err, CliEvent::Stderr { content: line });
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

    // Acquire the registry lock BEFORE spawning the supervisor. This
    // guarantees we insert the abort handle before the supervisor's own
    // self-cleanup can race with it (in practice impossible since
    // child.wait() takes much longer than a sync map insert, but we keep
    // it tight for correctness).
    let mut sessions = state.sessions.lock().await;

    // Supervisor task: owns Child and waits for exit. Aborting it drops the
    // Child handle which, thanks to kill_on_drop, also kills the OS process.
    let app_wait = app.clone();
    let evt_wait = event_name.clone();
    let sessions_arc = state.sessions.clone();
    let session_id_for_task = session_id.clone();
    let supervisor = tokio::spawn(async move {
        let exit_code = match child.wait().await {
            Ok(status) => status.code().unwrap_or(-1),
            Err(e) => {
                let _ = app_wait.emit(
                    &evt_wait,
                    CliEvent::Error {
                        message: format!("wait failed: {}", e),
                    },
                );
                -1
            }
        };

        // Drain any remaining buffered output
        let _ = stdout_task.await;
        let _ = stderr_task.await;

        let _ = app_wait.emit(&evt_wait, CliEvent::Done { exit_code });

        // Remove ourselves from the registry on natural exit
        let mut sessions = sessions_arc.lock().await;
        sessions.remove(&session_id_for_task);
    });

    sessions.insert(session_id, supervisor.abort_handle());
    drop(sessions);

    Ok(())
}

#[tauri::command]
pub async fn cli_kill(state: State<'_, CliState>, session_id: String) -> Result<bool, String> {
    let mut sessions = state.sessions.lock().await;
    if let Some(handle) = sessions.remove(&session_id) {
        handle.abort();
        Ok(true)
    } else {
        Ok(false)
    }
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

    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    Ok(cmd)
}
