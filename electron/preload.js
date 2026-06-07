const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),
  isMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  onMaximized: (cb) => ipcRenderer.on("window-maximized", (_, val) => cb(val)),
});

contextBridge.exposeInMainWorld("db", {
  loadSessions: () => ipcRenderer.invoke("db:loadSessions"),
  loadSessionMessages: (sessionId) =>
    ipcRenderer.invoke("db:loadSessionMessages", sessionId),
  saveSession: (session) => ipcRenderer.invoke("db:saveSession", session),
  saveMessages: (sessionId, messages) =>
    ipcRenderer.invoke("db:saveMessages", sessionId, messages),
  deleteSession: (id) => ipcRenderer.invoke("db:deleteSession", id),
  upsertSideChat: (sessionId, sideChat, position) =>
    ipcRenderer.invoke("db:upsertSideChat", sessionId, sideChat, position),
  saveSideChatMessages: (sideChatId, messages) =>
    ipcRenderer.invoke("db:saveSideChatMessages", sideChatId, messages),
  setActiveSideChat: (sessionId, sideChatId) =>
    ipcRenderer.invoke("db:setActiveSideChat", sessionId, sideChatId),
  deleteSideChat: (id) => ipcRenderer.invoke("db:deleteSideChat", id),
});

// Web tools (Phase 1b) — bridge from renderer to main process.
// Both methods return strings suitable for use as `role: "tool"` content
// in the Ollama API. Errors come back as "Error: ..." strings.
contextBridge.exposeInMainWorld("webTools", {
  search: (query, maxResults) =>
    ipcRenderer.invoke("web:search", query, maxResults),
  fetch: (url) => ipcRenderer.invoke("web:fetch", url),
});
