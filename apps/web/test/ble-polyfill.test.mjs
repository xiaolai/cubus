// The polyfill is the only new code between a real cube and a decoder nobody here has run.
//
// Every capture upstream ships was recorded through upstream's OWN Bluetooth mock, so their suite
// proves their decoders and says nothing about our transport. This drives the same twelve captures
// through OUR `navigator.bluetooth` — our device, server, service and characteristic objects, our
// notification path — into the real protocol layer from vendor/smartcube.js, and demands the same
// events their fixtures recorded from real hardware.
//
// That is why the fixtures are vendored rather than imported: upstream's `files` list ships `dist`
// and `src` but NOT `captures/`, so the package in node_modules has none of them. See
// test/fixtures/smartcube/PROVENANCE.md.
//
// Six protocol families, no radio, no cube.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CALLED_SURFACE, DELIBERATELY_ABSENT, canonicalUuid, createBluetooth, installBluetooth } from '../lib/ble-polyfill.js';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/smartcube/', import.meta.url));

// The library's `now()` reads window.performance. A browser and every webview always have one;
// node does not, so the shim exists for this file only and is not a polyfill concern.
if (typeof globalThis.window === 'undefined') globalThis.window = { performance: globalThis.performance };

const hexToBytes = (hex) => Uint8Array.from((hex.match(/../g) ?? []).map((h) => Number.parseInt(h, 16)));
const bytesToHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

function loadFixtures() {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const fx = JSON.parse(readFileSync(FIXTURE_DIR + f, 'utf8'));
      assert.equal(fx.format, 'smartcube-fixture', `${f}: unexpected fixture format`);
      assert.equal(fx.version, 1, `${f}: unexpected fixture version`);
      return { file: f, fx };
    });
}

/**
 * Replays a capture's recorded GATT conversation.
 *
 * Semantics deliberately mirror upstream's TrafficReplayer: reads and writes consume entries in
 * order and must match; notifications encountered on the way are delivered, or held until a sink
 * exists; after each I/O, notifications are flushed up to the next I/O. A write whose payload
 * differs from the recording is an error, not a shrug — it means the protocol layer said something
 * different to the cube than it said when the capture was taken.
 */
class Replayer {
  constructor(traffic, { maxAutoFlush = 200 } = {}) {
    this.traffic = traffic;
    this.i = 0;
    this.sinks = new Map();
    this.pending = new Map();
    this.maxAutoFlush = maxAutoFlush;
  }

  static key(service, characteristic) {
    return `${service}|${characteristic ?? ''}`;
  }

  registerSink(service, characteristic, sink) {
    const k = Replayer.key(service, characteristic);
    this.sinks.set(k, sink);
    const held = this.pending.get(k);
    if (held?.length) {
      for (const b of held) sink(b);
      this.pending.delete(k);
    }
  }

  unregisterSink(service, characteristic) {
    this.sinks.delete(Replayer.key(service, characteristic));
  }

  _emit(entry) {
    const k = Replayer.key(entry.service, entry.characteristic);
    const bytes = hexToBytes(entry.data ?? '');
    const sink = this.sinks.get(k);
    if (sink) sink(bytes);
    else this.pending.set(k, [...(this.pending.get(k) ?? []), bytes]);
  }

  _consumeUntil(op, service, characteristic, expectHex) {
    while (this.i < this.traffic.length) {
      const e = this.traffic[this.i++];
      if (e.op === 'marker' || e.op === 'discover-service' || e.op === 'discover-char') continue;
      if (e.op === 'notify') {
        this._emit(e);
        continue;
      }
      const match = e.op === op && e.service === service && (e.characteristic ?? null) === (characteristic ?? null);
      if (!match) {
        throw new Error(
          `traffic diverged: wanted ${op} ${service} ${characteristic ?? ''} but saw ` +
            `${e.op} ${e.service} ${e.characteristic ?? ''} at index ${this.i - 1}`,
        );
      }
      if (expectHex !== undefined && (e.data ?? '').toUpperCase() !== expectHex.toUpperCase()) {
        throw new Error(
          `write payload mismatch at index ${this.i - 1}\n  expected ${e.data}\n  actual   ${expectHex}`,
        );
      }
      this._flushToNextIo();
      return e;
    }
    throw new Error(`fixture ended before ${op} ${service} ${characteristic ?? ''} (${this.i}/${this.traffic.length})`);
  }

