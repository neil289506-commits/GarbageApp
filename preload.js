const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  pick: () => ipcRenderer.invoke('pick'),
  run: (mode, file, bytes) => ipcRenderer.invoke('run', mode, file, bytes),
  electron: bytes => ipcRenderer.invoke('electron-waste', bytes),
  free: () => ipcRenderer.invoke('free'),
  onProgress: cb => ipcRenderer.on('progress', (_e, p) => cb(p))
});
