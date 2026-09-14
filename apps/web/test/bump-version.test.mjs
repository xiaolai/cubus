// The version bump script (scripts/bump-version.mjs) moves one number through every file that carries it. This
// holds it to that: every site rewritten, nothing beside them touched, and a refusal, a failed
// write or a failed rename that leaves the tree exactly as it was — the script's whole value is
// that a half-done bump cannot happen. (A crash between two of its renames still could; the
// script's own doc says so.)
// Runs against a throwaway tree, never the repo's own files.

import assert from 'node:assert/strict';
import fs, { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { SITES, bump } from '../../../scripts/bump-version.mjs';

// Each file with its version line AND a decoy the pattern must not touch: a nested "version"
// key, a dependency's `version = "2"`, another crate's lockfile entry.
const TREE = {
  'apps/web/lib/version.js': `const x = 1;\nexport const VERSION = '0.4.2';\nconst y = "version = '9.9.9'";\n`,
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
  assert.match(got['apps/web/lib/version.js'], /^export const VERSION = '0\.5\.0';$/m);
  for (const f of ['apps/web/package.json', 'apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json']) {
    assert.match(got[f], /^  "version": "0\.5\.0",$/m, f);
  }
  assert.match(got['apps/desktop/src-tauri/Cargo.toml'], /^version = "0\.5\.0"$/m);
  assert.match(got['Cargo.lock'], /^name = "cubus-desktop"\nversion = "0\.5\.0"$/m);
  // The decoys — untouched.
  assert.ok(got['apps/web/lib/version.js'].includes(`"version = '9.9.9'"`), 'a string that merely mentions a version');
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

test('a version is bare MAJOR.MINOR.PATCH: a pre-release, a leading zero, or anything else is refused', () => {
  // A pre-release is refused, not rewritten: two of the ten sites are Apple bundle keys, which take
  // at most three period-separated integers, and release.yml will not ship one anyway. Strict
  // SemVer besides: no leading zero in a number (found by audit, 2026-09-13).
  write(TREE);
  try {
    for (const bad of [
      '0.5.0-beta.1', '1.2.3-01', '1.2.3-beta..1', '01.2.3', '1.02.3', '1.2.03',
      '0.5', 'v0.5.0', '0.5.0 ', 'latest', '', '0.5.0;rm -rf /',
    ]) {
      assert.throws(() => bump(root, bad), /not a version/, JSON.stringify(bad));
      assert.deepEqual(snapshot(), TREE, `${JSON.stringify(bad)} was written into the tree`);
    }
    assert.doesNotThrow(() => bump(root, '10.0.0'), 'a multi-digit number is not a leading zero');
  } finally {
    write(TREE);
  }
});

test('a write that fails part-way leaves every file at the version it had, and nothing staged behind', () => {
  write(TREE);
  let n = 0;
  const failing = (p, text) => {
    n += 1;
    if (n === 6) throw new Error('ENOSPC: no space left on device (test)');
    writeFileSync(p, text);
  };
  try {
    assert.throws(() => bump(root, '0.7.0', { write: failing }), /ENOSPC/);
    assert.deepEqual(snapshot(), TREE, 'some files moved to 0.7.0 and the rest stayed — a half-done bump');
    const staged = readdirSync(root, { recursive: true }).filter((p) => String(p).endsWith('.bump-tmp'));
    assert.deepEqual(staged, [], 'a staging file was left behind');
  } finally {
    write(TREE);
  }
});

// Staging protected the WRITES only: a rename that failed part-way left the files before it
// bumped and every later staging file behind (found by verification, 2026-09-14). The failure is
// real — the third file's target becomes a directory once its staging file is written, so the
// real rename refuses it.
test('a rename that fails part-way puts back every file already moved, and leaves nothing staged', () => {
  write(TREE);
  const broken = 'apps/desktop/package.json';
  let n = 0;
  const sabotaging = (p, text) => {
    writeFileSync(p, text);
    n += 1;
    if (n !== 3) return;
    assert.equal(p, path.join(root, `${broken}.bump-tmp`), 'precondition: the third file staged is the one broken');
    rmSync(path.join(root, broken));
    mkdirSync(path.join(root, broken));
    writeFileSync(path.join(root, broken, 'keep'), 'a directory is not renamed over');
  };
  try {
    assert.throws(() => bump(root, '0.7.0', { write: sabotaging }));
    rmSync(path.join(root, broken), { recursive: true, force: true });
    writeFileSync(path.join(root, broken), TREE[broken]);
    assert.deepEqual(snapshot(), TREE, 'files renamed before the failure stayed at 0.7.0 — a half-done bump');
    const staged = readdirSync(root, { recursive: true }).filter((p) => String(p).endsWith('.bump-tmp'));
    assert.deepEqual(staged, [], 'staging files were left behind');
  } finally {
    rmSync(path.join(root, broken), { recursive: true, force: true });
    write(TREE);
    for (const p of readdirSync(root, { recursive: true }).filter((q) => String(q).endsWith('.bump-tmp'))) {
      rmSync(path.join(root, p), { force: true });
    }
  }
});

// The rollback wrote each original straight back over its file and stopped at the first write that
// failed: a disk that filled during it left that file EMPTY, the files after it still bumped, and
// every staging file behind (found by verification, 2026-09-14). The fault here is the one a full
// disk makes of a truncating write — the target is emptied, then the write throws — injected under
// the script's own import of node:fs.
test('a rollback that itself fails leaves no file empty and nothing staged, and names what it could not put back', () => {
  write(TREE);
  const broken = 'apps/desktop/package.json';
  const unlucky = 'apps/web/lib/version.js'; // renamed first, so put back first
  const real = fs.writeFileSync;
  let staged = 0;
  fs.writeFileSync = (p, text, ...rest) => {
    const file = String(p);
    // Putting this file's original back, into the file itself or into anything staged beside it.
    if (file.startsWith(path.join(root, unlucky)) && text === TREE[unlucky]) {
      real(file, '');
      throw new Error('ENOSPC: no space left on device (test)');
    }
    real(file, text, ...rest);
    if (file.endsWith('.bump-tmp') && (staged += 1) === 3) {
      rmSync(path.join(root, broken));
      mkdirSync(path.join(root, broken));
      real(path.join(root, broken, 'keep'), 'a directory is not renamed over');
    }
  };
  syncBuiltinESMExports();
  let err = null;
  try {
    bump(root, '0.7.0');
  } catch (e) {
    err = e;
  } finally {
    fs.writeFileSync = real;
    syncBuiltinESMExports();
  }
  const behind = () => readdirSync(root, { recursive: true }).filter((p) => /\.bump-(tmp|restore)$/.test(String(p)));
  try {
    assert.ok(err, 'precondition: the bump failed');
    rmSync(path.join(root, broken), { recursive: true, force: true });
    writeFileSync(path.join(root, broken), TREE[broken]);
    const got = snapshot();
    assert.deepEqual(Object.keys(got).filter((f) => got[f] === ''), [], 'the rollback left a file empty');
    assert.deepEqual(Object.keys(got).filter((f) => got[f] !== TREE[f]), [unlucky],
      'the rollback stopped at the failure, or claimed to put back the file it could not');
    assert.match(err.message, /apps\/web\/lib\/version\.js/, 'the file left at the new version was not named');
    assert.deepEqual(behind(), [], 'files were left staged');
  } finally {
    rmSync(path.join(root, broken), { recursive: true, force: true });
    write(TREE);
    for (const p of behind()) rmSync(path.join(root, p), { force: true });
  }
});

test('a CRLF checkout bumps, and keeps its CRLF', () => {
  // Git for Windows checks this repo out with CRLF (there is no .gitattributes), and the three
  // multi-line patterns wanted a bare \n inside their prefix: the lockfile refused the bump.
  const crlf = Object.fromEntries(Object.entries(TREE).map(([file, text]) => [file, text.replaceAll('\n', '\r\n')]));
  write(crlf);
  try {
    const r = bump(root, '0.6.0');
    assert.deepEqual([...new Set(r.changed)].sort(), Object.keys(TREE).sort(), 'every file was written');
    assert.match(read('Cargo.lock'), /^name = "cubus-desktop"\r\nversion = "0\.6\.0"\r$/m);
    const plist = read('apps/desktop/src-tauri/gen/apple/cubus-desktop_iOS/Info.plist');
    assert.match(plist, /^\t<key>CFBundleShortVersionString<\/key>\r\n\t<string>0\.6\.0<\/string>\r$/m);
    assert.match(plist, /^\t<key>CFBundleVersion<\/key>\r\n\t<string>0\.6\.0<\/string>\r$/m);
    assert.ok(Object.keys(TREE).every((file) => !/[^\r]\n/.test(read(file))), 'a line ending was changed');
  } finally {
    write(TREE);
  }
});

test('the result names each file once, and says site by site what moved', () => {
  write(TREE);
  try {
    const full = bump(root, '0.8.0');
    assert.equal(full.changed.length, new Set(full.changed).size, 'a file with two sites was named twice');
    assert.deepEqual([...full.changed].sort(), Object.keys(TREE).sort());
    assert.ok(full.sites.every((site) => site.bumped === true), 'every site moved, and each should say so');

    // One of project.yml's two fields already at the target and the other not: only that one moved.
    write(TREE);
    const ios = 'apps/desktop/src-tauri/gen/apple/project.yml';
    write({ [ios]: TREE[ios].replace('CFBundleShortVersionString: 0.4.2', 'CFBundleShortVersionString: 0.8.0') });
    const part = bump(root, '0.8.0');
    assert.deepEqual(part.sites.filter((site) => site.file === ios).map((site) => [site.from, site.bumped]),
      [['0.8.0', false], ['0.4.2', true]],
      'a field already at the version was reported as bumped because its sibling moved');
  } finally {
    write(TREE);
  }
});

test('a file with no version line, or two, stops the whole bump with the file named', () => {
  write({ 'apps/desktop/src-tauri/Cargo.toml': `[package]\nname = "cubus-desktop"\nversion = "0.4.2"\n\n[dependencies.tauri]\nversion = "2"\n` });
  assert.throws(() => bump(root, '0.5.0'), /Cargo\.toml: expected exactly one version line, found 2/);
  assert.equal(read('apps/web/lib/version.js'), TREE['apps/web/lib/version.js'], 'the files before it in the list were not written either');
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
