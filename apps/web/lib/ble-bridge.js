// Which BLE bridge this build gets, and the one place that decides.
//
// `ble-polyfill.js` needs a bridge; there are exactly two, and they differ only in how bytes reach
// the radio. In a Chromium browser the real `navigator.bluetooth` already exists and no polyfill is
// wanted. Everywhere else — WKWebView on macOS and iOS, Android WebView, WebView2, WebKitGTK — the
// Tauri commands in `crates/cube-ble` are the only path, and the polyfill makes them look like the
// API the protocol layer expects. See dev-docs/universal-cube-driver.md §3-4.
//
// Deliberately NOT a third code path: both builds run the same protocol layer over the same
// polyfill contract. The seam is the transport, and nothing above it can tell which one it got.

import { createBluetooth } from './ble-polyfill.js';
import { hostPlatform } from './host.js';

/**
 * Hosts where the Tauri API is injected but the native BLE bridge is not offered.
 *
 * **The rule, from dev-docs/native-ble-platforms.md §3: a refusal is removed when a platform is
 * PROVEN, never when it builds.** Both entries below compile cleanly today. Neither has spoken to
 * a radio, and a build that succeeds is not a platform that works — Android is on this list
 * precisely because every gate stayed green over a guaranteed panic.
 *
 * `android` — the wiring EXISTS, which is the unusual case worth spelling out.
 * `gen/android/.../BlePlugin.kt` implements all nine commands over Android's own GATT stack, and
 * `src-tauri/src/android_ble.rs` forwards to it, so the crash this list originally guarded —
 * btleplug's droidplug backend panicking without its Java classes — is no longer what would
 * happen. What has not happened is a phone.
 *
 * `ios` — it compiles for `aarch64-apple-ios`, the usage string is in `Info.ios.plist` and
 * `project.yml`, and CoreBluetooth is the same btleplug backend macOS proved on hardware with a
 * real GAN16 ui. What is missing is one run on a physical device, and BLE does not work in the
 * simulator, so there is no cheaper proof available. It was offered on the strength of the
 * compile alone until 2026-09-04, which is exactly what §3 forbids and what Android is the
 * cautionary case for. `native-ble-platforms.md` step 2 is what removes it.
 *
 * THE FLIP IS THIS LINE. Delete a platform from the array below and the app offers Bluetooth
 * there. For Android, do it only after running `pnpm tauri android dev` on a device with a real
 * cube and seeing, at minimum: a scan that finds a cube advertising WITHOUT a recognisable name
 * (the manufacturer-data filter path, which is the one a summary loses); a subscribe that actually
 * delivers packets, since Android needs both `setCharacteristicNotification` AND a CCCD write and
 * the failure mode of doing one is silence rather than an error; and sustained traffic, because
 * Android GATT permits one outstanding operation per connection and a queue bug looks fine until
 * the protocol layer talks at speed. For iOS, one connect-and-turn on a real iPhone is the whole
 * gate.
 *
 * Compiling is not evidence. It compiled before this was written, too.
 */
export const NATIVE_BLE_UNSUPPORTED = Object.freeze(['android', 'ios']);

/** The protocol layer's own localStorage cache of a device's Bluetooth address.
 *  `smartcube/attachment/address-hints.ts` writes `smartcube-ble-mac:<device id>` after resolving
 *  one, and reads it back on every later connect. Spelled here because Forget has to reach it. */
const LIBRARY_MAC_PREFIX = 'smartcube-ble-mac:';

/**
 * Erase what the protocol layer remembers about a device's address.
 *
 * Forget used to clear the app's own registry and leave this behind, so on Windows, Linux and
 * Android — where the device id IS the Bluetooth address — a "forgotten" cube still had its MAC
 * on disk, and the next connect resolved a key from it without asking anything. A forget that
 * leaves the identifying value in storage is not a forget.
 *
 * Takes the device id rather than the address, because that is what the library keys on and it is
 * what a session exposes. Both spellings are removed: the id may be canonicalised differently by
 * the platform that produced it, and removing a key that is not there costs nothing.
 *
 * @returns how many entries were removed — a fact, so a caller can say nothing rather than claim.
 */
