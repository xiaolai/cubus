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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

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
