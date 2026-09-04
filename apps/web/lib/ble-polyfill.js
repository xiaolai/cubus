// A `navigator.bluetooth` implementation over a native BLE bridge.
//
// The protocol layer (vendor/smartcube.js) is a Web Bluetooth library, and Web Bluetooth exists on
// exactly one of the shipping targets — Chromium browsers. Not WKWebView (macOS, iOS), not Android
// WebView, not WebView2, not WebKitGTK. So on every PACKAGED build the library would refuse to
// start, and there is no packet-level entry point to feed it from Rust instead: each brand's
// connect logic (which characteristics to subscribe, QiYi's AES handshake) lives inside its own
// `connect()`. See dev-docs/universal-cube-driver.md §3-4.
//
// This is the other half of the seam. Give the library the API it expects, backed by whatever can
// actually reach the radio, and one unmodified protocol layer serves every target.
//
// WHAT THIS IS NOT: a general Web Bluetooth polyfill. It implements the surface one library uses,
// measured from its source rather than guessed — see CALLED_SURFACE below, which a test pins so a
// dependency bump that reaches for something new goes red instead of returning undefined.

/**
 * The Web Bluetooth members `smartcube-web-bluetooth` actually calls, measured at rev 77df8e9 and
 * unchanged since 44f1f09 — including across the GATT-lifecycle base-class lift, which moved a lot
 * of calling code without changing which members it calls.
 *
 * This list is the contract, and ble-polyfill.test.mjs asserts two things about it: that every
 * name here exists on the objects we hand out, and that the library's own source calls nothing
 * outside it. The realistic failure of a pinned dependency is a version bump reaching for a method
 * we never implemented — which, without this, surfaces as a cube that connects and then silently
 * reports nothing.
 */
export const CALLED_SURFACE = Object.freeze({
  bluetooth: ['requestDevice'],
  device: ['id', 'name', 'gatt', 'watchAdvertisements', 'addEventListener', 'removeEventListener'],
  server: ['connected', 'connect', 'disconnect', 'getPrimaryService', 'getPrimaryServices'],
  service: ['uuid', 'getCharacteristic', 'getCharacteristics'],
  characteristic: [
    'uuid',
    'value',
    'properties',
    'readValue',
    'writeValue',
    'writeValueWithResponse',
    'writeValueWithoutResponse',
    'startNotifications',
    'stopNotifications',
    'addEventListener',
    'removeEventListener',
  ],
});

/**
 * Members absent on purpose. Empty, and the history is why it is worth keeping.
 *
 * `watchAdvertisements` was here. The plan (§4) said to omit it and supply the MAC through the
 * library's `macAddressProvider`, on the grounds that the native side had already recovered it
 * properly. Building the native side is what showed that reasoning to be backwards: recovering a
 * MAC from manufacturer data is BRAND-SPECIFIC — company-id list, offset and byte order all differ
 * — so doing it in Rust puts per-brand knowledge back in the transport, which is the one thing
 * `crates/cube-ble` must not contain. The advertisement is reported verbatim instead and the
 * protocol layer extracts per brand, which is where that knowledge already lives for ten
 * protocols.
 *
 * The library still feature-detects it, so an entry here would remain a supported answer — but it
 * would mean GAN cubes could not derive a key on any packaged build.
 */
export const DELIBERATELY_ABSENT = Object.freeze([]);

const BLUETOOTH_BASE = '-0000-1000-8000-00805f9b34fb';

/** Canonical lowercase 128-bit form. Accepts 16-bit numbers, "fff6", and full UUIDs — the library
 *  mixes all three, and two spellings of one characteristic is a lookup that silently finds
 *  nothing. */
export function canonicalUuid(uuid) {
  if (typeof uuid === 'number') return `0000${uuid.toString(16).padStart(4, '0')}${BLUETOOTH_BASE}`;
  const s = String(uuid).toLowerCase();
  if (/^[0-9a-f]{4}$/.test(s)) return `0000${s}${BLUETOOTH_BASE}`;
  if (/^[0-9a-f]{8}$/.test(s)) return `${s}${BLUETOOTH_BASE}`;
  return s;
}

