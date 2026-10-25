// Bridge between the sandboxed page and the file store in the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('folioleDesktop', {
  // Loaded synchronously so the UI starts with the whole library in memory.
  initial: ipcRenderer.sendSync('foliole:load'),
  write: (name, text) => ipcRenderer.invoke('foliole:write', name, text),
  snapshot: (reason) => ipcRenderer.invoke('foliole:snapshot', reason),
  openDataFolder: () => ipcRenderer.invoke('foliole:open-data-folder'),
});
