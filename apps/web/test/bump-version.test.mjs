// The version bump script (scripts/bump-version.mjs) moves one number through six files. This
// holds it to that: every site rewritten, nothing beside them touched, and a refusal that leaves
// the tree exactly as it was — the script's whole value is that a half-done bump cannot happen.
// Runs against a throwaway tree, never the repo's own files.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { SITES, bump } from '../../../scripts/bump-version.mjs';

// Each file with its version line AND a decoy the pattern must not touch: a nested "version"
// key, a dependency's `version = "2"`, another crate's lockfile entry.
const TREE = {
  'apps/web/lib/app.js': `const x = 1;\nexport const VERSION = '0.4.2';\nconst y = "version = '9.9.9'";\n`,
  'apps/web/package.json': `{\n  "name": "cubus-web",\n  "version": "0.4.2",\n  "devDependencies": {\n    "three": {\n      "version": "0.169.0"\n    }\n  }\n}\n`,
  'apps/desktop/package.json': `{\n  "name": "cubus-desktop",\n  "version": "0.4.2",\n  "private": true\n}\n`,
  'apps/desktop/src-tauri/tauri.conf.json': `{\n  "productName": "cubus",\n  "version": "0.4.2",\n  "plugins": {\n    "updater": {\n      "version": "1.0.0"\n    }\n  }\n}\n`,
  'apps/desktop/src-tauri/Cargo.toml': `[package]\nname = "cubus-desktop"\nversion = "0.4.2"\nedition = "2021"\n\n[dependencies]\ntauri = { version = "2", features = [] }\nlog = "0.4"\n`,
  'Cargo.lock': `[[package]]\nname = "cube-vision"\nversion = "0.1.0"\n\n[[package]]\nname = "cubus-desktop"\nversion = "0.4.2"\ndependencies = [\n "log",\n]\n\n[[package]]\nname = "log"\nversion = "0.4.22"\n`,
  // The only file carrying TWO sites. Its decoy is the deployment target, which is a version
  // number on an adjacent line and must not move.
  'apps/desktop/src-tauri/gen/apple/project.yml': `options:\n  deploymentTarget:\n    iOS: 16.0\ntargets:\n  cubus-desktop_iOS:\n    info:\n      properties:\n        CFBundleShortVersionString: 0.4.2\n        CFBundleVersion: "0.4.2"\n`,
  // xcodegen's OUTPUT from the file above, and committed, so it ships whatever it last said.
  // It carries two sites for the same reason project.yml does. Its decoy is CFBundleInfoDictionaryVersion,
  // which is a plist schema version that has nothing to do with the app and must never move.
  'apps/desktop/src-tauri/gen/apple/cubus-desktop_iOS/Info.plist': `<plist version="1.0">\n<dict>\n\t<key>CFBundleInfoDictionaryVersion</key>\n\t<string>6.0</string>\n\t<key>CFBundleShortVersionString</key>\n\t<string>0.4.2</string>\n\t<key>CFBundleVersion</key>\n\t<string>0.4.2</string>\n</dict>\n</plist>\n`,
};