/** One conversion path, and it goes through toBytes so hex is handled everywhere.
 *
 *  This function used to do its own `Uint8Array.from(bytes)`, which silently turned a hex string
 *  into character codes — the SECOND appearance of that defect, after the manufacturer-data one.
 *  Both hot paths run through here (every notification, every read), so in production every packet
 *  would have been garbage while the tests passed, because the test bridges handed over
 *  Uint8Arrays and the real Tauri bridge hands over hex. There is one decoder now; a third caller
 *  cannot reintroduce the bug by writing its own. */
function toDataView(bytes) {
  const u8 = toBytes(bytes);
  return new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
}

/** Bytes from a Uint8Array, an ArrayBuffer, a plain array, or a HEX STRING.
 *
 *  The hex case is not decoration: the native bridge sends payloads as hex across the webview
 *  boundary, and `Uint8Array.from('00c8d3')` yields the CHARACTER CODES — plausible-looking bytes
 *  that are not the data. For manufacturer data that is a wrong MAC, hence a wrong AES key, hence
 *  a cube that connects and decodes to noise. Found by the layout cross-check in
 *  ble-polyfill.test.mjs, which is the only reason it is not a hardware mystery. */
function toBytes(value) {
  if (typeof value === 'string') {
    if (!/^([0-9a-fA-F]{2})*$/.test(value)) {
      throw new Error(`ble-polyfill: expected hex, got ${JSON.stringify(value.slice(0, 24))}`);
    }
    return Uint8Array.from((value.match(/../g) ?? []).map((h) => Number.parseInt(h, 16)));
  }
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return Uint8Array.from(value);
}

/** A member the library reached for and we never implemented. Loud, by name, with the reason —
 *  because the alternative is `undefined` behaving like a working call that reports nothing. */
function unimplemented(iface, member) {
  return () => {
    throw new Error(
      `ble-polyfill: ${iface}.${member} is not implemented. The protocol layer called a Web ` +
        'Bluetooth member outside the measured surface — see CALLED_SURFACE in lib/ble-polyfill.js. ' +
        'If a dependency bump introduced it, implement it here rather than stubbing it out.',
    );
  };
}

class PolyfillCharacteristic extends EventTarget {
  constructor(service, uuid, properties) {
    super();
    this.service = service;
    this.uuid = uuid;
    this.properties = properties;
    this.value = null;
    this._notifying = false;
    // Buffered notifications, and the reason they exist.
    //
    // The native side begins delivering the moment it subscribes, but the library attaches its
    // listener AFTER awaiting startNotifications(). Anything arriving in that window would be
    // dispatched to an EventTarget with no listener and vanish — and a dropped early packet is not
    // a cosmetic loss: a driver takes the first move serial it sees as its gap baseline, so a move
    // lost there is never reported missing. The GAN-only transport this replaced solved it once
    // and was deleted with the driver — a rewrite is exactly where such a fix gets lost, so it is
    // reimplemented here on purpose rather than inherited.
    this._queue = [];
    this._listening = false;
  }

  addEventListener(type, cb, opts) {
    super.addEventListener(type, cb, opts);
    if (type === 'characteristicvaluechanged' && !this._listening) {
      this._listening = true;
      // Flush in a microtask so the caller finishes attaching before events land, and in arrival
      // order — a reordered move stream is worse than a late one.
      queueMicrotask(() => {
        const queued = this._queue;
        this._queue = [];
        for (const dv of queued) this._dispatch(dv);
      });
    }
  }

  /** Called by the bridge when a notification arrives for this characteristic. */
  _notify(bytes) {
    const dv = toDataView(bytes);
    if (this._listening) this._dispatch(dv);
    else this._queue.push(dv);
  }

  _dispatch(dv) {
    this.value = dv;
    const ev = new Event('characteristicvaluechanged');
    // Web Bluetooth hands the characteristic back as event.target; the library reads
    // `ev.target.value`. Event.target is read-only and set by dispatch, so this is correct as-is,
    // but it is stated here because a hand-rolled event object is the obvious wrong shortcut.
    this.dispatchEvent(ev);
  }

  async readValue() {
    const bytes = await this.service.device._bridge.read(
      this.service.device.id,
      this.service.uuid,
      this.uuid,
    );
    this.value = toDataView(bytes);
    this.service.device._traffic({
      op: 'read',
      service: this.service.uuid,
      characteristic: this.uuid,
      bytes: toBytes(bytes),
    });
    return this.value;
  }

  async writeValue(value) {
    return this.writeValueWithoutResponse(value);
  }

