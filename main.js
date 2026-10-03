const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const addon = require('./native/build/Release/garbage.node');

let win, wasters = [];
function killWasters() { wasters.forEach(w => { if (!w.isDestroyed()) w.destroy(); }); wasters = []; }

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 980, height: 660, minWidth: 820, minHeight: 600, backgroundColor: '#d8dbd3',
    autoHideMenuBar: true, title: 'Garbage App',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  win.loadFile('index.html');
  win.on('closed', () => { killWasters(); app.quit(); });  // hidden windows would keep the app alive
});
app.on('window-all-closed', () => app.quit());

ipcMain.handle('pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('run', (_e, mode, file, bytes) => new Promise(resolve =>
  addon.run(mode, file, bytes, p => win.webContents.send('progress', p), err => resolve(err))));
ipcMain.handle('free', () => { killWasters(); addon.free(); });

// Mode 4: hidden Chromium windows, each its own renderer process hoarding random data
ipcMain.handle('electron-waste', (_e, bytes) => new Promise(resolve => {
  const total = Number(bytes);
  if (total > os.freemem()) return resolve(`Not enough free RAM. Available: ${Math.floor(os.freemem() / 2 ** 20)} MB`);
  killWasters();
  const n = Math.min(32, Math.max(1, Math.ceil(total / (512 * 2 ** 20))));
  const base = Math.floor(total / n);
  let got = 0, finished = false;
  const finish = err => { if (finished) return; finished = true; ipcMain.removeListener('waste-progress', onProg); resolve(err); };
  const onProg = (_ev, k) => {
    got += k; win.webContents.send('progress', Math.min(100, got / total * 100));
    if (got >= total) finish(null);
  };
  ipcMain.on('waste-progress', onProg);
  for (let i = 0; i < n; i++) {
    const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'waste-preload.js'), backgroundThrottling: false } });
    w.webContents.on('render-process-gone', () => { finish('A renderer ran out of memory and crashed.'); killWasters(); });
    w.loadFile('waste.html', { query: { bytes: String(i < n - 1 ? base : total - base * (n - 1)) } });
    wasters.push(w);
  }
}));
