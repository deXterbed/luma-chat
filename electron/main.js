const { app, BrowserWindow } = require('electron')
const path = require('path')
const db = require('./db')
const ipc = require('./ipc')

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0e0e10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    icon: path.join(__dirname, '../src/assets/icon.ico'),
  })

  ipc.register(win)

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  db.init()
  createWindow()
})

app.on('before-quit', () => db.close())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
