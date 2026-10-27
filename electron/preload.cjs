// Bridge between the sandboxed page and the file store in the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('saudadeDesktop', {
  // Loaded synchronously so the UI starts with the whole library in memory.
  initial: ipcRenderer.sendSync('saudade:load'),
  write: (name, text) => ipcRenderer.invoke('saudade:write', name, text),
  snapshot: (reason) => ipcRenderer.invoke('saudade:snapshot', reason),
  openDataFolder: () => ipcRenderer.invoke('saudade:open-data-folder'),
});
