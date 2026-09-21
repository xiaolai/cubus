// The Android vision plugin's command names, held to what Tauri will actually deliver.
//
// The page sends `plugin:cube-vision|next_detection`. On Apple and Windows a Rust `invoke_handler`
// matches that name verbatim. On Android the plugin registers no Rust handler
// (crates/cube-vision/src/lib.rs, the Android `init`), so the call takes Tauri's mobile fallback,
// which camel-cases the command before handing it to Kotlin — `heck::AsLowerCamelCase(
// message.command)` in tauri-2.11.5/src/webview/mod.rs, around line 1891 — and Tauri's
// `PluginHandle.kt` indexes `@Command` methods by the exact `method.name` (`indexMethods`,
// line 156). A Kotlin method named `next_detection` is therefore one nothing can reach: what
// arrives is `nextDetection`, and the answer is "No command nextDetection found". Until
// 2026-09-20 six of the seven commands were declared that way; only `probe`, one word, was
// findable (dev-docs/scanner-audit-2026-09-20.md, 1.6). Dormant while `verifiedOnDevice` is
// false, fatal the day it is flipped — which is why a source-reading test, not a device, holds it.
//
// So: every name `NativeDetector` (and `pickDetector`) sends, camel-cased the way heck does it,
// must be exactly the set of `@Command` methods `VisionPlugin.kt` declares. Neither side is
// trusted to be non-empty — a regex that matches nothing is a test that runs nothing.
//
// The BLE plugin is NOT held to this, deliberately: Rust calls it through `run_mobile_plugin`,
// which passes the name verbatim, so its `ble_*` methods are reached as written.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ROOT = new URL('../../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

/** The TypeScript that invokes the plugin: the detector, and the probe that selects it. */
const TS_SOURCES = [
  'packages/cube-scanner/view/native-detector.ts',
  'packages/cube-scanner/view/pick-detector.ts',
];
const KOTLIN = 'apps/desktop/src-tauri/gen/android/app/src/main/java/im/cubus/app/VisionPlugin.kt';

/**
 * heck's lowerCamelCase, for snake_case input: words are split on non-alphanumerics (a run of
 * them is one boundary, leading and trailing ones are dropped), the first word is lowercased and
 * every later word is capitalised — first character upper, the rest lower (the `Display` impl in
 * heck-0.5.0/src/lower_camel.rs; `capitalize` and `lowercase` in heck-0.5.0/src/lib.rs). heck also
 * splits inside a word on a case change, which no snake_case name has; this stops at what the
 * input can contain.
 */
export function lowerCamelCase(name) {
  assert.ok(!/[A-Z]/.test(name), `${name}: this conversion is for snake_case input only`);
  const words = name.split(/[^a-z0-9]+/i).filter(Boolean);
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
}

/** Every command the TypeScript sends to the plugin, by its snake_case name. */
function sentCommands() {
  const names = new Set();
  for (const rel of TS_SOURCES) {
    const src = read(rel);
    // `${P}name` and `${CUBE_VISION}name` — the namespace constant followed by the command.
    for (const m of src.matchAll(/\$\{(?:P|CUBE_VISION)\}([a-z_]+)/g)) names.add(m[1]);
    // A literal `plugin:cube-vision|name` — none today, but the spelling a comment or a future
    // call might use, and cheaper to read than to forbid.
    for (const m of src.matchAll(/plugin:cube-vision\|([a-z_]+)/g)) names.add(m[1]);
  }
  return names;
}

/**
 * Every `@Command`-annotated `fun` in the Kotlin plugin, the way the runtime finds them. The
 * annotation on its own line, then any other annotations on their own lines, then the `fun`.
 * Anchored to line starts so a mention of `@Command` in prose is not a declaration.
 */
function declaredCommands() {
  const src = read(KOTLIN);
  const names = new Set();
  for (const m of src.matchAll(/^[ \t]*@Command[ \t]*\n(?:[ \t]*@\w+(?:\([^)\n]*\))?[ \t]*\n)*[ \t]*fun (\w+)\(/gm)) {
    names.add(m[1]);
  }
  return names;
}

test('lowerCamelCase reproduces heck on the shapes a command name can take', () => {
  assert.equal(lowerCamelCase('probe'), 'probe');
  assert.equal(lowerCamelCase('next_detection'), 'nextDetection');
  assert.equal(lowerCamelCase('list_cameras'), 'listCameras');
  // Runs of boundaries fold into one; leading and trailing ones are dropped (the crate doc's
  // word-boundary definition, heck-0.5.0/src/lib.rs).
  assert.equal(lowerCamelCase('_open__camera_'), 'openCamera');
});

test('the TypeScript sends the seven commands the plugin is known for, in snake_case', () => {
  const sent = sentCommands();
  assert.ok(sent.size > 0, 'no plugin command was read off the TypeScript — the read is broken, not the code');
  assert.deepEqual(
    [...sent].sort(),
    ['close_camera', 'current_camera', 'list_cameras', 'load_model', 'next_detection', 'open_camera', 'probe'],
    'the set of commands the page sends changed — the Kotlin plugin, the ACL (crates/cube-vision/build.rs) and this list move together',
  );
  for (const name of sent) {
    assert.match(name, /^[a-z]+(?:_[a-z]+)*$/, `${name}: the ACL names commands in snake_case`);
  }
});

test('the Kotlin plugin declares exactly the lowerCamelCase of every command the page sends', () => {
  const declared = declaredCommands();
  assert.ok(declared.size > 0, 'no @Command was read off VisionPlugin.kt — the read is broken, not the code');
  const expected = new Set([...sentCommands()].map(lowerCamelCase));
  assert.deepEqual(
    [...declared].sort(),
    [...expected].sort(),
    'VisionPlugin.kt declares a command Tauri will not deliver under that name, or lacks one the page sends: ' +
      'the mobile fallback camel-cases `plugin:cube-vision|x_y` to `xY` before PluginHandle looks it up by method name',
  );
});

test('no Kotlin command carries an underscore, because the fallback removes them before the lookup', () => {
  const underscored = [...declaredCommands()].filter((n) => n.includes('_'));
  assert.deepEqual(underscored, [], `unreachable through the mobile fallback: ${underscored.join(', ')}`);
});
