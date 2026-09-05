// The mobile shells' declarations — the layout contract's step 8, and the App Store's minimum.
//
// dev-docs/stage-contract.md decision 6 says phones are portrait-locked and iPad rotates freely;
// decision 7 declares UIRequiresFullScreen. Both were built with the shells and then verified by
// NOTHING: no test in this repo read an Info.plist or an AndroidManifest until this file. That is
// the same shape as the icon verifier AGENTS.md records — a gate that exists in a document and in
// no runner — and it is why the mobile shells could satisfy the contract on the day they landed
// and quietly stop satisfying it on any day after.
//
// Two sources per platform on iOS, deliberately — but WHICH two changed on 2026-09-05. The
// orientation keys are project.yml's, which xcodegen builds the plist from, so a plist edited by
// hand is reverted the next time the project is regenerated. The PURPOSE STRINGS are
// `Info.ios.plist`'s: Tauri merges that file over the xcodegen output on every `tauri ios
// dev|build`, so it is the copy that ships, and it survives `tauri ios init` as project.yml does
// not. They used to be declared in both, in different words, and only the non-shipping copy was
// tested (audit 2026-09-04, mobile A5) — so this reads the shipping source AND the committed
// merge result, and holds them to each other.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TAURI = new URL('../../desktop/src-tauri/', import.meta.url);
const GEN = new URL('gen/', TAURI);
const plistPath = fileURLToPath(new URL('apple/cubus-desktop_iOS/Info.plist', GEN));
const iosPlistPath = fileURLToPath(new URL('Info.ios.plist', TAURI));
const projectYml = readFileSync(new URL('apple/project.yml', GEN), 'utf8');
const iosPlistText = readFileSync(iosPlistPath, 'utf8');
const macosPlistText = readFileSync(new URL('Info.macos.plist', TAURI), 'utf8');
const manifest = readFileSync(new URL('android/app/src/main/AndroidManifest.xml', GEN), 'utf8');
const mainActivity = readFileSync(new URL('android/app/src/main/java/im/cubus/app/MainActivity.kt', GEN), 'utf8');

/** A plist as JSON. `plutil` ships with macOS; on Linux the plist checks are skipped as
 *  INFORMATIONAL rather than passing — a check that cannot run has verified nothing, and the
 *  text sources below are asserted on every platform so no pair is ever both skipped. */
function readPlist(path) {
  try {
    return JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', path], { encoding: 'utf8' }));
  } catch {
    return null;
  }
}
const plist = () => readPlist(plistPath);

/** The <string> that follows a <key> in plist XML — the text-level read that runs everywhere. */
function plistString(xml, key) {
  const m = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml);
  return m ? m[1].replaceAll('&apos;', "'") : null;
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
  // The SOURCE (Info.ios.plist) is asserted on every platform, so a Linux runner without plutil
  // still gates on something. Guarding the whole test on the tool would trade a crash for a
  // silent gap, which is the same defect one level finer (AGENTS.md, verify-icons.py).
  const why = plistString(iosPlistText, 'NSCameraUsageDescription') ?? '';
  assert.ok(why.length > 20, `Info.ios.plist NSCameraUsageDescription is missing or too short: ${JSON.stringify(why)}`);
  assert.match(why, /camera|cube/i);
  assert.match(why, /no image is stored or sent|on this device/i,
    'the purpose string claims on-device processing — keep it true, or change both it and the UI');
  assert.equal(plistString(iosPlistText, 'NSCameraUsageDescription'), plistString(macosPlistText, 'NSCameraUsageDescription'),
    'iOS and macOS make the same promise about the camera');
  const p = plist();
  if (p === null) {
    console.log('# informational: plutil unavailable, plist not read (Info.ios.plist was asserted)');
    return;
  }
  assert.equal(p.NSCameraUsageDescription, why, 'the committed merge result carries the shipping source\'s words');
});

test('the purpose strings are declared ONCE for iOS, and project.yml does not carry a second copy', () => {
  // Two declarations in different words is how the shipping one went untested for a week.
  // A KEY, at the start of a line — the comment that explains their absence names them too.
  assert.ok(!/^\s*NS(Camera|BluetoothAlways)UsageDescription:/m.test(projectYml),
    'project.yml must not declare the purpose strings — Info.ios.plist is the one source');
  assert.match(iosPlistText, /<key>NSCameraUsageDescription<\/key>/);
  assert.match(iosPlistText, /<key>NSBluetoothAlwaysUsageDescription<\/key>/);
});

