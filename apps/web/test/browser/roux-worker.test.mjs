// Roux in a real lesson worker, on both engines: the shipped tables are FETCHED by the worker (the one path node
// cannot take — it reads them from disk), checked, and used; the answer solves the cube; and each table is
// fetched once for the page however many lessons are asked for.
//
// Fails loudly without the browsers: `pnpm exec playwright install webkit chromium` (CI does this).

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { ROUX_TABLES } from '../../lib/data/roux-manifest.js';
import Cube from '../../vendor/cubejs.js';
import { seededScrambles } from '../fixtures/seeded-scrambles.mjs';
import { startBrowserFixture } from './harness.mjs';

const ENGINES = ['webkit', 'chromium'];
const fixtures = {};

before(async () => {
  for (const engine of ENGINES) fixtures[engine] = await startBrowserFixture({ engine });
});
after(async () => {
  await Promise.all(Object.values(fixtures).map((fx) => fx.close()));
});

for (const engine of ENGINES) {
  test(`${engine}: the lesson worker fetches Roux's tables once, and its lessons solve the cube`, async () => {
    const fx = fixtures[engine];
    const context = await fx.browser.newContext();
    const fetched = [];
    context.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/lib/data/roux/')) fetched.push(path);
    });
    const page = await context.newPage();
    await page.goto(`${fx.base}/index.html`);
    const scrambles = seededScrambles(3, 0x40c5, 25);
    const algs = await page.evaluate(async (list) => {
      const { methodSolve } = await import('/lib/lesson-client.js');
      const { SOLVED, applyAlg } = await import('/lib/cube-pieces.js');
      const out = [];
      for (const scramble of list) {
        const r = await methodSolve(applyAlg(SOLVED, scramble), 'roux');
        out.push(r?.alg ?? null);
      }
      return out;
    }, scrambles);
    await context.close();
    for (const [i, alg] of algs.entries()) {
      assert.equal(typeof alg, 'string', `${engine}: lesson ${i} came back ${alg}`);
      const c = new Cube();
      c.move(scrambles[i]);
      if (alg) c.move(alg);
      assert.ok(c.isSolved(), `${engine}: cubejs says lesson ${i}'s alg does not solve its cube`);
    }
    // Each shipped table, once: a second lesson that fetched again would be a page paying for the tables twice.
    assert.deepEqual([...fetched].sort(), ROUX_TABLES.map((t) => `/lib/data/roux/${t.file}`).sort(),
      `${engine}: the tables fetched were ${fetched.join(', ') || 'none'}`);
  });
}
