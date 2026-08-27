// The vendored solver must work with no network.
//
// app.js used to import cubejs and cubing straight from esm.sh and cdn.cubing.net. That made a
// packaged desktop build unable to solve without a connection, and it failed SILENTLY: loadSolver()
// and solve() both try/catch the import, so an offline launch just quietly lost the ability to
// solve rather than reporting anything.
//
// These tests import the vendored bundles the same way app.js does. Nothing here reaches the
// network — if a CDN import creeps back into the vendoring, or the cubing worker stops being
// emitted beside its bundle, the solve throws and this goes red.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const vendor = (f) => new URL(`../vendor/${f}`, import.meta.url);

test('the vendored bundles exist', () => {
  for (const f of ['cubejs.js', 'cubing.js', 'search-worker-entry.js']) {
    assert.ok(existsSync(vendor(f)), `vendor/${f} missing — run \`pnpm vendor:libs\``);
  }
});

test('cubejs solves, and applying its solution leaves a solved cube', async () => {
  const Cube = (await import(vendor('cubejs.js'))).default;
  Cube.initSolver();
  const scramble = "R U R' U' F2 L D L' B2";

  const scrambled = new Cube();
  scrambled.move(scramble);
  assert.ok(!scrambled.isSolved(), 'scramble should actually disturb the cube');

  // Round-trip through the facelet string, which is how app.js hands state to cubejs.
  const solution = Cube.fromString(scrambled.asString()).solve();
  assert.ok(solution.trim().length > 0, 'solver returned an empty alg');

  scrambled.move(solution);
  assert.ok(scrambled.isSolved(), 'applying cubejs’s own solution must leave a solved cube');
});

// The interesting one. cubing runs min2phase in a Web Worker whose URL is resolved from
// import.meta.url, so this fails unless search-worker-entry.js sits beside cubing.js.
test('cubing solves through its worker, and the solution verifies', async () => {
  const { cube3x3x3, experimentalSolve3x3x3IgnoringCenters } = await import(vendor('cubing.js'));
  const scramble = "R U R' U' F2 L D L' B2";
  const kpuzzle = await cube3x3x3.kpuzzle();
  const start = kpuzzle.defaultPattern().applyAlg(scramble);

  const solution = (await experimentalSolve3x3x3IgnoringCenters(start)).toString();
  assert.ok(solution.trim().length > 0, 'solver returned an empty alg');
  assert.ok(
    start.applyAlg(solution).isIdentical(kpuzzle.defaultPattern()),
    'applying the solution must return the cube to solved',
  );
});

// A regression guard on the thing that caused all this: no remote imports in the shipped sources.
test('no source file imports from a CDN', () => {
  for (const f of ['lib/app.js', 'lib/cubejs-entry.js', 'lib/router.js']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const remote = [...src.matchAll(/import\s*\(\s*['"`](https?:\/\/[^'"`]+)/g)].map((m) => m[1]);
    assert.deepEqual(remote, [], `${f} must not import from the network`);
  }
});

// The test above scans four JavaScript files and stops. The page itself was never looked at — so
// a remote resource in index.html could pass a gate named to forbid exactly that.
//
// There used to be exactly one accepted exception here: the Google Fonts stylesheet, documented
// as a known gap. On 2026-08-27 the fonts went system-only, the exception came out, and the gate
// became absolute. An ABOUT-card link's href is fine — a `href` on an <a> fetches nothing — so
// only resource-bearing attributes and CSS url() are scanned.
test('the page loads nothing from the network at all', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const tags = [...html.matchAll(/<(link|script|img|source|video|audio|iframe)\b[^>]*>/gi)].map((m) => m[0]);
  const urls = [
    ...tags.flatMap((t) => [...t.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1])),
    ...[...html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]),
  ];
  const remote = urls.filter((u) => /^(https?:)?\/\//.test(u));
  assert.deepEqual(remote, [], 'index.html loads something remote — this app is offline software');
});
