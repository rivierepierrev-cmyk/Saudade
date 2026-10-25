// Electron shell: runs the bundled local Express server (web-clipper + static UI)
// on 127.0.0.1 and shows it in a window. No network service other than the
// optional "web clip" feature (fetching a URL the user types in).
// Library data lives in JSON files under <userData>/data (see store.cjs), not in
// the page's localStorage, so it doesn't depend on the port or the page origin.
const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const { createStore } = require('./store.cjs');

// Preferred port. Older versions kept the library in localStorage for this exact
// origin, so we try it first to let the one-time migration find that data.
const PREFERRED_PORT = 47653;
const HOST = '127.0.0.1';
const SNAPSHOT_CHECK_MS = 60 * 60 * 1000;

let win;
let store;

function registerIpc() {
  ipcMain.on('foliole:load', (event) => {
    try {
      event.returnValue = store.loadAll();
    } catch (e) {
      event.returnValue = { error: String(e && e.message ? e.message : e) };
    }
  });
  ipcMain.handle('foliole:write', (_event, name, text) => {
    store.write(name, text);
  });
  ipcMain.handle('foliole:snapshot', (_event, reason) => store.eventSnapshot(reason));
  ipcMain.handle('foliole:open-data-folder', () => shell.openPath(store.dataDir));
}

function takeDailySnapshot() {
  try {
    store.dailySnapshot();
  } catch (e) {
    console.error('Sauvegarde quotidienne impossible :', e);
  }
}

async function start() {
  try {
    store = createStore(path.join(app.getPath('userData'), 'data'));
  } catch (e) {
    dialog.showErrorBox('Foliole', `Impossible d'ouvrir le dossier des données.\n\n${e}`);
    app.quit();
    return;
  }
  registerIpc();
  takeDailySnapshot();
  setInterval(takeDailySnapshot, SNAPSHOT_CHECK_MS);

  process.env.NODE_ENV = 'production';
  process.env.PORT = String(PREFERRED_PORT);
  process.env.PORT_FALLBACK = '1';
  process.env.HOST = HOST;
  process.env.STATIC_DIR = path.join(__dirname, '..', 'dist');
  let port;
  try {
    const server = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'dist-electron', 'server.mjs')).href);
    port = await server.ready;
  } catch (e) {
    dialog.showErrorBox('Foliole', `Impossible de démarrer le serveur local.\n\n${e}`);
    app.quit();
    return;
  }

  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    title: 'Foliole', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  win.loadURL(`http://${HOST}:${port}/`);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
}
