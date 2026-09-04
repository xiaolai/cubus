// The other half of pinning the polyfill's surface.
//
// `ble-polyfill.test.mjs` asserts our objects HAVE everything in CALLED_SURFACE. That catches a
// polyfill that lost a method. It cannot catch the failure that actually happens: a pinned
// dependency is bumped, its new code reaches for a Web Bluetooth member nobody implemented, and
// the polyfill hands back `undefined`. Then the cube connects and silently reports nothing —
// which on a beginner's screen is indistinguishable from a cube that is simply asleep.
//
// So this reads the dependency's own source and asserts it calls nothing outside the surface we
// implement. It is the check dev-docs/universal-cube-driver.md §4 asks for by name: "a test that
// enumerates what the library calls, and fails when that set grows".
//
// It reads `src/` rather than `dist/` on purpose. The bundle mangles nothing relevant, but the
// source is what upstream edits, and it is shipped in the package (`files` includes `src`).

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CALLED_SURFACE, DELIBERATELY_ABSENT, createBluetooth } from '../lib/ble-polyfill.js';

const SRC = fileURLToPath(new URL('../node_modules/smartcube-web-bluetooth/src/', import.meta.url));

/**
 * Every member name in the Web Bluetooth API, across all its interfaces.
 *
 * The list is the point. Scanning for "anything that looks like a method call" would drown in the
 * library's own identifiers; scanning only for what we implement could never find something new.
 * Scanning for the whole API and subtracting what we implement finds exactly the gap.
 */
const WEB_BLUETOOTH_MEMBERS = [
  // Bluetooth
  'requestDevice', 'getAvailability', 'getDevices', 'requestLEScan',
  // BluetoothDevice
  'watchAdvertisements', 'watchingAdvertisements', 'forget', 'gatt',
  // BluetoothRemoteGATTServer
  'connect', 'disconnect', 'connected', 'getPrimaryService', 'getPrimaryServices',
  // BluetoothRemoteGATTService
  'getCharacteristic', 'getCharacteristics', 'getIncludedService', 'getIncludedServices',
  'isPrimary',
  // BluetoothRemoteGATTCharacteristic
  'readValue', 'writeValue', 'writeValueWithResponse', 'writeValueWithoutResponse',
  'startNotifications', 'stopNotifications', 'properties', 'getDescriptor', 'getDescriptors',
  // BluetoothRemoteGATTDescriptor
  'characteristic',
];

/**
 * Members whose names collide with ordinary JavaScript and cannot be attributed by a text scan.
 *
 * Named individually rather than dropped from the list, because each is a judgement: `connect` and
 * `disconnect` are implemented anyway, and `value`/`uuid`/`name`/`id`/`device`/`service` appear on
 * every object in the codebase. Leaving them in would make the scan noise; removing them silently
 * would make it a lie.
 */
const AMBIGUOUS = new Set(['connect', 'disconnect', 'connected', 'properties', 'characteristic']);

const implemented = new Set([...Object.values(CALLED_SURFACE).flat(), ...DELIBERATELY_ABSENT]);

/**
 * Implemented on purpose although the library does not currently call it.
 *
 * Named individually, with the reason, in the same spirit as the `treeShaken` lists in
 * vendor-bundles.test.mjs — an unexplained extra is indistinguishable from a stale one, and the
 * next person deletes the wrong one.
 *
 * `writeValue` is the original Web Bluetooth write, superseded by the two explicit forms the
 * library uses today. It costs three lines (it delegates to writeValueWithoutResponse, which is
 * what the spec says it does), and a dependency bump reaching for it is exactly the scenario this
 * whole file exists for — better implemented than discovered on a user's cube.
 */
const EXTRA_IMPLEMENTED = new Set(['writeValue']);

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = dir + name;
    if (statSync(p).isDirectory()) sources(p + '/', out);
    // Upstream's own tests reference the whole API to build mocks. They are not the library.
    else if (name.endsWith('.ts') && !name.includes('.test.')) out.push(p);
  }
  return out;
}

/** Strip comments, so a member named in prose is not read as a call. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * Where each Web Bluetooth member is reached, across the whole dependency.
 *
 * Scanned over the WHOLE file rather than line by line, and matching three access forms:
 * `.member`, `?.member`, and `['member']`. The line-based version missed a member access split
 * across lines by a formatter and missed bracket access entirely — either of which would let a
 * dependency bump widen the surface with this gate still green, which is the one thing it exists
 * to prevent.
 *
 * A regex is not a parser and this is not pretending to be one. It is deliberately over-eager:
 * a false positive here names a member we then implement, which costs a few lines; a false
 * negative is a silent packet loss on a user's cube.
 */
function scanCalledMembers() {
  const found = new Map();
  for (const file of sources(SRC)) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const member of WEB_BLUETOOTH_MEMBERS) {
      if (AMBIGUOUS.has(member) || found.has(member)) continue;
      const re = new RegExp(`(?:[.?]\\s*|\\[\\s*['"\`])${member}\\b`, 's');
      const m = re.exec(text);
      if (m) {
        const line = text.slice(0, m.index).split('\n').length;
        found.set(member, `${file.slice(SRC.length)}:${line}`);
      }
    }
  }
  return found;
}

