mod db;
mod api;
mod cli;
mod llm_proxy;
mod migrate;
mod provider;
mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(cli::CliState::default())
        .setup(|app| {
            cli::init_cli_environment();
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
            api::upload_user_avatar,
            api::read_local_avatar,
            api::get_claw_groups,
            api::create_claw_group,
            api::join_claw_group,
            api::get_claw_messages,
            api::send_claw_message,
            api::select_directory,
            api::create_workspace_directory,
            api::list_ai_members,
            api::get_ai_member,
            api::upsert_ai_member,
            api::delete_ai_member,
            api::seed_builtin_ai_members,
            api::secret_set,
            api::secret_has,
            api::secret_copy,
            api::secret_delete,
            api::secret_list_names,
            llm_proxy::llm_chat_stream,
            provider::list_providers,
            provider::get_provider,
            provider::upsert_provider,
            provider::delete_provider,
            provider::seed_builtin_providers,
            provider::provider_test,
            provider::provider_ping,
            migrate::migrate_a_complete,
            migrate::migration_status,
            cli::cli_run,
            cli::cli_kill,
            cli::cli_check,
            cli::cli_opencode_session_title,
            cli::cli_task_list,
            cli::cli_task_get,
            cli::cli_task_read_log,
            cli::cli_runtime_list,
            cli::cli_worktree_prepare,
            cli::cli_worktree_cleanup,
            cli::cli_git_diff,
            cli::cli_tempcopy_prepare,
            cli::cli_tempcopy_cleanup
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Ready = event {
                apply_window_icons(&app_handle);
            }
        });
}

/// macOS 开发模式下 Dock 图标有时不会自动刷新，显式同步窗口图标。
fn apply_window_icons(app: &tauri::AppHandle) {
    use tauri::Manager;

    let Some(icon) = app.default_window_icon().cloned() else {
        return;
    };

    for (_, window) in app.webview_windows() {
        let _ = window.set_icon(icon.clone());
    }
}
