// Electron shell: runs the bundled local Express server (web-clipper + static UI)
// on 127.0.0.1 and shows it in a window. No network service other than the
// optional "web clip" feature (fetching a URL the user types in).
const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('path');

// Fixed port => stable origin => localStorage (your library) persists between launches.
const PORT = 47653;
const HOST = '127.0.0.1';

if (!app.requestSingleInstanceLock()) app.quit();

let win;
async function start() {
  process.env.NODE_ENV = 'production';
  process.env.PORT = String(PORT);
  process.env.HOST = HOST;
  process.env.STATIC_DIR = path.join(__dirname, '..', 'dist');
  try {
    await import(require('url').pathToFileURL(path.join(__dirname, '..', 'dist-electron', 'server.mjs')).href);
  } catch (e) {
    dialog.showErrorBox('Foliole', 'Impossible de démarrer le serveur local (port ' + PORT + ' occupé ?)\n\n' + e);
    app.quit();
    return;
  }
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    title: 'Foliole', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL(`http://${HOST}:${PORT}/`);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(start);
app.on('window-all-closed', () => app.quit());
