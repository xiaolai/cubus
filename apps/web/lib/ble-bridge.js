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
 * Hosts where the Tauri API is injected but the native BLE bridge cannot work.
 *
 * Android's wiring now EXISTS and is still listed here, which is the unusual case worth spelling
 * out. `gen/android/.../BlePlugin.kt` implements all nine commands over Android's own GATT stack,
 * and `src-tauri/src/android_ble.rs` forwards to it, so the crash this list originally guarded —
 * btleplug's droidplug backend panicking without its Java classes — is no longer what would
 * happen. What has not happened is a phone: nothing in that path has spoken to a radio.
 *
 * THE FLIP IS THIS LINE. Delete 'android' from the array below and the app offers Bluetooth on
 * Android. Do it only after running `pnpm tauri android dev` on a device with a real cube and
 * seeing, at minimum: a scan that finds a cube advertising WITHOUT a recognisable name (the
 * manufacturer-data filter path, which is the one a summary loses); a subscribe that actually
 * delivers packets, since Android needs both `setCharacteristicNotification` AND a CCCD write and
 * the failure mode of doing one is silence rather than an error; and sustained traffic, because
 * Android GATT permits one outstanding operation per connection and a queue bug looks fine until
 * the protocol layer talks at speed.
 *
 * Compiling is not evidence. It compiled before this was written, too.
 */
const NATIVE_BLE_UNSUPPORTED = Object.freeze(['android']);

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
   * Validate an event payload before it reaches the polyfill.
   *
   * Zero trust at boundaries, and this one is a real boundary despite both sides being ours: the
   * Rust structs are typed, but nothing checks that the JSON arriving here still matches them. A
   * renamed field crosses as `undefined`, and the polyfill would then look up a characteristic
   * keyed on "undefined", find nothing, and drop the packet — silently, forever, with no error
   * anywhere. Loud beats silent: a malformed payload is a bug in the pair, not a packet to skip.
   */
  function requireFields(kind, payload, fields) {
    if (!payload || typeof payload !== 'object') {
      throw new Error(`ble-bridge: ${kind} payload is not an object (got ${typeof payload})`);
    }
    const missing = fields.filter((f) => typeof payload[f] !== 'string');
    if (missing.length) {
      throw new Error(
        `ble-bridge: ${kind} payload is missing ${missing.join(', ')} — the Rust event shape and ` +
          'this adapter have drifted apart. See NotificationPayload in apps/desktop/src-tauri/src/lib.rs.',
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
        const p = e.payload;
        if (!p || typeof p.sub !== 'number' || typeof p.data !== 'string') {
          throw new Error(
            'ble-bridge: ble-notification payload is missing sub or data — the Rust event shape ' +
              'and this adapter have drifted apart. See NotificationPayload in ' +
              'apps/desktop/src-tauri/src/lib.rs.',
          );
        }
        // The id is resolved HERE, from what we recorded at subscribe time. The alternative is
        // what this replaced: the native side re-sending a device id and two 36-character UUIDs
        // with every packet, 20 times a second, for 20 bytes of payload — 204 bytes on the wire
        // where 54 carry anything, and every one of them serialised, copied and parsed.
        const sub = subscriptions.get(p.sub);
        if (!sub) {
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
        const p = requireFields('ble-disconnect', e.payload, ['device']);
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

  return {
    ready,
    async requestDevice(options) {
      assertLive();
      await ready;
      // The filters come from the protocol layer's brand table. Nothing here reads them.
      return invoke('ble_request_device', { options });
    },
    async connect(id) {
      assertLive();
      await ready;
      return invoke('ble_connect', { id });
    },
    discoverServices: (id) => invoke('ble_discover_services', { id }),
    discoverCharacteristics: (id, service) => invoke('ble_discover_characteristics', { id, service }),
    async subscribe(id, service, characteristic) {
      const sub = await invoke('ble_subscribe', { id, service, characteristic });
      if (typeof sub !== 'number') {
        throw new Error(`ble-bridge: ble_subscribe returned ${typeof sub}, expected a subscription id`);
      }
      subscriptions.set(sub, { device: id, service, characteristic });
      return sub;
    },
    async unsubscribe(id, service, characteristic) {
      await invoke('ble_unsubscribe', { id, service, characteristic });
      for (const [sub, s] of subscriptions) {
        if (s.device === id && s.service === service && s.characteristic === characteristic) {
          subscriptions.delete(sub);
        }
      }
    },
    read: (id, service, characteristic) => invoke('ble_read', { id, service, characteristic }),
    write: (id, service, characteristic, bytes, withoutResponse) =>
      invoke('ble_write', {
        id,
        service,
        characteristic,
        data: [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''),
        withoutResponse,
      }),
    /** Ends ONE connection. Listeners survive, because a reconnect needs them. */
    disconnect: (id) => invoke('ble_disconnect', { id }),
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
 * Returns `{ kind, bluetooth, uninstall }`. `kind` is `'native'` when the polyfill is backed by
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
      uninstall: () => void bridge.dispose(),
    };
  }
  if (globalThis.navigator?.bluetooth) {
    // The browser's own, passed the same way, so the caller has ONE path rather than a branch.
    return { kind: 'browser', bluetooth: globalThis.navigator.bluetooth, bridge: null, uninstall: () => {} };
  }
  return { kind: 'none', bluetooth: null, bridge: null, uninstall: () => {} };
}
