use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, State};
use tokio::sync::Notify;

use crate::db::{Database, Message, Session, SessionMessages};
use crate::tools;

/// Tracks in-flight `ollama_chat_stream` requests so they can be cancelled
/// mid-stream by `ollama_cancel`. Each request registers a `CancelSlot`
/// (a latching `cancelled` flag + a `Notify` to wake the chunk-loop await);
/// cancellation sets the flag and calls `notify_waiters()`, so the Rust task
/// stops reading from Ollama immediately instead of streaming until the round
/// finishes (burning GPU / cloud quota and holding `streamChat` stuck on
/// `completionPromise`). The flag is latching so a cancel that lands while the
/// loop is processing a chunk (not awaiting) is still honored on the next
/// iteration — `notify_waiters()` alone would be lost in that microsecond gap.
#[derive(Default)]
pub struct CancelRegistry {
    inner: Mutex<HashMap<String, Arc<CancelSlot>>>,
}

/// Per-request cancellation state. `cancelled` latches the cancel so it's
/// honored even if `notify_waiters()` fires between awaits; `notify` wakes
/// the `tokio::select!` in the chunk loop when the cancel lands mid-await.
pub struct CancelSlot {
    cancelled: AtomicBool,
    notify: Notify,
}

impl CancelSlot {
    fn new() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            notify: Notify::new(),
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    /// Future that completes when `cancel()` is called. Thin wrapper so
    /// callers hold a `CancelSlot` and don't reach into the inner `Notify`.
    fn notified(&self) -> impl std::future::Future<Output = ()> + '_ {
        self.notify.notified()
    }
}

impl CancelRegistry {
    /// Insert (or reuse) the slot for `request_id` and return it. If
    /// `ollama_cancel` already ran for this id (the register race: JS set
    /// `state.requestId` and the abort fired before this command started), a
    /// pre-cancelled tombstone is already in the map and we hand that back —
    /// the stream's pre-loop `is_cancelled()` check then breaks immediately,
    /// so the round never drains Ollama.
    fn register(&self, request_id: String) -> Arc<CancelSlot> {
        let mut map = self.inner.lock().expect("cancel registry poisoned");
        map.entry(request_id)
            .or_insert_with(|| Arc::new(CancelSlot::new()))
            .clone()
    }

    /// Cancel the slot for `request_id`. If a stream is in flight, wakes its
    /// chunk-loop await and latches the flag. If no slot exists yet (register
    /// race), inserts a pre-cancelled tombstone so the about-to-start stream
    /// observes the cancel on its first `is_cancelled()` check. Returns true
    /// unless the id was already cancelled (idempotent).
    fn cancel(&self, request_id: &str) -> bool {
        let mut map = self.inner.lock().expect("cancel registry poisoned");
        let slot = map
            .entry(request_id.to_string())
            .or_insert_with(|| Arc::new(CancelSlot::new()));
        if slot.is_cancelled() {
            return false;
        }
        slot.cancel();
        true
    }
}

/// Cancel an in-flight `ollama_chat_stream` by `request_id`. Breaks the chunk
/// loop in that command (or pre-cancels it if the stream hasn't registered
/// yet), which emits `ollama://done` with whatever content was accumulated so
/// far and returns. Idempotent: a second call for an already-cancelled id is
/// a no-op.
#[tauri::command]
pub fn ollama_cancel(registry: State<'_, CancelRegistry>, request_id: String) -> bool {
    registry.cancel(&request_id)
}

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

fn resolve_ollama_base(from_settings: Option<String>) -> String {
    match from_settings {
        Some(url) if !url.trim().is_empty() => url.trim_end_matches('/').to_string(),
        _ => OLLAMA_BASE.to_string(),
    }
}

