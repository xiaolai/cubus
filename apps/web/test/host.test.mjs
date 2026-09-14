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
