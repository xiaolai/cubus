// Electron main process for the Cubus desktop shell.
//
// Electron is Chromium, so Web Bluetooth (gan-web-bluetooth) and getUserMedia
// (camera scanner) work — the reason we chose Electron over Tauri, whose macOS
// WKWebView has no Web Bluetooth.
//
// The renderer is served over a custom `app://` scheme (not file://) so the page
// can `fetch()` its own local assets — the ONNX model and onnxruntime-web's .wasm.
// Under file:// Chromium refuses to fetch local files, which broke the AI scanner;
// app:// is a normal secure origin where fetch works, so the model + wasm load
// locally and offline (no CDN). Bluetooth/camera are origin-independent.
//
// The catch: Electron does NOT render Chrome's native device-chooser popup. It
// fires `select-bluetooth-device` instead. So we forward the discovered devices
// to the renderer over IPC; the renderer shows its own in-window list, the user
// clicks the cube, and the choice comes back here — all in one window.

const { app, BrowserWindow, session, ipcMain, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const RENDERER = path.join(__dirname, 'renderer');

// Must be declared before app is ready: make `app://` a standard, secure origin that supports
// fetch (so relative fetch('./vendor/...') and wasm streaming work like on a normal web page).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

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

  win.loadURL('app://local/index.html');
}

// Renderer -> main: the user picked a device id (or '' to cancel).
ipcMain.on('bt:select', (_e, deviceId) => {
  if (btCallback) {
    btCallback(deviceId || '');
    btCallback = null;
  }
});

app.whenReady().then(() => {
  // Serve the renderer folder over app://. net.fetch(file://) infers the correct Content-Type
  // (crucial: .mjs must be text/javascript and .wasm application/wasm, or module/stream loads fail).
  // The join+relative-prefix check keeps a crafted path from escaping the renderer dir.
  protocol.handle('app', (request) => {
    const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html';
    const filePath = path.join(RENDERER, rel);
    const relCheck = path.relative(RENDERER, filePath);
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });

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