  async writeValueWithResponse(value) {
    this.service.device._traffic({
      op: 'write',
      service: this.service.uuid,
      characteristic: this.uuid,
      bytes: toBytes(value),
    });
    await this.service.device._bridge.write(
      this.service.device.id,
      this.service.uuid,
      this.uuid,
      toBytes(value),
      false,
    );
  }

  async writeValueWithoutResponse(value) {
    this.service.device._traffic({
      op: 'write',
      service: this.service.uuid,
      characteristic: this.uuid,
      bytes: toBytes(value),
    });
    await this.service.device._bridge.write(
      this.service.device.id,
      this.service.uuid,
      this.uuid,
      toBytes(value),
      true,
    );
  }

  async startNotifications() {
    // The flag moves only after the bridge agrees. Setting it first meant a REJECTED subscribe
    // left the characteristic claiming to be notifying, so a retry became a silent no-op and the
    // cube looked connected while delivering nothing.
    if (!this._notifying) {
      await this.service.device._bridge.subscribe(
        this.service.device.id,
        this.service.uuid,
        this.uuid,
      );
      this._notifying = true;
    }
    return this;
  }

  async stopNotifications() {
    if (this._notifying) {
      // Cleared FIRST here, and deliberately asymmetric with start: if the native unsubscribe
      // fails we still want to stop treating this characteristic as live, because the alternative
      // is a stream the app believes it has stopped listening to.
      this._notifying = false;
      await this.service.device._bridge.unsubscribe(
        this.service.device.id,
        this.service.uuid,
        this.uuid,
      );
    }
    return this;
  }
}

class PolyfillService {
  constructor(device, uuid) {
    this.device = device;
    this.uuid = uuid;
    this._chars = new Map();
  }

  async _load() {
    if (this._chars.size) return;
    const list = await this.device._bridge.discoverCharacteristics(this.device.id, this.uuid);
    for (const c of list) {
      const uuid = canonicalUuid(c.uuid);
      this.device._traffic({ op: 'discover-char', service: this.uuid, characteristic: uuid });
      this._chars.set(uuid, new PolyfillCharacteristic(this, uuid, Object.freeze({ ...c.properties })));
    }
  }

  async getCharacteristic(uuid) {
    await this._load();
    const found = this._chars.get(canonicalUuid(uuid));
    if (!found) {
      // Web Bluetooth throws NotFoundError here, and the library's brand resolution depends on the
      // rejection to rule a protocol out. Resolving with undefined would make every brand "match".
      throw new DOMException(
        `No Characteristic matching ${canonicalUuid(uuid)} found in service ${this.uuid}.`,
        'NotFoundError',
      );
    }
    return found;
  }

  async getCharacteristics() {
    await this._load();
    return [...this._chars.values()];
  }
}

class PolyfillServer {
  constructor(device) {
    this.device = device;
    this.connected = false;
    this._services = new Map();
    /** The native release currently in flight, or null. See `disconnect`. */
    this._releasing = null;
  }

  async connect() {
    await this.device._bridge.connect(this.device.id);
    this.connected = true;
    return this;
  }

  /**
   * Forget everything discovered over the link that has just gone.
   *
   * Service and characteristic handles are properties of a CONNECTION, not of a device, and the
   * polyfill reuses one `PolyfillDevice` per address for the life of the page. Keeping them meant
   * `_load()` saw a non-empty map on the next connect and returned without discovering anything,
   * and every characteristic still claimed `_notifying`, so `startNotifications()` became a no-op
   * and `ble_subscribe` was never issued: the cube connected, reported nothing, and looked asleep.
   *
   * Queued notifications go with them on purpose — a packet from the dead connection delivered
   * into the new one is a move that never happened.
   */
  _forget() {
    for (const service of this._services.values()) {
      for (const chr of service._chars.values()) {
        chr._notifying = false;
        chr._queue = [];
      }
      service._chars.clear();
    }
    this._services.clear();
  }