test('no purpose string names a cube brand', () => {
  // The bridge is brand-agnostic by a build-failing test (crates/cube-ble/tests); the sentence
  // the OS shows the user was the one place a brand had crept back in, on both platforms.
  for (const [name, xml] of [['Info.ios.plist', iosPlistText], ['Info.macos.plist', macosPlistText]]) {
    for (const key of ['NSCameraUsageDescription', 'NSBluetoothAlwaysUsageDescription']) {
      const why = plistString(xml, key) ?? '';
      assert.ok(why.length > 20, `${name} ${key} missing`);
      assert.ok(!/\b(gan|giiker|gocube|moyu|qiyi|rubik)/i.test(why), `${name} ${key} names a brand: ${why}`);
    }
  }
  const committed = plistString(readFileSync(plistPath, 'utf8'), 'NSBluetoothAlwaysUsageDescription');
  assert.equal(committed, plistString(iosPlistText, 'NSBluetoothAlwaysUsageDescription'),
    'the committed gen/apple plist must carry Info.ios.plist\'s Bluetooth sentence — it is what ships');
});

test('the Android phone is portrait-locked and the tablet is not — in code, not the manifest', () => {
  // The same contract, the other platform. A manifest `screenOrientation` locks EVERY device
  // alike, tablets included, contrary to decision 6; so the lock moved into MainActivity, per
  // device class at Android's own sw600dp line, and the manifest must not carry it.
  assert.ok(!/android:screenOrientation=/.test(manifest),
    'the manifest must not lock orientation — MainActivity.onCreate does it per device class');
  assert.match(mainActivity, /requestedOrientation\s*=\s*orientationFor\(resources\.configuration\.smallestScreenWidthDp\)/,
    'MainActivity must set requestedOrientation from smallestScreenWidthDp');
  assert.match(mainActivity, /TABLET_MIN_WIDTH_DP\s*=\s*600/, 'the tablet threshold is sw600dp');
  assert.match(mainActivity, /SCREEN_ORIENTATION_PORTRAIT/);
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

test('the Bluetooth permission story is told per Android era, and pinned', () => {
  // `neverForLocation` is what lets the API 31+ scan permission be asked for without dragging
  // location in behind it; the pre-31 pair is capped so it is not requested where it was
  // replaced; and ACCESS_FINE_LOCATION (capped the same way) is what a BLE scan needs through
  // API 30 — without it the scan does not fail, it returns nothing (BlePlugin.kt).
  assert.match(manifest, /android:name="android\.permission\.BLUETOOTH_SCAN"[^>]*android:usesPermissionFlags="neverForLocation"/,
    'BLUETOOTH_SCAN must carry neverForLocation');
  for (const perm of ['BLUETOOTH', 'BLUETOOTH_ADMIN', 'ACCESS_FINE_LOCATION']) {
    assert.match(manifest, new RegExp(`android:name="android\\.permission\\.${perm}"[^>]*android:maxSdkVersion="30"`),
      `${perm} must be declared with maxSdkVersion="30"`);
  }
});

test('the scaffold is gone and backup is off', () => {
  // Auto Backup would ship the WebView's localStorage — the user's cube registry and solves —
  // to a cloud account with no say from anyone; the leanback launcher, the FileProvider and the
  // Hello World layout were Tauri's template, never the app's.
  assert.match(manifest, /android:allowBackup="false"/);
  assert.ok(!/LEANBACK_LAUNCHER|android\.software\.leanback/.test(manifest), 'the AndroidTV scaffold must go');
  assert.ok(!/FileProvider|file_paths/.test(manifest), 'the unused FileProvider must go');
  assert.match(mainActivity, /override val handleBackNavigation: Boolean = true/, 'in-app Back must work');
});

test('the iOS bundle declares Bluetooth, or the smart cube cannot connect', () => {
  const source = plistString(iosPlistText, 'NSBluetoothAlwaysUsageDescription') ?? '';
  assert.ok(source.length > 10, 'Info.ios.plist must carry NSBluetoothAlwaysUsageDescription');
  const p = plist();
  if (p === null) {
    console.log('# informational: plutil unavailable, plist not read (Info.ios.plist was asserted)');
    return;
  }
  // iOS 13+ requires this key for any CoreBluetooth use, and terminates the app without it.
  const why = p.NSBluetoothAlwaysUsageDescription ?? p.NSBluetoothPeripheralUsageDescription ?? '';
  assert.ok(why.length > 10,
    'no NSBluetoothAlwaysUsageDescription — iOS terminates the app the moment it scans for a cube');
  assert.equal(why, source, 'the committed plist and Info.ios.plist must say the same thing');
  const src = readPlist(iosPlistPath);
  assert.ok(src, 'Info.ios.plist must be a well-formed plist');
  assert.equal(src.NSBluetoothAlwaysUsageDescription, source);
});

test('the release keystore path resolves against the directory keystore.properties lives in', () => {
  // `file()` in the app module resolves against gen/android/app; the properties file, and the
  // `storeFile=upload.jks` the release workflow writes into it, live one level up. That path
  // could never resolve (audit 2026-09-04, mobile A2).
  const gradle = readFileSync(new URL('android/app/build.gradle.kts', GEN), 'utf8');
  assert.match(gradle, /storeFile\s*=\s*rootProject\.file\(keystoreProperties\.getProperty\("storeFile"\)\)/,
    'storeFile must resolve with rootProject.file(...)');
  assert.ok(!/androidx\.test\.espresso/.test(gradle), 'the espresso scaffold dependency must go');
});