describe('the Web Bluetooth surface the protocol layer calls', () => {
  test('the dependency is installed, so this gate is actually running', () => {
    // A check that quietly skips is worse than no check: it reads green on the machine that
    // needed it most. smartcube-web-bluetooth is a devDependency of apps/web, so if it is missing
    // the environment is broken and that is worth failing over.
    assert.ok(
      existsSync(SRC),
      `${SRC} is missing — run \`pnpm install\`. This gate cannot be skipped into passing.`,
    );
    assert.ok(sources(SRC).length > 5, 'suspiciously few sources — the walk is broken');
  });

  test('calls nothing we have not implemented', () => {
    const found = scanCalledMembers();

    const missing = [...found].filter(([m]) => !implemented.has(m));
    assert.deepEqual(
      missing.map(([m, where]) => `${m} (${where})`).sort(),
      [],
      'the protocol layer calls Web Bluetooth members the polyfill does not implement. Add them to ' +
        'lib/ble-polyfill.js and CALLED_SURFACE — never a stub returning undefined, which is what ' +
        'makes this failure invisible at runtime.',
    );

    // And the converse: a surface entry nothing calls is dead weight that will rot. Reported as a
    // failure rather than trimmed silently, because the right fix might be either direction.
    const unused = [...implemented].filter(
      (m) =>
        WEB_BLUETOOTH_MEMBERS.includes(m) &&
        !AMBIGUOUS.has(m) &&
        !EXTRA_IMPLEMENTED.has(m) &&
        !found.has(m),
    );
    assert.deepEqual(
      unused.sort(),
      [],
      'CALLED_SURFACE claims a member the library never calls — either the scan is wrong or the ' +
        'entry is stale',
    );
  });

  test('every deliberate extra really is one the library does not call', () => {
    // Keeps EXTRA_IMPLEMENTED from becoming a place to hide a stale entry. The load-bearing
    // assertion is the last one: without consulting the SCAN, this test could not tell an extra
    // that is genuinely uncalled from one the library has since started calling, and the entry
    // would sit here misclassified forever.
    const found = scanCalledMembers();
    for (const m of EXTRA_IMPLEMENTED) {
      assert.ok(implemented.has(m), `${m} is listed as an extra but is not implemented`);
      assert.ok(WEB_BLUETOOTH_MEMBERS.includes(m), `${m} is not a Web Bluetooth member`);
      assert.ok(
        !found.has(m),
        `${m} is listed as a deliberate extra but the library DOES call it (${found.get(m)}) — ` +
          'remove it from EXTRA_IMPLEMENTED so the surface check covers it properly',
      );
    }
  });

  test('the scan would notice a new member appearing', () => {
    // The gate's own failure mode is a regex that matches nothing. This proves it matches every
    // access form the scan claims to cover — including the two the line-based version missed.
    const sample = [
      'const s = await device.gatt?.getPrimaryServices();',
      'await c.requestLEScan({});',
      "const d = dev['forget'];",
      'const w = char',
      '  .writeValueWithResponse(buf);',
    ].join('\n');
    const hits = WEB_BLUETOOTH_MEMBERS.filter((m) =>
      new RegExp(`(?:[.?]\\s*|\\[\\s*['"\`])${m}\\b`, 's').test(sample),
    );
    assert.ok(hits.includes('forget'), 'bracket access must be matched');
    assert.ok(hits.includes('writeValueWithResponse'), 'an access split across lines must be matched');
    assert.ok(hits.includes('getPrimaryServices'), 'optional chaining must still be matched');
    assert.ok(hits.includes('requestLEScan'), 'an unimplemented member must be detectable');
    assert.ok(!implemented.has('requestLEScan'), 'and requestLEScan is indeed not implemented');
  });

  test('comments naming a member are not mistaken for calls', () => {
    const src = '// we could use .requestLEScan here one day\nconst x = 1;';
    assert.ok(!/[.?]\s*requestLEScan\b/.test(stripComments(src)), 'a comment is not a call');
  });
});

// ---- the other half of the surface: the EVENTS ---------------------------------------------
//
// Everything above is about members the polyfill's OBJECTS must have. The library also reads
// fields off the events the polyfill dispatches, and those are a second, unrelated way for the
// surface to grow — one the member scan cannot see at all, because `evt.serviceData` is a property
// read on an Event, not a call on a device.
//
// The failure is the same shape and just as quiet: an absent field arrives as `undefined`, the
// library reads it, finds nothing, and moves on. For `manufacturerData` that means no MAC, hence
// no AES key, hence a cube that connects and decodes to noise.

/** Every field of `BluetoothAdvertisingEvent`, per the Web Bluetooth spec. */
const ADVERTISEMENT_EVENT_FIELDS = [
  'device', 'uuids', 'name', 'appearance', 'txPower', 'rssi', 'manufacturerData', 'serviceData',
];

