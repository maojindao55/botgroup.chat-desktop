// Agent Bridge: embedded WebSocket server on localhost:19816 that allows
// external CLI Agent Plugin processes to connect, receive prompts from the
// group chat, and stream results back.
//
// Protocol:
//   Plugin → Bridge: { type: "register", name } | { type: "chunk"|"stderr"|"done"|"error", id, ... }
//   Bridge → Plugin: { type: "prompt", id, text, cwd } | { type: "cancel", id }
//
// Bridge → Frontend: forwarded via Tauri events on channel "bridge://<agent_name>/<task_id>"

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;

// Re-export for lib.rs
pub use state::BridgeState;

mod state {
    use super::*;

    /// Represents a connected plugin agent.
    pub struct PluginAgent {
        pub name: String,
        pub tx: tokio::sync::mpsc::UnboundedSender<String>,
    }

    /// Shared state for the bridge.
    pub struct BridgeState {
        /// agent_name → PluginAgent
        pub agents: Arc<RwLock<HashMap<String, PluginAgent>>>,
        /// task_id → agent_name (so we know where to route cancel)
        pub tasks: Arc<Mutex<HashMap<String, String>>>,
        pub _server_handle: Option<JoinHandle<()>>,
    }

    impl Default for BridgeState {
        fn default() -> Self {
            Self {
                agents: Arc::new(RwLock::new(HashMap::new())),
                tasks: Arc::new(Mutex::new(HashMap::new())),
                _server_handle: None,
            }
        }
    }
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BridgeEvent {
    // Events forwarded to the frontend (same shape as CliEvent for
    // seamless ChatUI integration)
    Chunk { id: String, content: String },
    Stderr { id: String, content: String },
    Done { id: String, exit_code: i32 },
    Error { id: String, message: String },
}

/// Start the bridge WebSocket server. Called once from lib.rs setup.
pub fn start_bridge(app: AppHandle, bridge_state: Arc<BridgeState>) {
    let agents = bridge_state.agents.clone();
    let tasks = bridge_state.tasks.clone();

    tokio::spawn(async move {
        let listener = match TcpListener::bind("127.0.0.1:19816").await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[bridge] Failed to bind port 19816: {}", e);
                return;
            }
        };
        println!("[bridge] Listening on ws://127.0.0.1:19816/agent");

        loop {
            let (stream, addr) = match listener.accept().await {
                Ok(v) => v,
                Err(_) => continue,
            };
            println!("[bridge] New connection from {}", addr);

            let app2 = app.clone();
            let agents2 = agents.clone();
            let tasks2 = tasks.clone();

            tokio::spawn(async move {
                // Upgrade TCP to WebSocket
                let ws_stream = match tokio_tungstenite::accept_async(stream).await {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("[bridge] WS handshake failed: {}", e);
                        return;
                    }
                };

                use futures_util::{SinkExt, StreamExt};
                let (mut write, mut read) = ws_stream.split();

                // Channel for sending messages TO the plugin
                let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
                let mut agent_name: Option<String> = None;

                // Spawn writer task
                let write_task = tokio::spawn(async move {
                    while let Some(msg) = rx.recv().await {
                        use tokio_tungstenite::tungstenite::Message;
                        if write.send(Message::Text(msg)).await.is_err() {
                            break;
                        }
                    }
                });

                // Read loop
                while let Some(Ok(msg)) = read.next().await {
                    use tokio_tungstenite::tungstenite::Message;
                    let text = match msg {
                        Message::Text(t) => t,
                        Message::Close(_) => break,
                        _ => continue,
                    };

                    let parsed: serde_json::Value = match serde_json::from_str(&text) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    let msg_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");

                    match msg_type {
                        "register" => {
                            let name = parsed.get("name").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
                            println!("[bridge] Agent registered: {}", name);
                            agent_name = Some(name.clone());
                            let mut agents_w = agents2.write().await;
                            agents_w.insert(name, state::PluginAgent { name: agent_name.clone().unwrap(), tx: tx.clone() });
                        }
                        "chunk" | "stderr" | "done" | "error" => {
                            // Forward to frontend via Tauri event
                            let id = parsed.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let event_name = format!("bridge://{}", id);
                            let _ = app2.emit(&event_name, parsed.clone());
                        }
                        _ => {}
                    }
                }

                // Cleanup on disconnect
                if let Some(name) = &agent_name {
                    let mut agents_w = agents2.write().await;
                    agents_w.remove(name);
                    println!("[bridge] Agent disconnected: {}", name);
                }
                write_task.abort();
            });
        }
    });
}

// ---------- IPC commands for the frontend to interact with bridge --------

/// Send a prompt to a plugin agent. Returns the task_id.
#[tauri::command]
pub async fn bridge_send_prompt(
    state: tauri::State<'_, Arc<BridgeState>>,
    agent_name: String,
    prompt: String,
    cwd: Option<String>,
    task_id: String,
) -> Result<String, String> {
    let agents = state.agents.read().await;
    let agent = agents.get(&agent_name).ok_or_else(|| {
        format!("Agent '{}' is not connected. Please start the plugin.", agent_name)
    })?;

    let msg = serde_json::json!({
        "type": "prompt",
        "id": task_id,
        "text": prompt,
        "cwd": cwd,
    });

    agent.tx.send(serde_json::to_string(&msg).unwrap()).map_err(|e| e.to_string())?;

    // Track task → agent mapping for cancel routing
    let mut tasks = state.tasks.lock().await;
    tasks.insert(task_id.clone(), agent_name);

    Ok(task_id)
}

/// Cancel a running task.
#[tauri::command]
pub async fn bridge_cancel_task(
    state: tauri::State<'_, Arc<BridgeState>>,
    task_id: String,
) -> Result<bool, String> {
    let tasks = state.tasks.lock().await;
    let agent_name = match tasks.get(&task_id) {
        Some(n) => n.clone(),
        None => return Ok(false),
    };
    drop(tasks);

    let agents = state.agents.read().await;
    if let Some(agent) = agents.get(&agent_name) {
        let msg = serde_json::json!({ "type": "cancel", "id": task_id });
        let _ = agent.tx.send(serde_json::to_string(&msg).unwrap());
        Ok(true)
    } else {
        Ok(false)
    }
}

/// List connected plugin agents.
#[tauri::command]
pub async fn bridge_list_agents(
    state: tauri::State<'_, Arc<BridgeState>>,
) -> Result<Vec<String>, String> {
    let agents = state.agents.read().await;
    Ok(agents.keys().cloned().collect())
}
