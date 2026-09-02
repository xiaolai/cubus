// The bridge selector and the Tauri adapter.
//
// Two things are worth pinning here and neither is exercised by the replay suite. First, which
// transport a build gets: a browser must keep its own Web Bluetooth, a native build must get the
// polyfill, and a platform with neither must say so rather than fail later in a way that reads as
// a broken cube. Second, the command and payload names crossing the webview boundary — those are a
// contract with `crates/cube-ble`, and a rename on either side surfaces as `undefined` rather than
// as an error.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { installBleBridge, makeTauriBridge } from '../lib/ble-bridge.js';

/** A Tauri API stub that records every invoke and lets tests fire events. */
function fakeTauri() {
  const calls = [];
  const listeners = new Map();
  return {
    calls,
    fire(event, payload) {
      for (const cb of listeners.get(event) ?? []) cb({ payload });
    },
    api: {
      core: {
        invoke: async (cmd, args) => {
          calls.push([cmd, args]);
          if (cmd === 'ble_request_device') return { id: 'dev-1', name: 'Some Cube', manufacturerData: {} };
          if (cmd === 'ble_discover_services') return ['0000fff0-0000-1000-8000-00805f9b34fb'];
          if (cmd === 'ble_discover_characteristics') {
            return [{ uuid: '0000fff6-0000-1000-8000-00805f9b34fb', properties: { notify: true } }];
          }
          if (cmd === 'ble_read') return 'a1b2';
          if (cmd === 'ble_subscribe') return 7; // the id the real command hands back
          return null;
        },
      },
      event: {
        listen: async (name, cb) => {
          listeners.set(name, [...(listeners.get(name) ?? []), cb]);
          return () => listeners.set(name, (listeners.get(name) ?? []).filter((x) => x !== cb));
        },
      },
    },
  };
}

