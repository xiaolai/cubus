// A compatibility report has to be replayable, or it is a file nobody can act on.
//
// The strongest test here is the round trip: a report this module builds is fed back through the
// same replay machinery `ble-polyfill.test.mjs` uses on upstream's twelve captures. That is the
// property that makes the whole reporting loop worth having — a user's file has to be usable the
// same way upstream's are, or it is a bug report with an attachment nobody can open.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FIXTURE_FORMAT,
  FIXTURE_VERSION,
  createCaptureRecorder,
  describeReport,
  reportFilename,
  saveReport,
} from '../lib/cube-report.js';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/smartcube/', import.meta.url));

/** A clock that advances a millisecond per read, so ordering is deterministic. */
function fakeClock(start = 1_800_000_000_000) {
  let t = start;
  return () => t++;
}

function recordASession({ mac = 'CF:30:16:00:A3:88' } = {}) {
  const r = createCaptureRecorder({ now: fakeClock() });
  r.describeDevice({ name: 'GAN16ui_C8D3', id: 'dev-1', mac });
  r.describeProtocol({ id: 'gan-gen4', name: 'GAN Gen4' });
  r.onServiceDiscovered('0000fff0-0000-1000-8000-00805f9b34fb');
  r.onCharacteristicDiscovered('0000fff0-0000-1000-8000-00805f9b34fb', '0000fff6-0000-1000-8000-00805f9b34fb');
  r.mark('user asked to turn R');
  r.onWrite({ service: '0000fff0-0000-1000-8000-00805f9b34fb', characteristic: '0000fff5-0000-1000-8000-00805f9b34fb', bytes: Uint8Array.of(0xdd, 0x04) });
  r.onPacket({ service: '0000fff0-0000-1000-8000-00805f9b34fb', characteristic: '0000fff6-0000-1000-8000-00805f9b34fb', bytes: Uint8Array.of(0x01, 0x02, 0x0b) });
  r.onEvent({ type: 'MOVE', move: 'R' });
  return r;
}

