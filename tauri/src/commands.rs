use tauri::{AppHandle, Emitter, State};

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
pub fn save_session(db: State<Database>, id: String, title: String, model: String) {
    db.save_session(&id, &title, &model);
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
    db.upsert_side_chat(
        &session_id,
        &side_chat.id,
        &side_chat.model,
        position,
        side_chat.parent_side_chat_id.as_deref(),
    );
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

// ── Settings commands ──
//
// The settings table is a key/value store. The renderer is responsible
// for knowing which keys exist and how to parse/validate their values.
// All values are stored as strings; booleans and numbers are encoded
// by the caller.

#[tauri::command]
pub fn load_settings(db: State<Database>) -> std::collections::HashMap<String, String> {
    db.load_settings()
}

#[tauri::command]
pub fn save_setting(db: State<Database>, key: String, value: String) {
    db.save_setting(&key, &value);
}

// ── Web tool commands ──

#[tauri::command]
pub async fn web_search(
    query: String,
    max_results: Option<usize>,
    provider: Option<String>,
    api_key: Option<String>,
) -> String {
    let limit = max_results.unwrap_or(5);
    if provider.as_deref() == Some("ollama") {
        tools::search_web_ollama(&query, limit, &resolve_ollama_key(api_key)).await
    } else {
        tools::search_web(&query, limit).await
    }
}

#[tauri::command]
pub async fn web_fetch(url: String, provider: Option<String>, api_key: Option<String>) -> String {
    if provider.as_deref() == Some("ollama") {
        tools::fetch_page_ollama(&url, &resolve_ollama_key(api_key)).await
    } else {
        tools::fetch_page(&url).await
    }
}

/// Resolve the Ollama API key: prefer the one set in app settings, fall back
/// to the OLLAMA_API_KEY env var (only inherited when launched from a shell,
/// e.g. `npm run dev` — not from a Finder/Dock-launched bundle on macOS).
fn resolve_ollama_key(from_settings: Option<String>) -> String {
    match from_settings {
        Some(k) if !k.trim().is_empty() => k,
        _ => std::env::var("OLLAMA_API_KEY").unwrap_or_default(),
    }
}

// ── Helper types ──

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SideChatStub {
    pub id: String,
    pub model: String,
    #[serde(rename = "parentSideChatId", default)]
    pub parent_side_chat_id: Option<String>,
}

// ── Ollama proxy commands ──
//
// The WebView2 origin in release builds is `http://tauri.localhost`, which
// the browser treats as a separate origin from `http://localhost:11434` and
// enforces CORS on. Ollama does not return CORS headers, so the React UI
// cannot fetch it directly in production. All Ollama calls go through these
// commands instead.

const OLLAMA_BASE: &str = "http://localhost:11434";

#[tauri::command]
pub async fn ollama_reachable() -> bool {
    match reqwest::Client::new()
        .get(format!("{OLLAMA_BASE}/api/version"))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
    {
        Ok(res) => res.status().is_success(),
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn ollama_list_models() -> Vec<String> {
    let Ok(res) = reqwest::Client::new()
        .get(format!("{OLLAMA_BASE}/api/tags"))
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    else {
        return Vec::new();
    };
    if !res.status().is_success() {
        return Vec::new();
    }
    let Ok(data) = res.json::<serde_json::Value>().await else {
        return Vec::new();
    };
    let mut names: Vec<String> = (data
        .get("models")
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default())
    .into_iter()
    .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(String::from))
    .collect();
    names.sort();
    names
}

/// Proxy a streaming chat completion to Ollama. Emits one `ollama://chunk`
/// event per SSE JSON line from Ollama, then `ollama://done` (with the
/// accumulated final content) or `ollama://error` (with the error string).
/// The frontend subscribes to these events via `listen()` keyed by `request_id`.
#[tauri::command]
pub async fn ollama_chat_stream(
    app: AppHandle,
    request_id: String,
    body: serde_json::Value,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 30))
        .build()
        .map_err(|e| e.to_string())?;

    let mut response = client
        .post(format!("{OLLAMA_BASE}/api/chat"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            let _ = app.emit(
                "ollama://error",
                serde_json::json!({ "request_id": &request_id, "error": e.to_string() }),
            );
            e.to_string()
        })?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body_text = response.text().await.unwrap_or_default();
        let message = match status {
            401 | 403 => format!(
                "Ollama rejected the request (HTTP {status}). You may have hit a usage limit — check your account at ollama.com, or switch models."
            ),
            429 => "Ollama usage limit reached (HTTP 429). Wait a bit, check your account at ollama.com, or switch models.".to_string(),
            _ => format!(
                "Ollama chat request failed (HTTP {status}) {}",
                body_text.chars().take(200).collect::<String>()
            ),
        };
        let _ = app.emit(
            "ollama://error",
            serde_json::json!({ "request_id": &request_id, "error": &message }),
        );
        return Err(message);
    }

    let mut full = String::new();
    let mut buffer = String::new();

    // Stream chunks as they arrive. Each chunk may contain one or more
    // newline-delimited JSON lines from Ollama; we buffer the tail of each
    // chunk in case a JSON line is split across chunks.
    //
    // `Response::chunk()` returns `Result<Option<Bytes>, reqwest::Error>`.
    // `Ok(Some(bytes))` is a chunk of body data; `Ok(None)` is end of stream;
    // `Err(e)` is a transport error.
    loop {
        let bytes = match response.chunk().await {
            Ok(Some(b)) => b,
            Ok(None) => break,
            Err(e) => {
                let _ = app.emit(
                    "ollama://error",
                    serde_json::json!({ "request_id": &request_id, "error": e.to_string() }),
                );
                return Err(e.to_string());
            }
        };

        let text = match std::str::from_utf8(&bytes) {
            Ok(s) => s,
            Err(_) => continue, // skip non-UTF8 bytes defensively
        };
        buffer.push_str(text);

        // Drain complete lines (terminated by '\n'). Anything after
        // the last newline stays in the buffer for the next chunk.
        while let Some(idx) = buffer.find('\n') {
            let line: String = buffer.drain(..=idx).collect();
            let line = line.trim_end_matches('\n').trim_end_matches('\r');
            if line.is_empty() {
                continue;
            }
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(content) = json
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str())
                {
                    full.push_str(content);
                }
                let _ = app.emit(
                    "ollama://chunk",
                    serde_json::json!({ "request_id": &request_id, "line": json }),
                );
            }
        }
    }

    // Flush any trailing data Ollama sent without a final newline.
    let tail = buffer.trim();
    if !tail.is_empty() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(tail) {
            if let Some(content) = json
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
            {
                full.push_str(content);
            }
            let _ = app.emit(
                "ollama://chunk",
                serde_json::json!({ "request_id": &request_id, "line": json }),
            );
        }
    }

    let _ = app.emit(
        "ollama://done",
        serde_json::json!({ "request_id": &request_id, "content": full }),
    );
    Ok(())
}