  _flushToNextIo() {
    let flushed = 0;
    while (this.i < this.traffic.length) {
      const next = this.traffic[this.i];
      if (next.op === 'notify') {
        if (flushed >= this.maxAutoFlush) return;
        this.i++;
        this._emit(next);
        flushed++;
        continue;
      }
      if (next.op === 'marker' || next.op === 'discover-service' || next.op === 'discover-char') {
        this.i++;
        continue;
      }
      return;
    }
  }

  read(service, characteristic) {
    return hexToBytes(this._consumeUntil('read', service, characteristic).data ?? '');
  }

  write(service, characteristic, bytes) {
    this._consumeUntil('write', service, characteristic, bytesToHex(bytes));
  }

  async drain({ chunk = 500 } = {}) {
    let n = 0;
    while (this.i < this.traffic.length) {
      const e = this.traffic[this.i++];
      if (e.op === 'notify') this._emit(e);
      if (++n >= chunk) {
        n = 0;
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }
}

/**
 * How many notifications may be delivered DURING connect(), per protocol.
 *
 * Zero by default, and that default is the interesting half. A notification delivered before the
 * caller subscribes to `events$` is gone — rxjs Subjects do not replay — so auto-flushing the
 * stream during connect() silently empties the very evidence this file exists to check. Upstream
 * hit the same wall and solved it the same way (`maxAutoFlushNotifies: 0`, with the note "keep
 * them for post-connect subscription").
 *
 * A protocol appears here ONLY when its handshake genuinely awaits a reply from the cube, and the
 * number is the smallest that lets connect() finish. Each is a statement about that protocol, not
 * a knob to turn until the test goes green.
 */
const CONNECT_NOTIFY_ALLOWANCE = { __default: 0 };

/**
 * Captures that cannot be replayed at the connect level, and exactly why.
 *
 * Not a skip list. Each entry is asserted to fail in the stated WAY, so a capture that starts
 * working, or starts failing differently, is visible instead of absorbed. Deleting the fixture
 * would be the other option and it is worse: the capture is still real hardware evidence, and its
 * sibling is what proves the divergence is the recording's and not ours.
 */
const NOT_CONNECT_REPLAYABLE = {
  'fixture_WCU_MY32_A388_moyu32_2026-04-14T11-35-43.json': {
    // The protocol re-sends its first write where this recording has a different second one, so
    // the conversation diverges at the second I/O. Raising the connect-time notification
    // allowance does not fix it and at 4+ breaks a capture that passes — so it is not a
    // handshake-reply problem either.
    //
    // Not a transport defect: the SAME protocol and the SAME device (CF:30:16:00:A3:88) replay
    // correctly from the 2026-04-15 capture, and MY33 replays too. Upstream reaches the same
    // conclusion by omission — its FIXTURES registry names the 04-15 capture and no test anywhere
    // references this one.
    reason: 'protocol repeats its first write; recording expects a different second write',
    failsWith: /write payload mismatch/,
  },
};

/** Our bridge contract, served from a capture. This is the shape crates/cube-ble must implement. */
function makeFixtureBridge(fx, maxAutoFlush, deviceId, manufacturerData = {}) {
  const replayer = new Replayer(fx.traffic, { maxAutoFlush });
  const topology = new Map(); // service -> Set(characteristic)
  for (const e of fx.traffic) {
    if (!e.service || e.op === 'marker') continue;
    if (!topology.has(e.service)) topology.set(e.service, new Set());
    if (e.characteristic) topology.get(e.service).add(e.characteristic);
  }

  let onNotify = () => {};
  let onDisc = () => {};

  return {
    replayer,
    bridge: {
      requestDevice: async () => ({ id: deviceId, name: fx.device.name, manufacturerData }),
      connect: async () => {},
      disconnect: async () => {},
      discoverServices: async () => [...topology.keys()],
      discoverCharacteristics: async (_id, service) =>
        [...(topology.get(service) ?? [])].map((uuid) => ({
          // Permissive, exactly as upstream's mock is: the recorded traffic, not a property bit,
          // is what decides whether an operation was legal on real hardware.
          uuid,
          properties: { read: true, write: true, writeWithoutResponse: true, notify: true, indicate: false },
        })),
      subscribe: async (_id, service, characteristic) => {
        // HEX, exactly as the real Tauri bridge sends it. Handing over a Uint8Array here would
        // make these tests kinder than production — which is precisely how a hex-decoding bug in
        // toDataView survived a green suite.
        replayer.registerSink(service, characteristic, (bytes) =>
          onNotify({ device: deviceId, service, characteristic, bytes: bytesToHex(bytes) }),
        );
      },
      unsubscribe: async (_id, service, characteristic) => replayer.unregisterSink(service, characteristic),
      read: async (_id, service, characteristic) => bytesToHex(replayer.read(service, characteristic)),
      write: async (_id, service, characteristic, bytes) => replayer.write(service, characteristic, bytes),
      onNotification: (cb) => {
        onNotify = cb;
      },
      onDisconnect: (cb) => {
        onDisc = cb;
      },
      _fireDisconnect: () => onDisc({ device: deviceId }),
    },
  };
}

/** Yield the event loop enough times for async decode to finish emitting. */
async function settle(ticks = 10) {
  for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 0));
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(message)), ms);
    }),
  ]);
}

