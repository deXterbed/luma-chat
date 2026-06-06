const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximized: (cb) => ipcRenderer.on('window-maximized', (_, val) => cb(val)),
})

contextBridge.exposeInMainWorld('db', {
  loadSessions: () => ipcRenderer.invoke('db:loadSessions'),
  saveSession: (session) => ipcRenderer.invoke('db:saveSession', session),
  saveMessages: (sessionId, messages) => ipcRenderer.invoke('db:saveMessages', sessionId, messages),
  deleteSession: (id) => ipcRenderer.invoke('db:deleteSession', id),
  upsertSideChat: (sessionId, sideChat, position) => ipcRenderer.invoke('db:upsertSideChat', sessionId, sideChat, position),
  saveSideChatMessages: (sideChatId, messages) => ipcRenderer.invoke('db:saveSideChatMessages', sideChatId, messages),
  setActiveSideChat: (sessionId, sideChatId) => ipcRenderer.invoke('db:setActiveSideChat', sessionId, sideChatId),
})
