const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('copilot', {
  on: (ch, fn) => ipcRenderer.on(ch, (_e, p) => fn(p)),
  pcm: (buf) => ipcRenderer.send('pcm', buf),
  win: (kind, p) => ipcRenderer.send('win', kind, p),
  speaking: (on) => ipcRenderer.send('speaking', on),
});
