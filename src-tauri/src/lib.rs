mod db;
mod api;
mod cli;
mod bridge;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(cli::CliState::default())
        .manage(Arc::new(bridge::BridgeState::default()))
        .setup(|app| {
            // Initialize SQLite Database and Tables on startup
            db::init_db(app.handle()).map_err(|e| {
                eprintln!("Database initialization failed: {}", e);
                e
            })?;

            // Start the Agent Bridge WebSocket server on localhost:19816
            let bridge_state = app.state::<Arc<bridge::BridgeState>>().inner().clone();
            bridge::start_bridge(app.handle().clone(), bridge_state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api::get_current_user,
            api::create_local_user,
            api::update_user_info,
            api::get_claw_groups,
            api::create_claw_group,
            api::join_claw_group,
            api::get_claw_messages,
            api::send_claw_message,
            cli::cli_run,
            cli::cli_kill,
            cli::cli_check,
            bridge::bridge_send_prompt,
            bridge::bridge_cancel_task,
            bridge::bridge_list_agents
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
