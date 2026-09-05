// The protocol layer is an UNPUBLISHED git dependency, and this is what makes that safe.
//
// vendor-bundles.test.mjs guards our own bundles by comparing declarations and message strings in
// the source against the built artifact. A third-party bundle has no sources of ours to compare
// against — smartcube-entry.js is four lines of re-export — so that guard is nearly vacuous here
// and would wave through a bundle built from any revision at all.
//
// So the revision itself is the thing pinned, in three places that must agree:
//   1. the dependency spec in apps/web/package.json  (what pnpm installs)
//   2. SMARTCUBE_REV in lib/smartcube-entry.js       (what we believe we linked)
//   3. the string baked into vendor/smartcube.js     (what actually ships)
//
// Bump the dep and forget the rebuild: (1) disagrees with (3). Rebuild without bumping the
// constant: (2) disagrees with (1). Hand-edit the bundle: (3) disagrees with both. There is no
// ordering of those mistakes that stays green, which is the property a pinned git dep needs and
// a semver range does not — an npm tarball is integrity-hashed in the lockfile, a branch is not.
//
// **Two of those three are about OUR files, and that was the hole (found 2026-09-04.)**
// `SMARTCUBE_REV` is exported from `smartcube-entry.js`, which is ours, so it lands in the bundle
// whichever revision of the LIBRARY was installed when the build ran. Bump the spec and the
// constant, rebuild without `pnpm install`, and all three "agreed" over a bundle built from the
// old library. Only CI's rebuild-diff caught it, on a machine that had installed. So two more
// places now have to agree, and both describe what is actually on this disk:
//   4. the lockfile resolution                        (what `pnpm install` would put there)
//   5. the library's own messages, inside the bundle  (what the build actually consumed)

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const INSTALLED = fileURLToPath(new URL('../node_modules/smartcube-web-bluetooth/', import.meta.url));

/** A full 40-hex-character git commit sha, and nothing shorter. An abbreviated rev is not a pin:
 *  it can become ambiguous as the upstream history grows. */
const FULL_SHA = /^[0-9a-f]{40}$/;

const pkg = JSON.parse(read('../package.json'));
const spec = pkg.devDependencies['smartcube-web-bluetooth'];
const entry = read('../lib/smartcube-entry.js');

test('every package that depends on it pins the SAME revision', () => {
  // Two packages consume this: apps/web bundles it, packages/gan-driver cross-checks against it.
  // If they drift apart, the cross-implementation gate is measuring a different build from the one
  // that ships — which would make the strongest evidence in the project quietly meaningless.
  const driver = JSON.parse(read('../../../packages/gan-driver/package.json'));
  assert.equal(
    driver.devDependencies['smartcube-web-bluetooth'],
    spec,
    'apps/web and packages/gan-driver pin different revisions of the protocol layer',
  );
});

test('the dependency is pinned to a full commit sha, not a branch or a tag', () => {
  assert.ok(spec, 'smartcube-web-bluetooth is not a dependency of apps/web');
  // Owner-agnostic, sha-strict. We are on a fork (xiaolai/…), and the thing that must hold is not
  // WHOSE repo it is but that the revision is exact — a fork tracked by branch name would move
  // under us between a local build and CI, which is the one property a vendored bundle cannot
  // survive.
  const m = /^github:[\w.-]+\/smartcube-web-bluetooth#([0-9a-f]+)$/.exec(spec);
  assert.ok(m, `expected a github: spec pinned by sha, got ${spec}`);
  assert.match(m[1], FULL_SHA, 'a short sha is not a pin — it can go ambiguous as history grows');
});

test('the entry declares the same revision the package.json installs', () => {
  const m = /SMARTCUBE_REV = '([0-9a-f]+)'/.exec(entry);
  assert.ok(m, 'lib/smartcube-entry.js must declare SMARTCUBE_REV');
  const pinned = /#([0-9a-f]+)$/.exec(spec)[1];
  assert.equal(m[1], pinned, 'SMARTCUBE_REV disagrees with the installed revision');
});

test('the shipped bundle was built from that revision', () => {
  // The bundle is a committed build artifact and the app imports it, so this is the only one of
  // the three that describes what a user actually runs.
  const rev = /SMARTCUBE_REV = '([0-9a-f]+)'/.exec(entry)[1];
  const bundle = read('../vendor/smartcube.js');
  assert.ok(
    bundle.includes(rev),
    'vendor/smartcube.js does not carry the pinned revision — run `pnpm --filter cubus-web build:smartcube`',
  );
});

test('the bundle exports the protocol entry points the app connects through', () => {
  const bundle = read('../vendor/smartcube.js');
  for (const name of ['connectSmartCube', 'getRegisteredProtocols']) {
    assert.ok(
      new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(bundle),
      `${name} is missing from the bundle — the entry re-exports it, so this means a stale build`,
    );
  }
});

test('the bundle carries the decoders, not just the connect path', () => {
  // Ten protocols are the whole reason to link this library. esbuild tree-shakes from the entry,
  // and an entry that reached only the connect path would silently ship a bundle that recognises
  // nothing. These strings live in the individual protocol modules.
  const bundle = read('../vendor/smartcube.js');
  for (const marker of ['gan-gen4', 'giiker', 'gocube', 'qiyi', 'moyu']) {
    assert.ok(bundle.includes(marker), `no trace of the ${marker} protocol in the bundle`);
  }
});

