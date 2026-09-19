// Which host is this: the predicate every desktop-only capability now asks, because the mobile
// shells (2026-08-30) made `window.__TAURI__` stop meaning "desktop". The tests that matter are
// the negative ones — an unknown or mobile platform must not read as a desktop.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DESKTOP_PLATFORMS, hostPlatform, isDesktopHost } from '../lib/host.js';

/** Publish a platform the way boot() does — on <html data-platform>. */
const onPlatform = (platform) => {
  globalThis.document = { documentElement: { dataset: { platform } } };
};
const noDocument = () => {
  delete globalThis.document;
};

test('the three desktop platforms are desktops, and the two mobile ones are not', () => {
  for (const platform of ['macos', 'windows', 'linux']) {
    onPlatform(platform);
    assert.equal(isDesktopHost(), true, `${platform} is a desktop`);
    assert.equal(hostPlatform(), platform);
  }
  for (const platform of ['ios', 'android']) {
    onPlatform(platform);
    assert.equal(isDesktopHost(), false, `${platform} is not a desktop`);
  }
  noDocument();
});

test('an unknown or absent platform is not a desktop', () => {
  // The unknown case falls to the side that promises less: before boot() publishes, and in a
  // plain Node harness, there is no evidence of a desktop and none may be assumed.
  noDocument();
  assert.equal(hostPlatform(), null);
  assert.equal(isDesktopHost(), false);
  onPlatform('freebsd');
  assert.equal(isDesktopHost(), false, 'a platform nobody listed is not a desktop by default');
  onPlatform(undefined);
  assert.equal(isDesktopHost(), false, 'an unset data-platform is not a desktop');
  noDocument();
});

test('the list is frozen — a capability cannot widen it by assignment', () => {
  assert.throws(() => DESKTOP_PLATFORMS.push('ios'), TypeError);
  assert.deepEqual([...DESKTOP_PLATFORMS], ['macos', 'windows', 'linux']);
});

