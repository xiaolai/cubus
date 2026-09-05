#!/usr/bin/env node
// Build the updater's `latest.json` from the artifacts that were actually produced.
//
// WHY IT SCANS RATHER THAN SPELLS. Tauri's bundler names updater artifacts itself, and those names
// have changed between versions and differ per bundle kind. A manifest built from names typed into
// a workflow points at URLs that 404 — and a 404 is not an error the user ever sees: the client
// reports "no update available" and everybody stays on the old version indefinitely. So the source
// of truth is the directory: every `.sig` must sit beside the file it signs, and the URL is built
// from that file's real name.
//
// It is a script with tests rather than twenty lines of YAML because this is the piece whose
// failure is silent. `updater-manifest.test.mjs` drives the classifier, the missing-signature
// refusal, and the semver rule below — and asks the manifest the question the CLIENT asks, key by
// key, because the failure of 2026-09-04 was a manifest that looked complete and answered the
// wrong file.
//
// THE SEMVER RULE, learned the expensive way in a sibling project: Tauri parses `version` with
// `semver`, which strictly rejects a leading `v`. The git tag is `v0.2.2`, so a manifest that
// passes the tag straight through is well-formed JSON that every client silently rejects as "no
// update". That is why `--version` is validated here and not merely interpolated.

import { readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * The bundle kinds the updater can apply, by the file name Tauri's bundler gives each one.
 *
 * ONE KEY PER INSTALLER, because the client asks for its own installer FIRST. tauri-plugin-updater
 * 2.11.0 builds its lookup list as [`{os}-{arch}-{installer}`, `{os}-{arch}`] and takes the first
 * key the manifest carries (`Update::get_urls` in its `updater` module, lines 618-631), where `installer` is the bundle kind the running
 * binary was installed from — appimage, deb, rpm, msi, nsis, or app. The bare `{os}-{arch}` key is
 * only the FALLBACK for a client whose installer has no entry of its own, and that fallback is
 * where the mapping this replaces went wrong: it listed the AppImage alone for Linux, so a `.deb`
 * install fell through to the bare key, downloaded the AppImage, and `install_deb` refused the
 * bytes — `infer::archive::is_deb` fails and the install returns `InvalidUpdaterFormat`
 * (`install_deb`, same module, lines 1120-1135; `install_rpm` is the same check with `is_rpm`). A daily prompt whose
 * install always failed, on every deb and rpm install, until 2026-09-04. Windows had the same shape
 * with a preference rule instead of an omission: an MSI install was handed the NSIS installer.
 *
 * `bare` marks the plugin's DEFAULT installer per OS — the AppImage and the NSIS setup — which also
 * carries the fallback key, so a client whose installer is unknown to this list still finds a
 * payload it can apply. The `.zip` forms are still accepted because other Tauri configurations
 * emit them and it costs nothing; the bare installers are what this project actually ships,
 * measured from a real tagged build (the v0.2.3 run produced `cubus_0.2.3_x64-setup.exe.sig` and
 * `cubus_0.2.3_x64_en-US.msi.sig`, not the `.nsis.zip` / `.msi.zip` this originally looked for).
 */
const INSTALLERS = [
  { os: 'windows', installer: 'nsis', bare: true, matches: (f) => f.endsWith('-setup.exe') || f.endsWith('.nsis.zip') },
  { os: 'windows', installer: 'msi', bare: false, matches: (f) => f.endsWith('.msi') || f.endsWith('.msi.zip') },
  { os: 'linux', installer: 'appimage', bare: true, matches: (f) => f.endsWith('.AppImage') },
  { os: 'linux', installer: 'deb', bare: false, matches: (f) => f.endsWith('.deb') },
  { os: 'linux', installer: 'rpm', bare: false, matches: (f) => f.endsWith('.rpm') },
];

/**
 * The architecture an artifact's name states, in Tauri's spelling, or null when it states none.
 *
 * Every Windows and Linux bundle Tauri names carries one (`x64`, `amd64`, `x86_64`, `aarch64`,
 * `arm64`, `armhf`, `i686`); the universal macOS tarball carries none because it covers both. It
 * is read rather than assumed so that a bundle for an architecture this project does not build
 * today is keyed by the architecture it IS, never labelled `x86_64` — a client would download it,
 * verify its perfectly valid signature, and fail to run it, which is the silent failure this file
 * exists to prevent. `x86_64` is tested first because `x86` is a substring of it.
 */
function archOf(file) {
  const stem = file.toLowerCase();
  const has = (alternatives) => new RegExp(`(^|[_.-])(${alternatives})([_.-]|$)`).test(stem);
  if (has('x64|amd64|x86_64')) return 'x86_64';
  if (has('aarch64|arm64')) return 'aarch64';
  if (has('armhf|armv7|armv7l')) return 'armv7';
  if (has('i386|i686|x86')) return 'i686';
  return null;
}

/**
 * Which Tauri platform keys an artifact serves — an empty list for a file the updater never
 * applies, such as the `.dmg`, which is how macOS INSTALLS and carries no updater signature.
 *
 * macOS self-updates alongside its Homebrew cask since 47aee64 (2026-09-03), and
 * `tauri.macos.conf.json` emits the artifact: ONE universal `.app.tar.gz`, which answers for
 * `darwin-aarch64` and `darwin-x86_64` alike because a universal bundle covers both. The plugin's
 * installer there is `app`, whose bare-key fallback is exactly these two entries. Listing only one
 * would leave half of macOS never offered an update, and nothing would report that.
 */
export function platformsFor(name) {
  const file = basename(name);
  if (file.endsWith('.app.tar.gz')) return ['darwin-aarch64', 'darwin-x86_64'];
  const kind = INSTALLERS.find((k) => k.matches(file));
  if (!kind) return [];
  const arch = archOf(file);
  if (!arch) {
    throw new Error(
      `${file}: cannot tell which architecture this ${kind.os} ${kind.installer} bundle is for — ` +
        'Tauri names every Windows and Linux bundle with one, so this is not a file Tauri produced.',
    );
  }
  const keys = [`${kind.os}-${arch}-${kind.installer}`];
  if (kind.bare) keys.push(`${kind.os}-${arch}`);
  return keys;
}

/**
 * @param {object} o
 * @param {string[]} o.files    every filename present (signatures included)
 * @param {(sig: string) => string} o.readSignature  reads a .sig's contents
 * @param {string} o.version    bare semver, no leading v
 * @param {string} o.baseUrl    where the assets are downloadable from
 * @param {string} [o.notes]
 * @param {string} [o.pubDate]
 */
export function buildManifest({ files, readSignature, version, baseUrl, notes, pubDate }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `version "${version}" is not bare X.Y.Z. Tauri parses this with semver and rejects a ` +
        'leading "v" — the manifest would be valid JSON that every client reads as "no update".',
    );
  }

  const sigs = files.filter((f) => f.endsWith('.sig'));
  if (sigs.length === 0) {
    throw new Error(
      'no .sig files were produced. createUpdaterArtifacts is off, or TAURI_SIGNING_PRIVATE_KEY ' +
        'was not set during the build — either way an unsigned update is one no client will take.',
    );
  }

  /** @type {Record<string, {signature: string, url: string, from: string}>} */
  const platforms = {};
  for (const sig of sigs.sort()) {
    const artifact = basename(sig).replace(/\.sig$/, '');
    const targets = platformsFor(artifact);
    if (targets.length === 0) continue; // a signature for something the updater does not serve
    const signature = readSignature(sig).trim();
    if (!signature) {
      throw new Error(`${sig} is empty — an empty signature validates as JSON and fails every client`);
    }
    for (const key of targets) {
      // A key claimed twice is a COLLISION, not a preference. The old code ranked NSIS over MSI
      // here, which is how an MSI install came to be handed the NSIS installer; now that every
      // installer has its own key, two files for one key means the build produced something this
      // list does not understand, and guessing which to publish is the wrong response.
      const held = platforms[key];
      if (held) {
        throw new Error(
          `${artifact} and ${held.from} both claim the updater key "${key}" — ` +
            'two payloads for one installer; refusing to guess which one to publish',
        );
      }
      platforms[key] = { signature, url: `${baseUrl}/${artifact}`, from: artifact };
    }
  }

  if (Object.keys(platforms).length === 0) {
    throw new Error(
      `none of the ${sigs.length} signature(s) belong to a platform the updater serves: ` +
        `${sigs.map((s) => basename(s)).join(', ')}`,
    );
  }

  return {
    version,
    notes: notes ?? `See the release notes at ${baseUrl.replace('/download/', '/tag/')}`,
    pub_date: pubDate ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    platforms: Object.fromEntries(
      Object.entries(platforms).map(([k, v]) => [k, { signature: v.signature, url: v.url }]),
    ),
  };
}

/* c8 ignore start — the CLI shell; the logic above is what the tests drive. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? undefined : process.argv[i + 1];
  };
  const dir = arg('dir');
  const version = arg('version');
  const baseUrl = arg('base-url');
  const out = arg('out') ?? 'latest.json';
  if (!dir || !version || !baseUrl) {
    console.error('usage: make-updater-manifest.mjs --dir <artifacts> --version <X.Y.Z> --base-url <url> [--out latest.json]');
    process.exit(2);
  }
  const { readFileSync } = await import('node:fs');
  // Recursive, because upload-artifact preserves the bundler's directory tree.
  const walk = (d) =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
    );
  const manifest = buildManifest({
    files: walk(dir),
    readSignature: (f) => readFileSync(f, 'utf8'),
    version,
    baseUrl,
  });
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${out}:`);
  console.log(JSON.stringify(manifest, null, 2));
}
/* c8 ignore stop */