export function forgetLibraryMac(deviceId, storage = globalThis.localStorage) {
  if (typeof deviceId !== 'string' || deviceId === '') return 0;
  let removed = 0;
  for (const id of new Set([deviceId, deviceId.toUpperCase(), deviceId.toLowerCase()])) {
    const key = LIBRARY_MAC_PREFIX + id;
    try {
      // Read before removing, so the count is what was actually there rather than what was asked
      // for. A storage that throws on either call is a platform without one, not a failure to
      // report: the caller's own registry write is the part that must be loud.
      if (storage?.getItem(key) === null || storage?.getItem(key) === undefined) continue;
      storage.removeItem(key);
      removed++;
    } catch {}
  }
  return removed;
}

/** The Tauri API, or null in a browser. Mirrors host.js rather than re-deriving the check. */
function tauri() {
  return (globalThis.window && globalThis.window.__TAURI__) || null;
}

/**
 * A bridge backed by the native commands in `crates/cube-ble`.
 *
 * Every method maps to one command; the two event channels map to `ble-notification` and
 * `ble-disconnect`. Payload shapes are the Rust structs `NotificationPayload` and
 * `DisconnectPayload` — typed there on purpose, because a renamed field would otherwise arrive
 * here as `undefined` and drop packets silently rather than failing.
 */
