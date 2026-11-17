const { contextBridge, ipcRenderer } = require('electron');
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('room', {
  state: () => call('r:state'),
  startNow: () => call('r:startNow'),
  admit: () => call('r:admit'),
  next: () => call('r:next'),
  end: () => call('r:end'),
  cancel: () => call('r:cancel'),
  spoken: (id) => ipcRenderer.send('r:spoken', id),
  onSpeak: (fn) => ipcRenderer.on('r:speak', (_e, p) => fn(p)),
});
