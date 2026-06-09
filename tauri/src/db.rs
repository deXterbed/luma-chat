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
    pub images: Vec<String>,
    #[serde(rename = "toolCalls")]
    pub tool_calls: Vec<serde_json::Value>,
    pub position: i64,
    #[serde(rename = "isStreaming")]
    pub is_streaming: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SideChat {
    pub id: String,
    pub model: String,
    pub messages: Vec<Message>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMessages {
    pub messages: Vec<Message>,
    #[serde(rename = "sideChats")]
    pub side_chats: Vec<SideChat>,
}

/// Lazily resolved DB path — uses Tauri's app data dir.
fn db_path() -> PathBuf {
    let dir = dirs_next();
    let mut path = PathBuf::from(dir);
    path.push("luma.db");
    path
}

fn dirs_next() -> String {
    // Use the same directory as the old Electron app so existing data is preserved.
    // Electron uses the app's productName ("Luma") for the directory.
    if let Ok(home) = std::env::var("HOME") {
        #[cfg(target_os = "macos")]
        {
            format!("{}/Library/Application Support/Luma", home)
        }
        #[cfg(target_os = "linux")]
        {
            // Electron on Linux uses XDG config dir with the app name
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

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> Self {
        let dir = dirs_next();
        std::fs::create_dir_all(&dir).ok();

        let path = db_path();
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
            ",
        )
        .expect("Failed to create tables");

        // Migrations: add columns if they don't exist
        for table in &["messages", "side_chat_messages"] {
            conn.execute_batch(&format!(
                "ALTER TABLE {} ADD COLUMN tool_calls TEXT NOT NULL DEFAULT '[]'",
                table
            ))
            .ok();
        }
        conn.execute_batch("ALTER TABLE sessions ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0")
            .ok();
        conn.execute_batch("UPDATE sessions SET updated_at = created_at WHERE updated_at = 0")
            .ok();

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
                        "SELECT id, model FROM side_chats WHERE session_id = ? ORDER BY position",
                    )
                    .unwrap();
                s.side_chats = sc_stmt
                    .query_map(params![s.id], |row| {
                        Ok(SideChat {
                            id: row.get(0)?,
                            model: row.get(1)?,
                            messages: vec![],
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
                .prepare("SELECT id, model FROM side_chats WHERE session_id = ? ORDER BY position")
                .unwrap();

            sc_stmt
                .query_map(params![session_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .map(|(sc_id, model)| {
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

                    SideChat { id: sc_id, model, messages }
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
    ) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO side_chats (id, session_id, model, position) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET model = excluded.model",
            params![side_chat_id, session_id, model, position],
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
    fn test_session_serialization() {
        let db = Database::new();
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
        let db = Database::new();
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
        let db = Database::new();
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