const withGlobals = async (globals, fn) => {
  const saved = new Map();
  for (const [k, v] of Object.entries(globals)) {
    saved.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  try {
    return await fn();
  } finally {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  }
};

describe('choosing a transport', () => {
  test('a native build gets a polyfill it can HAND OVER, without touching any global', async () => {
    // The improvement this pins. The bridge used to assign to `navigator.bluetooth` because the
    // protocol layer read that global directly; it takes the implementation as an option now, so
    // there is nothing to mutate. A global mutation cannot be scoped to one connection, two
    // consumers on a page cannot both do it, and anything else reading that global silently got
    // ours.
    const t = fakeTauri();
    const before = globalThis.navigator?.bluetooth;
    await withGlobals({ window: { __TAURI__: t.api, performance: globalThis.performance } }, async () => {
      const { kind, bluetooth, uninstall } = installBleBridge();
      try {
        assert.equal(kind, 'native');
        assert.equal(typeof bluetooth.requestDevice, 'function', 'it hands back an implementation');
        assert.equal(globalThis.navigator?.bluetooth, before, 'and leaves the global exactly as it was');
      } finally {
        uninstall();
      }
    });
  });

  test('every kind returns a bluetooth, so the caller has one path', async () => {
    // A caller that has to branch on `kind` to find the implementation would be reintroducing the
    // per-host special-casing this seam exists to remove.
    const real = { requestDevice: () => {} };
    await withGlobals({ window: undefined, navigator: { bluetooth: real } }, async () => {
      const r = installBleBridge();
      assert.equal(r.kind, 'browser');
      assert.equal(r.bluetooth, real, 'the browser hands back its own, untouched');
    });
    await withGlobals({ window: undefined, navigator: {} }, async () => {
      const r = installBleBridge();
      assert.equal(r.kind, 'none');
      assert.equal(r.bluetooth, null, 'and nothing pretends to be one where none exists');
    });
  });

  test('forwards BOTH taps to the polyfill, not just the inbound one', async () => {
    // This is the test that was missing when `installBleBridge` silently dropped `onTraffic`. The
    // session's own suite injected a fake installer, so it drove the tap directly and never
    // exercised the real one — a test that could not fail for the bug it was meant to cover.
    // Going through installBleBridge is the whole point.
    const t = fakeTauri();
    await withGlobals({ window: { __TAURI__: t.api, performance: globalThis.performance } }, async () => {
      const packets = [];
      const traffic = [];
      const { bridge, bluetooth, uninstall } = installBleBridge({
        onRawPacket: (p) => packets.push(p),
        onTraffic: (e) => traffic.push(e),
      });
      try {
        await bridge.ready;
        const device = await bluetooth.requestDevice({});
        const svc = await device.gatt.getPrimaryService('0000fff0-0000-1000-8000-00805f9b34fb');
        const chr = await svc.getCharacteristic('0000fff6-0000-1000-8000-00805f9b34fb');
        await chr.writeValueWithoutResponse(Uint8Array.of(0xdd, 0x04));

        const ops = traffic.map((e) => e.op);
        assert.ok(ops.includes('discover-service'), 'service discovery must reach the tap');
        assert.ok(ops.includes('discover-char'), 'characteristic discovery must reach the tap');
        assert.ok(ops.includes('write'), 'writes must reach the tap — a handshake IS a write');

        // startNotifications() ran during the writes above? No — subscribe explicitly, so the id
        // exists before the packet that uses it.
        await bridge.subscribe(
          'dev-1',
          '0000fff0-0000-1000-8000-00805f9b34fb',
          '0000fff6-0000-1000-8000-00805f9b34fb',
        );
        t.fire('ble-notification', { sub: 7, data: 'beef' });
        assert.equal(packets.length, 1, 'and notifications still reach the other tap');
      } finally {
        uninstall();
      }
    });
  });

  test('a Chromium browser keeps its own Web Bluetooth, untouched', async () => {
    // Installing over a working implementation would replace a tested browser API with ours for
    // no gain, and would hide any polyfill bug behind the one platform that does not need it.
    const real = { requestDevice: () => {} };
    await withGlobals({ window: undefined, navigator: { bluetooth: real } }, async () => {
      const { kind } = installBleBridge();
      assert.equal(kind, 'browser');
      assert.equal(globalThis.navigator.bluetooth, real, 'the real implementation must survive');
    });
  });

  test('Safari and Firefox get an honest "none" rather than a late failure', async () => {
    // No Tauri, no Web Bluetooth. The truthful answer is that smart cubes are unavailable here —
    // not a connect that times out and reads to a beginner as a broken cube.
    await withGlobals({ window: undefined, navigator: {} }, async () => {
      assert.equal(installBleBridge().kind, 'none');
    });
  });
});

  test('a host where native BLE cannot work gets the honest "none", not a crash', async () => {
    // Android is the case. btleplug's droidplug backend needs Java classes in the APK and a JNI
    // init that this project does not yet do, and WITHOUT them the first adapter call panics
    // inside a Tauri command — a crash, not an error a screen can report. The crate compiles for
    // Android regardless, so nothing catches it at build time.
    const t = fakeTauri();
    const doc = { documentElement: { dataset: { platform: 'android' } } };
    await withGlobals({ window: { __TAURI__: t.api, performance: globalThis.performance }, document: doc }, async () => {
      const r = installBleBridge();
      assert.equal(r.kind, 'none', 'the Tauri API being present is not the same as a radio');
      assert.equal(r.bluetooth, null);
    });
  });

  test('and a host where it DOES work is unaffected by that guard', async () => {
    const t = fakeTauri();
    const doc = { documentElement: { dataset: { platform: 'macos' } } };
    await withGlobals({ window: { __TAURI__: t.api, performance: globalThis.performance }, document: doc }, async () => {
      const r = installBleBridge();
      try {
        assert.equal(r.kind, 'native');
        assert.equal(typeof r.bluetooth.requestDevice, 'function');
      } finally {
        r.uninstall();
      }
    });
  });

describe('the Tauri adapter', () => {
  test('refuses to exist without the Tauri API rather than half-working', async () => {
    await withGlobals({ window: undefined }, () => {
      assert.throws(() => makeTauriBridge(null), /Tauri API is not injected/);
    });
  });

  test('calls the commands the Rust side registers, with the argument keys it expects', async () => {
    // A contract across the webview boundary, and it has to be checked in FULL. An earlier version
    // of this test compared command names only while its own name claimed to pin payloads — so a
    // renamed argument key (`id` -> `deviceId`, say) passed, and would have failed at runtime on
    // hardware as a command that silently received undefined.
    const t = fakeTauri();
    const b = makeTauriBridge(t.api);
    await b.ready;
    await b.requestDevice({ filters: [{ namePrefix: 'GAN' }] });
    await b.connect('dev-1');
    await b.discoverServices('dev-1');
    await b.discoverCharacteristics('dev-1', 'svc');
    await b.subscribe('dev-1', 'svc', 'chr');
    await b.unsubscribe('dev-1', 'svc', 'chr');
    await b.read('dev-1', 'svc', 'chr');
    await b.write('dev-1', 'svc', 'chr', Uint8Array.of(0xa1, 0x0b), true);
    await b.disconnect('dev-1');

    assert.deepEqual(t.calls, [
      ['ble_request_device', { options: { filters: [{ namePrefix: 'GAN' }] } }],
      ['ble_connect', { id: 'dev-1' }],
      ['ble_discover_services', { id: 'dev-1' }],
      ['ble_discover_characteristics', { id: 'dev-1', service: 'svc' }],
      ['ble_subscribe', { id: 'dev-1', service: 'svc', characteristic: 'chr' }],
      ['ble_unsubscribe', { id: 'dev-1', service: 'svc', characteristic: 'chr' }],
      ['ble_read', { id: 'dev-1', service: 'svc', characteristic: 'chr' }],
      ['ble_write', { id: 'dev-1', service: 'svc', characteristic: 'chr', data: 'a10b', withoutResponse: true }],
      ['ble_disconnect', { id: 'dev-1' }],
    ]);
  });

  test('sends write payloads as lowercase hex, zero-padded', async () => {
    // 0x0b must be "0b", not "b". An odd-length string is not decodable hex, and the Rust side
    // rejects it — but only after the write was silently wrong for every byte below 0x10.
    const t = fakeTauri();
    const b = makeTauriBridge(t.api);
    await b.ready;
    await b.write('d', 's', 'c', Uint8Array.of(0xa1, 0x0b, 0x00, 0xff), false);
    const [, args] = t.calls.find(([cmd]) => cmd === 'ble_write');
    assert.equal(args.data, 'a10b00ff');
    assert.equal(args.withoutResponse, false);
  });

  test('forwards notifications with the field names the Rust payload uses', async () => {
    const t = fakeTauri();
    const b = makeTauriBridge(t.api);
    await b.ready;
    const seen = [];
    b.onNotification((p) => seen.push(p));
    await b.subscribe('d', 's', 'c'); // the id is learned here, once
    t.fire('ble-notification', { sub: 7, data: 'beef' });
    assert.deepEqual(seen, [{ device: 'd', service: 's', characteristic: 'c', bytes: 'beef' }]);
  });

  test('a packet carries only an id, and the triple is resolved locally', async () => {
    // The reason this indirection exists. The native side used to re-send a device id and two
    // 36-character UUIDs with every notification — identical for the whole session — which is 204
    // bytes on the wire for 20 bytes of payload, twenty times a second. The triple is sent ONCE,
    // at subscribe, and every packet after that is an integer.
    const t = fakeTauri();
    const b = makeTauriBridge(t.api);
    await b.ready;
    const seen = [];
    b.onNotification((p) => seen.push(p));
    await b.subscribe('dev-9', 'svc-9', 'chr-9');
    t.fire('ble-notification', { sub: 7, data: 'aabb' });
    assert.deepEqual(seen, [{ device: 'dev-9', service: 'svc-9', characteristic: 'chr-9', bytes: 'aabb' }]);
  });

  test('a packet for an unknown subscription is dropped loudly, not routed by guess', async () => {
    const t = fakeTauri();
    const b = makeTauriBridge(t.api);
    await b.ready;
    const seen = [];
    b.onNotification((p) => seen.push(p));
    t.fire('ble-notification', { sub: 999, data: 'aabb' });
    assert.equal(seen.length, 0, 'nothing may be delivered against an id we never issued');
  });

  test('unsubscribing forgets the id, so a late packet cannot be routed', async () => {
    const t = fakeTauri();
    const b = makeTauriBridge(t.api);
    await b.ready;
    const seen = [];
    b.onNotification((p) => seen.push(p));
    await b.subscribe('d', 's', 'c');
    await b.unsubscribe('d', 's', 'c');
    t.fire('ble-notification', { sub: 7, data: '01' });
    assert.equal(seen.length, 0);
  });

  test('forwards a native disconnect', async () => {
    const t = fakeTauri();
    const b = makeTauriBridge(t.api);
    await b.ready;
    const seen = [];
    b.onDisconnect((p) => seen.push(p));
    t.fire('ble-disconnect', { device: 'd' });
    assert.deepEqual(seen, [{ device: 'd' }]);
  });

  test('listens before the first connect, not after', async () => {
    // The native side emits as soon as it subscribes. Registering listeners lazily would lose
    // whatever arrives first, and the polyfill can only buffer packets it has been handed.
    const t = fakeTauri();
    const b = makeTauriBridge(t.api);
    await b.ready;
    const seen = [];
    b.onNotification((p) => seen.push(p));
    await b.subscribe('d', 's', 'c');
    t.fire('ble-notification', { sub: 7, data: '01' });
    assert.equal(seen.length, 1, 'an event fired before any connect must still be delivered');
  });

  test('keeps its listeners across a disconnect, so a reconnect still hears the cube', async () => {
    // This test used to assert the opposite, and the opposite was a real bug: dropping the Tauri
    // listeners on disconnect meant the FIRST reconnect received nothing at all and the cube
    // looked dead. A Tauri listener is not scoped to a peripheral — the payload carries the device
    // id and the polyfill routes on it.
    const t = fakeTauri();
    const b = makeTauriBridge(t.api);
    await b.ready;
    const seen = [];
    b.onNotification((p) => seen.push(p.bytes));

    await b.subscribe('d', 's', 'c');
    await b.disconnect('d');
    await b.connect('d');
    t.fire('ble-notification', { sub: 7, data: '01' });
    assert.deepEqual(seen, ['01'], 'a reconnected bridge must still deliver notifications');
  });

  test('releases its listeners only when the bridge itself is disposed', async () => {
    const t = fakeTauri();
    const b = makeTauriBridge(t.api);
    await b.ready;
    const seen = [];
    b.onNotification((p) => seen.push(p.bytes));
    await b.subscribe('d', 's', 'c');
    await b.dispose();
    t.fire('ble-notification', { sub: 7, data: '01' });
    assert.equal(seen.length, 0, 'a disposed bridge must be silent');
    await assert.rejects(() => b.connect('d'), /disposed/, 'and must refuse to be reused');
  });

  test('uninstalling the bridge releases its listeners too', async () => {
    // Restoring navigator.bluetooth alone would leave the old bridge attached and firing into a
    // polyfill nothing uses — one reinstall and every packet arrives twice.
    const t = fakeTauri();
    await withGlobals({ window: { __TAURI__: t.api, performance: globalThis.performance } }, async () => {
      const { bridge, uninstall } = installBleBridge();
      await bridge.ready;
      const seen = [];
      bridge.onNotification((p) => seen.push(p));
      uninstall();
      await new Promise((r) => queueMicrotask(r));
      t.fire('ble-notification', { sub: 7, data: '01' });
      assert.equal(seen.length, 0);
    });
  });

  test('refuses a malformed event payload loudly instead of dropping the packet', async () => {
    // Both sides are ours, which is exactly why this is worth checking: the Rust structs are typed
    // but nothing verifies the JSON still matches them. A renamed field arrives as undefined, the
    // polyfill looks up a characteristic keyed "undefined", finds none, and drops every packet in
    // silence. There is no error anywhere in that story, which is what makes it dangerous.
    const t = fakeTauri();
    const b = makeTauriBridge(t.api);
    await b.ready;
    b.onNotification(() => {});
    assert.throws(() => t.fire('ble-notification', { data: '01' }), /wrong at sub \(want number/);
    assert.throws(() => t.fire('ble-notification', { sub: 7 }), /wrong at data \(want string/);
    assert.throws(() => t.fire('ble-disconnect', {}), /wrong at device \(want string/);

    // A `sub` of the wrong TYPE, not merely absent. The old check tested `typeof p.sub !== 'number'`
    // for notifications and `typeof payload[f] !== 'string'` for everything else, in two separate
    // implementations — so this case was covered on one path and not the other.
    assert.throws(() => t.fire('ble-notification', { sub: '7', data: '01' }), /want number, got string/);
  });

  // The first packet after a subscribe is usually the one carrying the cube's current state, and
  // it is the one most likely to arrive before the id exists here: the id is allocated in RUST, so
  // it does not reach this side until `ble_subscribe` resolves. Before this was held, that packet
  // hit the "unknown subscription" branch and was dropped with a warning.
  test('a packet that arrives before ble_subscribe resolves is delivered, not dropped', async () => {
    let release;
    const pending = new Promise((r) => {
      release = r;
    });
    const t = fakeTauri();
    // Hold `ble_subscribe` open so the notification can land inside the window.
    const realInvoke = t.api.core.invoke;
    t.api.core.invoke = async (cmd, args) => {
      if (cmd === 'ble_subscribe') {
        await pending;
        return 7;
      }
      return realInvoke(cmd, args);
    };

    const b = makeTauriBridge(t.api);
    await b.ready;
    const seen = [];
    b.onNotification((n) => seen.push(n));

    const subscribing = b.subscribe('dev-1', 'svc', 'chr');
    await new Promise((r) => queueMicrotask(r));
    // The cube starts talking while the subscribe is still out.
    t.fire('ble-notification', { sub: 7, data: 'aa' });
    assert.equal(seen.length, 0, 'nothing can be delivered yet — the id is not known here');

    release();
    await subscribing;
    await new Promise((r) => queueMicrotask(r));
    assert.equal(seen.length, 1, 'the held packet must be delivered once the id is registered');
    assert.equal(seen[0].bytes, 'aa');
    assert.equal(seen[0].characteristic, 'chr');
  });

  // The buffer is scoped to the window and is not a general retry: outside it, an unknown id is a
  // real drop — a stale subscription — and must still say so rather than accumulating silently.
  test('an unknown subscription outside a pending subscribe is still dropped loudly', async () => {
    const t = fakeTauri();
    const b = makeTauriBridge(t.api);
    await b.ready;
    const seen = [];
    b.onNotification((n) => seen.push(n));
    const warnings = [];
    const warn = console.warn;
    console.warn = (m) => warnings.push(m);
    try {
      t.fire('ble-notification', { sub: 99, data: 'aa' });
    } finally {
      console.warn = warn;
    }
    assert.equal(seen.length, 0);
    assert.match(warnings.join('\n'), /unknown subscription 99 — dropped/);
  });

  // Registration is NOT transactional: `ble-notification` can install and `ble-disconnect` then
  // fail. The bridge is supposed to release whatever landed rather than leaving half of itself
  // attached to the app — a listener nobody owns, firing into a polyfill that was never returned.
  // The recovery path existed and nothing exercised it.
  test('a listener that fails to register releases the ones that already did', async () => {
    const released = [];
    let n = 0;
    const api = {
      core: { invoke: async () => null },
      event: {
        listen: async (name) => {
          n++;
          if (n === 2) throw new Error('registration refused');
          return () => released.push(name);
        },
      },
    };
    const b = makeTauriBridge(api);
    await assert.rejects(b.ready, /registration refused/);
    assert.deepEqual(released, ['ble-notification'],
      'the listener that DID install must be released exactly once');
  });

  // Disposing while registration is still in flight. `dispose()` waits for `ready` to settle before
  // releasing, precisely so the listeners it releases are the ones that actually landed — clearing
  // an empty list first left them registering into a bridge nobody owns.
  test('disposing during registration still releases every listener that lands', async () => {
    const released = [];
    let openTheGate;
    const gate = new Promise((r) => {
      openTheGate = r;
    });
    const api = {
      core: { invoke: async () => null },
      event: {
        listen: async (name) => {
          await gate;
          return () => released.push(name);
        },
      },
    };
    const b = makeTauriBridge(api);
    const disposing = b.dispose(); // begins while both listens are still pending
    assert.deepEqual(released, [], 'nothing has registered yet, so nothing can be released yet');
    openTheGate();
    await disposing;
    assert.deepEqual(released.sort(), ['ble-disconnect', 'ble-notification'],
      'both listeners registered after dispose began, and both must still be released');
  });

  // And a disposed bridge refuses work rather than driving the radio. Every command, not just the
  // two that used to check.
  test('every command on a disposed bridge refuses', async () => {
    const t = fakeTauri();
    const b = makeTauriBridge(t.api);
    await b.ready;
    await b.dispose();
    const before = t.calls.length;
    for (const call of [
      () => b.requestDevice({}),
      () => b.connect('dev-1'),
      () => b.discoverServices('dev-1'),
      () => b.discoverCharacteristics('dev-1', 'svc'),
      () => b.subscribe('dev-1', 'svc', 'chr'),
      () => b.unsubscribe('dev-1', 'svc', 'chr'),
      () => b.read('dev-1', 'svc', 'chr'),
      () => b.write('dev-1', 'svc', 'chr', new Uint8Array([1]), false),
      () => b.disconnect('dev-1'),
    ]) {
      await assert.rejects(call(), /was disposed/);
    }
    assert.equal(t.calls.length, before, 'a disposed bridge must not invoke a single command');
  });

  // The drift that made the two validators worth merging: a malformed DISCONNECT sent whoever was
  // debugging it to read `NotificationPayload`, which is a different struct with different fields.
  test('a malformed payload names the Rust struct that actually governs it', async () => {
    const t = fakeTauri();
    const b = makeTauriBridge(t.api);
    await b.ready;
    b.onNotification(() => {});
    assert.throws(() => t.fire('ble-disconnect', {}), /DisconnectPayload/);
    assert.throws(() => t.fire('ble-disconnect', {}), (e) => !/NotificationPayload/.test(e.message));
    assert.throws(() => t.fire('ble-notification', { sub: 7 }), /NotificationPayload/);
  });
});
