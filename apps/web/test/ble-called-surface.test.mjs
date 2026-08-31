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
import { CALLED_SURFACE, DELIBERATELY_ABSENT } from '../lib/ble-polyfill.js';

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
