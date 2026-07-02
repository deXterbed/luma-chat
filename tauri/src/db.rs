use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

/// Serializable session metadata (matches the JS version's return shape).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub title: String,
    pub model: String,
    pub messages: Vec<Message>,
    #[serde(rename = "sideChats")]
    pub side_chats: Vec<SideChat>,
    #[serde(rename = "activeSideChatId")]
    pub active_side_chat_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(rename = "toolCalls", default)]
    pub tool_calls: Vec<serde_json::Value>,
    #[serde(default)]
    pub position: i64,
    #[serde(rename = "isStreaming", default)]
    pub is_streaming: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SideChat {
    pub id: String,
    pub model: String,
    pub messages: Vec<Message>,
    // The side chat this one was branched from, if any. None means its
    // context is the main session chat (the original/default behavior).
    #[serde(rename = "parentSideChatId", default)]
    pub parent_side_chat_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMessages {
    pub messages: Vec<Message>,
    #[serde(rename = "sideChats")]
    pub side_chats: Vec<SideChat>,
}

/// Legacy data-dir resolution (matches the old Electron app location).
/// Used by `migrate_legacy_db()` to find an old `luma.db` to copy into the new
/// Tauri `app_data_dir()`, and by the smoke tests that read the real on-disk DB.
/// Production reads/writes via Tauri's `app_data_dir()` (see `lib.rs`), which is
/// correct on Windows where `HOME` is typically unset and this env-var probe
/// fell through to a relative `luma_data` dir.
fn dirs_next() -> String {
    if let Ok(home) = std::env::var("HOME") {
        #[cfg(target_os = "macos")]
        {
            format!("{}/Library/Application Support/Luma", home)
        }
        #[cfg(target_os = "linux")]
        {
            if let Ok(data) = std::env::var("XDG_CONFIG_HOME") {
                format!("{}/luma", data)
            } else {
                format!("{}/.config/luma", home)
            }
        }
        #[cfg(target_os = "windows")]
        {
            if let Ok(appdata) = std::env::var("APPDATA") {
                format!("{}/Luma", appdata)
            } else {
                format!("{}/AppData/Roaming/Luma", home)
            }
        }
    } else {
        "luma_data".to_string()
    }
}

/// One-time migration from the legacy `dirs_next()` DB location to Tauri's
/// `app_data_dir()`. Copies the old `luma.db` over the new one when the new one
/// is absent **or** empty (zero sessions), so existing chats survive the path
/// move. A new DB that already holds user sessions is never touched.
///
/// Best-effort: failures are swallowed so a migration hiccup never blocks app
/// launch. The legacy and new paths being identical (e.g. identifier change
/// that happens to resolve back) is a guarded no-op.
pub fn migrate_legacy_db(new_db_dir: &std::path::Path) {
    let new_path = new_db_dir.join("luma.db");
    let legacy_path = std::path::PathBuf::from(dirs_next()).join("luma.db");
    if legacy_path == new_path || !legacy_path.is_file() {
        return;
    }

    // Only migrate if the new DB has no user data to lose. A missing new DB is
    // trivially empty; an existing one is empty only if it has zero sessions.
    // If we can't open the new DB to count (locked / corrupt), treat it as
    // non-empty so we never risk clobbering real data.
    let new_is_empty = if !new_path.exists() {
        true
    } else {
        matches!(count_sessions(&new_path), Ok(0))
    };
    if !new_is_empty {
        return;
    }

    // Drop any empty new DB + WAL/SHM sidecars so the copy lands clean.
    let _ = std::fs::remove_file(&new_path);
    let _ = std::fs::remove_file(new_db_dir.join("luma.db-wal"));
    let _ = std::fs::remove_file(new_db_dir.join("luma.db-shm"));
    let _ = std::fs::create_dir_all(new_db_dir);
    let _ = std::fs::copy(&legacy_path, &new_path);
}

/// Counts rows in the `sessions` table; returns 0 if the DB/table doesn't exist.
fn count_sessions(path: &std::path::Path) -> rusqlite::Result<usize> {
    let conn = Connection::open(path)?;
    let table_exists: bool = conn.query_row(
        "SELECT count(*) > 0 FROM sqlite_master WHERE type='table' AND name='sessions'",
        [],
        |r| r.get(0),
    )?;
    if !table_exists {
        return Ok(0);
    }
    let n: i64 = conn.query_row("SELECT count(*) FROM sessions", [], |r| r.get(0))?;
    Ok(n as usize)
}

// Ordered schema migrations, gated by SQLite's built-in `PRAGMA user_version`
// (a plain integer stored in the DB file — no extra table needed). Each
// closure is the Nth migration (1-indexed); `run_migrations` only invokes the
// ones above the DB's current version, then advances the version, so a given
// migration's ALTER/UPDATE statements are attempted at most once per DB
// rather than re-attempted (and silently failing) on every app launch.
//
// Each step still wraps its SQL in `.ok()`: a DB upgraded from before this
// tracking existed may already have these columns from the old `.ok()`-swallowed
// approach, in which case `user_version` starts at 0 but the column exists —
// the ALTER fails harmlessly that one time, then the version advances and the
// statement is never attempted again.
const MIGRATIONS: &[fn(&Connection)] = &[
    |conn| {
        for table in &["messages", "side_chat_messages"] {
            conn.execute_batch(&format!(
                "ALTER TABLE {} ADD COLUMN tool_calls TEXT NOT NULL DEFAULT '[]'",
                table
            ))
            .ok();
        }
    },
    |conn| {
        conn.execute_batch("ALTER TABLE sessions ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0")
            .ok();
        conn.execute_batch("UPDATE sessions SET updated_at = created_at WHERE updated_at = 0")
            .ok();
    },
    |conn| {
        conn.execute_batch("ALTER TABLE side_chats ADD COLUMN parent_side_chat_id TEXT")
            .ok();
    },
];

fn run_migrations(conn: &Connection) {
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap_or(0);

    for (i, migration) in MIGRATIONS.iter().enumerate() {
        let step = (i + 1) as i64;
        if version < step {
            migration(conn);
            conn.pragma_update(None, "user_version", step).ok();
        }
    }
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// `dir` is the resolved app data directory (e.g. Tauri's `app_data_dir()`);
    /// `luma.db` is created inside it. Pass a dir the app has permission to write.
    pub fn new(dir: PathBuf) -> Self {
        std::fs::create_dir_all(&dir).ok();

        let mut path = dir;
        path.push("luma.db");
        let conn = Connection::open(&path).expect("Failed to open database");

        conn.pragma_update(None, "journal_mode", "WAL").ok();
        conn.pragma_update(None, "foreign_keys", "ON").ok();

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                model TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
                updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                images TEXT NOT NULL DEFAULT '[]',
                position INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS side_chats (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                model TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 0,
                position INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS side_chat_messages (
                id TEXT PRIMARY KEY,
                side_chat_id TEXT NOT NULL REFERENCES side_chats(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                images TEXT NOT NULL DEFAULT '[]',
                position INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS custom_models (
                name TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            ",
        )
        .expect("Failed to create tables");

        run_migrations(&conn);

        Database {
            conn: Mutex::new(conn),
        }
    }

    pub fn load_sessions(&self) -> Vec<Session> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, title, model, created_at, updated_at FROM sessions ORDER BY updated_at DESC")
            .unwrap();

        let sessions: Vec<Session> = stmt
            .query_map([], |row| {
                Ok(Session {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    model: row.get(2)?,
                    messages: vec![],
                    side_chats: vec![],
                    active_side_chat_id: None,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        sessions
            .into_iter()
            .map(|mut s| {
                // Load side chat stubs
                let mut sc_stmt = conn
                    .prepare(
                        "SELECT id, model, parent_side_chat_id FROM side_chats WHERE session_id = ? ORDER BY position",
                    )
                    .unwrap();
                s.side_chats = sc_stmt
                    .query_map(params![s.id], |row| {
                        Ok(SideChat {
                            id: row.get(0)?,
                            model: row.get(1)?,
                            messages: vec![],
                            parent_side_chat_id: row.get(2)?,
                        })
                    })
                    .unwrap()
                    .filter_map(|r| r.ok())
                    .collect();

                // Active side chat
                if let Ok(active) = conn.query_row(
                    "SELECT id FROM side_chats WHERE session_id = ? AND is_active = 1",
                    params![s.id],
                    |row| row.get::<_, String>(0),
                ) {
                    s.active_side_chat_id = Some(active);
                }

                s
            })
            .collect()
    }

    pub fn load_session_messages(&self, session_id: &str) -> SessionMessages {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn
            .prepare("SELECT id, role, content, images, tool_calls, position FROM messages WHERE session_id = ? ORDER BY position")
            .unwrap();

        let messages: Vec<Message> = stmt
            .query_map(params![session_id], |row| {
                let images_str: String = row.get(3)?;
                let tool_calls_str: String = row.get(4)?;
                Ok(Message {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    content: row.get(2)?,
                    images: serde_json::from_str(&images_str).unwrap_or_default(),
                    tool_calls: serde_json::from_str(&tool_calls_str).unwrap_or_default(),
                    position: row.get(5)?,
                    is_streaming: false,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let side_chats: Vec<SideChat> = {
            let mut sc_stmt = conn
                .prepare("SELECT id, model, parent_side_chat_id FROM side_chats WHERE session_id = ? ORDER BY position")
                .unwrap();

            sc_stmt
                .query_map(params![session_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .map(|(sc_id, model, parent_side_chat_id)| {
                    let mut msg_stmt = conn
                        .prepare("SELECT id, role, content, images, tool_calls, position FROM side_chat_messages WHERE side_chat_id = ? ORDER BY position")
                        .unwrap();

                    let messages: Vec<Message> = msg_stmt
                        .query_map(params![sc_id], |row| {
                            let images_str: String = row.get(3)?;
                            let tool_calls_str: String = row.get(4)?;
                            Ok(Message {
                                id: row.get(0)?,
                                role: row.get(1)?,
                                content: row.get(2)?,
                                images: serde_json::from_str(&images_str).unwrap_or_default(),
                                tool_calls: serde_json::from_str(&tool_calls_str).unwrap_or_default(),
                                position: row.get(5)?,
                                is_streaming: false,
                            })
                        })
                        .unwrap()
                        .filter_map(|r| r.ok())
                        .collect();

                    SideChat { id: sc_id, model, messages, parent_side_chat_id }
                })
                .collect()
        };

        SessionMessages {
            messages,
            side_chats,
        }
    }

    pub fn save_session(&self, id: &str, title: &str, model: &str) {
        let conn = self.conn.lock().unwrap();
        let now = chrono_now();
        conn.execute(
            "INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO UPDATE SET title = excluded.title, model = excluded.model, updated_at = excluded.updated_at",
            params![id, title, model, now, now],
        )
        .ok();
    }

    pub fn update_session_activity(&self, id: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
            params![chrono_now(), id],
        )
        .ok();
    }

    pub fn save_messages(&self, session_id: &str, messages: &[Message]) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM messages WHERE session_id = ?1",
            params![session_id],
        )
        .ok();

        for (i, m) in messages.iter().enumerate() {
            conn.execute(
                "INSERT OR REPLACE INTO messages (id, session_id, role, content, images, tool_calls, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    m.id,
                    session_id,
                    m.role,
                    m.content,
                    serde_json::to_string(&m.images).unwrap_or_default(),
                    serde_json::to_string(&m.tool_calls).unwrap_or_default(),
                    i as i64,
                ],
            )
            .ok();
        }
    }

    pub fn delete_session(&self, id: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])
            .ok();
    }

    pub fn upsert_side_chat(
        &self,
        session_id: &str,
        side_chat_id: &str,
        model: &str,
        position: i64,
        parent_side_chat_id: Option<&str>,
    ) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO side_chats (id, session_id, model, position, parent_side_chat_id) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO UPDATE SET model = excluded.model",
            params![side_chat_id, session_id, model, position, parent_side_chat_id],
        )
        .ok();
    }

    pub fn save_side_chat_messages(&self, side_chat_id: &str, messages: &[Message]) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM side_chat_messages WHERE side_chat_id = ?1",
            params![side_chat_id],
        )
        .ok();

        for (i, m) in messages.iter().enumerate() {
            conn.execute(
                "INSERT OR REPLACE INTO side_chat_messages (id, side_chat_id, role, content, images, tool_calls, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    m.id,
                    side_chat_id,
                    m.role,
                    m.content,
                    serde_json::to_string(&m.images).unwrap_or_default(),
                    serde_json::to_string(&m.tool_calls).unwrap_or_default(),
                    i as i64,
                ],
            )
            .ok();
        }
    }

    pub fn set_active_side_chat(&self, session_id: &str, side_chat_id: Option<&str>) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE side_chats SET is_active = 0 WHERE session_id = ?1",
            params![session_id],
        )
        .ok();
        if let Some(scid) = side_chat_id {
            conn.execute(
                "UPDATE side_chats SET is_active = 1 WHERE id = ?1",
                params![scid],
            )
            .ok();
        }
    }

    pub fn delete_side_chat(&self, id: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM side_chats WHERE id = ?1", params![id])
            .ok();
    }

    pub fn load_custom_models(&self) -> Vec<String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT name FROM custom_models ORDER BY created_at ASC")
            .unwrap();

        stmt.query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    }

    pub fn add_custom_model(&self, name: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO custom_models (name, created_at) VALUES (?1, ?2) ON CONFLICT(name) DO NOTHING",
            params![name, chrono_now()],
        )
        .ok();
    }

    pub fn remove_custom_model(&self, name: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM custom_models WHERE name = ?1", params![name])
            .ok();
    }

    // ── Settings (key/value) ──
    //
    // Used by the frontend's settings page. Returns a flat map of
    // key → value strings — the renderer is responsible for parsing
    // and validating each well-known key.

    pub fn load_settings(&self) -> std::collections::HashMap<String, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare("SELECT key, value FROM settings") {
            Ok(s) => s,
            Err(_) => return std::collections::HashMap::new(),
        };
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap();
        rows.filter_map(|r| r.ok()).collect()
    }

    pub fn save_setting(&self, key: &str, value: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .ok();
    }
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrations_apply_once_and_track_version() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE messages (id TEXT PRIMARY KEY);
             CREATE TABLE side_chat_messages (id TEXT PRIMARY KEY);
             CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
             CREATE TABLE side_chats (id TEXT PRIMARY KEY);",
        )
        .unwrap();

        run_migrations(&conn);
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);

        // Columns from every migration step should now exist.
        conn.execute_batch("SELECT tool_calls FROM messages")
            .unwrap();
        conn.execute_batch("SELECT updated_at FROM sessions")
            .unwrap();
        conn.execute_batch("SELECT parent_side_chat_id FROM side_chats")
            .unwrap();

        // Re-running must be a no-op: dropping the column would make a
        // re-attempted ALTER TABLE crash this test (it isn't wrapped in
        // `.ok()` here on purpose, to prove the second run never touches it).
        conn.execute_batch("ALTER TABLE side_chats DROP COLUMN parent_side_chat_id")
            .unwrap();
        run_migrations(&conn);
        let result = conn.execute_batch("SELECT parent_side_chat_id FROM side_chats");
        assert!(
            result.is_err(),
            "second run_migrations() call re-applied a migration that was already marked done"
        );
    }

    #[test]
    fn test_session_serialization() {
        let db = Database::new(PathBuf::from(dirs_next()));
        let sessions = db.load_sessions();

        let json = serde_json::to_string_pretty(&sessions[0]).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // Verify camelCase keys that the JS frontend expects
        assert!(
            parsed.get("sideChats").is_some(),
            "Session missing 'sideChats' key"
        );
        assert!(
            parsed.get("activeSideChatId").is_some() || parsed.get("activeSideChatId").is_some(),
            "Session missing 'activeSideChatId' key"
        );

        eprintln!("Session serialization test passed:");
        eprintln!("{}", &json[..json.len().min(300)]);
    }

    #[test]
    fn test_load_sessions_from_existing_db() {
        let db = Database::new(PathBuf::from(dirs_next()));
        let sessions = db.load_sessions();
        eprintln!("Found {} sessions", sessions.len());
        for s in &sessions {
            eprintln!("  Session: id={} title={}", s.id, s.title);
            let msgs = db.load_session_messages(&s.id);
            eprintln!(
                "    messages: {}, side_chats: {}",
                msgs.messages.len(),
                msgs.side_chats.len()
            );
        }
        assert!(
            !sessions.is_empty(),
            "Should have loaded sessions from existing DB"
        );
    }

    #[test]
    fn test_serialization_matches_frontend() {
        let db = Database::new(PathBuf::from(dirs_next()));
        let sessions = db.load_sessions();
        let msgs = db.load_session_messages(&sessions[0].id);

        let json = serde_json::to_string_pretty(&msgs).unwrap();

        // Verify the keys match what the JS frontend expects
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // Top-level keys
        assert!(parsed.get("messages").is_some(), "Missing 'messages' key");
        assert!(parsed.get("sideChats").is_some(), "Missing 'sideChats' key");

        // Message keys
        if let Some(msg) = parsed["messages"][0].as_object() {
            for key in &[
                "id",
                "role",
                "content",
                "images",
                "toolCalls",
                "position",
                "isStreaming",
            ] {
                assert!(msg.contains_key(*key), "Message missing key: {}", key);
            }
        }

        // SideChat keys
        if let Some(sc) = parsed["sideChats"][0].as_object() {
            for key in &["id", "model", "messages"] {
                assert!(sc.contains_key(*key), "SideChat missing key: {}", key);
            }
        }

        eprintln!("Serialization test passed. Full output (truncated):");
        eprintln!("{}", &json[..json.len().min(500)]);
    }
}
