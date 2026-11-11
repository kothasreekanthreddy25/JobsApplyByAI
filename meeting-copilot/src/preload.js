const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('copilot', {
  on: (ch, fn) => ipcRenderer.on(ch, (_e, p) => fn(p)),
  pcm: (buf) => ipcRenderer.send('pcm', buf),
});