export function makeTauriBridge(api = tauri()) {
  if (!api) throw new Error('ble-bridge: the Tauri API is not injected — this is not a native build');
  const { invoke } = api.core;
  let notifyCb = () => {};
  let discCb = () => {};
  let unlisten = [];
  let disposed = false;
  /** Subscription id -> what it addresses. Populated by `subscribe`, which is the only place the
   *  triple is sent, and read once per packet so it never has to be sent again. */
  const subscriptions = new Map();

  /**
   * Packets that arrived before the subscription they belong to was recorded.
   *
   * The id is allocated by RUST — deliberately, so Android and the desktop cannot answer the same
   * question with different numbers — which means it does not exist here until `ble_subscribe`
   * resolves. A device that starts notifying the instant the descriptor write lands can therefore
   * get a packet across before that: the id is unknown, and the packet was dropped with a warning.
   * For a smart cube the packet immediately after subscribe is usually the one carrying its current
   * state, so it is the worst one to lose.
   *
   * Held ONLY while a subscribe is actually in flight, and only up to a bound: outside that window
   * an unknown id means a stale subscription, which is a real drop and still says so.
   */
  const early = [];
  const EARLY_LIMIT = 64;
  let subscribesInFlight = 0;

  /** Deliver whatever the just-registered id was waiting on, in arrival order. */
  function drainEarly() {
    if (early.length === 0) return;
    const held = early.splice(0, early.length);
    for (const packet of held) {
      const s = subscriptions.get(packet.sub);
      if (s) {
        notifyCb({ device: s.device, service: s.service, characteristic: s.characteristic, bytes: packet.data });
      } else if (subscribesInFlight > 0) {
        early.push(packet); // another subscribe is still out; it may be that one's
      } else {
        console.warn(`ble-bridge: notification for unknown subscription ${packet.sub} — dropped`);
      }
    }
  }

  /**
   * Validate an event payload before it reaches the polyfill.
   *
   * Zero trust at boundaries, and this one is a real boundary despite both sides being ours: the
   * Rust structs are typed, but nothing checks that the JSON arriving here still matches them. A
   * renamed field crosses as `undefined`, and the polyfill would then look up a characteristic
   * keyed on "undefined", find nothing, and drop the packet — silently, forever, with no error
   * anywhere. Loud beats silent: a malformed payload is a bug in the pair, not a packet to skip.
   */
  function requireShape(kind, payload, shape, struct) {
    if (!payload || typeof payload !== 'object') {
      throw new Error(`ble-bridge: ${kind} payload is not an object (got ${typeof payload})`);
    }
    const wrong = Object.entries(shape)
      .filter(([field, type]) => typeof payload[field] !== type)
      .map(([field, type]) => `${field} (want ${type}, got ${typeof payload[field]})`);
    if (wrong.length) {
      throw new Error(
        `ble-bridge: ${kind} payload is wrong at ${wrong.join(', ')} — the Rust event shape and ` +
          `this adapter have drifted apart. See ${struct} in apps/desktop/src-tauri/src/lib.rs.`,
      );
    }
    return payload;
  }

  /**
   * Registered once, for the life of the BRIDGE — not of a connection.
   *
   * This distinction was a real bug: `disconnect()` used to drop these listeners, so the first
   * reconnect received no notifications at all and the cube looked dead. Worse, a test asserted
   * that behaviour was correct. A Tauri event listener is not scoped to a peripheral; the payload
   * carries the device id, and the polyfill routes on it.
   */
  const ready = (async () => {
    unlisten.push(
      await api.event.listen('ble-notification', (e) => {
        // The SAME validator as the disconnect below, which is why it takes types rather than a
        // list of field names: `sub` is a number and the old helper could only require strings, so
        // this branch was hand-written beside it — and then drifted, telling anyone debugging a
        // malformed DISCONNECT to go and read `NotificationPayload`.
        const p = requireShape(
          'ble-notification',
          e.payload,
          { sub: 'number', data: 'string' },
          'NotificationPayload',
        );
        // The id is resolved HERE, from what we recorded at subscribe time. The alternative is
        // what this replaced: the native side re-sending a device id and two 36-character UUIDs
        // with every packet, 20 times a second, for 20 bytes of payload — 204 bytes on the wire
        // where 54 carry anything, and every one of them serialised, copied and parsed.
        const sub = subscriptions.get(p.sub);
        if (!sub) {
          if (subscribesInFlight > 0 && early.length < EARLY_LIMIT) {
            // A subscribe is mid-flight and this may well be its first packet. Held, not dropped.
            early.push({ sub: p.sub, data: p.data });
            return;
          }
          // Loud, because a silently dropped packet is the failure this whole path avoids.
          console.warn(`ble-bridge: notification for unknown subscription ${p.sub} — dropped`);
          return;
        }
        notifyCb({
          device: sub.device,
          service: sub.service,
          characteristic: sub.characteristic,
          // Hex across the webview boundary; the polyfill decodes. A byte array costs ~6x here.
          bytes: p.data,
        });
      }),
    );
    unlisten.push(
      await api.event.listen('ble-disconnect', (e) => {
        const p = requireShape('ble-disconnect', e.payload, { device: 'string' }, 'DisconnectPayload');
        discCb({ device: p.device });
      }),
    );
  })().catch((e) => {
    // Registration is not transactional: the first listener may be installed when the second
    // fails. Release whatever landed rather than leaving half a bridge attached to the app.
    for (const off of unlisten) {
      try {
        off();
      } catch {}
    }
    unlisten = [];
    throw e;
  });

  function assertLive() {
    if (disposed) throw new Error('ble-bridge: this bridge was disposed — build a new one');
  }

  /**
   * Every command goes through here: refuse after disposal, and never run before the listeners are
   * up.
   *
   * Only `requestDevice` and `connect` used to do this, and the rest went straight to `invoke`. So a
   * disposed bridge still drove the radio — `subscribe` even repopulated the map `dispose()` had
   * just cleared, re-attaching a torn-down bridge to a live subscription. Awaiting `ready` for all
   * of them is the same argument one level on: a `read` issued before the listeners exist cannot
   * lose a packet, but a `subscribe` can, and having one rule is what stops the next method being
   * added on the wrong side of it.
   */
  async function command(name, args) {
    assertLive();
    await ready;
    // Re-checked: `ready` is a real await, so a dispose can land while we were queued behind it.
    assertLive();
    return invoke(name, args);
  }

  return {
    ready,
    // The filters come from the protocol layer's brand table. Nothing here reads them.
    requestDevice: (options) => command('ble_request_device', { options }),
    connect: (id) => command('ble_connect', { id }),
    discoverServices: (id) => command('ble_discover_services', { id }),
    discoverCharacteristics: (id, service) => command('ble_discover_characteristics', { id, service }),
    async subscribe(id, service, characteristic) {
      // Counted BEFORE the await: the window this covers opens the moment the command goes out.
      subscribesInFlight++;
      let sub;
      try {
        sub = await command('ble_subscribe', { id, service, characteristic });
        if (typeof sub !== 'number') {
          throw new Error(`ble-bridge: ble_subscribe returned ${typeof sub}, expected a subscription id`);
        }
        // A dispose that landed while the subscribe was in flight already cleared the map; adding
        // to it here would resurrect one entry of a bridge that no longer exists.
        if (disposed) throw new Error('ble-bridge: this bridge was disposed — build a new one');
        subscriptions.set(sub, { device: id, service, characteristic });
      } finally {
        subscribesInFlight--;
        // After the decrement, so a failed subscribe releases anything held for it rather than
        // leaving packets queued against an id that will never be registered.
        drainEarly();
      }
      return sub;
    },
    async unsubscribe(id, service, characteristic) {
      await command('ble_unsubscribe', { id, service, characteristic });
      for (const [sub, s] of subscriptions) {
        if (s.device === id && s.service === service && s.characteristic === characteristic) {
          subscriptions.delete(sub);
        }
      }
    },
    read: (id, service, characteristic) => command('ble_read', { id, service, characteristic }),
    write: (id, service, characteristic, bytes, withoutResponse) =>
      command('ble_write', {
        id,
        service,
        characteristic,
        data: [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''),
        withoutResponse,
      }),
    /** Ends ONE connection. Listeners survive, because a reconnect needs them. */
    disconnect: (id) => command('ble_disconnect', { id }),
    /** Tears the BRIDGE down. The only thing that releases listeners. */
    async dispose() {
      disposed = true;
      subscriptions.clear();
      // Wait for registration to settle first. Disposing while `ready` is still in flight cleared
      // an EMPTY list, and the listeners then finished registering into a bridge nobody owns —
      // still firing, attached to a polyfill that has been uninstalled. The flag above stops any
      // new work either way; this stops the leak.
      await ready.catch(() => {});
      for (const off of unlisten) {
        try {
          off();
        } catch {}
      }
      unlisten = [];
    },
    onNotification(cb) {
      notifyCb = cb;
    },
    onDisconnect(cb) {
      discCb = cb;
    },
  };
}

