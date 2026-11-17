const { contextBridge, ipcRenderer } = require('electron');
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('app', {
  state: () => call('s:state'),
  saveKeys: (k) => call('s:save', k),
  pick: () => call('s:pick'),
  makePrep: (o) => call('s:prep', o),
  openFolder: (w) => call('s:open', w),
  toggleSession: () => call('s:session'),
});
