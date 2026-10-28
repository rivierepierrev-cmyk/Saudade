// Bridge between the sandboxed page and the file store in the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('saudadeDesktop', {
  // Loaded synchronously so the UI starts with the whole library in memory.
  initial: ipcRenderer.sendSync('saudade:load'),
  write: (name, text) => ipcRenderer.invoke('saudade:write', name, text),
  // Documents: the list without texts, plus the texts that changed.
  writeDocuments: (metaText, changed) => ipcRenderer.invoke('saudade:write-documents', metaText, changed),
  snapshot: (reason) => ipcRenderer.invoke('saudade:snapshot', reason),
  openDataFolder: () => ipcRenderer.invoke('saudade:open-data-folder'),
  // Automatic updates (electron/updater.cjs).
  updates: {
    get: () => ipcRenderer.invoke('saudade:update-get'),
    check: () => ipcRenderer.invoke('saudade:update-check'),
    install: () => ipcRenderer.invoke('saudade:update-install'),
    setEnabled: (enabled) => ipcRenderer.invoke('saudade:update-enabled', enabled),
    onChange: (listener) => {
      const handler = (_e, state) => listener(state);
      ipcRenderer.on('saudade:update-state', handler);
      return () => ipcRenderer.removeListener('saudade:update-state', handler);
    },
  },
  // Synchronisation through a shared folder (electron/sync.cjs).
  sync: {
    initial: ipcRenderer.sendSync('saudade:sync-initial'),
    status: () => ipcRenderer.invoke('saudade:sync-status'),
    chooseFolder: () => ipcRenderer.invoke('saudade:sync-choose-folder'),
    inspect: (folder) => ipcRenderer.invoke('saudade:sync-inspect', folder),
    enable: (folder, passphrase) => ipcRenderer.invoke('saudade:sync-enable', folder, passphrase),
    disable: () => ipcRenderer.invoke('saudade:sync-disable'),
    append: (events) => ipcRenderer.invoke('saudade:sync-append', events),
    pull: () => ipcRenderer.invoke('saudade:sync-pull'),
    ack: (token) => ipcRenderer.invoke('saudade:sync-ack', token),
    compact: (events) => ipcRenderer.invoke('saudade:sync-compact', events),
    saveMeta: (text) => ipcRenderer.invoke('saudade:sync-meta', text),
  },
});
