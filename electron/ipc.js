const { ipcMain } = require("electron");
const db = require("./db");
const webTools = require("./tools");

function register(win) {
  // Window controls
  ipcMain.on("window-minimize", () => win.minimize());
  ipcMain.on("window-maximize", () =>
    win.isMaximized() ? win.unmaximize() : win.maximize(),
  );
  ipcMain.on("window-close", () => win.close());
  ipcMain.handle("window-is-maximized", () => win.isMaximized());

  win.on("maximize", () => win.webContents.send("window-maximized", true));
  win.on("unmaximize", () => win.webContents.send("window-maximized", false));

  // DB — sessions
  ipcMain.handle("db:loadSessions", () => db.loadSessions());
  ipcMain.handle("db:loadSessionMessages", (_, sessionId) =>
    db.loadSessionMessages(sessionId),
  );
  ipcMain.handle("db:saveSession", (_, session) => db.saveSession(session));
  ipcMain.handle("db:saveMessages", (_, sessionId, messages) =>
    db.saveMessages(sessionId, messages),
  );
  ipcMain.handle("db:deleteSession", (_, id) => db.deleteSession(id));

  // DB — side chats
  ipcMain.handle("db:upsertSideChat", (_, sessionId, sideChat, position) =>
    db.upsertSideChat(sessionId, sideChat, position),
  );
  ipcMain.handle("db:saveSideChatMessages", (_, sideChatId, messages) =>
    db.saveSideChatMessages(sideChatId, messages),
  );
  ipcMain.handle("db:setActiveSideChat", (_, sessionId, sideChatId) =>
    db.setActiveSideChat(sessionId, sideChatId),
  );
  ipcMain.handle("db:deleteSideChat", (_, id) => db.deleteSideChat(id));

  // DB — custom models (user-added entries that show in the model dropdown
  // alongside locally-pulled Ollama models; persist across sessions).
  ipcMain.handle("db:loadCustomModels", () => db.loadCustomModels());
  ipcMain.handle("db:addCustomModel", (_, name) => db.addCustomModel(name));
  ipcMain.handle("db:removeCustomModel", (_, name) =>
    db.removeCustomModel(name),
  );

  // Web tools (Phase 1b) — search and fetch for the research workbench.
  // Both return string content suitable for `role: "tool"` messages.
  ipcMain.handle("web:search", (_, query, maxResults) =>
    webTools.searchWeb(query, maxResults),
  );
  ipcMain.handle("web:fetch", (_, url) => webTools.fetchPage(url));
}

module.exports = { register };