/**
 * A minimal bridge for the polyfill's own unit tests.
 *
 * One fixture instead of three near-identical literals: the copies had already started to drift,
 * and each new lifecycle or error case had to be added to all of them or silently covered only one.
 */
function makeUnitBridge({ characteristics = [{ uuid: '0000fff6-0000-1000-8000-00805f9b34fb', properties: { notify: true } }] } = {}) {
  const state = { notify: null };
  const bridge = {
    requestDevice: async () => ({ id: 'd', name: 'x' }),
    connect: async () => {},
    disconnect: async () => {},
    discoverServices: async () => ['0000fff0-0000-1000-8000-00805f9b34fb'],
    discoverCharacteristics: async () => characteristics,
    subscribe: async () => {},
    unsubscribe: async () => {},
    read: async () => '',
    write: async () => {},
    onNotification: (cb) => {
      state.notify = cb;
    },
    onDisconnect: () => {},
  };
  // A function rather than the captured value: the polyfill registers its callback during
  // createBluetooth(), which happens after this returns.
  return { bridge, notify: (p) => state.notify(p) };
}

const expectedMoves = (fx, limit) => {
  const m = fx.events.map((e) => e.event).filter((e) => e.type === 'MOVE').map((e) => e.move);
  return limit ? m.slice(0, limit) : m;
};
const expectedLastFacelets = (fx) => {
  for (let i = fx.events.length - 1; i >= 0; i--) {
    if (fx.events[i].event.type === 'FACELETS') return fx.events[i].event.facelets ?? null;
  }
  return null;
};

/** Connect through the polyfill and the real protocol layer, and return what came out. */
/** Connections opened by a replay, so each one can be closed again. Several protocol drivers
 *  (GoCube most visibly) start polling intervals on connect; leaving them running is what kept
 *  the test process alive after every assertion had finished. */
const connections = [];

async function closeConnections() {
  while (connections.length) {
    const c = connections.pop();
    try {
      await c.disconnect();
    } catch {}
  }
}

