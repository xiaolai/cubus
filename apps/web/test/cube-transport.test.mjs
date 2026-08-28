// Unit tests for the transport seam (apps/web/lib/cube-transport.js).
//
// These lock in the two defects an inline <script> hid from every gate:
//  - packets that arrive before the driver subscribes must be BUFFERED, not dropped
//    (the "never drop a move" invariant), and
//  - the Tauri command/event contract must match the Rust backend exactly.
// The factories take their host object by argument, so we inject mocks — no globals, no hardware.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeTauriTransport, makeWebBluetoothTransport } from '../lib/cube-transport.js';

const tick = () => new Promise((r) => setTimeout(r, 0)); // let queued microtasks flush

function mockTauri() {
  const listeners = {};
  const invocations = [];
  return {
    invocations,
    emitPacket: (hex) => listeners['cube-packet']?.({ payload: hex }),
    emitDisconnect: () => listeners['cube-disconnect']?.(),
    api: {
      event: {
        listen: async (name, handler) => {
          listeners[name] = handler;
          return () => {
            delete listeners[name];
          };
        },
      },
      core: {
        invoke: async (cmd, args) => {
          invocations.push({ cmd, args });
          if (cmd === 'connect_cube') return { name: 'GAN-test', mac: 'AA:BB:CC:DD:EE:FF' };
          return undefined;
        },
      },
    },
  };
}

test('tauri: buffers packets that arrive before subscribe(), flushed in order', async () => {
  const m = mockTauri();
  const t = makeTauriTransport(m.api);
  await t.start();
  m.emitPacket('aa'); // BEFORE subscribe — must be buffered
  m.emitPacket('bb');
  const bus = t.subscribe();
  const got = [];
  bus.on('packet', (hex) => got.push(hex));
  m.emitPacket('cc'); // after subscribe but before the flush — still ordered
  await tick();
  assert.deepEqual(got, ['aa', 'bb', 'cc']); // nothing dropped, order preserved
});

test('tauri: write invokes write_fff5 with the camelCased hexData arg', async () => {
  const m = mockTauri();
  const t = makeTauriTransport(m.api);
  await t.start();
  await t.write('FFF5', 'deadbeef');
  const w = m.invocations.find((i) => i.cmd === 'write_fff5');
  assert.ok(w, 'write_fff5 was invoked');
  assert.deepEqual(w.args, { hexData: 'deadbeef' });
});

test('tauri: disconnect awaits disconnect_cube and unlistens', async () => {
  const m = mockTauri();
  const t = makeTauriTransport(m.api);
  await t.start();
  await t.disconnect();
  assert.ok(m.invocations.some((i) => i.cmd === 'disconnect_cube'));
  const bus = t.subscribe();
  let got = 0;
  bus.on('packet', () => got++);
  m.emitPacket('aa'); // handler removed by disconnect → dropped
  await tick();
  assert.equal(got, 0);
});

test('tauri: forwards cube-disconnect as a close event', async () => {
  const m = mockTauri();
  const t = makeTauriTransport(m.api);
  await t.start();
  const bus = t.subscribe();
  let closed = null;
  bus.on('close', (c) => (closed = c));
  m.emitDisconnect();
  assert.equal(closed, 0);
});

function mockBluetooth() {
  let notifyHandler = null;
  const writeChar = {
    writeValueWithoutResponse: async (bytes) => {
      writeChar.lastWrite = bytes;
    },
  };
  const notifyChar = {
    addEventListener: (ev, h) => {
      if (ev === 'characteristicvaluechanged') notifyHandler = h;
    },
    removeEventListener: () => {
      notifyHandler = null;
    },
    startNotifications: async () => {},
  };
  const svc = { getCharacteristic: async (uuid) => (uuid === 0xfff6 ? notifyChar : writeChar) };
  const server = {
    getPrimaryService: async () => svc,
    disconnect: () => {
      server.disconnected = true;
    },
  };
  const device = {
    gatt: { connect: async () => server },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return {
    server,
    writeChar,
    api: { requestDevice: async () => device },
    emitNotify: (bytes) => notifyHandler?.({ target: { value: { byteLength: bytes.length, getUint8: (i) => bytes[i] } } }),
  };
}

test('web bluetooth: buffers + forwards notifications as hex, and writes raw bytes', async () => {
  const m = mockBluetooth();
  const t = makeWebBluetoothTransport(m.api);
  await t.start();
  m.emitNotify([0xaa, 0x01]); // before subscribe → buffered
  const bus = t.subscribe();
  const got = [];
  bus.on('packet', (hex) => got.push(hex));
  await tick();
  assert.deepEqual(got, ['aa01']);
  await t.write('FFF5', 'deadbeef');
  assert.deepEqual(Array.from(m.writeChar.lastWrite), [0xde, 0xad, 0xbe, 0xef]);
});

test('web bluetooth: disconnect tears down the server', async () => {
  const m = mockBluetooth();
  const t = makeWebBluetoothTransport(m.api);
  await t.start();
  await t.disconnect();
  assert.equal(m.server.disconnected, true);
});