  /**
   * Web Bluetooth's `disconnect()` is synchronous and returns void; this one returns a promise.
   *
   * That is a strict widening, and it is the half a native transport needs: the peripheral is
   * still held until the native command lands, so anything that reconnects on the next line races
   * a release that has not happened — which is how the following scan stares into silence at a
   * cube sitting on the desk. A caller that ignores the return value gets exactly the old
   * behaviour, and this never rejects, so an ignored promise cannot become an unhandled rejection.
   * A failed release is reported instead, because a peripheral the native side never let go of is
   * the one fault that looks identical to a clean goodbye.
   */
  disconnect() {
    this.connected = false;
    this._forget();
    const releasing = Promise.resolve()
      .then(() => this.device._bridge.disconnect(this.device.id))
      .catch((e) => {
        console.warn('ble-polyfill: native disconnect failed', e);
      })
      .finally(() => {
        // Only if it is still ours: two disconnects in a row would otherwise have the first one's
        // completion clear a release that is still in flight.
        if (this._releasing === releasing) this._releasing = null;
      });
    this._releasing = releasing;
    return releasing;
  }

  async _load() {
    if (this._services.size) return;
    const uuids = await this.device._bridge.discoverServices(this.device.id);
    for (const u of uuids) {
      const uuid = canonicalUuid(u);
      this.device._traffic({ op: 'discover-service', service: uuid });
      this._services.set(uuid, new PolyfillService(this.device, uuid));
    }
  }

  async getPrimaryService(uuid) {
    if (!this.connected) await this.connect();
    await this._load();
    const found = this._services.get(canonicalUuid(uuid));
    if (!found) {
      throw new DOMException(`No Services matching UUID ${canonicalUuid(uuid)} found.`, 'NotFoundError');
    }
    return found;
  }

  async getPrimaryServices() {
    if (!this.connected) await this.connect();
    await this._load();
    return [...this._services.values()];
  }
}

/**
 * How many further scans one `watchAdvertisements` may ask the bridge for.
 *
 * Bounded rather than open-ended: the caller's own abort is the normal stop (it fires the moment
 * the library has what it needs), and this is the backstop for a caller that never aborts. Eight
 * covers the GAN case measured upstream — the first advertisement's manufacturer-data map is
 * routinely empty and the MAC-bearing frame arrives a few packets later — without turning a cube
 * that has gone to sleep into an unbounded scan loop.
 */
const EXTRA_ADVERTISEMENT_SCANS = 8;

class PolyfillDevice extends EventTarget {
  constructor(bridge, info, traffic = () => {}, rescan = null) {
    super();
    this._bridge = bridge;
    this._traffic = traffic;
    /** Ask the transport for a fresh advertisement for this device, or null if it cannot. */
    this._rescan = rescan;
    this.id = info.id;
    this.name = info.name ?? '';
    this._rssi = info.rssi ?? null;
    this.gatt = new PolyfillServer(this);
    // Company id -> payload, exactly as a browser's BluetoothAdvertisingEvent exposes it: the
    // bytes AFTER the two-byte company id, which is also what btleplug hands us.
    //
    // Each DataView owns its own ArrayBuffer, and that is load-bearing rather than tidy. The
    // library's GAN extractor does `manufacturerData.get(id).buffer.slice(0, 9)` — it reads the
    // BUFFER and ignores byteOffset — so a view into a shared buffer would silently yield another
    // payload's bytes, and the symptom is a wrong AES key: the cube connects, streams, and decodes
    // to noise.
    this._manufacturerData = new Map();
    this._mergeManufacturerData(info.manufacturerData);
    for (const m of DELIBERATELY_ABSENT) {
      // Absent, not broken: defining a throwing stub would defeat the library's feature detection
      // and turn a supported "no" into a crash. Asserted by test rather than left to memory.
      if (m in this) delete this[m];
    }
  }

  /**
   * Merge a scan result's manufacturer data into what this device has broadcast so far.
   *
   * Accumulated rather than replaced, because that is how the payload actually arrives: a cube
   * broadcasts several frames and the interesting one is rarely the first. Answers whether
   * anything new landed.
   *
   * Each payload owns its own ArrayBuffer, and that is load-bearing rather than tidy. The
   * library's GAN extractor reads `manufacturerData.get(id).buffer` and slices from the buffer's
   * start — so a view into a shared buffer would silently yield another payload's bytes, and the
   * symptom is a wrong AES key: the cube connects, streams, and decodes to noise.
   */
  _mergeManufacturerData(data) {
    let added = false;
    for (const [id, bytes] of Object.entries(data ?? {})) {
      const u8 = toBytes(bytes);
      const owned = new Uint8Array(u8.length);
      owned.set(u8);
      const key = Number(id);
      const before = this._manufacturerData.get(key);
      // A later frame replaces an earlier one for the same company id — never truncates it. An
      // empty or shorter payload for an id we already hold carries strictly less.
      if (before && before.byteLength >= owned.length) continue;
      this._manufacturerData.set(key, new DataView(owned.buffer));
      added = true;
    }
    return added;
  }

