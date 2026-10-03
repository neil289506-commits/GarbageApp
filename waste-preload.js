const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('wasteApi', { report: n => ipcRenderer.send('waste-progress', n) });
