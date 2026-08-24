// The renderer ships as a bundle, so editing the source is only half of a change.
//
// apps/web/lib/cubus-cube.js is bundled to apps/web/vendor/cubus-cube.js by `pnpm build:cube`, and
// the page loads the BUNDLE. Editing the source and forgetting the build fails in the quietest way
// there is: every test that reads the source passes, the app loads, and the new method is simply
// not there at runtime. Nothing goes red until someone clicks the button.
//
// build.mjs already refuses to assemble dist/ when the bundle's MTIME is older than the source.
// This is the complement, not a duplicate: mtimes do not survive a clone or a checkout, so that
// guard goes quiet on exactly the machine that did not do the build, and it cannot run at all
// outside `build:dist`. This compares CONTENT, and runs in the ordinary test suite.
//
// This is a staleness check, not a behaviour test — three.js cannot be driven under happy-dom.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../lib/cubus-cube.js', import.meta.url), 'utf8');
const bundle = readFileSync(new URL('../vendor/cubus-cube.js', import.meta.url), 'utf8');

test('every method the renderer source declares survived into the bundle', () => {
  // Class-body method declarations: `name(args) {` at two-space indent, minus control keywords.
  const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function']);
  const methods = [
    ...new Set(
      [...src.matchAll(/^ {2}(?:set |get |async )?([A-Za-z_$][\w$]*)\s*\(/gm)]
        .map((m) => m[1])
        .filter((n) => !KEYWORDS.has(n)),
    ),
  ];
  assert.ok(methods.length > 10, `expected a class body, parsed ${methods.length} methods`);
  const missing = methods.filter((n) => !bundle.includes(n)).sort();
  assert.deepEqual(missing, [], 'source is ahead of the bundle — run `pnpm build:cube`');
});

test('the animation floor in the bundle is the one the source sets', () => {
  // The floor exists to stop a non-positive tempo producing an Infinite duration, which freezes
  // the cube mid-turn. It also bounds the slowest speed the app can ask for, so a stale bundle
  // here means the app silently animates at the old speed.
  const floor = src.match(/Math\.max\((0\.\d+), this\._num\('tempo-scale'/);
  assert.ok(floor, 'tempo floor not found in the source — update this test');
  assert.ok(
    bundle.includes(`Math.max(${floor[1]}, `),
    `bundle does not carry the ${floor[1]} tempo floor — run \`pnpm build:cube\``,
  );
});
