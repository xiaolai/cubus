// Transport seam for the browser-safe gan-driver.
//
// The driver decodes packets identically everywhere; only how packets ARRIVE differs by host.
// In the Tauri app, native Rust BLE (crates/gan-ble) forwards each FFF6 notification as a
// `cube-packet` event. In a Chromium browser, navigator.bluetooth talks to the cube directly.
// Both implement the driver's Transport interface (see packages/gan-driver/src/transport/blew.ts):
//   subscribe(char) -> EventEmitter emitting 'packet'(hex, ts) / 'close'(code)
//   write(char, hex): Promise<void>   read(char): Promise<string>   disconnect(): Promise<void>
//
// Extracted from index.html so it can be unit-tested against mocked Tauri / Web Bluetooth
// (see ../test/cube-transport.test.mjs) — the subscribe/notify race and the reconnect
// ordering are exactly the kind of defect an inline <script> hides from every gate.

import { TinyEmitter } from '../vendor/gan-driver.js';

const GAN_SERVICE = 0xfff0;
const GAN_NOTIFY = 0xfff6;
const GAN_WRITE = 0xfff5;

// A packet bus that BUFFERS notifications until the driver attaches its consumer.
//
// Both transports must enable notifications before the driver calls subscribe() + on('packet')
// (Tauri emits as soon as connect_cube subscribes; Web Bluetooth streams once notifications are
// on). Without buffering, any packet in that window is emitted to a bus with no listener and
// vanishes — and since the driver takes the first serial it sees as its gap baseline, a dropped
// early move is never reported. That breaks the project's "never drop a move" invariant. Here,
// packets that arrive before consume() are queued and flushed in order once the driver's
// listener is in place (it attaches synchronously right after subscribe() returns, so a
// microtask flush lands after the attach).
function makeBus() {
  const bus = new TinyEmitter();
  let live = false;
  let queue = [];
  return {
    bus,
    push(hex, ts) {
      if (live) bus.emit('packet', hex, ts);
      else queue.push([hex, ts]);
    },
    close(code) {
      bus.emit('close', code);
    },
    consume() {
      queueMicrotask(() => {
        for (const [hex, ts] of queue) bus.emit('packet', hex, ts);
        queue = [];
        live = true;
      });
      return bus;
    },
  };
}

// Convert a DataView (Web Bluetooth notification value) to a lowercase hex string.
function viewToHex(dv) {
  let hex = '';
  for (let i = 0; i < dv.byteLength; i++) hex += dv.getUint8(i).toString(16).padStart(2, '0');
  return hex;
}

function hexToBytes(hex) {
  const pairs = hex.match(/../g) || [];
  return Uint8Array.from(pairs.map((h) => Number.parseInt(h, 16)));
}

// Tauri: relay Rust `cube-packet` / `cube-disconnect` events onto the driver's Transport.
export function makeTauriTransport(tauri = globalThis.window && globalThis.window.__TAURI__) {
  const T = tauri;
  const m = makeBus();
  let offPacket = null;
  let offDisc = null;
  return {
    // Register listeners BEFORE connect_cube runs so no notification is missed; buffering then
    // holds them until the driver attaches.
    async start() {
      offPacket = await T.event.listen('cube-packet', (e) => m.push(e.payload, performance.now()));
      offDisc = await T.event.listen('cube-disconnect', () => m.close(0));
    },
    subscribe() {
      return m.consume();
    },
    async write(_char, hex) {
      await T.core.invoke('write_fff5', { hexData: hex });
    },
    async read() {
      throw new Error('read not supported over the Tauri transport');
    },
    // Awaitable so a reconnect can wait for the native teardown before scanning again.
    async disconnect() {
      try {
        await T.core.invoke('disconnect_cube');
      } catch {}
      try {
        if (offPacket) offPacket();
      } catch {}
      try {
        if (offDisc) offDisc();
      } catch {}
    },
  };
}

// Web Bluetooth: GATT notifications on FFF6 -> 'packet'; writes go to FFF5. FFF5/FFF6 live under
// the 0xFFF0 service (btleplug finds chars directly; Web Bluetooth needs the service named in
// optionalServices to reach them).
export function makeWebBluetoothTransport(bluetooth = globalThis.navigator && globalThis.navigator.bluetooth) {
  const m = makeBus();
  let device = null;
  let server = null;
  let writeChar = null;
  let notifyChar = null;
  let onNotify = null;
  let onGattDisc = null;
  return {
    async start() {
      device = await bluetooth.requestDevice({
        filters: [{ namePrefix: 'GAN' }],
        optionalServices: [GAN_SERVICE],
      });
      onGattDisc = () => m.close(0);
      device.addEventListener('gattserverdisconnected', onGattDisc);
      server = await device.gatt.connect();
      const svc = await server.getPrimaryService(GAN_SERVICE);
      notifyChar = await svc.getCharacteristic(GAN_NOTIFY);
      writeChar = await svc.getCharacteristic(GAN_WRITE);
      onNotify = (ev) => m.push(viewToHex(ev.target.value), performance.now());
      notifyChar.addEventListener('characteristicvaluechanged', onNotify);
      await notifyChar.startNotifications();
    },
    subscribe() {
      return m.consume();
    },
    async write(_char, hex) {
      await writeChar.writeValueWithoutResponse(hexToBytes(hex));
    },
    async read() {
      throw new Error('read not used over the Web Bluetooth transport');
    },
    // Awaitable + removes the listeners it added, so a reconnect starts clean.
    async disconnect() {
      try {
        if (notifyChar && onNotify) notifyChar.removeEventListener('characteristicvaluechanged', onNotify);
      } catch {}
      try {
        if (device && onGattDisc) device.removeEventListener('gattserverdisconnected', onGattDisc);
      } catch {}
      try {
        if (server) server.disconnect();
      } catch {}
    },
  };
}
