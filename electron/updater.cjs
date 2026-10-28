// Automatic updates from the project's GitHub releases (electron-updater): checked
// shortly after start and every 6 hours, downloaded in the background, installed
// when the app quits, or at once from the page ("Redémarrer"). The choice is kept
// per computer in <userData>/updates.json. Unavailable when not packaged (dev) and
// for the portable Windows build, which cannot replace itself.
const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 15 * 1000;

function setupUpdates(getWindow) {
  const prefsFile = path.join(app.getPath('userData'), 'updates.json');
  const prefs = (() => {
    try {
      return { enabled: true, ...JSON.parse(fs.readFileSync(prefsFile, 'utf8')) };
    } catch {
      return { enabled: true };
    }
  })();
  const savePrefs = () => fs.writeFileSync(prefsFile, JSON.stringify(prefs));

  let autoUpdater = null;
  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
  if (app.isPackaged && !portable) {
    try {
      ({ autoUpdater } = require('electron-updater'));
    } catch (e) {
      console.error('electron-updater indisponible :', e);
    }
  }

  // status: idle | checking | none | downloading | ready | error
  const state = { supported: Boolean(autoUpdater), enabled: prefs.enabled, current: app.getVersion(), status: 'idle', version: null, percent: 0, error: null };
  const publish = (patch) => {
    Object.assign(state, patch);
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('saudade:update-state', { ...state });
  };

  if (autoUpdater) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => publish({ status: 'checking', error: null }));
    autoUpdater.on('update-not-available', () => publish({ status: 'none' }));
    autoUpdater.on('update-available', (info) => publish({ status: 'downloading', version: info.version, percent: 0 }));
    autoUpdater.on('download-progress', (p) => publish({ status: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (info) => publish({ status: 'ready', version: info.version, percent: 100 }));
    autoUpdater.on('error', (e) => publish({ status: 'error', error: explain(e) }));
  }

  // electron-updater's messages are technical: the usual cases in plain words.
  const explain = (e) => {
    const msg = String((e && e.message) || e);
    if (/\b404\b/.test(msg)) return 'aucune version publiée trouvée (le dépôt GitHub doit être public et avoir une « release »).';
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::/i.test(msg)) return 'pas de connexion à GitHub.';
    return msg.split('\n')[0];
  };

  const check = () => {
    if (!autoUpdater) return;
    autoUpdater.checkForUpdates().catch((e) => publish({ status: 'error', error: explain(e) }));
  };
  if (autoUpdater) {
    setTimeout(() => state.enabled && check(), FIRST_CHECK_MS);
    setInterval(() => state.enabled && check(), CHECK_EVERY_MS);
  }

  ipcMain.handle('saudade:update-get', () => ({ ...state }));
  ipcMain.handle('saudade:update-check', () => check());
  ipcMain.handle('saudade:update-install', () => {
    if (autoUpdater && state.status === 'ready') autoUpdater.quitAndInstall();
  });
  ipcMain.handle('saudade:update-enabled', (_e, enabled) => {
    prefs.enabled = Boolean(enabled);
    savePrefs();
    if (autoUpdater) autoUpdater.autoInstallOnAppQuit = prefs.enabled;
    publish({ enabled: prefs.enabled });
    if (prefs.enabled) check();
  });
}

module.exports = { setupUpdates };
