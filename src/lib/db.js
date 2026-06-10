// Renderer-side DB client — wraps Tauri invoke calls.
// Falls back gracefully in browser/dev contexts where Tauri isn't available.

const isTauri = typeof window !== "undefined" && window.__TAURI_INTERNALS__;

async function invoke(cmd, args = {}) {
  if (!isTauri) return null;
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke(cmd, args);
}

const noop = async () => {};

export const db = {
  loadSessions: () => invoke("load_sessions").then((r) => r ?? []),
  loadSessionMessages: (sid) =>
    invoke("load_session_messages", { sessionId: sid }).then(
      (r) => r ?? { messages: [], sideChats: [] },
    ),
  saveSession: (s) => invoke("save_session", { id: s.id, title: s.title, model: s.model }).catch(noop),
  updateSessionActivity: (id) =>
    invoke("update_session_activity", { id }).catch(noop),
  saveMessages: (sid, msgs) =>
    invoke("save_messages", { sessionId: sid, messages: msgs }).catch(noop),
  deleteSession: (id) => invoke("delete_session", { id }).catch(noop),
  upsertSideChat: (sid, sc, pos) =>
    invoke("upsert_side_chat", {
      sessionId: sid,
      sideChat: { id: sc.id, model: sc.model },
      position: pos,
    }).catch(noop),
  saveSideChatMessages: (scid, msgs) =>
    invoke("save_side_chat_messages", {
      sideChatId: scid,
      messages: msgs,
    }).catch(noop),
  setActiveSideChat: (sid, scid) =>
    invoke("set_active_side_chat", {
      sessionId: sid,
      sideChatId: scid,
    }).catch(noop),
  deleteSideChat: (id) => invoke("delete_side_chat", { id }).catch(noop),
  loadCustomModels: () => invoke("load_custom_models").then((r) => r ?? []),
  addCustomModel: (name) => invoke("add_custom_model", { name }).catch(noop),
  removeCustomModel: (name) =>
    invoke("remove_custom_model", { name }).catch(noop),
};
