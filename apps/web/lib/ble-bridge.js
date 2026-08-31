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

import { createBluetooth, installBluetooth } from './ble-polyfill.js';

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
        const p = requireFields('ble-notification', e.payload, [
          'device',
          'service',
          'characteristic',
          'data',
        ]);
        notifyCb({
          device: p.device,
          service: p.service,
          characteristic: p.characteristic,
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
    subscribe: (id, service, characteristic) => invoke('ble_subscribe', { id, service, characteristic }),
    unsubscribe: (id, service, characteristic) => invoke('ble_unsubscribe', { id, service, characteristic }),
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
 * Returns `{ kind, uninstall }`. `kind` is `'native'` when the polyfill was installed over the
 * Tauri bridge, `'browser'` when the platform already had Web Bluetooth, and `'none'` when there
 * is no way to reach a radio at all — Safari and Firefox, where the honest answer is that smart
 * cubes are unavailable, not that connecting mysteriously fails.
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
  if (api) {
    const bridge = makeTauriBridge(api);
    const restore = installBluetooth(globalThis, createBluetooth(bridge, { onRawPacket, onTraffic }));
    // Uninstalling must release the bridge too. Restoring only `navigator.bluetooth` would leave
    // the old bridge's Tauri listeners attached and still firing into a polyfill nothing uses.
    const uninstall = () => {
      restore();
      void bridge.dispose();
    };
    return { kind: 'native', uninstall, bridge };
  }
  if (globalThis.navigator?.bluetooth) {
    return { kind: 'browser', uninstall: () => {}, bridge: null };
  }
  return { kind: 'none', uninstall: () => {}, bridge: null };
}
