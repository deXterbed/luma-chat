// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod tools;

use db::Database;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let database = Database::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(database)
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
            commands::web_search,
            commands::web_fetch,
            commands::ollama_reachable,
            commands::ollama_list_models,
            commands::ollama_chat_stream,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