async function replayThroughPolyfill(fx) {
  const { getRegisteredProtocols } = await import('../vendor/smartcube.js');
  const allowance = CONNECT_NOTIFY_ALLOWANCE[fx.protocol.id] ?? CONNECT_NOTIFY_ALLOWANCE.__default;
  // A device id unique per capture, and it is load-bearing rather than tidy.
  //
  // The library caches a verified MAC at module scope, keyed by device. Every replay in this file
  // shares one process, so reusing an id lets one capture's cached key decrypt — or fail to
  // decrypt — the next one's traffic. That produced two failures of DIFFERENT shapes: gan-gen4
  // decoded zero moves, and one MoYu capture wrote a payload the recording never contained.
  // One mechanism, two symptoms. Upstream's own tests name each replay's device for this reason.
  const { bridge, replayer } = makeFixtureBridge(fx, allowance, `replay:${fx.protocol.id}:${fx.device.name}`);
  const raw = [];
  const bluetooth = createBluetooth(bridge, { onRawPacket: (p) => raw.push(p) });
  const restore = installBluetooth(globalThis, bluetooth);
  try {
    const device = await globalThis.navigator.bluetooth.requestDevice({});
    // Discovery goes through OUR server object, which is half the point of the exercise.
    const services = await device.gatt.getPrimaryServices();
    // Exactly what the library's own collectPrimaryServiceUuids() builds: the discovered service
    // uuids run through its normalizeUuid, which UPPERCASES. Brand resolution compares against
    // that form, so a lowercase set silently matches no protocol at all — which is precisely how
    // this test failed the first time it ran.
    const serviceUuids = new Set(services.map((s) => s.uuid.toUpperCase()));

    const protocols = getRegisteredProtocols();
    const ranked = protocols
      .map((p) => ({ p, score: p.gattAffinity(serviceUuids, device) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    assert.ok(ranked.length > 0, `no protocol claimed ${fx.device.name} (${fx.protocol.id})`);

    // Bounded, because a protocol whose handshake awaits a notification we are not delivering
    // would otherwise hang the suite rather than say what it needed. See CONNECT_NOTIFY_ALLOWANCE.
    const conn = await withTimeout(
      ranked[0].p.connect(device, async () => fx.device.mac ?? null, {
        serviceUuids,
        advertisementManufacturerData: null,
        enableAddressSearch: false,
        onStatus: undefined,
        signal: undefined,
      }),
      8000,
      `${fx.protocol.id} connect() did not settle — it likely awaits a notification during ` +
        'handshake, so give it an entry in CONNECT_NOTIFY_ALLOWANCE',
    );

    const events = [];
    const sub = conn.events$.subscribe({ next: (e) => events.push(e) });
    connections.push(conn);
    await replayer.drain();
    // Let emission settle before unsubscribing. `handleStateEvent` is async, so a notification
    // delivered synchronously by the replayer is decoded a tick or more later; unsubscribing the
    // instant the last byte is handed over drops the tail of the stream. This is a real property
    // of the protocol layer, not a test convenience — the app's own consumer must not assume an
    // event has been emitted by the time a packet has been delivered.
    await settle();
    sub.unsubscribe();
    return { conn, events, raw, services, bluetooth, protocol: ranked[0].p };
  } finally {
    restore();
  }
}

describe('every upstream capture replays through our polyfill', () => {
  for (const { file, fx } of loadFixtures()) {
    const label = `${fx.device.name} (${fx.protocol.id})`;
    const known = NOT_CONNECT_REPLAYABLE[file];

    if (known) {
      test(`${label} — still diverges exactly as recorded: ${known.reason}`, async () => {
        await assert.rejects(() => replayThroughPolyfill(fx), known.failsWith,
          `${file} no longer fails the way NOT_CONNECT_REPLAYABLE says it does — re-read that entry`);
      });
      continue;
    }

    test(`${label} — moves and final state match what the hardware produced`, async () => {
      const { events } = await replayThroughPolyfill(fx);

      // The WHOLE move stream, both directions. Slicing the actual list to the expected length
      // (as an earlier version did) hides extra trailing moves, and capping the expected list
      // hides a stream that stops early — two real decoder failures that would both read green.
      const got = events.filter((e) => e.type === 'MOVE').map((e) => e.move);
      const want = expectedMoves(fx);
      assert.deepEqual(got, want, `${file}: move stream diverged`);

      const wantFacelets = expectedLastFacelets(fx);
      if (wantFacelets) {
        const lastSeen = [...events].reverse().find((e) => e.type === 'FACELETS');
        assert.ok(lastSeen, `${file}: the capture ends in a known state but we produced none`);
        assert.equal(lastSeen.facelets, wantFacelets, `${file}: final cube state diverged`);
      }
    });

    test(`${label} — every notification reached the capture tap, in order and intact`, async () => {
      // The tap is what makes a compatibility report possible. Comparing COUNTS alone would let
      // reordered packets, corrupted bytes, or wrong service/characteristic metadata through — and
      // a report that replays to something the user never did is worse than no report.
      const { raw } = await replayThroughPolyfill(fx);
      const expected = fx.traffic
        .filter((e) => e.op === 'notify')
        .map((e) => `${e.service}|${e.characteristic}|${(e.data ?? '').toLowerCase()}`);
      const actual = raw.map(
        (p) => `${p.service}|${p.characteristic}|${[...p.bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`,
      );
      assert.equal(actual.length, expected.length, `${file}: tap saw ${actual.length} of ${expected.length}`);
      const firstDiff = actual.findIndex((a, i) => a !== expected[i]);
      assert.equal(
        firstDiff,
        -1,
        firstDiff === -1 ? '' : `${file}: tap packet ${firstDiff} differs\n  want ${expected[firstDiff]}\n  got  ${actual[firstDiff]}`,
      );
    });
  }
});

describe('the corpus', () => {
  test('replays eleven of the twelve upstream captures, and names the twelfth', () => {
    // Pinned because "the captures pass" means nothing without how many there were. Three of the
    // eleven are captures upstream's own suite never exercises (its FIXTURES registry names 8).
    const all = loadFixtures();
    const excluded = all.filter((f) => NOT_CONNECT_REPLAYABLE[f.file]);
    assert.equal(all.length, 12, 'the vendored capture set changed size');
    assert.equal(excluded.length, 1, 'the not-replayable set changed — read the reasons before editing');
    assert.equal(
      new Set(all.map((f) => f.fx.protocol.id)).size, 6,
      'six protocol families is the breadth this evidence covers',
    );
  });
});

// Every replay opens a connection; several drivers start polling intervals on connect. Releasing
// them after each test is what lets this file exit on its own.
test.afterEach?.(async () => closeConnections());

describe('the polyfill itself', () => {
  test('covers exactly the surface the protocol layer calls', async () => {
    const fx = loadFixtures().find((f) => !NOT_CONNECT_REPLAYABLE[f.file]).fx;
    // The object we built, not `globalThis.navigator.bluetooth` — the replay restores the global
    // in its `finally`, so reading it here would test whatever was there before.
    const { conn, services, bluetooth } = await replayThroughPolyfill(fx);
    const device = [...(await Promise.resolve(services))][0].device;

    // `in` alone proves nothing about a METHOD: a name present but undefined satisfies it, which
    // is exactly the shape a half-finished polyfill has. Data members are checked for presence,
    // function members for being functions.
    const DATA = new Set(['id', 'name', 'gatt', 'connected', 'uuid', 'value', 'properties']);
    const check = (obj, names, what) => {
      for (const m of names) {
        assert.ok(m in obj, `${what}.${m} missing`);
        if (!DATA.has(m)) assert.equal(typeof obj[m], 'function', `${what}.${m} is not callable`);
      }
    };
    // The Bluetooth root was previously unchecked entirely.
    check(bluetooth, CALLED_SURFACE.bluetooth, 'bluetooth');
    check(device, CALLED_SURFACE.device, 'device');
    check(device.gatt, CALLED_SURFACE.server, 'gatt');
    const svc = services[0];
    check(svc, CALLED_SURFACE.service, 'service');
    const chars = await svc.getCharacteristics();
    check(chars[0], CALLED_SURFACE.characteristic, 'characteristic');
    await conn.disconnect().catch(() => {});
  });

  test('anything listed as deliberately absent really is absent, not stubbed', async () => {
    // The list is empty today. The test is not: an entry added later must mean ABSENT, because
    // the library feature-detects these and a throwing stub turns a supported "no" into a crash.
    const fx = loadFixtures()[0].fx;
    const { bridge } = makeFixtureBridge(fx, 0, 'unit-test-device');
    const bt = createBluetooth(bridge);
    const restore = installBluetooth(globalThis, bt);
    try {
      const device = await globalThis.navigator.bluetooth.requestDevice({});
      for (const m of DELIBERATELY_ABSENT) {
        assert.equal(typeof device[m], 'undefined', `${m} must be absent, not stubbed`);
      }
      // And the converse: nothing the library calls may be missing.
      for (const m of CALLED_SURFACE.device) assert.ok(m in device, `device.${m} missing`);
    } finally {
      restore();
    }
  });

  test('the library recovers the MAC our verified layout encodes', async () => {
    // The single highest-risk thing this branch cannot verify on hardware.
    //
    // `crates/cube-ble` no longer recovers a MAC — that is brand knowledge, and it now belongs to
    // the protocol layer, which reads the advertisement per brand. So GAN key derivation on every
    // packaged build depends on the library's extractor agreeing with the layout gan-driver
    // verified against a real GAN16 ui in 2026-08: company id with low byte 0x01, MAC at payload
    // bytes 3..9, reversed.
    //
    // Their extractor takes a different-looking route — slice the payload to 9 bytes, read the
    // last 6 reversed — and this asserts the two agree. A disagreement is a wrong AES key, whose
    // symptom is a cube that connects, streams, and decodes to noise: indistinguishable from
    // broken hardware, and exactly the failure worth catching before a user meets it.
    const { fx } = loadFixtures().find((f) => f.fx.protocol.id === 'gan-gen4');
    const mac = fx.device.mac;
    assert.ok(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac), `fixture MAC looks wrong: ${mac}`);

    // Lay the advertisement out the way gan-driver says a GAN cube broadcasts it.
    const macBytes = mac.split(':').map((h) => Number.parseInt(h, 16));
    const payload = Uint8Array.from([0x00, 0x00, 0x00, ...macBytes.slice().reverse()]);
    const manufacturerData = { 1: [...payload].map((b) => b.toString(16).padStart(2, '0')).join('') };

    const { getRegisteredProtocols } = await import('../vendor/smartcube.js');
    const { bridge, replayer } = makeFixtureBridge(fx, 0, 'mac-recovery', manufacturerData);
    const bt = createBluetooth(bridge);
    const restore = installBluetooth(globalThis, bt);
    try {
      const device = await globalThis.navigator.bluetooth.requestDevice({});

      // Each payload must own its buffer: the library's extractor reads `.buffer.slice(0, 9)` and
      // ignores byteOffset, so a view into a shared buffer silently yields other bytes.
      const dv = device._manufacturerData.get(1);
      assert.equal(dv.byteOffset, 0, 'the payload DataView must start at offset 0 of its own buffer');
      assert.equal(dv.buffer.byteLength, payload.length, 'and its buffer must hold only this payload');

      // The path connectSmartCube really takes: listener first, then watchAdvertisements.
      const seen = await new Promise((resolve) => {
        device.addEventListener('advertisementreceived', (e) => resolve(e.manufacturerData));
        device.watchAdvertisements({});
      });
      assert.ok(seen.has(1), 'the advertisement event must carry the manufacturer data');

      const services = await device.gatt.getPrimaryServices();
      const serviceUuids = new Set(services.map((sv) => sv.uuid.toUpperCase()));
      const protocols = getRegisteredProtocols();
      const p = protocols
        .map((x) => ({ x, score: x.gattAffinity(serviceUuids, device) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)[0].x;

      // No macAddressProvider at all: the MAC can only come from the advertisement.
      const conn = await withTimeout(
        p.connect(device, undefined, {
          serviceUuids,
          advertisementManufacturerData: seen,
          enableAddressSearch: false,
          onStatus: undefined,
          signal: undefined,
        }),
        8000,
        'connect did not settle while recovering the MAC from the advertisement',
      );
      assert.equal(conn.deviceMAC, mac, 'the library read a different MAC than our layout encodes');
      await replayer.drain();
    } finally {
      restore();
    }
  });

  test('throws by name for a member it does not implement', () => {
    // The realistic failure of a pinned dependency is a bump reaching for something new. It must
    // be loud: a stub returning undefined produces a cube that connects and reports nothing.
    const bt = createBluetooth({ onNotification() {}, onDisconnect() {} });
    assert.throws(() => bt.getDevices(), /getDevices is not implemented/);
    assert.throws(() => bt.getAvailability(), /getAvailability is not implemented/);
  });

  test('buffers notifications that arrive before a listener attaches', async () => {
    // The GAN-only transport this replaced fixed this once, and went with the driver. A packet
    // delivered to an EventTarget with no listener is
    // gone, and a driver takes the first move serial it sees as its gap baseline — so a move lost
    // here is never reported missing. Rebuilding the transport is exactly where that gets lost.
    const { bridge, notify } = makeUnitBridge();
    const bt = createBluetooth(bridge);
    const restore = installBluetooth(globalThis, bt);
    try {
      const device = await globalThis.navigator.bluetooth.requestDevice({});
      const svc = await device.gatt.getPrimaryService(0xfff0);
      const chr = await svc.getCharacteristic(0xfff6);
      await chr.startNotifications();

      // Three packets arrive in the window between subscribing and attaching a listener.
      for (const n of [1, 2, 3]) {
        notify({ device: 'd', service: '0000fff0-0000-1000-8000-00805f9b34fb', characteristic: '0000fff6-0000-1000-8000-00805f9b34fb', bytes: Uint8Array.of(n) });
      }

      const seen = [];
      chr.addEventListener('characteristicvaluechanged', (e) => seen.push(e.target.value.getUint8(0)));
      await new Promise((r) => queueMicrotask(r));
      await new Promise((r) => queueMicrotask(r));

      assert.deepEqual(seen, [1, 2, 3], 'buffered packets must arrive, and in order');
    } finally {
      restore();
    }
  });

  test('a throwing capture tap costs no packet', async () => {
    const { bridge, notify } = makeUnitBridge();
    const bt = createBluetooth(bridge, {
      onRawPacket: () => {
        throw new Error('a diagnostic must never cost data');
      },
    });
    const restore = installBluetooth(globalThis, bt);
    try {
      const device = await globalThis.navigator.bluetooth.requestDevice({});
      const svc = await device.gatt.getPrimaryService(0xfff0);
      const chr = await svc.getCharacteristic(0xfff6);
      await chr.startNotifications();
      const seen = [];
      chr.addEventListener('characteristicvaluechanged', (e) => seen.push(e.target.value.getUint8(0)));
      await new Promise((r) => queueMicrotask(r));
      notify({ device: 'd', service: '0000fff0-0000-1000-8000-00805f9b34fb', characteristic: '0000fff6-0000-1000-8000-00805f9b34fb', bytes: Uint8Array.of(7) });
      await new Promise((r) => queueMicrotask(r));
      assert.deepEqual(seen, [7]);
    } finally {
      restore();
    }
  });

  test('a missing characteristic rejects rather than resolving undefined', async () => {
    // Brand resolution depends on this rejection to rule a protocol out. Resolving with undefined
    // would make every protocol appear to match every cube.
    const { bridge } = makeUnitBridge({ characteristics: [] });
    const bt = createBluetooth(bridge);
    const restore = installBluetooth(globalThis, bt);
    try {
      const device = await globalThis.navigator.bluetooth.requestDevice({});
      const svc = await device.gatt.getPrimaryService(0xfff0);
      await assert.rejects(() => svc.getCharacteristic(0xfff6), /NotFoundError|No Characteristic/);
      await assert.rejects(() => device.gatt.getPrimaryService(0x1234), /NotFoundError|No Services/);
    } finally {
      restore();
    }
  });

  test('canonicalises every spelling of a UUID to one form', () => {
    const full = '0000fff6-0000-1000-8000-00805f9b34fb';
    for (const spelling of [0xfff6, 'fff6', 'FFF6', full, full.toUpperCase()]) {
      assert.equal(canonicalUuid(spelling), full, `${spelling} did not canonicalise`);
    }
    // A vendor 128-bit uuid is passed through, lowercased, not mangled into the base range.
    assert.equal(canonicalUuid('6E400001-B5A3-F393-E0A9-E50E24DCCA9E'), '6e400001-b5a3-f393-e0a9-e50e24dcca9e');
  });

  test('a native disconnect reaches the library as gattserverdisconnected', async () => {
    const fx = loadFixtures()[0].fx;
    const { bridge } = makeFixtureBridge(fx, 0, 'unit-test-device');
    const bt = createBluetooth(bridge);
    const restore = installBluetooth(globalThis, bt);
    try {
      const device = await globalThis.navigator.bluetooth.requestDevice({});
      await device.gatt.getPrimaryServices();
      let fired = false;
      device.addEventListener('gattserverdisconnected', () => {
        fired = true;
      });
      bridge._fireDisconnect();
      assert.equal(fired, true, 'the library tears down on this event; without it the app leaks a connection');
      assert.equal(device.gatt.connected, false);
    } finally {
      restore();
    }
  });
});
