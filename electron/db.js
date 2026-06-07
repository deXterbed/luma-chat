const path = require('path')
const { app } = require('electron')
let db = null

function init() {
  const Database = require('better-sqlite3')
  const dbPath = path.join(app.getPath('userData'), 'luma.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
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
  `)
  // Migrate existing DBs that predate the tool_calls column
  for (const table of ['messages', 'side_chat_messages']) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN tool_calls TEXT NOT NULL DEFAULT '[]'`) } catch {}
  }
}

function loadSessions() {
  const sessions = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all()
  return sessions.map(s => {
    const messages = db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY position')
      .all(s.id)
      .map(m => ({ id: m.id, role: m.role, content: m.content, images: JSON.parse(m.images), toolCalls: JSON.parse(m.tool_calls), isStreaming: false }))

    const sideChats = db
      .prepare('SELECT * FROM side_chats WHERE session_id = ? ORDER BY position')
      .all(s.id)
      .map(sc => {
        const scMessages = db
          .prepare('SELECT * FROM side_chat_messages WHERE side_chat_id = ? ORDER BY position')
          .all(sc.id)
          .map(m => ({ id: m.id, role: m.role, content: m.content, images: JSON.parse(m.images), toolCalls: JSON.parse(m.tool_calls), isStreaming: false }))
        return { id: sc.id, model: sc.model, messages: scMessages }
      })

    const activeRow = db.prepare('SELECT id FROM side_chats WHERE session_id = ? AND is_active = 1').get(s.id)
    return {
      id: s.id, title: s.title, model: s.model,
      messages, sideChats,
      activeSideChatId: activeRow ? activeRow.id : null,
    }
  })
}

const upsertSession = db_lazy(() =>
  db.prepare('INSERT INTO sessions (id, title, model, created_at) VALUES (@id, @title, @model, @created_at) ON CONFLICT(id) DO UPDATE SET title = excluded.title, model = excluded.model')
)

function saveSession({ id, title, model }) {
  upsertSession().run({ id, title, model, created_at: Date.now() })
}

const deleteAllMessages = db_lazy(() => db.prepare('DELETE FROM messages WHERE session_id = ?'))
const insertMessage = db_lazy(() =>
  db.prepare('INSERT OR REPLACE INTO messages (id, session_id, role, content, images, tool_calls, position) VALUES (@id, @session_id, @role, @content, @images, @tool_calls, @position)')
)

function saveMessages(sessionId, messages) {
  const tx = db.transaction(() => {
    deleteAllMessages().run(sessionId)
    messages.forEach((m, i) => {
      insertMessage().run({
        id: m.id, session_id: sessionId, role: m.role,
        content: m.content, images: JSON.stringify(m.images || []),
        tool_calls: JSON.stringify(m.toolCalls || []), position: i,
      })
    })
  })
  tx()
}

function upsertSideChat(sessionId, { id, model }, position) {
  db.prepare(
    'INSERT INTO side_chats (id, session_id, model, position) VALUES (@id, @session_id, @model, @position) ON CONFLICT(id) DO UPDATE SET model = excluded.model'
  ).run({ id, session_id: sessionId, model, position })
}

const deleteAllSideChatMessages = db_lazy(() => db.prepare('DELETE FROM side_chat_messages WHERE side_chat_id = ?'))
const insertSideChatMessage = db_lazy(() =>
  db.prepare('INSERT OR REPLACE INTO side_chat_messages (id, side_chat_id, role, content, images, tool_calls, position) VALUES (@id, @side_chat_id, @role, @content, @images, @tool_calls, @position)')
)

function saveSideChatMessages(sideChatId, messages) {
  const tx = db.transaction(() => {
    deleteAllSideChatMessages().run(sideChatId)
    messages.forEach((m, i) => {
      insertSideChatMessage().run({
        id: m.id, side_chat_id: sideChatId, role: m.role,
        content: m.content, images: JSON.stringify(m.images || []),
        tool_calls: JSON.stringify(m.toolCalls || []), position: i,
      })
    })
  })
  tx()
}

function setActiveSideChat(sessionId, sideChatId) {
  db.prepare('UPDATE side_chats SET is_active = 0 WHERE session_id = ?').run(sessionId)
  if (sideChatId) {
    db.prepare('UPDATE side_chats SET is_active = 1 WHERE id = ?').run(sideChatId)
  }
}

function deleteSession(id) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

// Helper: lazily prepare a statement (db may not be init'd at module load time)
function db_lazy(factory) {
  let stmt = null
  return () => {
    if (!stmt) stmt = factory()
    return stmt
  }
}

function close() {
  if (db) db.close()
}

module.exports = { init, close, loadSessions, saveSession, saveMessages, upsertSideChat, saveSideChatMessages, setActiveSideChat, deleteSession }
