// `latest.json` is the one artifact whose failure is completely silent.
//
// A manifest with a wrong URL, a missing platform, or a leading `v` on the version is well-formed
// JSON that every Tauri client accepts and reads as "no update available" — so a broken release
// looks exactly like a release nobody needed, on every user's machine, indefinitely. There is no
// error to notice and no log to read. That is why the generator is a script with tests rather than
// bash in a workflow, and why these tests are mostly about refusing rather than producing.
//
// The tests that matter most here ask the manifest the question the CLIENT asks, with the client's
// own lookup order, because the defect of 2026-09-04 passed every test that only looked at the
// keys: the manifest was complete, well-formed, and answered a `.deb` install with the AppImage.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { buildManifest, platformsFor } from '../../../scripts/make-updater-manifest.mjs';

const BASE = 'https://github.com/xiaolai/cubus/releases/download/v0.2.6';
const sigOf = (name) => `${name}.sig`;
const reader = (map) => (path) => map[path.split('/').pop()] ?? '';

/**
 * The client's own lookup, transcribed from tauri-plugin-updater 2.11.0 (`Update::get_urls` in its `updater` module, lines 618-631):
 * `[{os}-{arch}-{installer}, {os}-{arch}]`, first key present wins. `installer` is the bundle
 * kind the running binary was installed from (`installer_for_bundle_type`, same module, line 1502).
 */
function lookup(manifest, os, arch, installer) {
  for (const key of [`${os}-${arch}-${installer}`, `${os}-${arch}`]) {
    if (manifest.platforms[key]) return manifest.platforms[key].url;
  }
  return undefined;
}

// The exact asset list of the published v0.2.6 release (`gh release view v0.2.6`), signatures
// included, minus the latest.json this script produced from it. The .dmg is the one bundle Tauri
// does not sign for the updater; the universal .app.tar.gz IS there, because macOS self-updates.
const V026 = [
  'cubus-0.2.6-1.x86_64.rpm', 'cubus-0.2.6-1.x86_64.rpm.sig',
  'cubus.app.tar.gz', 'cubus.app.tar.gz.sig',
  'cubus_0.2.6_amd64.AppImage', 'cubus_0.2.6_amd64.AppImage.sig',
  'cubus_0.2.6_amd64.deb', 'cubus_0.2.6_amd64.deb.sig',
  'cubus_0.2.6_universal.dmg',
  'cubus_0.2.6_x64-setup.exe', 'cubus_0.2.6_x64-setup.exe.sig',
  'cubus_0.2.6_x64_en-US.msi', 'cubus_0.2.6_x64_en-US.msi.sig',
];
const real = () =>
  buildManifest({
    files: V026,
    readSignature: (f) => `SIG(${f.split('/').pop()})`,
    version: '0.2.6',
    baseUrl: BASE,
  });

describe('the client finds the payload its own installer can apply', () => {
  // THE HEADLINE DEFECT. `install_deb` verifies the bytes ARE a deb (`infer::archive::is_deb`)
  // before handing them to dpkg, and `install_rpm` the same with `is_rpm` (`install_deb` and `install_rpm`, same module, lines 1120-1135).
  // With no per-installer key the lookup fell through to the bare `linux-x86_64`, which was the
  // AppImage — so every deb and rpm install got a daily prompt whose install always failed.
  for (const [installer, suffix] of [
    ['deb', '.deb'],
    ['rpm', '.rpm'],
    ['appimage', '.AppImage'],
  ]) {
    test(`a Linux ${installer} install resolves to the ${suffix}`, () => {
      const url = lookup(real(), 'linux', 'x86_64', installer);
      assert.ok(url, `no key served the ${installer} client at all`);
      assert.ok(url.endsWith(suffix), `${installer} client was handed ${url}`);
    });
  }

  // Same shape on Windows, by ranking rather than omission: NSIS "won" the one Windows key, so an
  // MSI install was offered the NSIS installer.
  for (const [installer, suffix] of [
    ['msi', '.msi'],
    ['nsis', '-setup.exe'],
  ]) {
    test(`a Windows ${installer} install resolves to the ${suffix}`, () => {
      const url = lookup(real(), 'windows', 'x86_64', installer);
      assert.ok(url, `no key served the ${installer} client at all`);
      assert.ok(url.endsWith(suffix), `${installer} client was handed ${url}`);
    });
  }

  // The plugin's installer on macOS is `app`, and no `darwin-*-app` key is written: the bare
  // darwin keys are the fallback it lands on, one universal tarball for both architectures.
  test('a macOS app install resolves to the universal .app.tar.gz on either architecture', () => {
    for (const arch of ['aarch64', 'x86_64']) {
      assert.equal(lookup(real(), 'darwin', arch, 'app'), `${BASE}/cubus.app.tar.gz`, arch);
    }
  });

  // The bare key is a FALLBACK, for a client whose installer has no entry of its own. It must be
  // the format the plugin can always apply on that OS, and it must exist — a manifest with only
  // per-installer keys would leave an unknown installer with nothing.
  test('the bare keys carry the default installer of each OS', () => {
    const m = real();
    assert.equal(m.platforms['linux-x86_64'].url, `${BASE}/cubus_0.2.6_amd64.AppImage`);
    assert.equal(m.platforms['windows-x86_64'].url, `${BASE}/cubus_0.2.6_x64-setup.exe`);
  });

  test('a real release yields exactly the keys the clients ask for', () => {
    assert.deepEqual(Object.keys(real().platforms).sort(), [
      'darwin-aarch64',
      'darwin-x86_64',
      'linux-x86_64',
      'linux-x86_64-appimage',
      'linux-x86_64-deb',
      'linux-x86_64-rpm',
      'windows-x86_64',
      'windows-x86_64-msi',
      'windows-x86_64-nsis',
    ]);
  });
});

