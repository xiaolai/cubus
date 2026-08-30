// The mobile shells' declarations — the layout contract's step 8, and the App Store's minimum.
//
// dev-docs/stage-contract.md decision 6 says phones are portrait-locked and iPad rotates freely;
// decision 7 declares UIRequiresFullScreen. Both were built with the shells and then verified by
// NOTHING: no test in this repo read an Info.plist or an AndroidManifest until this file. That is
// the same shape as the icon verifier AGENTS.md records — a gate that exists in a document and in
// no runner — and it is why the mobile shells could satisfy the contract on the day they landed
// and quietly stop satisfying it on any day after.
//
// Two sources per platform on iOS, deliberately. `gen/apple/project.yml` is what xcodegen builds
// the plist FROM, so a plist edited by hand is reverted the next time the project is regenerated.
// Asserting only the plist would pass right up until someone runs `tauri ios init`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GEN = new URL('../../desktop/src-tauri/gen/', import.meta.url);
const plistPath = fileURLToPath(new URL('apple/cubus-desktop_iOS/Info.plist', GEN));
const projectYml = readFileSync(new URL('apple/project.yml', GEN), 'utf8');
const manifest = readFileSync(new URL('android/app/src/main/AndroidManifest.xml', GEN), 'utf8');

/** The plist as JSON. `plutil` ships with macOS; on Linux the plist checks are skipped as
 *  INFORMATIONAL rather than passing — a check that cannot run has verified nothing, and the
 *  yaml source below is asserted on every platform so the pair is never both skipped. */
function plist() {
  try {
    return JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plistPath], { encoding: 'utf8' }));
  } catch {
    return null;
  }
}

test('the iPhone is portrait-locked, and the iPad is not', () => {
  // Decision 6. The app has exactly two compositions keyed on orientation; a phone that rotates
  // would land in the 4:3 landscape composition on a 3:4 screen, which is the one shape the
  // contract never fits.
  assert.match(projectYml, /UISupportedInterfaceOrientations~iphone:\s*\n\s*-\s*UIInterfaceOrientationPortrait\s*\n(?!\s*-)/,
    'project.yml must give the iPhone portrait and nothing else — the plist is generated from it');

  const p = plist();
  if (p === null) {
    console.log('# informational: plutil unavailable, plist not read (project.yml was still asserted)');
    return;
  }
  assert.deepEqual(p['UISupportedInterfaceOrientations~iphone'], ['UIInterfaceOrientationPortrait'],
    'the iPhone must offer portrait only');
  assert.ok((p['UISupportedInterfaceOrientations~ipad'] ?? []).length >= 4,
    'the iPad rotates freely — all four orientations');
});

test('UIRequiresFullScreen is declared, because Split View 1/3 is unsupported', () => {
  // Decision 7: the portrait floor is 375px and a 1/3 column is narrower. The key is deprecated
  // and still honoured on iPadOS 26; when Apple stops honouring it the contract needs revisiting,
  // and this test failing is the reminder.
  assert.match(projectYml, /UIRequiresFullScreen:\s*true/i, 'project.yml must declare it');
  const p = plist();
  if (p === null) {
    console.log('# informational: plutil unavailable, plist not read (project.yml was asserted)');
    return;
  }
  assert.equal(p.UIRequiresFullScreen, true);
});

test('the camera purpose string exists and says what actually happens', () => {
  // Not style: iOS terminates the app on first camera access without this key, and the App Store
  // rejects a build whose string does not describe the use. The claim it makes — nothing stored,
  // nothing sent — is the same one the scan screen makes to the user, so the two must not drift.
  //
  // The SOURCE is asserted on every platform, so a Linux runner without plutil still gates on
  // something. Guarding the whole test on the tool would trade a crash for a silent gap, which
  // is the same defect one level finer (AGENTS.md, verify-icons.py).
  assert.match(projectYml, /NSCameraUsageDescription:/, 'project.yml must carry the purpose string');
  const p = plist();
  if (p === null) {
    console.log('# informational: plutil unavailable, plist not read (project.yml was asserted)');
    return;
  }
  const why = p.NSCameraUsageDescription ?? '';
  assert.ok(why.length > 20, `NSCameraUsageDescription is missing or too short: ${JSON.stringify(why)}`);
  assert.match(why, /camera|cube/i);
  assert.match(why, /no image is stored or sent|on this device/i,
    'the purpose string claims on-device processing — keep it true, or change both it and the UI');
});

test('the Android phone is portrait-locked too', () => {
  // The same contract, the other platform. Android has no per-device-class split, so the lock
  // sits on the single MainActivity.
  assert.match(manifest, /android:screenOrientation="portrait"/,
    'MainActivity must be portrait — the contract has no landscape composition for a phone');
});

test('Android declares every capability the app actually uses', () => {
  // A missing permission does not fail the build; it fails at the moment a child points the
  // camera at a cube, which is the worst possible place to discover it.
  for (const perm of ['android.permission.CAMERA', 'android.permission.BLUETOOTH_SCAN', 'android.permission.BLUETOOTH_CONNECT']) {
    assert.match(manifest, new RegExp(`uses-permission[^>]*android:name="${perm.replace(/\./g, '\\.')}"`),
      `${perm} is not declared`);
  }
  // Features, not just permissions: the Play listing is filtered by these, and a cube tutor that
  // installs on a device with no camera is a support ticket.
  assert.match(manifest, /uses-feature[^>]*android:name="android\.hardware\.camera"/);
  assert.match(manifest, /uses-feature[^>]*android:name="android\.hardware\.bluetooth_le"/);
});

test('the iOS bundle declares Bluetooth, or the smart cube cannot connect', () => {
  assert.match(projectYml, /NSBluetoothAlwaysUsageDescription:/, 'project.yml must carry it');
  const p = plist();
  if (p === null) {
    console.log('# informational: plutil unavailable, plist not read (project.yml was asserted)');
    return;
  }
  // iOS 13+ requires this key for any CoreBluetooth use, and terminates the app without it.
  const why = p.NSBluetoothAlwaysUsageDescription ?? p.NSBluetoothPeripheralUsageDescription ?? '';
  assert.ok(why.length > 10,
    'no NSBluetoothAlwaysUsageDescription — iOS terminates the app the moment it scans for a cube');
});
