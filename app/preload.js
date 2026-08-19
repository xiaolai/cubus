// Safe IPC bridge for the Bluetooth device picker. contextIsolation is on, so
// the renderer never touches Node — it only gets these two functions.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cubusBT', {
  // main -> renderer: the current discovered-device list (fires repeatedly)
  onDevices: (cb) => ipcRenderer.on('bt:devices', (_e, devices) => cb(devices)),
  // renderer -> main: user picked a device id, or '' to cancel
  select: (deviceId) => ipcRenderer.send('bt:select', deviceId),
});