#[tauri::command]
pub async fn ollama_reachable(ollama_url: Option<String>, api_key: Option<String>) -> bool {
    let base = resolve_ollama_base(ollama_url);
    let key = resolve_ollama_key(api_key);
    let mut req = reqwest::Client::new()
        .get(format!("{base}/api/version"))
        .timeout(std::time::Duration::from_secs(2));
    if !key.is_empty() {
        req = req.header("Authorization", format!("Bearer {key}"));
    }
    match req.send().await {
        Ok(res) => res.status().is_success(),
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn ollama_list_models(
    ollama_url: Option<String>,
    api_key: Option<String>,
) -> Vec<String> {
    let base = resolve_ollama_base(ollama_url);
    let key = resolve_ollama_key(api_key);
    let mut req = reqwest::Client::new()
        .get(format!("{base}/api/tags"))
        .timeout(std::time::Duration::from_secs(5));
    if !key.is_empty() {
        req = req.header("Authorization", format!("Bearer {key}"));
    }
    let Ok(res) = req.send().await else {
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
    registry: State<'_, CancelRegistry>,
    request_id: String,
    body: serde_json::Value,
    ollama_url: Option<String>,
    api_key: Option<String>,
) -> Result<(), String> {
    let slot = registry.register(request_id.clone());
    // RAII: ensure the registry entry is removed on every exit path (done,
    // error, cancel) so a stale slot never lingers for a finished id.
    let registry_cleanup = CancelGuard {
        registry: registry.inner(),
        request_id: request_id.clone(),
    };

    let base = resolve_ollama_base(ollama_url);
    let key = resolve_ollama_key(api_key);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 30))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client
        .post(format!("{base}/api/chat"))
        .header("Content-Type", "application/json")
        .json(&body);
    if !key.is_empty() {
        req = req.header("Authorization", format!("Bearer {key}"));
    }
    let mut response = req.send().await.map_err(|e| {
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
    let mut cancelled = false;

    // Stream chunks as they arrive. Each chunk may contain one or more
    // newline-delimited JSON lines from Ollama; we buffer the tail of each
    // chunk in case a JSON line is split across chunks.
    //
    // `Response::chunk()` returns `Result<Option<Bytes>, reqwest::Error>`.
    // `Ok(Some(bytes))` is a chunk of body data; `Ok(None)` is end of stream;
    // `Err(e)` is a transport error.
    //
    // We race the next chunk against slot.notified() so ollama_cancel
    // can break us out of the await immediately — without this, the Rust task
    // keeps draining Ollama (and billing GPU / cloud quota) after Stop until
    // the round finishes.
    loop {
        // Honor a cancel that landed while we were processing the previous
        // chunk (when notify_waiters had no awaiter to wake). The flag
        // latches, so this catches the microsecond gap between iterations.
        if slot.is_cancelled() {
            cancelled = true;
            break;
        }
        let chunk = tokio::select! {
            r = response.chunk() => r,
            _ = slot.notified() => {
                cancelled = true;
                break;
            }
        };

        let bytes = match chunk {
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

    // Flush any trailing data Ollama sent without a final newline. Skipped on
    // cancel — we already broke out of the loop and don't parse more.
    if !cancelled {
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
    }

    // Emit done with whatever content accumulated. On cancel this is the
    // partial answer up to the point the user stopped; the frontend's
    // `ollama://done` listener resolves `completionPromise`, then
    // `streamChat` checks `signal.aborted` and throws to finalize the bubble.
    let _ = app.emit(
        "ollama://done",
        serde_json::json!({ "request_id": &request_id, "content": full }),
    );
    drop(registry_cleanup);
    Ok(())
}

/// RAII guard that removes a request id from the `CancelRegistry` when the
/// streaming task exits — whether by finishing, erroring, or being cancelled.
/// Without this, an early `return Err` between `register` and the final
/// `drop(registry_cleanup)` would leave a stale entry nobody will ever notify.
struct CancelGuard<'a> {
    registry: &'a CancelRegistry,
    request_id: String,
}

impl Drop for CancelGuard<'_> {
    fn drop(&mut self) {
        let mut map = self
            .registry
            .inner
            .lock()
            .expect("cancel registry poisoned");
        map.remove(&self.request_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_before_register_yields_pre_cancelled_slot() {
        let registry = CancelRegistry::default();
        let id = "req-1".to_string();
        // Stop fires before the stream's register() — cancel inserts a tombstone.
        assert!(registry.cancel(&id));
        // register() must hand back that tombstone, not a fresh slot.
        let slot = registry.register(id.clone());
        assert!(
            slot.is_cancelled(),
            "register must return the pre-cancelled slot"
        );
    }

    #[test]
    fn cancel_is_idempotent() {
        let registry = CancelRegistry::default();
        let id = "req-2".to_string();
        assert!(registry.cancel(&id), "first cancel should return true");
        assert!(
            !registry.cancel(&id),
            "second cancel for an already-cancelled id is a no-op"
        );
    }

    #[test]
    fn cancel_after_register_latches_existing_slot() {
        let registry = CancelRegistry::default();
        let id = "req-3".to_string();
        let slot = registry.register(id.clone());
        assert!(!slot.is_cancelled(), "fresh slot must not be cancelled");
        assert!(registry.cancel(&id), "cancel of a live slot returns true");
        assert!(
            slot.is_cancelled(),
            "the registered slot observes the cancel"
        );
        // The entry stays (latched), so a second cancel is a no-op.
        assert!(!registry.cancel(&id));
    }

    #[test]
    fn cancel_guard_removes_entry_on_drop() {
        let registry = CancelRegistry::default();
        let id = "req-4".to_string();
        let _slot = registry.register(id.clone());
        assert!(registry.inner.lock().unwrap().contains_key(&id));
        {
            let _guard = CancelGuard {
                registry: &registry,
                request_id: id.clone(),
            };
        }
        assert!(
            !registry.inner.lock().unwrap().contains_key(&id),
            "guard drop must remove the entry"
        );
    }

    #[test]
    fn cancel_guard_removes_tombstone_on_drop() {
        // The register-race tombstone is also cleaned by the guard, so a
        // pre-cancelled stream that starts + immediately breaks doesn't leak.
        let registry = CancelRegistry::default();
        let id = "req-5".to_string();
        registry.cancel(&id); // tombstone
        let slot = registry.register(id.clone());
        assert!(slot.is_cancelled());
        assert!(registry.inner.lock().unwrap().contains_key(&id));
        {
            let _guard = CancelGuard {
                registry: &registry,
                request_id: id.clone(),
            };
        }
        assert!(!registry.inner.lock().unwrap().contains_key(&id));
    }
}