// Imported inside the case: the classifier was lifted out of window-chrome.js's detectPlatform
// (found by audit, 2026-09-13), where the table of cases needed a whole browser window to write.
test('the platform a user agent and a finger describe: an iPad is the Mac with a finger', async () => {
  const { PLATFORMS, classifyDevice } = await import('../lib/host.js');
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
  assert.equal(classifyDevice(MAC, true), 'ios', 'iPadOS calls itself a Mac; the finger gives it away');
  assert.equal(classifyDevice(MAC, false), 'macos');
  assert.equal(classifyDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', false), 'ios');
  assert.equal(classifyDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8)', true), 'android');
  assert.equal(classifyDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', false), 'windows');
  assert.equal(classifyDevice('Mozilla/5.0 (X11; Linux x86_64)', false), 'linux');
  assert.deepEqual([...PLATFORMS].sort(), ['android', 'ios', 'linux', 'macos', 'windows']);
  assert.throws(() => PLATFORMS.push('bogus'), TypeError, 'the pin list must be frozen too');
});

// The study's sticker view needs a scanner that says where each sticker sits in the picture: the
// browser runtime (it has the frame) and the Apple plugin (wire version 2). Windows' and Android's
// plugins do not yet, and the Settings switch is not drawn there (dev-docs/scan-guidance-plan.md 5).
/** Stand in for the device, or take the stand-in away. Node's own `navigator` has only a getter, so
 *  it is redefined rather than assigned — and put back from its own descriptor. */
function useDevice(value) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  if (value === undefined) delete globalThis.navigator;
  else Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
  return () => {
    delete globalThis.navigator;
    if (had) Object.defineProperty(globalThis, 'navigator', had);
  };
}

test('the platform says what a build of its shape is expected to do, and unknown means no', async () => {
  const { PLATFORMS, platformPlacesStickers: scannerPlacesStickers } = await import('../lib/host.js');
  // Every platform the app knows, answered one way or the other — tied to PLATFORMS, so a platform
  // added there without a decision here fails this rather than inheriting one (audit, 2026-09-19).
  const places = { macos: true, ios: true, linux: true, windows: false, android: false };
  assert.deepEqual(Object.keys(places).sort(), [...PLATFORMS].sort(), 'a platform has no answer here');
  for (const [platform, expected] of Object.entries(places)) {
    assert.equal(scannerPlacesStickers(false, platform), true, `the browser build has the frame on ${platform}`);
    assert.equal(scannerPlacesStickers(true, platform), expected, `the native build on ${platform}`);
  }
  // And a native build whose platform nobody has named — before boot publishes one, or a platform
  // this build has never heard of — answers NO: the row it draws would offer a view the scanner
  // cannot feed.
  for (const platform of [null, '', 'freebsd', 'visionos']) {
    assert.equal(scannerPlacesStickers(true, platform), false, `a native build on ${String(platform)}`);
  }
  // Asked with NO arguments, it reads the DEVICE — the user agent and a finger — and never the
  // `<html data-platform>` a design-review pin writes: a pin answers "what should this screen look
  // like", not "what can the scanner on this machine do" (audit, 2026-09-19).
  const hadDocument = 'document' in globalThis;
  const wasDocument = globalThis.document;
  let restoreDevice = () => {};
  try {
    globalThis.document = { documentElement: { dataset: { platform: 'macos' } } }; // the pin says yes…
    for (const [ua, expected] of [
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', true],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', false],
      ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', false],
      ['Mozilla/5.0 (X11; Linux x86_64)', true],
      // An agent this app has never heard of names NO platform, and a capability is not inherited by
      // one: `classifyDevice` reads it as Linux for chrome's sake, which would offer desktop Linux's
      // scanner capabilities to a machine nobody has looked at (audit, 2026-09-19).
      ['Mozilla/5.0 (SomeFuturePhone 3.0)', false],
      ['Node.js/24.18.0', false],
      ['', false],
    ]) {
      restoreDevice();
      restoreDevice = useDevice({ userAgent: ua, maxTouchPoints: 0 });
      assert.equal(scannerPlacesStickers(true), expected, `the machine behind ${ua}`);
      assert.equal(scannerPlacesStickers(false), true, `the browser build on ${ua}`);
    }
    // …and it cannot turn the answer on for a machine whose scanner could not feed the view.
    restoreDevice();
    restoreDevice = useDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)', maxTouchPoints: 5 });
    assert.equal(scannerPlacesStickers(true), false, 'a pin claiming macOS offered the view on an Android build');
    // With no navigator at all — a plain Node test — a native build promises nothing.
    restoreDevice();
    restoreDevice = useDevice(undefined);
    assert.equal(scannerPlacesStickers(true), false, 'a native build with no device to read');
  } finally {
    restoreDevice();
    if (hadDocument) globalThis.document = wasDocument;
    else delete globalThis.document;
  }
});

