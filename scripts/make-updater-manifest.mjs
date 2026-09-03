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
// refusal, and the semver rule below.
//
// THE SEMVER RULE, learned the expensive way in a sibling project: Tauri parses `version` with
// `semver`, which strictly rejects a leading `v`. The git tag is `v0.2.2`, so a manifest that
// passes the tag straight through is well-formed JSON that every client silently rejects as "no
// update". That is why `--version` is validated here and not merely interpolated.

import { readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Which Tauri platform keys an artifact serves.
 *
 * macOS DOES NOT CURRENTLY PRODUCE ONE. `tauri.macos.conf.json` sets `createUpdaterArtifacts:
 * false`, because macOS ships through a Homebrew cask and that cask is its updater — the app's own
 * updater is not even compiled there (`SELF_UPDATE_PLATFORMS` in apps/web/lib/app-update.js). So
 * no `.app.tar.gz` reaches this function today and no `darwin-*` entry appears in latest.json,
 * which is the correct manifest for a platform whose updates somebody else owns.
 *
 * The mapping is kept because it is a true statement about what an `.app.tar.gz` IS, and because
 * the decision is a policy rather than a fact about the format: a universal bundle covers both
 * architectures, so one file answers for `darwin-aarch64` and `darwin-x86_64` alike, and listing
 * only one would leave half of macOS unserved if this is ever turned back on.
 */
export function platformsFor(name) {
  if (name.endsWith('.app.tar.gz')) return ['darwin-aarch64', 'darwin-x86_64'];
  // WINDOWS SIGNS THE INSTALLERS THEMSELVES. Measured from a real tagged build, not assumed: the
  // v0.2.3 run produced `cubus_0.2.3_x64-setup.exe.sig` and `cubus_0.2.3_x64_en-US.msi.sig`, not
  // the `.nsis.zip` / `.msi.zip` this originally looked for. The zip forms are still accepted
  // because other Tauri configurations emit them and costing nothing to keep; the bare installers
  // are what this project actually ships.
  if (name.endsWith('-setup.exe') || name.endsWith('.nsis.zip')) return ['windows-x86_64'];
  if (name.endsWith('.msi') || name.endsWith('.msi.zip')) return ['windows-x86_64'];
  // Linux updates through the AppImage. `.deb` and `.rpm` are signed too — createUpdaterArtifacts
  // signs every bundle — but they are how Linux INSTALLS, not how it updates, and handing the
  // updater a payload it cannot apply is worse than offering nothing.
  if (name.endsWith('.AppImage')) return ['linux-x86_64'];
  return [];
}

/** NSIS beats MSI when a build produced both, so one platform never gets two candidate URLs. */
const RANK = (name) =>
  name.endsWith('-setup.exe') || name.endsWith('.nsis.zip') ? 0
  : name.endsWith('.msi') || name.endsWith('.msi.zip') ? 1
  : 0;

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
      const held = platforms[key];
      if (held && RANK(held.from) <= RANK(artifact)) continue;
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
