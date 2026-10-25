// Bridge between the sandboxed page and the file store in the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gemmaDesktop', {
  // Loaded synchronously so the UI starts with the whole library in memory.
  initial: ipcRenderer.sendSync('gemma:load'),
  write: (name, text) => ipcRenderer.invoke('gemma:write', name, text),
  snapshot: (reason) => ipcRenderer.invoke('gemma:snapshot', reason),
  openDataFolder: () => ipcRenderer.invoke('gemma:open-data-folder'),
});
