// Renderer-side DB client — wraps window.db IPC calls
// Falls back gracefully in browser/dev contexts where window.db isn't available

const api = typeof window !== "undefined" && window.db ? window.db : null;

const noop = async () => {};

export const db = {
  loadSessions: api ? () => api.loadSessions() : async () => [],
  loadSessionMessages: api
    ? (sid) => api.loadSessionMessages(sid)
    : async () => ({ messages: [], sideChats: [] }),
  saveSession: api ? (s) => api.saveSession(s) : noop,
  saveMessages: api ? (sid, msgs) => api.saveMessages(sid, msgs) : noop,
  deleteSession: api ? (id) => api.deleteSession(id) : noop,
  upsertSideChat: api
    ? (sid, sc, pos) => api.upsertSideChat(sid, sc, pos)
    : noop,
  saveSideChatMessages: api
    ? (scid, msgs) => api.saveSideChatMessages(scid, msgs)
    : noop,
  setActiveSideChat: api
    ? (sid, scid) => api.setActiveSideChat(sid, scid)
    : noop,
  deleteSideChat: api ? (id) => api.deleteSideChat(id) : noop,
};