describe('platformsFor', () => {
  // ONE universal macOS bundle answers for both architectures, so a single `.app.tar.gz` serves
  // `darwin-aarch64` and `darwin-x86_64` alike. Listing only one would leave half of macOS never
  // offered an update, and nothing would report that.
  test('a universal .app.tar.gz serves both macOS architectures', () => {
    assert.deepEqual(platformsFor('cubus.app.tar.gz'), ['darwin-aarch64', 'darwin-x86_64']);
  });

  // macOS self-updates alongside its Homebrew cask (47aee64, 2026-09-03), so it has to actually
  // EMIT the artifact. This was false for one commit, and the effect would have been silent in the
  // worst way: a manifest with no darwin entry, and every macOS copy checking, finding nothing, and
  // staying put forever. The fixture above carries the tarball for the same reason: a test set that
  // omitted it would let "no darwin entry" pass as correct, which is exactly what it used to do.
  test('the macOS config emits updater artifacts, and the real set carries one', () => {
    const conf = JSON.parse(
      readFileSync(new URL('../../desktop/src-tauri/tauri.macos.conf.json', import.meta.url), 'utf8'),
    );
    assert.equal(conf?.bundle?.createUpdaterArtifacts, true,
      'macOS must produce updater artifacts now that it self-updates');
    assert.ok(V026.includes('cubus.app.tar.gz.sig'), 'the fixture must include the macOS updater artifact');
    assert.ok('darwin-aarch64' in real().platforms && 'darwin-x86_64' in real().platforms);
  });

  test('every installer maps to its own key, and the two defaults also to the bare key', () => {
    assert.deepEqual(platformsFor('cubus_0.2.6_x64-setup.exe'), ['windows-x86_64-nsis', 'windows-x86_64']);
    assert.deepEqual(platformsFor('cubus_0.2.6_x64_en-US.msi'), ['windows-x86_64-msi']);
    assert.deepEqual(platformsFor('cubus_0.2.6_amd64.AppImage'), ['linux-x86_64-appimage', 'linux-x86_64']);
    assert.deepEqual(platformsFor('cubus_0.2.6_amd64.deb'), ['linux-x86_64-deb']);
    assert.deepEqual(platformsFor('cubus-0.2.6-1.x86_64.rpm'), ['linux-x86_64-rpm']);
  });

  test('the zipped Windows forms other Tauri configs emit map to the same installers', () => {
    assert.deepEqual(platformsFor('cubus_0.2.6_x64-setup.nsis.zip'), ['windows-x86_64-nsis', 'windows-x86_64']);
    assert.deepEqual(platformsFor('cubus_0.2.6_x64_en-US.msi.zip'), ['windows-x86_64-msi']);
  });

  // The .dmg is how macOS INSTALLS. The updater's macOS payload is the .app.tar.gz, and Tauri
  // signs no .dmg for it — a `.dmg.sig` would be a file this script did not expect and must not
  // turn into a darwin entry pointing at an image the client cannot unpack.
  test('the .dmg serves no updater platform, even if a signature turns up beside it', () => {
    assert.deepEqual(platformsFor('cubus_0.2.6_universal.dmg'), []);
    assert.throws(
      () => buildManifest({
        files: ['cubus_0.2.6_universal.dmg', 'cubus_0.2.6_universal.dmg.sig'],
        readSignature: () => 'DMG-SIG',
        version: '0.2.6',
        baseUrl: BASE,
      }),
      /belong to a platform/,
    );
  });

  // The architecture is READ from the name, never assumed: a bundle this project does not build
  // today must be keyed by what it is, and a name that states none is not a file Tauri produced.
  test('a bundle that names another architecture is keyed by it; one that names none is refused', () => {
    assert.deepEqual(platformsFor('cubus_0.2.6_arm64.deb'), ['linux-aarch64-deb']);
    assert.deepEqual(platformsFor('cubus_0.2.6_aarch64.AppImage'), ['linux-aarch64-appimage', 'linux-aarch64']);
    assert.throws(() => platformsFor('cubus.deb'), /architecture/);
  });
});

