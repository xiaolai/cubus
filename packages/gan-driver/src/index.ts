// Public browser-safe entry for gan-driver — the driver plus the pieces a UI needs.
// Node-only tooling (cli.ts, transport/blew.ts) is intentionally NOT re-exported here; only the
// Transport *type* is, so a UI can implement its own transport (Web Bluetooth, Tauri events, …).

export { GanCube } from './driver.js';
export type { GanCubeOptions, Unsubscribe } from './driver.js';
export { extractMacFromManufacturerData, macMatchesName } from './mac.js';
export { TinyEmitter } from './emitter.js';
export { bytesToHex, hexToBytes } from './hex.js';
export type { Transport } from './transport/blew.js';
export type {
  CubeEvent,
  CubeMove,
  CubeFacelets,
  CubeGyro,
  CubeBattery,
  CubeHardware,
  Face,
} from './gen4/types.js';
