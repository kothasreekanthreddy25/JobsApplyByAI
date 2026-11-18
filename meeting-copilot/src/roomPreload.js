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
  micPcm: (buf) => ipcRenderer.send('r:micpcm', buf),
  micState: (ok) => ipcRenderer.send('r:micstate', ok),
  onMic: (fn) => ipcRenderer.on('r:mic', (_e, p) => fn(p)),
  onReview: (fn) => ipcRenderer.on('r:review', (_e, p) => fn(p)),
  lastReview: () => call('r:lastReview'),
  openReviews: () => call('r:openReviews'),
  onSpeak: (fn) => ipcRenderer.on('r:speak', (_e, p) => fn(p)),
});