describe('buildManifest', () => {
  const full = () => {
    const mac = 'cubus.app.tar.gz';
    const win = 'cubus_0.2.6_x64-setup.nsis.zip';
    const lin = 'cubus_0.2.6_amd64.AppImage';
    return {
      files: [mac, win, lin, sigOf(mac), sigOf(win), sigOf(lin), 'cubus_0.2.6_universal.dmg'],
      readSignature: reader({ [sigOf(mac)]: 'MAC-SIG', [sigOf(win)]: 'WIN-SIG', [sigOf(lin)]: 'LIN-SIG' }),
      version: '0.2.6',
      baseUrl: BASE,
    };
  };

  test('every platform gets the signature and URL of a file that exists', () => {
    const m = buildManifest(full());
    assert.equal(m.version, '0.2.6');
    assert.deepEqual(Object.keys(m.platforms).sort(), [
      'darwin-aarch64', 'darwin-x86_64',
      'linux-x86_64', 'linux-x86_64-appimage',
      'windows-x86_64', 'windows-x86_64-nsis',
    ]);
    assert.equal(m.platforms['darwin-aarch64'].signature, 'MAC-SIG');
    assert.equal(m.platforms['darwin-aarch64'].url, `${BASE}/cubus.app.tar.gz`);
    assert.equal(m.platforms['darwin-x86_64'].url, `${BASE}/cubus.app.tar.gz`);
    assert.equal(m.platforms['windows-x86_64-nsis'].url, `${BASE}/cubus_0.2.6_x64-setup.nsis.zip`);
    assert.equal(m.platforms['linux-x86_64-appimage'].signature, 'LIN-SIG');
    // No stray bookkeeping reaches the published file.
    assert.deepEqual(Object.keys(m.platforms['linux-x86_64']).sort(), ['signature', 'url']);
  });

  // The trap that cost a sibling project a release: the tag is `v0.2.6`, Tauri parses `version`
  // with semver, and semver rejects the leading v. The manifest stays valid JSON and every client
  // reads it as "no update".
  test('a version with a leading v is refused, not published', () => {
    assert.throws(() => buildManifest({ ...full(), version: 'v0.2.6' }), /bare X\.Y\.Z|semver/);
  });

  test('a non-semver version is refused', () => {
    for (const v of ['0.2', '0.2.6-beta', '', 'latest']) {
      assert.throws(() => buildManifest({ ...full(), version: v }), /bare X\.Y\.Z/, v);
    }
  });

  // An empty sigs/ directory used to cascade into empty signature strings that still validate as
  // JSON — the failure this whole file exists to make impossible.
  test('no signatures at all is a hard failure', () => {
    assert.throws(
      () => buildManifest({ ...full(), files: ['cubus.app.tar.gz', 'cubus_0.2.6_universal.dmg'] }),
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

  // A partial release is allowed to publish — a Windows-only run should still update Windows —
  // because refusing would mean one platform's build failure blocks everyone else's update.
  test('a partial set publishes the platforms it has', () => {
    const lin = 'cubus_0.2.6_amd64.AppImage';
    const m = buildManifest({
      files: [lin, sigOf(lin)],
      readSignature: () => 'LIN-SIG',
      version: '0.2.6',
      baseUrl: BASE,
    });
    assert.deepEqual(Object.keys(m.platforms).sort(), ['linux-x86_64', 'linux-x86_64-appimage']);
  });

  // Two files for one installer key is a build this list does not understand. The old code
  // resolved it by ranking (NSIS over MSI) — and that ranking is precisely how an MSI install came
  // to be offered the NSIS installer. Refusing names both files; guessing publishes one of them.
  test('two artifacts claiming one key is a collision, not a preference', () => {
    const exe = 'cubus_0.2.6_x64-setup.exe';
    const zip = 'cubus_0.2.6_x64-setup.nsis.zip';
    assert.throws(
      () => buildManifest({
        files: [exe, zip, sigOf(exe), sigOf(zip)],
        readSignature: reader({ [sigOf(exe)]: 'EXE-SIG', [sigOf(zip)]: 'ZIP-SIG' }),
        version: '0.2.6',
        baseUrl: BASE,
      }),
      /both claim the updater key "windows-x86_64-nsis"/,
    );
  });

  test('pub_date is an ISO instant the updater can parse', () => {
    const m = buildManifest(full());
    assert.match(m.pub_date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  // The generator is fed a recursive walk, so paths arrive with directories attached; the URL must
  // carry the FILE name, never the runner's directory tree.
  test('nested artifact paths still produce a flat download URL', () => {
    const mac = 'target/universal-apple-darwin/release/bundle/macos/cubus.app.tar.gz';
    const deb = 'target/release/bundle/deb/cubus_0.2.6_amd64.deb';
    const m = buildManifest({
      files: [mac, `${mac}.sig`, deb, `${deb}.sig`],
      readSignature: () => 'SIG',
      version: '0.2.6',
      baseUrl: BASE,
    });
    assert.equal(m.platforms['darwin-aarch64'].url, `${BASE}/cubus.app.tar.gz`);
    assert.equal(m.platforms['linux-x86_64-deb'].url, `${BASE}/cubus_0.2.6_amd64.deb`);
  });
});
