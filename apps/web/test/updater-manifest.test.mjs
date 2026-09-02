// `latest.json` is the one artifact whose failure is completely silent.
//
// A manifest with a wrong URL, a missing platform, or a leading `v` on the version is well-formed
// JSON that every Tauri client accepts and reads as "no update available" — so a broken release
// looks exactly like a release nobody needed, on every user's machine, indefinitely. There is no
// error to notice and no log to read. That is why the generator is a script with tests rather than
// bash in a workflow, and why these tests are mostly about refusing rather than producing.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { buildManifest, platformsFor } from '../../../scripts/make-updater-manifest.mjs';

const BASE = 'https://github.com/xiaolai/cubus/releases/download/v0.2.3';
const sigOf = (name) => `${name}.sig`;
const reader = (map) => (path) => map[path.split('/').pop()] ?? '';

describe('platformsFor', () => {
  // macOS does not produce this today — `createUpdaterArtifacts` is false there, because Homebrew
  // owns macOS updates and the app's updater is not compiled for it. The mapping stays because it
  // is a true statement about the FORMAT (one universal bundle covers both architectures), and the
  // exclusion is a policy that could be reversed; serving only one arch would then quietly leave
  // half of macOS unserved.
  test('a universal .app.tar.gz would serve both macOS architectures', () => {
    assert.deepEqual(platformsFor('cubus.app.tar.gz'), ['darwin-aarch64', 'darwin-x86_64']);
  });

  // The decision, asserted where someone changing it will trip over it: macOS emits no updater
  // artifact, so a real release produces no darwin entry at all.
  test('the macOS config emits no updater artifacts, so no darwin entry is ever built', () => {
    const conf = JSON.parse(
      readFileSync(new URL('../../desktop/src-tauri/tauri.macos.conf.json', import.meta.url), 'utf8'),
    );
    assert.equal(conf?.bundle?.createUpdaterArtifacts, false,
      'macOS must not produce updater artifacts while Homebrew owns its updates');
  });

  test('windows and linux artifacts map to their single targets', () => {
    assert.deepEqual(platformsFor('cubus_0.2.3_x64-setup.nsis.zip'), ['windows-x86_64']);
    assert.deepEqual(platformsFor('cubus_0.2.3_x64_en-US.msi.zip'), ['windows-x86_64']);
    assert.deepEqual(platformsFor('cubus_0.2.3_amd64.AppImage'), ['linux-x86_64']);
  });

  // The .dmg, .deb and .rpm are how people INSTALL; they are not what the updater consumes, and
  // pointing the updater at one would hand the client a payload it cannot apply.
  test('installer-only formats serve no updater platform', () => {
    for (const n of ['cubus_0.2.3_universal.dmg', 'cubus_0.2.3_amd64.deb', 'cubus-0.2.3-1.x86_64.rpm']) {
      assert.deepEqual(platformsFor(n), [], n);
    }
  });
});