let root;
const write = (tree) => {
  for (const [file, text] of Object.entries(tree)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
};
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const snapshot = () => Object.fromEntries(Object.keys(TREE).map((f) => [f, read(f)]));

before(() => { root = mkdtempSync(path.join(tmpdir(), 'cubus-bump-')); write(TREE); });
after(() => rmSync(root, { recursive: true, force: true }));

test('the script names every place the version lives, and only those', () => {
  // Sites, not files: gen/apple/project.yml and the iOS Info.plist each carry two, so the lists
  // are compared as SETS and the duplicates are expected rather than a smell.
  assert.deepEqual([...new Set(SITES.map((s) => s.file))].sort(), Object.keys(TREE).sort());
  assert.equal(SITES.length, Object.keys(TREE).length + 2,
    'project.yml and Info.plist each contribute a second site');
});

test('a bump rewrites every site and nothing beside it', () => {
  const r = bump(root, '0.5.0');
  assert.equal(r.to, '0.5.0');
  assert.deepEqual(r.sites.map((s) => s.from), Array(SITES.length).fill('0.4.2'));
  assert.deepEqual([...new Set(r.changed)].sort(), Object.keys(TREE).sort(), 'every file was written');
  const got = snapshot();
  // The version lines — each once, at the version asked for.
  assert.match(got['apps/web/lib/app.js'], /^export const VERSION = '0\.5\.0';$/m);
  for (const f of ['apps/web/package.json', 'apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json']) {
    assert.match(got[f], /^  "version": "0\.5\.0",$/m, f);
  }
  assert.match(got['apps/desktop/src-tauri/Cargo.toml'], /^version = "0\.5\.0"$/m);
  assert.match(got['Cargo.lock'], /^name = "cubus-desktop"\nversion = "0\.5\.0"$/m);
  // The decoys — untouched.
  assert.ok(got['apps/web/lib/app.js'].includes(`"version = '9.9.9'"`), 'a string that merely mentions a version');
  assert.ok(got['apps/web/package.json'].includes('"version": "0.169.0"'), 'a nested version key');
  assert.ok(got['apps/desktop/src-tauri/tauri.conf.json'].includes('"version": "1.0.0"'), 'a nested version key');
  assert.ok(got['apps/desktop/src-tauri/Cargo.toml'].includes('tauri = { version = "2"'), "a dependency's version");
  assert.ok(got['Cargo.lock'].includes('name = "cube-vision"\nversion = "0.1.0"'), "another crate's lockfile entry");
  assert.ok(got['Cargo.lock'].includes('name = "log"\nversion = "0.4.22"'), "another crate's lockfile entry");
  // And no other byte moved: putting the old number back restores the original tree exactly.
  bump(root, '0.4.2');
  assert.deepEqual(snapshot(), TREE, 'a bump and its reverse are the identity');
});

test('bumping to the version already there writes nothing', () => {
  const r = bump(root, '0.4.2');
  assert.deepEqual(r.changed, []);
  assert.deepEqual(snapshot(), TREE);
});

test('a prerelease is a version; anything else is refused before a byte is written', () => {
  assert.doesNotThrow(() => bump(root, '0.5.0-beta.1'));
  bump(root, '0.4.2');
  for (const bad of ['0.5', 'v0.5.0', '0.5.0 ', 'latest', '', '0.5.0;rm -rf /']) {
    assert.throws(() => bump(root, bad), /not a version/, JSON.stringify(bad));
  }
  assert.deepEqual(snapshot(), TREE, 'refusals leave the tree as it was');
});

test('a file with no version line, or two, stops the whole bump with the file named', () => {
  write({ 'apps/desktop/src-tauri/Cargo.toml': `[package]\nname = "cubus-desktop"\nversion = "0.4.2"\n\n[dependencies.tauri]\nversion = "2"\n` });
  assert.throws(() => bump(root, '0.5.0'), /Cargo\.toml: expected exactly one version line, found 2/);
  assert.equal(read('apps/web/lib/app.js'), TREE['apps/web/lib/app.js'], 'the files before it in the list were not written either');
  write({ 'apps/desktop/src-tauri/Cargo.toml': TREE['apps/desktop/src-tauri/Cargo.toml'] });

  write({ 'Cargo.lock': `[[package]]\nname = "log"\nversion = "0.4.22"\n` });
  assert.throws(() => bump(root, '0.5.0'), /Cargo\.lock: expected exactly one version line, found 0/);
  assert.deepEqual({ ...snapshot(), 'Cargo.lock': TREE['Cargo.lock'] }, TREE, 'nothing else moved');
  write({ 'Cargo.lock': TREE['Cargo.lock'] });

  rmSync(path.join(root, 'apps/desktop/package.json'));
  assert.throws(() => bump(root, '0.5.0'), /ENOENT/, 'a missing manifest is an error, not a skipped site');
  write({ 'apps/desktop/package.json': TREE['apps/desktop/package.json'] });
  assert.deepEqual(snapshot(), TREE);
});

test('two sites in ONE file both land — the second must not clobber the first', () => {
  // The defect, found 2026-08-31 the day gen/apple/project.yml gained a second version line:
  // every site computed its replacement from the ORIGINAL text, so writing them in order kept
  // only the last. It reported BOTH as bumped and moved one — the worst shape a version tool can
  // fail in, because the log states the thing that did not happen.
  const ios = 'apps/desktop/src-tauri/gen/apple/project.yml';
  write(TREE);                 // back to 0.4.2 everywhere
  bump(root, '0.9.9');
  const got = read(ios);
  assert.match(got, /^        CFBundleShortVersionString: 0\.9\.9$/m, 'the first site was clobbered');
  assert.match(got, /^        CFBundleVersion: "0\.9\.9"$/m, 'the second site did not land');
  assert.doesNotMatch(got, /0\.4\.2/, 'a site in this file still carries the old version');
  assert.match(got, /^    iOS: 16\.0$/m, 'the deployment target is not a version site');
});
