// Electron main process for the Cubus desktop shell.
//
// Electron is Chromium, so Web Bluetooth (gan-web-bluetooth) and getUserMedia
// (camera scanner) work — the reason we chose Electron over Tauri, whose macOS
// WKWebView has no Web Bluetooth.
//
// The catch: Electron does NOT render Chrome's native device-chooser popup. It
// fires `select-bluetooth-device` instead. So we forward the discovered devices
// to the renderer over IPC; the renderer shows its own in-window list, the user
// clicks the cube, and the choice comes back here — all in one window.

const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('node:path');

let win = null;
let btCallback = null; // pending select-bluetooth-device callback (latest)

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 880,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Fires (and re-fires) as devices are discovered. Keep the latest callback,
  // push the current list to the renderer, and wait for the user to pick.
  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    btCallback = callback;
    win.webContents.send(
      'bt:devices',
      devices.map((d) => ({ deviceId: d.deviceId, deviceName: d.deviceName || '' })),
    );
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// Renderer -> main: the user picked a device id (or '' to cancel).
ipcMain.on('bt:select', (_e, deviceId) => {
  if (btCallback) {
    btCallback(deviceId || '');
    btCallback = null;
  }
});

app.whenReady().then(() => {
  // Least privilege: allow only camera/mic (the scanner); deny everything else.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
