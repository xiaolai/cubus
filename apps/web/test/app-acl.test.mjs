// The app's own commands are under Tauri's ACL now (build.rs declares them through
// `AppManifest::commands`), which means: a command no capability file allows is unreachable from
// the webview. That is the safety belt the audit asked for — and it is also a trap, because the
// failure is silent and lands at runtime: a command added to `generate_handler!` and forgotten in
// a capability answers "not allowed" on a user's machine and nowhere else.
//
// So the three lists are read and held to each other here: what lib.rs registers, what build.rs
// declares, and what the capability files grant — and WHERE they grant it, because the whole point
// of the split is that a phone's webview cannot reach `set_orientation` or `optimal_prove`.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const TAURI = new URL('../../desktop/src-tauri/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, TAURI), 'utf8');
const json = (rel) => JSON.parse(read(rel));

/** The app commands lib.rs hands to `generate_handler!`, by name. */
function registered() {
  const src = read('src/lib.rs');
  const block = /invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/.exec(src);
  assert.ok(block, 'lib.rs no longer has a generate_handler! block this test can read');
  return block[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^optimal::/, ''));
}

/** The commands build.rs declares to the ACL. */
function declared() {
  const src = read('build.rs');
  const block = /const COMMANDS: &\[&str\] = &\[([\s\S]*?)\];/.exec(src);
  assert.ok(block, 'build.rs no longer declares COMMANDS');
  return [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

/** Every permission a capability grants, as bare identifiers. */
function granted(cap) {
  return cap.permissions.map((p) => (typeof p === 'string' ? p : p.identifier));
}

const capabilities = ['default', 'desktop', 'update'].map((name) => ({ name, cap: json(`capabilities/${name}.json`) }));
const DESKTOP_ONLY = ['set_orientation', 'get_orientation', 'optimal_prepare', 'optimal_status', 'optimal_prove', 'optimal_cancel'];
const allow = (cmd) => `allow-${cmd.replaceAll('_', '-')}`;

test('every registered app command is declared to the ACL, and nothing else is', () => {
  assert.deepEqual([...registered()].sort(), [...declared()].sort(),
    'lib.rs generate_handler! and build.rs COMMANDS disagree — an undeclared command is unreachable, a declared phantom is a permission for nothing');
});

test('every app command is granted by exactly one capability', () => {
  for (const cmd of declared()) {
    const where = capabilities.filter(({ cap }) => granted(cap).includes(allow(cmd))).map(({ name }) => name);
    assert.deepEqual(where.length, 1, `${cmd} is granted by ${where.length} capabilities (${where.join(', ')}); it needs exactly one`);
  }
});

test('the desktop-only commands live in a capability no phone platform gets', () => {
  const desktop = capabilities.find(({ name }) => name === 'desktop').cap;
  assert.deepEqual([...desktop.platforms].sort(), ['linux', 'macOS', 'windows'],
    'desktop.json must be scoped to the three desktops — a phone injects the identical command surface');
  for (const cmd of DESKTOP_ONLY) {
    assert.ok(granted(desktop).includes(allow(cmd)), `${cmd} must be granted by desktop.json`);
    const def = capabilities.find(({ name }) => name === 'default').cap;
    assert.ok(!granted(def).includes(allow(cmd)), `${cmd} must NOT be granted by default.json, which every platform gets`);
  }
});

test('the window permissions are granted by the desktop capability and by no other', () => {
  // window-chrome.js names desktop.json as the file a refused window control points at. A
  // dangling-pointer check cannot hold that — every capability file exists — so this holds the
  // pointer to what the file grants.
  const windowPermissions = [
    'core:window:allow-start-dragging', 'core:window:allow-minimize',
    'core:window:allow-close', 'core:window:allow-set-title',
  ];
  for (const { name, cap } of capabilities) {
    for (const p of windowPermissions) {
      assert.equal(granted(cap).includes(p), name === 'desktop', `${p} in ${name}.json`);
    }
  }
});

test('the BLE bridge is granted everywhere, because every build reaches the same cube', () => {
  const def = capabilities.find(({ name }) => name === 'default').cap;
  assert.equal(def.platforms, undefined, 'default.json applies to every platform');
  for (const cmd of declared().filter((c) => c.startsWith('ble_'))) {
    assert.ok(granted(def).includes(allow(cmd)), `${cmd} missing from default.json`);
  }
});

test('the opener is scoped to https, not granted its default set', () => {
  const def = capabilities.find(({ name }) => name === 'default').cap;
  assert.ok(!granted(def).includes('opener:default'),
    'opener:default also allows http://, mailto:, tel: and revealing files in the file manager; the About card needs none of them');
  const opener = def.permissions.find((p) => typeof p === 'object' && p.identifier === 'opener:allow-open-url');
  assert.ok(opener, 'opener:allow-open-url is missing');
  assert.deepEqual(opener.allow, [{ url: 'https://*' }], 'the one scope the About card needs');
});

test('the capability descriptions do not claim macOS lacks self-update', () => {
  // The desktop.json text used to say self-update was granted on a NARROWER set "because macOS
  // updates through its Homebrew cask" — false since 2026-09-03, when macOS joined the updater.
  for (const { name, cap } of capabilities) {
    assert.ok(!/narrower/i.test(cap.description), `${name}.json still describes the pre-2026-09-03 platform split`);
  }
  const update = capabilities.find(({ name }) => name === 'update').cap;
  assert.deepEqual([...update.platforms].sort(), ['linux', 'macOS', 'windows']);
});

test('tauri.conf.json no longer asks for the macOS private API', () => {
  // Nothing needs it — the traffic lights are placed through public AppKit — and the flag is an
  // App Store rejection. The cargo feature went with it (Cargo.toml).
  const conf = json('tauri.conf.json');
  assert.equal(conf.app.macOSPrivateApi, undefined);
  // The dependency LINE, not the file: the comment above it records why the feature went.
  const tauriDep = /^tauri = .*$/m.exec(read('Cargo.toml'));
  assert.ok(tauriDep, 'Cargo.toml no longer declares the tauri dependency on one line');
  assert.ok(!/macos-private-api/.test(tauriDep[0]), 'the macos-private-api feature is back in Cargo.toml');
});

test('the build hook runs copy-ort once, through vendor:libs', () => {
  const conf = json('tauri.conf.json');
  const steps = conf.build.beforeBuildCommand.split('&&').map((s) => s.trim());
  assert.equal(steps.filter((s) => /\bcopy-ort\b/.test(s)).length, 0, 'copy-ort is run explicitly AND by vendor:libs');
  assert.ok(steps.some((s) => /vendor:libs/.test(s)), 'vendor:libs (which runs copy-ort) must stay in the hook');
});

// The hook rebuilt the panel and nothing else of the scanner's, so a desktop build packaged whatever
// worker bundle was committed — fresh only if someone had remembered to rebuild it (audit-fix
// 2026-09-21, finding 9). Every `build:*` script the scanner package points at `vendor/` is a
// bundle build.mjs requires in the dist, so every one of them runs before `build:dist`.
test('the build hook rebuilds every bundle the scanner package emits into vendor/, before build:dist', () => {
  const conf = json('tauri.conf.json');
  const steps = conf.build.beforeBuildCommand.split('&&').map((s) => s.trim());
  const scanner = JSON.parse(readFileSync(new URL('../../../packages/cube-scanner/package.json', import.meta.url), 'utf8'));
  const emitters = Object.entries(scanner.scripts ?? {})
    .filter(([, cmd]) => /--outfile=\S*vendor\//.test(String(cmd)))
    .map(([name]) => name);
  assert.ok(emitters.length >= 3, `expected the panel and two workers, found ${emitters.join(', ')}`);
  const dist = steps.findIndex((s) => /build:dist/.test(s));
  assert.ok(dist >= 0, 'the hook must end in build:dist');
  for (const script of emitters) {
    const at = steps.findIndex((s) => new RegExp(`--filter cube-scanner ${script}\\b`).test(s));
    assert.ok(at >= 0, `the hook does not rebuild ${script}, so a stale committed bundle would be packaged`);
    assert.ok(at < dist, `${script} runs after build:dist, which packages the old one`);
  }
});

// THE PLUGINS' OWN COMMANDS, held to the same rule — and this half was missing.
//
// The app's commands are checked above, and they were the only ones. `cube-vision` is a Tauri
// PLUGIN: its commands live in the plugin crate, their permission files are autogenerated by its
// build script, and what makes one reachable is being listed in a permission SET the app's
// capability grants. Nothing checked that last step, and on 2026-09-23 it had already gone wrong —
// D7's `frame_pixels` shipped with its command registered and its permission file generated, and
// no set listed it. Every call was refused at runtime with "cube-vision.frame_pixels not allowed",
// so `stickerLab` and the assembly's paint recovery never ran once on macOS, the platform D7 was
// written for. Found by calling the command from the running app, which is the only place the
// failure was visible.
const PLUGINS = [{ name: 'cube-vision', crate: '../../../crates/cube-vision/' }];

for (const plugin of PLUGINS) {
  test(`${plugin.name}: every command it generates a permission for is granted by a set`, () => {
    const dir = new URL(plugin.crate, import.meta.url);
    const generated = readdirSync(new URL('permissions/autogenerated/commands/', dir))
      .filter((f) => f.endsWith('.toml'))
      .map((f) => f.replace(/\.toml$/, ''));
    assert.ok(generated.length > 0, `${plugin.name} generated no command permissions to check`);
    // Every `allow-*` named anywhere in the plugin's hand-written permission sets.
    const sets = readdirSync(new URL('permissions/', dir)).filter((f) => f.endsWith('.toml'));
    const granted = new Set();
    for (const file of sets) {
      const text = readFileSync(new URL(`permissions/${file}`, dir), 'utf8');
      for (const m of text.matchAll(/"allow-([a-z0-9-]+)"/g)) granted.add(m[1]);
    }
    const ungranted = generated
      .map((c) => c.replace(/_/g, '-'))
      .filter((c) => !granted.has(c));
    assert.deepEqual(
      ungranted,
      [],
      `${plugin.name} commands with a permission file that no set grants — each is unreachable from the webview, and says so only at runtime on a user's machine`,
    );
  });
}