describe('buildManifest', () => {
  const full = () => {
    const mac = 'cubus.app.tar.gz';
    const win = 'cubus_0.2.3_x64-setup.nsis.zip';
    const lin = 'cubus_0.2.3_amd64.AppImage';
    return {
      files: [mac, win, lin, sigOf(mac), sigOf(win), sigOf(lin), 'cubus_0.2.3_universal.dmg'],
      readSignature: reader({ [sigOf(mac)]: 'MAC-SIG', [sigOf(win)]: 'WIN-SIG', [sigOf(lin)]: 'LIN-SIG' }),
      version: '0.2.3',
      baseUrl: BASE,
    };
  };

  test('every platform gets the signature and URL of a file that exists', () => {
    const m = buildManifest(full());
    assert.equal(m.version, '0.2.3');
    assert.deepEqual(Object.keys(m.platforms).sort(), [
      'darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'windows-x86_64',
    ]);
    assert.equal(m.platforms['darwin-aarch64'].signature, 'MAC-SIG');
    assert.equal(m.platforms['darwin-aarch64'].url, `${BASE}/cubus.app.tar.gz`);
    assert.equal(m.platforms['darwin-x86_64'].url, `${BASE}/cubus.app.tar.gz`);
    assert.equal(m.platforms['windows-x86_64'].url, `${BASE}/cubus_0.2.3_x64-setup.nsis.zip`);
    assert.equal(m.platforms['linux-x86_64'].signature, 'LIN-SIG');
    // No stray bookkeeping reaches the published file.
    assert.deepEqual(Object.keys(m.platforms['linux-x86_64']).sort(), ['signature', 'url']);
  });

  // The trap that cost a sibling project a release: the tag is `v0.2.3`, Tauri parses `version`
  // with semver, and semver rejects the leading v. The manifest stays valid JSON and every client
  // reads it as "no update".
  test('a version with a leading v is refused, not published', () => {
    assert.throws(() => buildManifest({ ...full(), version: 'v0.2.3' }), /bare X\.Y\.Z|semver/);
  });

  test('a non-semver version is refused', () => {
    for (const v of ['0.2', '0.2.3-beta', '', 'latest']) {
      assert.throws(() => buildManifest({ ...full(), version: v }), /bare X\.Y\.Z/, v);
    }
  });

  // An empty sigs/ directory used to cascade into empty signature strings that still validate as
  // JSON — the failure this whole file exists to make impossible.
  test('no signatures at all is a hard failure', () => {
    assert.throws(
      () => buildManifest({ ...full(), files: ['cubus.app.tar.gz', 'cubus_0.2.3_universal.dmg'] }),
      /no \.sig files/,
    );
  });

  test('an empty signature file is a hard failure', () => {
    const f = full();
    assert.throws(
      () => buildManifest({ ...f, readSignature: () => '   ' }),
      /empty/,
    );
  });

  test('signatures that belong to no updater platform are a hard failure', () => {
    assert.throws(
      () => buildManifest({
        ...full(),
        files: ['cubus_0.2.3_amd64.deb', 'cubus_0.2.3_amd64.deb.sig'],
        readSignature: () => 'DEB-SIG',
      }),
      /belong to a platform/,
    );
  });

  // A partial release is allowed to publish — a Windows-only run should still update Windows —
  // because refusing would mean one platform's build failure blocks everyone else's update.
  test('a partial set publishes the platforms it has', () => {
    const lin = 'cubus_0.2.3_amd64.AppImage';
    const m = buildManifest({
      files: [lin, sigOf(lin)],
      readSignature: () => 'LIN-SIG',
      version: '0.2.3',
      baseUrl: BASE,
    });
    assert.deepEqual(Object.keys(m.platforms), ['linux-x86_64']);
  });

  test('when a build produced both Windows artifacts, NSIS wins and the platform gets one URL', () => {
    const nsis = 'cubus_0.2.3_x64-setup.nsis.zip';
    const msi = 'cubus_0.2.3_x64_en-US.msi.zip';
    const m = buildManifest({
      files: [nsis, msi, sigOf(nsis), sigOf(msi)],
      readSignature: reader({ [sigOf(nsis)]: 'NSIS-SIG', [sigOf(msi)]: 'MSI-SIG' }),
      version: '0.2.3',
      baseUrl: BASE,
    });
    assert.equal(Object.keys(m.platforms).length, 1);
    assert.equal(m.platforms['windows-x86_64'].signature, 'NSIS-SIG');
  });

  test('pub_date is an ISO instant the updater can parse', () => {
    const m = buildManifest(full());
    assert.match(m.pub_date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  // The generator is fed a recursive walk, so paths arrive with directories attached; the URL must
  // carry the FILE name, never the runner's directory tree.
  test('nested artifact paths still produce a flat download URL', () => {
    const mac = 'target/universal-apple-darwin/release/bundle/macos/cubus.app.tar.gz';
    const m = buildManifest({
      files: [mac, `${mac}.sig`],
      readSignature: () => 'MAC-SIG',
      version: '0.2.3',
      baseUrl: BASE,
    });
    assert.equal(m.platforms['darwin-aarch64'].url, `${BASE}/cubus.app.tar.gz`);
  });
});