test('no runtime fetch: the bundle is self-contained', () => {
  // Same rule the solver bundle is held to. A vendored artifact that reaches the network at
  // runtime is not vendored, and it breaks the app offline.
  const bundle = read('../vendor/smartcube.js');
  assert.doesNotMatch(bundle, /from\s+["']https?:\/\//, 'a remote import survived into the bundle');
  assert.doesNotMatch(bundle, /import\(\s*["']https?:\/\//, 'a dynamic remote import is in the bundle');
});

test('the lockfile resolves the revision the manifest asks for', () => {
  // The mistake this catches: bumping the spec and the constant, then rebuilding WITHOUT running
  // `pnpm install`. Every check above stays green — they read our own files — while the bundle is
  // built from the library that is still on disk. `pnpm install` is what writes the lockfile, so a
  // lockfile that still names the old revision is proof the install did not happen.
  const lock = readFileSync(new URL('../../../pnpm-lock.yaml', import.meta.url), 'utf8');
  const pinned = /#([0-9a-f]{40})$/.exec(spec)[1];

  // Both importers, because a git dep with no integrity hash is only pinned by what the lockfile
  // says it resolved to.
  const importers = [...lock.matchAll(/^\s{6}smartcube-web-bluetooth:\n\s+specifier: (.+)\n\s+version: (.+)$/gm)];
  assert.equal(importers.length, 2, 'apps/web and packages/gan-driver both depend on it');
  for (const [, specifier, version] of importers) {
    assert.equal(specifier.trim(), spec, 'the lockfile specifier disagrees with package.json — run `pnpm install`');
    assert.ok(
      version.trim().endsWith(`/${pinned}`),
      `the lockfile resolved ${version.trim()}, not ${pinned} — run \`pnpm install\``,
    );
  }
});

test('the installed package is the one the pin names', () => {
  // Not skippable into passing: this file's whole subject is a dependency with no integrity hash,
  // and a check that goes quiet when the dependency is missing reads green on the machine that
  // needed it most.
  assert.ok(existsSync(INSTALLED), `${INSTALLED} is missing — run \`pnpm install\``);
  const installed = JSON.parse(readFileSync(`${INSTALLED}package.json`, 'utf8'));
  const owner = /^github:([\w.-]+)\//.exec(spec)[1];
  assert.match(
    installed.repository?.url ?? '',
    new RegExp(`github\\.com/${owner}/smartcube-web-bluetooth`),
    `installed package comes from ${installed.repository?.url}, but the pin names ${owner}`,
  );
});

/**
 * Messages the entry cannot reach, so their absence from the bundle is correct rather than stale.
 *
 * Named individually with the reason, the same contract as `treeShaken` in vendor-bundles.test.mjs:
 * an unexplained absence is indistinguishable from a stale bundle, and the next person deletes the
 * wrong one. All three belong to code paths `connectSmartCube`/`getRegisteredProtocols` never
 * reach — the standalone GAN cube entry, and the GAN Smart TIMER, which is not a cube.
 */
const UNREACHABLE_FROM_ENTRY = [
  'This device does not support GATT connections', // the library's standalone GAN cube entry
  'Invalid time characteristic value received from Timer', // the GAN Smart Timer, not a cube
  'Invalid time components:', // the same timer module
];

test('the bundle carries the messages the INSTALLED library contains', () => {
  // The only check here that compares the bundle against the dependency rather than against our
  // own re-export. Message literals are copied through by esbuild verbatim, so a message the
  // installed library has and the bundle does not means the bundle was built from something else —
  // an older install, or a different revision entirely.
  const source = readFileSync(`${INSTALLED}dist/esm/index.mjs`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const bundle = read('../vendor/smartcube.js');

  const literals = new Set([
    ...[...source.matchAll(/'([^'\\\n]{20,})'/g)].map((m) => m[1]),
    ...[...source.matchAll(/"([^"\\\n]{20,})"/g)].map((m) => m[1]),
    ...[...source.matchAll(/`([^`\\]*)`/g)]
      .flatMap((m) => m[1].split(/\$\{[^}]*\}/))
      .map((c) => c.trim())
      .filter((c) => c.length >= 20),
  ]);

  const missing = [];
  let checked = 0;
  for (const lit of literals) {
    // A message, not an identifier or a type union: it has to read like a sentence. Plain ASCII
    // only, because esbuild emits non-ASCII as escapes and such a literal is never found verbatim.
    if (!/ [a-z]/.test(lit) || lit.includes('${') || lit.includes('|')) continue;
    if (!/^[ -~]+$/.test(lit)) continue;
    if (/[(){}]|=>|\?\?/.test(lit)) continue;
    if (UNREACHABLE_FROM_ENTRY.some((s) => lit.includes(s))) continue;
    checked++;
    if (!bundle.includes(lit)) missing.push(lit.slice(0, 70));
  }

  assert.ok(checked > 40, `only ${checked} messages compared — the extractor is broken, not the bundle`);
  assert.deepEqual(
    missing.sort(),
    [],
    'the bundle was built from a different install of the library — run `pnpm install` and then ' +
      '`pnpm --filter cubus-web build:smartcube`',
  );
});

test('every message listed as unreachable really is absent, so the list cannot hide a stale one', () => {
  // Without this, an entry here could quietly cover a message that HAS gone missing for a real
  // reason — which is how a "known exception" list turns into a place to bury failures.
  const bundle = read('../vendor/smartcube.js');
  const source = readFileSync(`${INSTALLED}dist/esm/index.mjs`, 'utf8');
  for (const lit of UNREACHABLE_FROM_ENTRY) {
    assert.ok(source.includes(lit), `${lit} is no longer in the library — delete it from the list`);
    assert.ok(!bundle.includes(lit), `${lit} IS in the bundle — it is reachable, so stop excusing it`);
  }
});