/**
 * Advertisement fields the polyfill supplies whatever the library currently reads.
 *
 * Three of the eight collide with ordinary JavaScript — `device`, `name` and `rssi` appear on
 * half the objects in any codebase — so a text scan cannot attribute them to an advertisement.
 * They are supplied unconditionally instead and asserted below by construction, which is stronger
 * than a scan would have been. `name` is deliberately NOT here: the library reads `device.name`,
 * which is on the device object and already covered by CALLED_SURFACE.
 */
const ALWAYS_SUPPLIED = ['device', 'manufacturerData', 'rssi'];

/** Fields whose names are distinctive enough for the scan to attribute honestly. */
const SCANNABLE_EVENT_FIELDS = ADVERTISEMENT_EVENT_FIELDS.filter(
  (f) => !['device', 'name', 'rssi'].includes(f),
);

/** Where the library reads each scannable advertisement field, across the whole dependency. */
function scanAdvertisementFields() {
  const found = new Map();
  for (const file of sources(SRC)) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const field of SCANNABLE_EVENT_FIELDS) {
      if (found.has(field)) continue;
      const re = new RegExp(`(?:[.?]\\s*|\\[\\s*['"\`])${field}\\b`, 's');
      const m = re.exec(text);
      if (m) found.set(field, `${file.slice(SRC.length)}:${text.slice(0, m.index).split('\n').length}`);
    }
  }
  return found;
}

/** One advertisement event, dispatched by the real polyfill over a stub transport. */
async function captureAdvertisement(manufacturerData = { 1: '000000d3c889506c54' }) {
  const bridge = {
    requestDevice: async () => ({ id: 'd', name: 'GAN16ui', rssi: -54, manufacturerData }),
    connect: async () => {},
    disconnect: async () => {},
    discoverServices: async () => [],
    discoverCharacteristics: async () => [],
    subscribe: async () => {},
    unsubscribe: async () => {},
    read: async () => '',
    write: async () => {},
    onNotification: () => {},
    onDisconnect: () => {},
  };
  const device = await createBluetooth(bridge).requestDevice({});
  const controller = new AbortController();
  const event = await new Promise((resolve) => {
    device.addEventListener('advertisementreceived', (e) => {
      controller.abort(); // one is enough; stop the polyfill asking for more
      resolve(e);
    });
    device.watchAdvertisements({ signal: controller.signal });
  });
  return event;
}

describe('the events the protocol layer reads off our dispatches', () => {
  test('every advertisement field the library reads is on the event we dispatch', async () => {
    const found = scanAdvertisementFields();
    const event = await captureAdvertisement();
    const missing = [...found]
      .filter(([field]) => event[field] === undefined)
      .map(([field, where]) => `${field} (read at ${where})`);
    assert.deepEqual(
      missing.sort(),
      [],
      'the protocol layer reads an advertisement field our event does not carry. Supply it in ' +
        "PolyfillDevice.watchAdvertisements — an absent field arrives as `undefined`, which the " +
        'library reads as "the radio saw nothing" rather than as a bug.',
    );
    // And at least one really was found, or this test is measuring an empty set.
    assert.ok(found.has('manufacturerData'), 'the GAN MAC recovery reads manufacturerData');
  });

  test('the fields too common to scan for are supplied unconditionally', async () => {
    // `device`, `manufacturerData` and `rssi` cannot be attributed by a text scan, so they are
    // asserted by construction instead: dispatch a real advertisement and look at it.
    const event = await captureAdvertisement();
    for (const field of ALWAYS_SUPPLIED) {
      assert.notEqual(event[field], undefined, `the advertisement event must carry ${field}`);
    }
    assert.equal(event.type, 'advertisementreceived');
    assert.equal(event.device.id, 'd', 'and `device` is the device, not a copy of the scan result');
    assert.equal(event.rssi, -54);
    const payload = event.manufacturerData.get(1);
    assert.ok(payload instanceof DataView, 'manufacturerData maps company id -> DataView');
    assert.equal(payload.byteOffset, 0, 'each payload owns its buffer — the extractor reads it whole');
  });

  test('an empty advertisement is an empty MAP, never a missing field', async () => {
    // The distinction the library depends on: it calls `.size` and merges, so `undefined` would
    // throw inside its listener rather than reading as "this frame carried nothing".
    const event = await captureAdvertisement({});
    assert.ok(event.manufacturerData instanceof Map);
    assert.equal(event.manufacturerData.size, 0);
  });

  test('the scan would notice a new advertisement field appearing', () => {
    // The gate's own failure mode is a regex that matches nothing. Proven against a sample that
    // contains fields the library does not currently read.
    const sample = 'const s = evt.serviceData; const t = evt?.txPower; const u = evt["uuids"];';
    const hits = SCANNABLE_EVENT_FIELDS.filter((f) =>
      new RegExp(`(?:[.?]\\s*|\\[\\s*['"\`])${f}\\b`, 's').test(sample),
    );
    assert.deepEqual(hits.sort(), ['serviceData', 'txPower', 'uuids']);
    // …and those three are not read by the library today, so the assertion above is not vacuous.
    const found = scanAdvertisementFields();
    for (const f of ['serviceData', 'txPower', 'uuids', 'appearance']) {
      assert.ok(!found.has(f), `${f} is now read at ${found.get(f)} — the polyfill must supply it`);
    }
  });
});
