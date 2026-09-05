// Public browser-safe entry for gan-driver — the driver plus the pieces a UI needs.
// Node-only tooling (cli.ts, transport/blew.ts) is intentionally NOT re-exported here; only the
// Transport *type* is, so a UI can implement its own transport (Web Bluetooth, Tauri events, …).

export type { GanCubeOptions, Unsubscribe } from './driver.js';
export { GanCube } from './driver.js';
export { TinyEmitter } from './emitter.js';
export type {
  CubeBattery,
  CubeEvent,
  CubeFacelets,
  CubeGyro,
  CubeHardware,
  CubeMove,
  Face,
} from './gen4/types.js';
export { bytesToHex, hexToBytes } from './hex.js';
export { extractMacFromManufacturerData, macMatchesName } from './mac.js';
export type { Transport } from './transport/blew.js';
