// The release status report, held to the failures it exists to catch.
//
// `scripts/release-status.mjs` answers "where is release X.Y.Z", and the only interesting thing
// about it is whether it can say NO. A reporter that prints `ok` down the page is worse than no
// reporter, because it is believed — so every case here feeds it a release that is wrong in one
// specific way and asserts it notices.
//
// Offline by construction: the decisions are pure functions over data, and the `gh`/`git` calls
// live in the script's own effect layer. That split is the point — the part that decides is the
// part that can be tested, and the part that talks to GitHub answers `null` rather than throwing
// so one missing tool degrades one line to `unchecked` instead of taking the report down.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DONE, FAILED, PENDING, UNCHECKED,
  assetReport, caskVersion, exitCodeFor, expectedAssets, expectedPlatformKeys, manifestReport,
} from '../../../scripts/release-status.mjs';

const V = '0.6.0';
const step = (status) => ({ name: 'x', status, detail: '' });

test('the expected assets are the shape two releases have actually carried', () => {
  const names = expectedAssets(V);
  assert.equal(names.length, 14, 'v0.5.3 and v0.6.0 both carried fourteen assets');
  // The installers a person downloads, each with the signature the updater needs — except the
  // .dmg, which is how macOS INSTALLS and carries none.
  assert.ok(names.includes(`cubus_${V}_universal.dmg`));
  assert.ok(!names.includes(`cubus_${V}_universal.dmg.sig`), 'the .dmg has no updater signature, by design');
  assert.ok(names.includes('cubus.app.tar.gz.sig'), 'the macOS update artifact is signed');
  assert.ok(names.includes('latest.json'));
  for (const n of names) assert.ok(!n.includes('{'), `${n} still holds a placeholder`);
});

test('the platform keys are derived from the manifest writer, not listed again', () => {
  const keys = expectedPlatformKeys(V);
  // The shape AGENTS.md records: one key per INSTALLER, plus the bare fallback, because the client
  // looks up its installer key first and install_deb refuses foreign bytes.
  for (const want of ['linux-x86_64-deb', 'linux-x86_64-rpm', 'linux-x86_64-appimage',
    'windows-x86_64-msi', 'windows-x86_64-nsis', 'linux-x86_64', 'windows-x86_64',
    'darwin-aarch64', 'darwin-x86_64']) {
    assert.ok(keys.includes(want), `${want} is not among the derived keys`);
  }
  assert.ok(!keys.some((k) => k.includes('dmg')), 'the .dmg serves no platform key');
});

test('a missing asset is reported, and so is one nobody expected', () => {
  const full = expectedAssets(V);
  const short = full.filter((n) => n !== `cubus_${V}_amd64.deb.sig`);
  assert.deepEqual(assetReport(V, short).missing, [`cubus_${V}_amd64.deb.sig`]);
  assert.deepEqual(assetReport(V, short).unexpected, []);

  const strange = [...full, 'cubus_0.6.0_surprise.zip'];
  assert.deepEqual(assetReport(V, strange).missing, []);
  assert.deepEqual(assetReport(V, strange).unexpected, ['cubus_0.6.0_surprise.zip']);

  assert.deepEqual(assetReport(V, full), { missing: [], unexpected: [] });
});

test('a manifest naming the wrong version is refused', () => {
  const good = { version: V, platforms: Object.fromEntries(expectedPlatformKeys(V).map((k) => [k, {}])) };
  assert.deepEqual(manifestReport(V, good), []);

  const wrong = { ...good, version: '0.5.3' };
  assert.match(manifestReport(V, wrong).join(' '), /0\.5\.3/);
});

test('a manifest missing an installer key is refused, because that failure is daily and silent', () => {
  const keys = expectedPlatformKeys(V).filter((k) => k !== 'linux-x86_64-deb');
  const bare = { version: V, platforms: Object.fromEntries(keys.map((k) => [k, {}])) };
  const problems = manifestReport(V, bare);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /linux-x86_64-deb/);
});

test('a manifest with no platforms at all, and one that is not an object', () => {
  assert.deepEqual(manifestReport(V, { version: V, platforms: {} }), ['latest.json carries no platforms at all']);
  assert.deepEqual(manifestReport(V, null), ['latest.json is not an object']);
});

test('the cask version is read, and unreadable text yields null rather than a guess', () => {
  assert.equal(caskVersion('cask "cubus" do\n  version "0.6.0"\n  sha256 "abc"\nend\n'), '0.6.0');
  assert.equal(caskVersion('cask "cubus" do\nend\n'), null);
  assert.equal(caskVersion(''), null);
});

test('the exit code never calls an unfinished release finished', () => {
  assert.equal(exitCodeFor([step(DONE), step(DONE)]), 0);
  assert.equal(exitCodeFor([step(DONE), step(FAILED)]), 1);
  assert.equal(exitCodeFor([step(DONE), step(PENDING)]), 2);

  // The one that matters most: a step that could not run is not a pass. A missing `gh` must never
  // produce exit 0, which is the whole reason `unchecked` is a state of its own.
  assert.equal(exitCodeFor([step(DONE), step(UNCHECKED)]), 2);
  assert.notEqual(exitCodeFor([step(UNCHECKED)]), 0);

  // A failure outranks a pending one: there is no point reporting "nearly there" over a red step.
  assert.equal(exitCodeFor([step(PENDING), step(FAILED), step(UNCHECKED)]), 1);
});
