// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod tools;

use commands::CancelRegistry;
use db::Database;
use tauri::Emitter;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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

            // macOS convention: "Check for Updates…" sits in the app menu, right
            // under About. Tauri installs the default menu when none is set, so
            // this slots into that submenu rather than replacing it — replacing
            // would mean re-declaring Edit/Window/Help by hand.
            #[cfg(target_os = "macos")]
            {
                let check_updates = tauri::menu::MenuItem::with_id(
                    app,
                    "check_updates",
                    "Check for Updates…",
                    true,
                    None::<&str>,
                )?;
                if let Some(menu) = app.handle().menu() {
                    let items = menu.items()?;
                    if let Some(app_menu) = items.first().and_then(|item| item.as_submenu()) {
                        // Index 0 is "About Luma"; 1 puts us directly beneath it.
                        app_menu.insert(&check_updates, 1)?;
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_sessions,
            commands::load_session_messages,
            commands::save_session,
            commands::set_session_web_search,
            commands::update_session_activity,
            commands::save_messages,
            commands::delete_session,
            commands::upsert_side_chat,
            commands::save_side_chat_messages,
            commands::set_active_side_chat,
            commands::set_side_chat_web_search,
            commands::delete_side_chat,
            commands::load_custom_models,
            commands::add_custom_model,
            commands::remove_custom_model,
            commands::load_settings,
            commands::save_setting,
            commands::export_chats,
            commands::import_chats,
            commands::web_search,
            commands::web_fetch,
            commands::read_file,
            commands::search_code,
            commands::list_dir,
            commands::list_project_files,
            commands::validate_project_root,
            commands::set_project_roots,
            commands::append_agent_log,
            commands::agent_log_path,
            commands::clear_agent_log,
            commands::ollama_reachable,
            commands::ollama_list_models,
            commands::ollama_model_context,
            commands::ollama_chat_stream,
            commands::ollama_cancel,
        ])
        // The menu item lives in Rust, so hand the click to the frontend and let
        // the existing Settings "About" section own the check itself.
        .on_menu_event(|app, event| {
            if event.id == "check_updates" {
                let _ = app.emit("menu:check-updates", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