// The platform is a GUESS — `<html data-platform>` is what a design-review pin writes — so the row
// that offers the study's view follows what the scanner has actually been seen to do, and falls back
// to the guess only until there is a report to read (audit, 2026-09-19).
test('what the scanner has shown outranks the platform, and a report says nothing until it shows something', async () => {
  const { forgetScannerReports, noteScanReport, platformPlacesStickers, scannerPlacesStickers } =
    await import('../lib/host.js');
  const hadDocument = 'document' in globalThis;
  const wasDocument = globalThis.document;
  let restoreDevice = () => {};
  /** The DEVICE the guess is read from — the pin is no longer part of this answer. */
  const device = (ua, touch = 0) => {
    restoreDevice();
    restoreDevice = useDevice({ userAgent: ua, maxTouchPoints: touch });
  };
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8)';
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
  const tauri = () => { globalThis.__TAURI__ = {}; };
  const browser = () => { delete globalThis.__TAURI__; };
  try {
    // A native build whose plugin cannot place stickers, whose scanner then does: the row appears,
    // because the scanner is the one that knows.
    forgetScannerReports();
    device(ANDROID, 5);
    tauri();
    assert.equal(platformPlacesStickers(), false, 'precondition: the platform would say no');
    assert.equal(scannerPlacesStickers(), false, 'with nothing shown, the platform stands');
    noteScanReport({ runtime: 'native', live: null, seen: null });
    assert.equal(scannerPlacesStickers(), false, 'a report that showed nothing changed the answer');
    noteScanReport({ runtime: 'native', live: 'U', seen: { width: 640, height: 480, stickers: [] } });
    assert.equal(scannerPlacesStickers(), true, "the scanner placed stickers and the platform's no stood");

    // And the other way: a build the device vouches for, whose scanner reads a side and places none.
    forgetScannerReports();
    device(MAC);
    assert.equal(platformPlacesStickers(), true, 'precondition: the platform would say yes');
    noteScanReport({ runtime: 'native', live: 'U', seen: null });
    assert.equal(scannerPlacesStickers(), false, "the scanner placed none and the platform's yes stood");

    // A scanner that HAS placed stickers is not unlearned by a later report that shows nothing — the
    // camera goes quiet between sides, and the capability does not come and go with it.
    noteScanReport({ runtime: 'native', live: 'U', seen: { width: 640, height: 480, stickers: [] } });
    noteScanReport({ runtime: 'native', live: null, seen: null });
    assert.equal(scannerPlacesStickers(), true, 'a quiet tick took the capability away');

    forgetScannerReports();
    browser();
    assert.equal(scannerPlacesStickers(), true, 'the browser build has the frame');
  } finally {
    browser();
    forgetScannerReports();
    restoreDevice();
    if (hadDocument) globalThis.document = wasDocument;
    else delete globalThis.document;
  }
});

test('what the scanner showed is remembered between visits, and a hostile value is ignored', async () => {
  // The platform's guess is only ever used on a device that has NEVER scanned: after one scan the
  // answer is the scanner's own, from the first screen of the next visit (audit, 2026-09-19).
  const store = new Map();
  const hadStorage = 'localStorage' in globalThis;
  const wasStorage = globalThis.localStorage;
  const hadDocument = 'document' in globalThis;
  const wasDocument = globalThis.document;
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.document = { documentElement: { dataset: { platform: 'macos' } } };
  // The DEVICE decides the guess, so the precondition is a Mac's agent — the pin above is there to
  // show it makes no difference either way.
  const restoreDevice = useDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 });
  globalThis.__TAURI__ = {};
  try {
    // A scanner that read a side and placed nothing, on a platform whose guess says it can.
    const first = await import('../lib/host.js?remembered=1');
    first.forgetScannerReports();
    assert.equal(first.scannerPlacesStickers(), true, 'precondition: the platform would say yes');
    first.noteScanReport({ runtime: 'native', live: 'U', seen: null });
    assert.equal(store.get('cubusScannerPlaces'), '0', 'what the scanner did was not kept');

    // A fresh load of the module is a fresh visit: it reads what was kept, before any scan.
    const next = await import('../lib/host.js?remembered=2');
    assert.equal(next.scannerPlacesStickers(), false, 'the next visit went back to the platform guess');

    // A value the app never writes is not a value: ignored, and the guess stands again.
    store.set('cubusScannerPlaces', 'maybe');
    const hostile = await import('../lib/host.js?remembered=3');
    assert.equal(hostile.scannerPlacesStickers(), true, 'a value the app cannot have written was believed');

    // And forgetting clears the keeping too, so a test cannot leave one behind.
    hostile.noteScanReport({ runtime: 'native', live: 'U', seen: { width: 1, height: 1, stickers: [] } });
    assert.equal(store.get('cubusScannerPlaces'), '1');
    hostile.forgetScannerReports();
    assert.equal(store.has('cubusScannerPlaces'), false, 'forgetting left the answer in storage');
  } finally {
    delete globalThis.__TAURI__;
    restoreDevice();
    if (hadStorage) globalThis.localStorage = wasStorage;
    else delete globalThis.localStorage;
    if (hadDocument) globalThis.document = wasDocument;
    else delete globalThis.document;
  }
});