describe('the shape a report has to have', () => {
  test('is upstream’s fixture format, at the version their replayer reads', () => {
    // Not ours to invent or to bump: a report for a model nobody has captured should be
    // contributable upstream unchanged, and their loader rejects any other format/version pair.
    const f = recordASession().build();
    assert.equal(f.format, FIXTURE_FORMAT);
    assert.equal(f.version, FIXTURE_VERSION);
    assert.equal(FIXTURE_FORMAT, 'smartcube-fixture');
    assert.equal(FIXTURE_VERSION, 1);
  });

  test('matches the shape of the captures already in the tree', () => {
    // Derived from a real upstream file rather than from memory, so a format drift upstream shows
    // up here instead of in a report someone cannot replay.
    const sample = JSON.parse(
      readFileSync(FIXTURE_DIR + readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'))[0], 'utf8'),
    );
    const mine = recordASession().build();
    for (const key of ['format', 'version', 'capturedAt', 'device', 'protocol', 'services', 'traffic', 'events']) {
      assert.ok(key in sample, `the upstream sample lacks ${key} — this test is out of date`);
      assert.ok(key in mine, `a report must carry ${key}`);
    }
    for (const key of ['name', 'id']) assert.ok(key in mine.device, `device.${key}`);
    for (const e of mine.traffic) {
      assert.equal(typeof e.t, 'number');
      assert.ok(['notify', 'write', 'read', 'discover-service', 'discover-char', 'marker'].includes(e.op), e.op);
    }
  });

  test('records traffic and events in the order they happened', () => {
    const f = recordASession().build();
    const ts = f.traffic.map((e) => e.t);
    assert.deepEqual(ts, [...ts].sort((a, b) => a - b), 'traffic must be chronological');
    assert.equal(f.traffic[0].op, 'discover-service');
    assert.equal(f.traffic.at(-1).op, 'notify');
  });

  test('writes bytes as lowercase zero-padded hex', () => {
    // 0x0b must be "0b". An odd-length string is not decodable, and the replayer compares write
    // payloads byte for byte — so a single unpadded byte makes the whole capture unreplayable.
    const f = recordASession().build();
    assert.equal(f.traffic.find((e) => e.op === 'notify').data, '01020b');
    assert.equal(f.traffic.find((e) => e.op === 'write').data, 'dd04');
  });

  test('names its file the way upstream names theirs', () => {
    const f = recordASession().build();
    const name = reportFilename(f);
    assert.match(name, /^fixture_GAN16ui_C8D3_gan-gen4_[\dT-]+\.json$/);
    assert.ok(!/[^A-Za-z0-9_.-]/.test(name), 'a filename must survive being attached to an issue');
  });
});

describe('a report is machine-generated evidence, not an opinion', () => {
  test('carries the self-check verdict as facts', () => {
    const r = recordASession();
    const f = r.build({
      scenario: 'turn each face once',
      selfCheck: { verdict: 'refused', reason: 'reconcile-failed', evidence: { reconciled: 0, failed: 1 } },
    });
    assert.equal(f.selfCheck.verdict, 'refused');
    assert.equal(f.selfCheck.reason, 'reconcile-failed');
    assert.equal(f.scenario, 'turn each face once');
    // The reason is an enum value, not prose. A sentence here would be a claim about the cube
    // rather than a record of what was measured.
    assert.ok(!/\s/.test(f.selfCheck.reason), 'the reason must be a token, not a sentence');
  });

  test('says plainly what a reader is about to publish', () => {
    const f = recordASession().build();
    const d = describeReport(f);
    assert.equal(d.containsMac, true, 'a GAN capture carries the cube MAC and must say so');
    assert.equal(d.packets, 1);
    assert.equal(d.events, 1);
    assert.deepEqual(d.eventKinds, { MOVE: 1 });
  });

  test('says so when the cube MAC is not in the file', () => {
    // `null`, not `undefined`: a default parameter swallows undefined, so the helper would have
    // gone on supplying a MAC and the test would have asserted nothing.
    const f = recordASession({ mac: null }).build();
    assert.equal(describeReport(f).containsMac, false);
    assert.ok(!('mac' in f.device), 'an absent MAC must be absent, not an empty string');
  });

  test('an unrecognised cube still produces a usable report', () => {
    // The whole reason the capture tap sits below decoding: a cube no protocol claims is exactly
    // the one worth reporting, and it must not produce an empty file.
    const r = createCaptureRecorder({ now: fakeClock() });
    r.describeDevice({ name: 'SomeUnknownCube', id: 'x' });
    r.onPacket({ service: 'svc', characteristic: 'chr', bytes: Uint8Array.of(9) });
    const f = r.build();
    assert.equal(f.protocol.id, '');
    assert.equal(f.traffic.length, 1);
    assert.equal(describeReport(f).protocol, '(unrecognised)');
  });

  test('refuses data that is not hex rather than writing an unreplayable capture', () => {
    // A string used to be passed through untouched. Uppercase, odd-length or outright non-hex all
    // produce a file that replays to nothing, and the divergence gets blamed on the decoder.
    const r = createCaptureRecorder({ now: fakeClock() });
    assert.throws(() => r.onPacket({ service: 's', characteristic: 'c', bytes: 'nothex!!' }), /expected hex/);
    assert.throws(() => r.onPacket({ service: 's', characteristic: 'c', bytes: 'abc' }), /expected hex/);
    r.onPacket({ service: 's', characteristic: 'c', bytes: 'AABB' });
    assert.equal(r.build().traffic[0].data, 'aabb', 'and it canonicalises the case');
  });

  test('says a MAC is present when the device id itself is one', () => {
    // device.id is a Bluetooth address on Windows, Android and most Linux stacks; only macOS
    // substitutes an opaque per-host UUID. "No MAC in this file" would be false reassurance there.
    const r = createCaptureRecorder({ now: fakeClock() });
    r.describeDevice({ name: 'Cube', id: 'CF:30:16:00:A3:88' });
    assert.equal(describeReport(r.build()).containsMac, true);
    const r2 = createCaptureRecorder({ now: fakeClock() });
    r2.describeDevice({ name: 'Cube', id: '8A9C1E22-0000-0000-0000-000000000000' });
    assert.equal(describeReport(r2.build()).containsMac, false, 'a CoreBluetooth UUID is not a MAC');
  });

  test('a truncated report says it was truncated', () => {
    // A capped capture that looks complete is worse than no capture: it replays to a state the
    // user never reached, and the divergence gets blamed on the decoder.
    const r = createCaptureRecorder({ now: fakeClock() });
    for (let i = 0; i < 20050; i++) r.onPacket({ service: 's', characteristic: 'c', bytes: Uint8Array.of(1) });
    const f = r.build();
    assert.ok(f.truncatedEntries > 0, 'the overflow must be recorded');
    assert.equal(describeReport(f).truncated, f.truncatedEntries);
    // The cap counts BOTH lists. Applied per list it allowed 40,000 entries while the docs said
    // 20,000 — and the documented number is the one someone reasons about when a report is too
    // large to attach.
    assert.equal(f.traffic.length + f.events.length, 20000);
  });
});

describe('getting the report off the device', () => {
  /** A DOM stub that records the anchor a download would click. */
  function fakeDoc() {
    const state = { clicked: null, appended: 0, removed: 0 };
    return {
      state,
      doc: {
        createElement: () => ({
          set href(v) { state.href = v; },
          set download(v) { state.download = v; },
          click() { state.clicked = { href: state.href, download: state.download }; },
          remove() { state.removed++; },
        }),
        body: { appendChild: () => { state.appended++; } },
      },
    };
  }

  const withUrl = async (fn) => {
    const saved = { c: globalThis.URL.createObjectURL, r: globalThis.URL.revokeObjectURL, B: globalThis.Blob };
    const made = [];
    globalThis.URL.createObjectURL = (b) => { made.push(b); return 'blob:report'; };
    globalThis.URL.revokeObjectURL = () => {};
    try {
      return await fn(made);
    } finally {
      globalThis.URL.createObjectURL = saved.c;
      globalThis.URL.revokeObjectURL = saved.r;
      globalThis.Blob = saved.B;
    }
  };

  test('a browser downloads it, under the upstream filename', async () => {
    const f = recordASession().build();
    const { doc, state } = fakeDoc();
    const r = await withUrl(() => saveReport(f, { doc, nav: {}, isWebview: false }));
    assert.equal(r.how, 'downloaded');
    assert.equal(state.clicked.download, reportFilename(f));
    assert.equal(state.clicked.href, 'blob:report');
    assert.equal(state.removed, 1, 'the anchor must not be left in the document');
  });

  test('a webview copies it instead of pretending to download', async () => {
    // The desktop build has no file-save capability at all — Tauri's `opener` and nothing else —
    // and clicking a Blob anchor reports NOTHING, so success and silent failure are
    // indistinguishable. Choosing by capability is what keeps the answer honest.
    const f = recordASession().build();
    let copied = null;
    const r = await saveReport(f, {
      doc: fakeDoc().doc,
      nav: { clipboard: { writeText: async (t) => { copied = t; } } },
      isWebview: true,
    });
    assert.equal(r.how, 'copied');
    assert.equal(JSON.parse(copied).format, FIXTURE_FORMAT, 'and what it copied is the report');
  });

  test('says what it actually did, so the UI cannot claim more', async () => {
    const f = recordASession().build();
    const r = await saveReport(f, {
      doc: null,
      nav: { clipboard: { writeText: async () => {} } },
      isWebview: true,
    });
    assert.equal(r.how, 'copied');
    assert.equal(r.name, reportFilename(f));
    assert.ok(r.bytes > 0, 'and how much, so a too-large report is visible');
  });

  test('refuses loudly where neither path exists', async () => {
    // A report that could not leave the device is not a report. Saying "saved" here would waste
    // the one thing the user was willing to give.
    const f = recordASession().build();
    await assert.rejects(
      () => saveReport(f, { doc: null, nav: {}, isWebview: true }),
      /no way to save or copy/,
    );
  });
});

describe('the round trip', () => {
  test('a report this module builds replays through the polyfill to the same bytes', async () => {
    // The property that makes the reporting loop worth having, and it has to be a REAL replay.
    // An earlier version of this test only hex-decoded a string it had just hex-encoded, which
    // proves nothing about whether anyone can act on the file.
    const f = recordASession().build();
    const { createBluetooth, installBluetooth } = await import('../lib/ble-polyfill.js');

    // A bridge whose topology and notifications come from the report, exactly as ble-polyfill's
    // fixture bridge does for upstream's captures — and speaking hex, as the real bridge does.
    const topology = new Map();
    for (const e of f.traffic) {
      if (!e.service || e.op === 'marker') continue;
      if (!topology.has(e.service)) topology.set(e.service, new Set());
      if (e.characteristic) topology.get(e.service).add(e.characteristic);
    }
    let notify = () => {};
    const bridge = {
      requestDevice: async () => ({ id: 'replay', name: f.device.name }),
      connect: async () => {},
      disconnect: async () => {},
      discoverServices: async () => [...topology.keys()],
      discoverCharacteristics: async (_i, svc) =>
        [...(topology.get(svc) ?? [])].map((uuid) => ({ uuid, properties: { notify: true } })),
      subscribe: async () => {},
      unsubscribe: async () => {},
      read: async () => '',
      write: async () => {},
      onNotification: (cb) => {
        notify = cb;
      },
      onDisconnect: () => {},
    };

    const restore = installBluetooth(globalThis, createBluetooth(bridge));
    try {
      const device = await globalThis.navigator.bluetooth.requestDevice({});
      const notifies = f.traffic.filter((e) => e.op === 'notify');
      assert.ok(notifies.length > 0, 'the report must contain traffic to replay');

      const seen = [];
      for (const entry of notifies) {
        const svc = await device.gatt.getPrimaryService(entry.service);
        const chr = await svc.getCharacteristic(entry.characteristic);
        await chr.startNotifications();
        chr.addEventListener('characteristicvaluechanged', (ev) => {
          const dv = ev.target.value;
          seen.push([...new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)]
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(''));
        });
        await new Promise((r) => queueMicrotask(r));
        notify({
          device: 'replay',
          service: entry.service,
          characteristic: entry.characteristic,
          bytes: entry.data,
        });
        await new Promise((r) => queueMicrotask(r));
      }

      assert.deepEqual(seen, notifies.map((e) => e.data), 'bytes must survive record -> replay');
    } finally {
      restore();
    }
  });

  test('the topology a replayer derives from a report names every characteristic used', () => {
    const f = recordASession().build();
    const topology = new Map();
    for (const e of f.traffic) {
      if (!e.service || e.op === 'marker') continue;
      if (!topology.has(e.service)) topology.set(e.service, new Set());
      if (e.characteristic) topology.get(e.service).add(e.characteristic);
    }
    assert.equal(topology.size, 1);
    assert.equal([...topology.values()][0].size, 2, 'both the notify and write characteristics');
  });
});
