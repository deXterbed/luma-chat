use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, State};
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

// ── Backup / restore ──
//
// Export/import work against a file path chosen by the frontend via the
// dialog plugin's native save/open pickers, so this file I/O stays in Rust
// (no need for the fs plugin just to read/write one file).
//
// The backup file is a small custom container (not plain JSON) so a large
// chat history doesn't produce a huge file and the format is recognizably
// Luma's own: a 4-byte magic (`LMBK`) + 1-byte format version, followed by
// gzip-compressed compact (non-pretty) JSON. `flate2` is already pulled in
// transitively (reqwest's gzip feature), so this adds no new dependency.
const BACKUP_MAGIC: &[u8; 4] = b"LMBK";
const BACKUP_FORMAT_VERSION: u8 = 1;

/// Encodes sessions into the on-disk backup container: magic + version
/// header followed by gzip-compressed compact JSON. Pure/no I/O so it's
/// unit-testable without a Tauri `State`.
fn encode_backup(sessions: &[Session]) -> Result<Vec<u8>, String> {
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

    let json = serde_json::to_vec(sessions).map_err(|e| e.to_string())?;
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&json).map_err(|e| e.to_string())?;
    let compressed = encoder.finish().map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(5 + compressed.len());
    out.extend_from_slice(BACKUP_MAGIC);
    out.push(BACKUP_FORMAT_VERSION);
    out.extend_from_slice(&compressed);
    Ok(out)
}