  /**
   * Report the advertisements this device is broadcasting.
   *
   * A browser streams these as the radio sees them, and the protocol layer counts on that: its MAC
   * recovery MERGES frames until its own timeout, precisely because the first advertisement's
   * manufacturer-data map is routinely empty and the MAC-bearing frame arrives later. Delivering
   * exactly one — the scan result that produced this device — meant a GAN cube whose first frame
   * was empty could never yield a MAC on a packaged build, and the connect failed with "Unable to
   * determine cube MAC address" for a cube sitting on the desk.
   *
   * So this keeps asking the transport for a fresh advertisement, merging each into what the
   * device has broadcast so far and reporting the union, until the caller aborts — which it does
   * the moment its filter is satisfied — or the bound above is reached. A transport with no way to
   * scan again delivers the one it has, exactly as before.
   *
   * Asynchronous on purpose, including the first: the library attaches its listener and only then
   * awaits this call, so a synchronous dispatch would fire into no listener and leave it waiting
   * out its full timeout on every connect.
   */
  async watchAdvertisements(options = {}) {
    const signal = options.signal;
    if (signal?.aborted) return;
    const report = () => {
      if (signal?.aborted) return false;
      const ev = new Event('advertisementreceived');
      ev.device = this;
      ev.manufacturerData = this._manufacturerData;
      ev.rssi = this._rssi;
      this.dispatchEvent(ev);
      return true;
    };
    queueMicrotask(async () => {
      if (!report() || !this._rescan) return;
      for (let i = 0; i < EXTRA_ADVERTISEMENT_SCANS; i++) {
        if (signal?.aborted) return;
        let info;
        try {
          info = await this._rescan();
        } catch {
          // A scan that cannot run is not a failure of this call: the first advertisement was
          // still reported, which is exactly the old behaviour. Stop asking rather than looping.
          return;
        }
        // Another cube answered the same filter. Reporting its payload under this device's name
        // would derive a key for the wrong cube, which is worse than reporting nothing.
        if (!info || info.id !== this.id) return;
        this._rssi = info.rssi ?? this._rssi;
        this._mergeManufacturerData(info.manufacturerData);
        if (!report()) return;
      }
    });
  }
}

/**
 * Build a `navigator.bluetooth` over a native bridge.
 *
 * The bridge is the only thing that differs per platform, and it is deliberately small:
 *
 *   requestDevice(options)                            -> { id, name, mac? }
 *   connect(id)                                       -> void
 *   discoverServices(id)                              -> [uuid]
 *   discoverCharacteristics(id, service)              -> [{ uuid, properties }]
 *   subscribe(id, service, characteristic)            -> void
 *   unsubscribe(id, service, characteristic)          -> void
 *   read(id, service, characteristic)                 -> bytes
 *   write(id, service, char, bytes, withoutResponse)  -> void
 *   disconnect(id)                                    -> void
 *   onNotification(cb)   cb({ device, service, characteristic, bytes })
 *   onDisconnect(cb)     cb({ device })
 *
 * @param {object} bridge
 * @param {object} [hooks]
 * @param {(packet: {device: string, service: string, characteristic: string, bytes: Uint8Array,
 *   at: number}) => void} [hooks.onRawPacket] every inbound notification, before decoding.
 * @param {(op: {op: string, service: string, characteristic?: string, bytes?: Uint8Array}) => void}
 *   [hooks.onTraffic] every OUTBOUND and structural operation — reads, writes, and service and
 *   characteristic discovery.
 *
 *   Notifications alone do not make a replayable capture. A protocol's handshake is a WRITE, and a
 *   recording that omits it replays a conversation the cube was never actually having — which is
 *   why upstream's own fixture format records all six operation kinds rather than just `notify`.
 */
