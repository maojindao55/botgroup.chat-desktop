mod db;
mod api;
mod cli;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(cli::CliState::default())
        .setup(|app| {
            // Initialize SQLite Database and Tables on startup
            db::init_db(app.handle()).map_err(|e| {
                eprintln!("Database initialization failed: {}", e);
                e
            })?;
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
            api::select_directory,
            cli::cli_run,
            cli::cli_kill,
            cli::cli_check,
            cli::cli_task_list,
            cli::cli_task_get,
            cli::cli_task_read_log,
            cli::cli_runtime_list,
            cli::cli_worktree_prepare,
            cli::cli_worktree_cleanup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