/// Inverse of `encode_backup`. Rejects files missing the magic header or
/// carrying a newer format version than this build understands.
fn decode_backup(bytes: &[u8]) -> Result<Vec<Session>, String> {
    use flate2::read::GzDecoder;
    use std::io::Read;

    if bytes.len() < 5 || &bytes[0..4] != BACKUP_MAGIC {
        return Err("Not a Luma backup file".to_string());
    }
    let version = bytes[4];
    if version != BACKUP_FORMAT_VERSION {
        return Err(format!("Unsupported backup format version {version}"));
    }

    let mut json = String::new();
    GzDecoder::new(&bytes[5..])
        .read_to_string(&mut json)
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_chats(db: State<Database>, path: String) -> Result<usize, String> {
    let sessions = db.export_all();
    let count = sessions.len();
    let out = encode_backup(&sessions)?;
    std::fs::write(&path, out).map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub fn import_chats(db: State<Database>, path: String) -> Result<usize, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let sessions = decode_backup(&bytes)?;
    Ok(db.import_all(&sessions))
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

// ── Agent log commands ──
//
// A structured JSONL record of what the agent loop did (see
// `src/lib/agentLog.js` for the events), for tuning the harness from evidence.
// Lines arrive already serialized from the frontend — the format is owned there
// — so there is no schema here to keep in sync: this only appends, rotates, and
// reports its own path.

/// Rotate past this size, so a log switched on and forgotten can't grow without
/// bound. One rotated file is kept.
const AGENT_LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;

fn agent_log_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("logs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn append_agent_log(app: AppHandle, lines: Vec<String>) -> Result<(), String> {
    use std::io::Write;

    let path = agent_log_dir(&app)?.join("agent.jsonl");
    rotate_agent_log_if_large(&path, AGENT_LOG_MAX_BYTES);
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    for line in lines {
        // One write per line so concurrent appends can't interleave mid-line.
        file.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        file.write_all(b"\n").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn agent_log_path(app: AppHandle) -> Result<String, String> {
    Ok(agent_log_dir(&app)?
        .join("agent.jsonl")
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
pub fn clear_agent_log(app: AppHandle) -> Result<(), String> {
    let path = agent_log_dir(&app)?.join("agent.jsonl");
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Rename `agent.jsonl` to `agent.1.jsonl` once it passes `max` bytes,
/// discarding any previous rotation.
fn rotate_agent_log_if_large(path: &std::path::Path, max: u64) {
    let Ok(meta) = std::fs::metadata(path) else {
        return;
    };
    if meta.len() < max {
        return;
    }
    let rotated = path.with_extension("1.jsonl");
    std::fs::remove_file(&rotated).ok();
    std::fs::rename(path, rotated).ok();
}

// ── Codebase (file) tool commands ──
//
// Read-only, root-bounded tools for Codebase mode (see plan.md). The roots come
// from the renderer's session state, never from the model. Each one does a
// blocking walk, so it runs through `spawn_blocking` rather than occupying an
// async-runtime thread.

#[tauri::command]
pub async fn read_file(
    app: AppHandle,
    roots: Vec<String>,
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> String {
    let roots = roots_to_paths(&app, roots);
    tauri::async_runtime::spawn_blocking(move || tools::read_file(&roots, &path, offset, limit))
        .await
        .unwrap_or_else(|e| format!("Error: file read failed ({})", e))
}

// The argument list is the `invoke()` payload shape the renderer sends — grouping
// it into a struct would change the JS call sites for no gain.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn search_code(
    app: AppHandle,
    roots: Vec<String>,
    query: String,
    path: Option<String>,
    glob: Option<String>,
    output: Option<String>,
    regex: Option<bool>,
    no_ignore: Option<bool>,
) -> String {
    let roots = roots_to_paths(&app, roots);
    tauri::async_runtime::spawn_blocking(move || {
        tools::search_code(
            &roots,
            &query,
            path.as_deref(),
            glob.as_deref(),
            output.as_deref(),
            regex.unwrap_or(false),
            no_ignore.unwrap_or(false),
        )
    })
    .await
    .unwrap_or_else(|e| format!("Error: search failed ({})", e))
}

#[tauri::command]
pub async fn list_dir(app: AppHandle, roots: Vec<String>, path: Option<String>) -> String {
    let roots = roots_to_paths(&app, roots);
    tauri::async_runtime::spawn_blocking(move || tools::list_dir(&roots, path.as_deref()))
        .await
        .unwrap_or_else(|e| format!("Error: listing failed ({})", e))
}

/// Gate for attaching a folder: returns the canonical path to store, or the
/// reason it was refused. Also re-used by the UI to mark a restored root as
/// missing, so "exists" is answered in exactly one place.
#[tauri::command]
pub fn validate_project_root(app: AppHandle, path: String) -> Result<String, String> {
    let app_data = app.path().app_data_dir().ok();
    tools::validate_root(&path, app_data.as_deref())
}

#[tauri::command]
pub fn set_project_roots(db: State<Database>, session_id: String, roots: Vec<String>) {
    db.set_project_roots(&session_id, &roots);
}

/// The roots the file tools may read from: what the renderer sent, minus any
/// path the attach flow refuses.
///
/// The DB is not a trusted source — `import_chats` writes a backup's roots
/// straight into it, and a row can be edited by hand — so the denylist is
/// re-applied on every call instead of being trusted to attach time. A refused
/// root simply reads as missing, which is the answer the UI already shows.
fn roots_to_paths(app: &AppHandle, roots: Vec<String>) -> Vec<std::path::PathBuf> {
    let app_data = app.path().app_data_dir().ok();
    roots
        .into_iter()
        .filter(|r| !tools::is_refused_root(r, app_data.as_deref()))
        .map(std::path::PathBuf::from)
        .collect()
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

/// The user-facing text for a failed Ollama chat request. Split out of the
/// streaming command so the wording — which is the whole point of this
/// function — can be asserted without a live Ollama.
fn ollama_error_message(status: u16, body: &str) -> String {
    match status {
        401 | 403 => format!(
            "Ollama rejected the request (HTTP {status}). You may have hit a usage limit — check your account at ollama.com, or switch models."
        ),
        429 => "Ollama usage limit reached (HTTP 429). Wait a bit, check your account at ollama.com, or switch models.".to_string(),
        // Ollama answers 404 for a tag it doesn't know: renamed, retired, or
        // never pulled. Reachability has already been checked by this point, so
        // this is about the model — and it's the one case where "pick another"
        // is the actual fix, which the raw body ("model not found, try pulling
        // it first") does not say usefully.
        404 => "That model isn't available on this Ollama server (HTTP 404) — it may have been renamed, removed, or never pulled. Pick another from the model menu.".to_string(),
        // Anything else keeps the provider's own text, which is the only
        // explanation available for an unanticipated failure.
        _ => format!(
            "Ollama chat request failed (HTTP {status}) {}",
            body.chars().take(200).collect::<String>()
        ),
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

/// A model's context window, from Ollama's `/api/show`.
///
/// Codebase mode uses this as the *ceiling* for the context it asks for: the
/// window is a fact about the model, and asking for more than the trained length
/// doesn't error — Ollama applies RoPE scaling and the output quietly degrades.
///
/// `None` on any failure, which the caller must treat as "do not raise": a
/// window we can't read is one we have no business exceeding.
#[tauri::command]
pub async fn ollama_model_context(
    model: String,
    ollama_url: Option<String>,
    api_key: Option<String>,
) -> Option<usize> {
    let base = resolve_ollama_base(ollama_url);
    let key = resolve_ollama_key(api_key);
    let mut req = reqwest::Client::new()
        .post(format!("{base}/api/show"))
        .timeout(std::time::Duration::from_secs(5))
        .json(&serde_json::json!({ "model": model }));
    if !key.is_empty() {
        req = req.header("Authorization", format!("Bearer {key}"));
    }
    let Ok(res) = req.send().await else {
        return None;
    };
    if !res.status().is_success() {
        return None;
    }
    let Ok(data) = res.json::<serde_json::Value>().await else {
        return None;
    };
    context_length_from_show(&data)
}

/// Pull the context window out of a `/api/show` payload. Split out so it can be
/// tested without a running Ollama.
///
/// `model_info` keys are architecture-prefixed (`gemma4.context_length`,
/// `llama.context_length`, …), so match the suffix rather than guessing the
/// architecture from the tag.
fn context_length_from_show(data: &serde_json::Value) -> Option<usize> {
    data.get("model_info")
        .and_then(|info| info.as_object())
        .and_then(|info| {
            info.iter()
                .find(|(key, _)| key.ends_with("context_length"))
                .and_then(|(_, value)| {
                    value
                        .as_u64()
                        .or_else(|| value.as_f64().map(|f| f.max(0.0) as u64))
                })
        })
        .filter(|n| *n > 0)
        .map(|n| n as usize)
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
        let message = ollama_error_message(status, &body_text);
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
    fn rotate_agent_log_keeps_one_rotated_file() {
        let dir = std::env::temp_dir().join(format!("luma_agent_log_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("agent.jsonl");

        // Under the cap: left alone.
        std::fs::write(&path, b"one\n").unwrap();
        rotate_agent_log_if_large(&path, 1024);
        assert!(path.exists());
        assert!(!dir.join("agent.1.jsonl").exists());

        // Over the cap: rotated, and a previous rotation is replaced.
        std::fs::write(&path, vec![b'x'; 2048]).unwrap();
        std::fs::write(dir.join("agent.1.jsonl"), b"stale").unwrap();
        rotate_agent_log_if_large(&path, 1024);
        assert!(!path.exists(), "log should have been rotated away");
        let rotated = std::fs::read(dir.join("agent.1.jsonl")).unwrap();
        assert_eq!(rotated.len(), 2048, "previous rotation should be replaced");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ollama_error_message_names_the_model_problem_on_404() {
        // The tag can be renamed or retired under a saved session; the message
        // has to point at the fix, not print the provider's raw JSON.
        let msg = ollama_error_message(
            404,
            "{\"error\":\"model 'x' not found, try pulling it first\"}",
        );
        assert!(msg.contains("isn't available"), "{msg}");
        assert!(msg.contains("Pick another from the model menu"), "{msg}");
        assert!(!msg.contains("{"), "raw JSON leaked: {msg}");

        // Usage-limit statuses keep their own wording.
        assert!(ollama_error_message(401, "").contains("usage limit"));
        assert!(ollama_error_message(403, "").contains("usage limit"));
        assert!(ollama_error_message(429, "").contains("usage limit reached"));

        // Anything unanticipated still surfaces the provider's text, truncated.
        let other = ollama_error_message(500, &"x".repeat(500));
        assert!(other.contains("HTTP 500"), "{other}");
        assert_eq!(other.matches('x').count(), 200, "body should be truncated");
    }

    #[test]
    fn context_length_is_read_from_the_architecture_prefixed_key() {
        // Shape verified against a live Ollama: /api/show for gemma4:31b-cloud
        // reports gemma4.context_length = 262144.
        let show = serde_json::json!({
            "model_info": {
                "gemma4.context_length": 262144,
                "general.architecture": "gemma4",
                "gemma4.attention.head_count": 32
            }
        });
        assert_eq!(context_length_from_show(&show), Some(262144));

        // Any architecture prefix, not just the one we happened to check.
        let llama = serde_json::json!({ "model_info": { "llama.context_length": 131072 } });
        assert_eq!(context_length_from_show(&llama), Some(131072));
    }

    #[test]
    fn context_length_is_none_when_absent_unreadable_or_nonsense() {
        let cases = [
            serde_json::json!({}),
            serde_json::json!({ "model_info": {} }),
            serde_json::json!({ "model_info": { "llama.block_count": 32 } }),
            // A zero window is not a window — refuse it rather than returning 0.
            serde_json::json!({ "model_info": { "llama.context_length": 0 } }),
            serde_json::json!({ "model_info": "not an object" }),
        ];
        for case in cases {
            assert_eq!(context_length_from_show(&case), None, "{case}");
        }
    }

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

    // ── backup format ──

    fn sample_sessions() -> Vec<Session> {
        vec![Session {
            id: "s1".to_string(),
            title: "Title".to_string(),
            model: "llama3".to_string(),
            project_roots: Some(vec!["/tmp/luma-project".to_string()]),
            messages: vec![Message {
                id: "m1".to_string(),
                role: "user".to_string(),
                content: "hi".to_string(),
                images: vec![],
                tool_calls: vec![],
                position: 0,
                is_streaming: false,
            }],
            side_chats: vec![],
            active_side_chat_id: None,
            created_at: 1,
            updated_at: 2,
        }]
    }

    #[test]
    fn backup_round_trip_preserves_sessions() {
        let sessions = sample_sessions();
        let encoded = encode_backup(&sessions).unwrap();
        let decoded = decode_backup(&encoded).unwrap();
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].id, "s1");
        assert_eq!(decoded[0].messages[0].content, "hi");
        // An attached project has to survive a backup/restore round trip.
        assert_eq!(
            decoded[0].project_roots,
            Some(vec!["/tmp/luma-project".to_string()])
        );
    }

    #[test]
    fn backup_is_smaller_than_pretty_json_for_repetitive_content() {
        // The whole point of the custom container is to avoid huge files for
        // chat histories, which are highly repetitive text — gzip should
        // easily beat pretty-printed JSON here.
        let mut sessions = sample_sessions();
        sessions[0].messages = (0..200)
            .map(|i| Message {
                id: format!("m{i}"),
                role: "assistant".to_string(),
                content: "the quick brown fox jumps over the lazy dog ".repeat(20),
                images: vec![],
                tool_calls: vec![],
                position: i,
                is_streaming: false,
            })
            .collect();

        let pretty_json = serde_json::to_vec_pretty(&sessions).unwrap();
        let encoded = encode_backup(&sessions).unwrap();
        assert!(
            encoded.len() < pretty_json.len() / 2,
            "expected compressed backup ({}) to be well under half the pretty JSON size ({})",
            encoded.len(),
            pretty_json.len()
        );
    }

    #[test]
    fn decode_backup_rejects_missing_magic() {
        let err = decode_backup(b"not a luma backup").unwrap_err();
        assert!(err.contains("Not a Luma backup file"));
    }

    #[test]
    fn decode_backup_rejects_future_format_version() {
        let sessions = sample_sessions();
        let mut encoded = encode_backup(&sessions).unwrap();
        encoded[4] = BACKUP_FORMAT_VERSION + 1;
        let err = decode_backup(&encoded).unwrap_err();
        assert!(err.contains("Unsupported backup format version"));
    }
}