export function createBluetooth(bridge, { onRawPacket, onTraffic } = {}) {
  const devices = new Map();
  // Handed to every device so the whole object graph can report what it did, without each class
  // needing a reference back to this factory's options.
  const traffic = (entry) => {
    if (!onTraffic) return;
    try {
      onTraffic(entry);
    } catch (e) {
      console.warn('ble-polyfill: traffic tap threw', e);
    }
  };

  bridge.onNotification(({ device, service, characteristic, bytes }) => {
    // The capture tap. Every notification for every brand passes here, including one no protocol
    // recognises — which is the whole reason a compatibility report can exist at all (§7). It runs
    // BEFORE decoding, and a throwing tap must never cost a packet.
    if (onRawPacket) {
      try {
        onRawPacket({
          device,
          service: canonicalUuid(service),
          characteristic: canonicalUuid(characteristic),
          bytes: toBytes(bytes),
          at: Date.now(),
        });
      } catch (e) {
        console.warn('ble-polyfill: capture tap threw', e);
      }
    }
    const dev = devices.get(device);
    const svc = dev?.gatt._services.get(canonicalUuid(service));
    const chr = svc?._chars.get(canonicalUuid(characteristic));
    if (chr) {
      chr._notify(bytes);
      return;
    }
    // Dropped, but never in silence. This means the native side is subscribed to something the
    // library never asked for — a bridge bug — and the old comment correctly identified it as one
    // while saying nothing when it happened. A silently discarded packet is indistinguishable
    // from a cube that stopped talking, which is the single hardest smart-cube symptom to
    // diagnose. Throwing here would kill the stream over someone else's mistake; saying so does
    // not.
    console.warn(
      `ble-polyfill: notification for an unroutable ${dev ? 'characteristic' : 'device'} ` +
        `(device=${device} service=${canonicalUuid(service)} characteristic=${canonicalUuid(characteristic)}) — dropped`,
    );
  });

  bridge.onDisconnect(({ device }) => {
    const dev = devices.get(device);
    if (!dev) return;
    dev.gatt.connected = false;
    // Everything discovered belonged to the link that has just gone. Dropped BEFORE the event, so
    // a listener that reconnects synchronously re-discovers rather than reusing dead handles —
    // which is what made a reconnect through the same polyfill skip `ble_subscribe` entirely and
    // leave the cube connected and silent.
    dev.gatt._forget();
    dev.dispatchEvent(new Event('gattserverdisconnected'));
  });

  return {
    async requestDevice(options) {
      const filters = options ?? {};
      const info = await bridge.requestDevice(filters);
      if (!info) {
        // Web Bluetooth rejects when the chooser is dismissed; the library treats a rejection as
        // "the user changed their mind" and a resolution as "here is your cube".
        throw new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError');
      }
      const existing = devices.get(info.id);
      if (existing) {
        // A second scan for a device we already hold still carries an advertisement: merge it,
        // because that is the payload the caller went looking for.
        existing._mergeManufacturerData(info.manufacturerData);
        return existing;
      }
      // The rescan closure carries the filters this device was FOUND by, so a later advertisement
      // is asked for the same way. Nothing else in the polyfill remembers them, and asking with a
      // different set would be a different question.
      const dev = new PolyfillDevice(bridge, info, traffic, () => bridge.requestDevice(filters));
      devices.set(info.id, dev);
      return dev;
    },

    getAvailability: unimplemented('Bluetooth', 'getAvailability'),
    getDevices: unimplemented('Bluetooth', 'getDevices'),
    addEventListener: unimplemented('Bluetooth', 'addEventListener'),

    /**
     * Resolve once no native release is still in flight. NOT part of Web Bluetooth.
     *
     * The protocol layer's own teardown calls `gatt.disconnect()` without awaiting it, which is
     * correct against the real API — there, disconnect returns void — and leaves an app that wants
     * to reconnect with nothing to wait on. This is that something. It is the app's handle, not
     * the library's: the library keeps working unchanged, and a caller who needs the radio to have
     * actually let go can say so.
     */
    async whenReleased() {
      for (const dev of devices.values()) await dev.gatt._releasing;
    },

    /** Test and diagnostic access. Not part of the Web Bluetooth surface. */
    _devices: devices,
  };
}

/** Install onto a global. Returns a function that puts back whatever was there. */
export function installBluetooth(target, bluetooth) {
  const nav = target.navigator ?? (target.navigator = {});
  const had = Object.prototype.hasOwnProperty.call(nav, 'bluetooth');
  const previous = nav.bluetooth;
  Object.defineProperty(nav, 'bluetooth', { value: bluetooth, configurable: true, writable: true });
  return () => {
    if (had) Object.defineProperty(nav, 'bluetooth', { value: previous, configurable: true, writable: true });
    else delete nav.bluetooth;
  };
}
