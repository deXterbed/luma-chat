use tauri::State;

use crate::db::{Database, Message, Session, SessionMessages};
use crate::tools;

// ── Session commands ──

#[tauri::command]
pub fn load_sessions(db: State<Database>) -> Vec<Session> {
    db.load_sessions()
}

#[tauri::command]
pub fn load_session_messages(db: State<Database>, session_id: String) -> SessionMessages {
    db.load_session_messages(&session_id)
}

#[tauri::command]
pub fn save_session(db: State<Database>, session: Session) {
    db.save_session(&session.id, &session.title, &session.model);
}

#[tauri::command]
pub fn update_session_activity(db: State<Database>, id: String) {
    db.update_session_activity(&id);
}

#[tauri::command]
pub fn save_messages(db: State<Database>, session_id: String, messages: Vec<Message>) {
    db.save_messages(&session_id, &messages);
}

#[tauri::command]
pub fn delete_session(db: State<Database>, id: String) {
    db.delete_session(&id);
}

// ── Side chat commands ──

#[tauri::command]
pub fn upsert_side_chat(
    db: State<Database>,
    session_id: String,
    side_chat: SideChatStub,
    position: i64,
) {
    db.upsert_side_chat(&session_id, &side_chat.id, &side_chat.model, position);
}

#[tauri::command]
pub fn save_side_chat_messages(db: State<Database>, side_chat_id: String, messages: Vec<Message>) {
    db.save_side_chat_messages(&side_chat_id, &messages);
}

#[tauri::command]
pub fn set_active_side_chat(db: State<Database>, session_id: String, side_chat_id: Option<String>) {
    db.set_active_side_chat(&session_id, side_chat_id.as_deref());
}

#[tauri::command]
pub fn delete_side_chat(db: State<Database>, id: String) {
    db.delete_side_chat(&id);
}

// ── Custom model commands ──

#[tauri::command]
pub fn load_custom_models(db: State<Database>) -> Vec<String> {
    db.load_custom_models()
}

#[tauri::command]
pub fn add_custom_model(db: State<Database>, name: String) {
    db.add_custom_model(&name);
}

#[tauri::command]
pub fn remove_custom_model(db: State<Database>, name: String) {
    db.remove_custom_model(&name);
}

// ── Web tool commands ──

#[tauri::command]
pub async fn web_search(query: String, max_results: Option<usize>) -> String {
    tools::search_web(&query, max_results.unwrap_or(5)).await
}

#[tauri::command]
pub async fn web_fetch(url: String) -> String {
    tools::fetch_page(&url).await
}

// ── Helper types ──

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SideChatStub {
    pub id: String,
    pub model: String,
}