/**
 * Make `navigator.bluetooth` usable on this build, and say which one was used.
 *
 * Returns `{ kind, bluetooth, uninstall }`. `uninstall()` returns a promise on the native path —
 * awaiting it is how a caller knows the old listeners are gone before installing new ones.
 * `kind` is `'native'` when the polyfill is backed by
 * the Tauri bridge, `'browser'` when the platform already had Web Bluetooth, and `'none'` when
 * there is no way to reach a radio at all — Safari and Firefox, where the honest answer is that
 * smart cubes are unavailable, not that connecting mysteriously fails.
 *
 * `bluetooth` is the implementation to HAND to the protocol layer. Both kinds return one, so the
 * caller has a single path and never has to know which host it is on.
 *
 * @param {object} [hooks]
 * @param {(packet: object) => void} [hooks.onRawPacket] the capture tap (§7). Native builds only:
 *   a browser's Web Bluetooth gives no seam to tap, which is a real asymmetry rather than an
 *   oversight, and the report screen is drawn from what this returns.
 * @param {(entry: object) => void} [hooks.onTraffic] reads, writes and discovery. Forwarded for
 *   the same reason and to the same place — a capture without the outbound half replays a
 *   conversation the cube was never having.
 */
export function installBleBridge({ onRawPacket, onTraffic } = {}) {
  const api = tauri();
  if (api && NATIVE_BLE_UNSUPPORTED.includes(hostPlatform())) {
    // Same honest answer Safari and Firefox get, for the same reason: the host cannot reach a
    // radio, so say so now rather than at the end of a connect that was never going to work.
    return { kind: 'none', bluetooth: null, bridge: null, uninstall: () => {} };
  }
  if (api) {
    const bridge = makeTauriBridge(api);
    const bluetooth = createBluetooth(bridge, { onRawPacket, onTraffic });
    // Handed over, not installed.
    //
    // This used to assign to `navigator.bluetooth` because the protocol layer read that global
    // directly and there was no other way in. Mutating a global to satisfy a library is a poor
    // trade even when it works: it cannot be scoped to one connection, two consumers on a page
    // cannot both do it, and anything else reading `navigator.bluetooth` silently gets ours.
    //
    // The library takes a `bluetooth` option now (added upstream of our pin), so the polyfill is
    // an argument. `uninstall` still exists and still releases the bridge's listeners — there is
    // simply no global left to restore.
    return {
      kind: 'native',
      bluetooth,
      bridge,
      // RETURNS the promise. `dispose()` waits for listener registration to settle before it
      // releases anything, so discarding it left a caller that replaces the bridge immediately with
      // the old listeners still attached alongside the new ones — both firing into the polyfill.
      // Callers that do not care may still ignore it; the ones that must order a teardown now can.
      uninstall: () => bridge.dispose(),
    };
  }
  if (globalThis.navigator?.bluetooth) {
    // The browser's own, passed the same way, so the caller has ONE path rather than a branch.
    return { kind: 'browser', bluetooth: globalThis.navigator.bluetooth, bridge: null, uninstall: () => {} };
  }
  return { kind: 'none', bluetooth: null, bridge: null, uninstall: () => {} };
}
