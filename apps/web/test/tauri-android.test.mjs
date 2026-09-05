// The Android build wrapper (scripts/tauri-android.mjs) exists for one reason: with an unsupported
// JDK, Gradle fails with "Unsupported class file major version 70", which names neither Java nor
// the remedy. These assert the version logic that turns that into a useful message — including the
// case that actually happened (Java 26 on this machine, 2026-08-30).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pathToFileURL } from 'node:url';

import { JDK_MAX, JDK_MIN, chooseJdk, isMain, majorVersion, supported } from '../../../scripts/tauri-android.mjs';

test('majorVersion reads the modern and the legacy 1.x forms', () => {
  assert.equal(majorVersion('21.0.5'), 21);
  assert.equal(majorVersion('26.0.2.1'), 26);
  assert.equal(majorVersion('17'), 17);
  // Java 8 reports itself as 1.8.0_x, and the major version is the SECOND component.
  assert.equal(majorVersion('1.8.0_402'), 8);
  assert.equal(majorVersion(' 21.0.5 '), 21, 'surrounding whitespace is not a parse failure');
});

test('majorVersion refuses rather than guesses', () => {
  assert.equal(majorVersion(''), null);
  assert.equal(majorVersion('not a version'), null);
  assert.equal(majorVersion('1'), null, 'a bare "1" does not say which Java it is');
});

test('the JDK that broke the build is rejected, and the one that fixed it is accepted', () => {
  // The whole point of the script: 26 is what is installed by default here and it must not pass.
  assert.equal(supported(majorVersion('26.0.2.1')), false);
  assert.equal(supported(majorVersion('21.0.5')), true);
  assert.equal(supported(majorVersion('17.0.9')), true);
  assert.equal(supported(majorVersion('1.8.0_402')), false, 'too old, not just too new');
  assert.equal(supported(null), false);
  assert.equal(supported(JDK_MIN), true);
  assert.equal(supported(JDK_MAX), true);
  assert.equal(supported(JDK_MIN - 1), false);
  assert.equal(supported(JDK_MAX + 1), false);
});

test('chooseJdk takes the newest supported one, deterministically', () => {
  const home = chooseJdk([
    { home: '/jdk17', version: '17.0.9' },
    { home: '/jdk26', version: '26.0.2.1' },
    { home: '/jdk21', version: '21.0.5' },
  ]);
  assert.equal(home, '/jdk21', 'newest SUPPORTED, not newest overall');
});

test('chooseJdk returns null rather than an unusable JDK', () => {
  assert.equal(chooseJdk([]), null);
  assert.equal(chooseJdk([{ home: '/jdk26', version: '26.0.2.1' }]), null);
  assert.equal(chooseJdk([{ home: '/jdk8', version: '1.8.0_402' }]), null);
  assert.equal(
    chooseJdk([{ home: '', version: '21.0.5' }]),
    null,
    'a supported version with no path is not a usable answer',
  );
});

test('the main guard recognises the script from a path containing a space', () => {
  // The case that produced a wrapper that exited 0 having built nothing: `import.meta.url` is
  // percent-encoded (`my%20dir`) and `process.argv[1]` is not, so a raw `file://` concatenation
  // never matched from any checkout path with a space in it.
  const withSpace = '/Users/someone/my projects/cubus/scripts/tauri-android.mjs';
  assert.equal(isMain(withSpace, pathToFileURL(withSpace).href), true);
  assert.equal(
    isMain(withSpace, `file://${withSpace}`),
    false,
    'the raw concatenation is NOT the loader URL, which is the whole bug',
  );
  assert.equal(isMain('/a/other.mjs', pathToFileURL('/a/tauri-android.mjs').href), false);
  assert.equal(isMain(undefined, pathToFileURL('/a/tauri-android.mjs').href), false, 'no argv[1] is an import');
});
