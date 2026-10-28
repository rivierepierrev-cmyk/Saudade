// Electron shell: runs the bundled local Express server (web-clipper + static UI)
// on 127.0.0.1 and shows it in a window. No network service other than the
// optional "web clip" feature (fetching a URL the user types in).
// Library data lives in JSON files under <userData>/data (see store.cjs), not in
// the page's localStorage, so it doesn't depend on the port or the page origin.
const { app, BrowserWindow, shell, Menu, dialog, ipcMain, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const { createStore } = require('./store.cjs');

// Preferred port. Older versions kept the library in localStorage for this exact
// origin, so we try it first to let the one-time migration find that data.
const PREFERRED_PORT = 47653;
const HOST = '127.0.0.1';
const SNAPSHOT_CHECK_MS = 60 * 60 * 1000;

let win;
let store;

// The app used to be called Gemma, and Foliole before that. The first time Saudade
// starts, it takes over the most recent of those profiles: the library files (data/)
// and the browser storage that holds the library of the very first versions, which
// the page migrates on its own. The old folder is left untouched. Must run before
// anything uses the profile folder.
const FORMER_PROFILES = ['Gemma', 'Foliole'];

function migrateFormerProfile() {
  const target = app.getPath('userData');
  // Electron creates the (empty) profile folder before this code runs.
  const targetIsEmpty = !fs.existsSync(target) || fs.readdirSync(target).length === 0;
  if (!targetIsEmpty) return;
  const source = FORMER_PROFILES.map((name) => path.join(app.getPath('appData'), name)).find(
    (dir) => fs.existsSync(dir) && fs.readdirSync(dir).length > 0
  );
  if (!source) return;
  const partial = `${target}.migrating`;
  try {
    fs.rmSync(partial, { recursive: true, force: true });
    fs.cpSync(source, partial, {
      recursive: true,
      // Lock files of a running former version must not be copied.
      filter: (src) => !/^Singleton|^lockfile$|^LOCK$/.test(path.basename(src)),
    });
    fs.rmSync(target, { recursive: true, force: true }); // empty: see above
    fs.renameSync(partial, target);
  } catch (e) {
    fs.rmSync(partial, { recursive: true, force: true });
    console.error(`Reprise du profil ${path.basename(source)} impossible :`, e);
  }
}
migrateFormerProfile();

// Ubuntu 24.04+ (and derivatives) block the unprivileged user namespaces Chromium's
// sandbox needs, and an AppImage can't ship the setuid helper the .deb installs:
// without this the AppImage would not start at all. The window only shows Saudade's
// own pages, with imported HTML sanitized, so running it without the sandbox is an
// acceptable fallback. The .deb keeps the sandbox.
function appImageNeedsNoSandbox() {
  if (process.platform !== 'linux' || !process.env.APPIMAGE) return false;
  try {
    return fs.readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() === '1';
  } catch {
    return false;
  }
}
if (appImageNeedsNoSandbox()) app.commandLine.appendSwitch('no-sandbox');

function registerIpc() {
  ipcMain.on('saudade:load', (event) => {
    try {
      event.returnValue = store.loadAll();
    } catch (e) {
      event.returnValue = { error: String(e && e.message ? e.message : e) };
    }
  });
  ipcMain.handle('saudade:write', (_event, name, text) => {
    store.write(name, text);
  });
  ipcMain.handle('saudade:write-documents', (_event, metaText, changed) => {
    store.writeDocuments(metaText, changed);
  });
  ipcMain.handle('saudade:snapshot', (_event, reason) => store.eventSnapshot(reason));
  ipcMain.handle('saudade:open-data-folder', () => shell.openPath(store.dataDir));
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
    dialog.showErrorBox('Saudade', `Impossible d'ouvrir le dossier des données.\n\n${e}`);
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
  process.env.SAUDADE_DATA_DIR = store.dataDir;
  let port;
  try {
    const server = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'dist-electron', 'server.mjs')).href);
    port = await server.ready;
  } catch (e) {
    dialog.showErrorBox('Saudade', `Impossible de démarrer le serveur local.\n\n${e}`);
    app.quit();
    return;
  }

  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    title: 'Saudade', autoHideMenuBar: true,
    // Matches the page background while it loads (no white flash in dark mode).
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#181714' : '#faf7f2',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  win.loadURL(`http://${HOST}:${port}/`);
  // Links in documents open in the system browser instead of replacing the app.
  const appOrigin = `http://${HOST}:${port}`;
  const openExternally = (url) => { if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { openExternally(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appOrigin + '/')) { event.preventDefault(); openExternally(url); }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
}
