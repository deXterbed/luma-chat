// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod tools;

use commands::CancelRegistry;
use db::Database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Resolve the OS-correct app data dir via Tauri (works on Windows
            // where `HOME` is typically unset; the old `dirs_next()` env-var
            // probe fell through to a relative `luma_data` dir there).
            let dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            // Copy any legacy DB (old Electron-compatible location / broken
            // Windows `luma_data` fallback) into the new app_data_dir before
            // opening, so existing chats survive the path move.
            db::migrate_legacy_db(&dir);
            app.manage(Database::new(dir));
            app.manage(CancelRegistry::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_sessions,
            commands::load_session_messages,
            commands::save_session,
            commands::update_session_activity,
            commands::save_messages,
            commands::delete_session,
            commands::upsert_side_chat,
            commands::save_side_chat_messages,
            commands::set_active_side_chat,
            commands::delete_side_chat,
            commands::load_custom_models,
            commands::add_custom_model,
            commands::remove_custom_model,
            commands::load_settings,
            commands::save_setting,
            commands::web_search,
            commands::web_fetch,
            commands::ollama_reachable,
            commands::ollama_list_models,
            commands::ollama_chat_stream,
            commands::ollama_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
