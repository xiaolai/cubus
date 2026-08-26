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
// the one remote resource this app actually loads sat in index.html, passing a gate named to
// forbid exactly that.
//
// The fonts are a decision already taken and written down (dev-docs/design/README.md, "known
// accepted gap"), so this does not fail them. It makes them the ONLY thing that can be remote:
// anything else new is a test failure, and the exception is visible instead of unexamined.
const ACCEPTED_REMOTE = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

test('the page loads nothing from the network except the one accepted exception', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const urls = [
    ...[...html.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]),
  ];
  const remote = urls.filter((u) => /^(https?:)?\/\//.test(u));
  // Compared by ORIGIN, not by prefix. `startsWith` accepts
  // `https://fonts.googleapis.com.evil.example/`, which is a different host that merely begins
  // with an allowed one — the classic way an allowlist stops being one.
  const originOf = (u) => { try { return new URL(u, 'https://x.invalid').origin; } catch { return u; } };
  const unexpected = remote.filter((u) => !ACCEPTED_REMOTE.includes(originOf(u)));
  assert.deepEqual(unexpected, [], 'index.html loads something remote that is not the accepted exception');

  // And the exception is still exactly what it was recorded as. If the fonts ever get vendored,
  // this fails and the allowlist comes out with them — rather than quietly outliving its reason.
  //
  // It looks for the STYLESHEET, not merely the hostname: the two preconnect hints point at the
  // same origin, so hostname alone kept this assertion satisfied by a pair of links that fetch
  // nothing once the stylesheet is local.
  const remoteStylesheet = [...html.matchAll(/<link\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => /rel\s*=\s*["']stylesheet["']/.test(tag))
    .some((tag) => /href\s*=\s*["'](https?:)?\/\//.test(tag));
  assert.ok(
    remoteStylesheet,
    'the accepted gap is gone — vendored? then remove ACCEPTED_REMOTE, the preconnects, and this assertion',
  );
});

// The check above can only reject what index.html actually contains, and index.html contains only
// allowed URLs — so reverting the origin comparison to `startsWith` would leave it green. These
// exercise the comparison directly, on the hostile inputs a prefix check waves through.
test('the remote allowlist compares origins, not prefixes', () => {
  const originOf = (u) => { try { return new URL(u, 'https://x.invalid').origin; } catch { return u; } };
  const allowed = (u) => ACCEPTED_REMOTE.includes(originOf(u));

  assert.ok(allowed('https://fonts.googleapis.com/css2?family=Zilla+Slab'), 'the real one still passes');
  assert.ok(allowed('https://fonts.gstatic.com/s/x.woff2'));

  for (const hostile of [
    'https://fonts.googleapis.com.evil.example/x.css',   // a different host that merely starts the same
    'https://fonts.googleapis.com.evil.example',
    'http://fonts.googleapis.com/x.css',                 // wrong scheme
    'https://fonts.googleapis.com:8443/x.css',           // wrong port
    'https://evil.example/?u=https://fonts.googleapis.com',
    '//fonts.googleapis.com.evil.example/x.css',
  ]) {
    assert.equal(allowed(hostile), false, `allowlist accepted ${hostile}`);
  }
});
