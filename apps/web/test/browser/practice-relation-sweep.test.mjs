// THE FOUNDING SWEEP of the Practice screen against a smart cube that is not there (dev-docs/algorithm-drill-v2-plan.md
// §6, D1–D3): every library row, in every one of the 24 holds, through `window.cubusFeed` and the real session path in
// a real WebKit. Its own file because it is the one case too slow for every push — about 27 minutes on CI's runner,
// most of the web job's test step — so the nightly tier names it (apps/web/run-tests.mjs, owner, 2026-10-20) and CI's
// scheduled job runs it. Every push still runs the same rows in the same holds through the engine with no page
// (test/drill-engine.test.mjs), and the page's other relations (./practice-relation.test.mjs).

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { ORIENTATIONS } from '../../lib/cube-orientation.js';
import { lcg } from '../fixtures/seeded-scrambles.mjs';
import { startBrowserFixture } from './harness.mjs';
import { STEP_MS, feedRep, openPractice as openOn, randomStart, recordOf, reportsPerToken, show } from './practice-page.mjs';

let fixture;
before(async () => { fixture = await startBrowserFixture(); });
after(async () => { await fixture?.close(); });

/** A page on the Practice library, with the stand-in cube connected unless a case says otherwise. */
const openPractice = (opts) => openOn(fixture, opts);

// ---- D1, D2: every row completes exactly at its last report, and the page prints what is judged ------------

test('every ledger row completes exactly at its last report — never before — from random starts, in all 24 holds', async () => {
  // THE FOUNDING TEST of plan §6, as it is written: every row, every hold, through `cubusFeed` and the real
  // session path. The engine's own sweep (test/drill-engine.test.mjs) covers the same reps with no page; what
  // this adds is the page — the chips it prints are what is judged, and every report it paints for a hold the
  // engine inferred, a half turn's and a slice's midpoints included, draws without a page error.
  const { page, context, errors } = await openPractice();
  const t0 = Date.now();
  try {
    const catalogue = await page.evaluate(() => window.__p.rows());
    const rows = Object.values(catalogue.rows);
    assert.ok(rows.length > 300, `the library read ${rows.length} rows`);
    const rnd = lcg(20261017);
    let reps = 0;
    for (const row of rows) {
      const printed = await show(page, row.id);
      // THE RELATION's first half: the page prints the row as written, and the engine was handed that string.
      assert.equal(printed.chips.join(' '), row.alg.trim().replace(/\s+/g, ' '), `${row.id}: the page prints something else`);
      assert.equal(printed.data.judging, row.alg, `${row.id}: the engine was given something other than the row`);
      // The record is emptied for each row, so the reps of all of them never reach its total cap and every one made
      // can be counted on it below — emptied as another window would empty it, by deleting the database. The page's
      // connection closes under it and its next read opens a fresh one; the previous row's saves have all settled
      // (`recordOf` below), so none of them can land in the new database.
      await page.evaluate(() => window.__p.drop());
      // Every hold, with reports built from the PRINTED chips.
      for (const hold of ORIENTATIONS) {
        const flat = reportsPerToken(printed.chips.join(' '), hold, rnd).flat();
        const dones = await feedRep(page, randomStart(rnd), flat);
        assert.deepEqual(dones, [...Array(flat.length - 1).fill(0), 1],
          `${row.id} held ${hold}: done after reports ${dones.map((d, i) => (d ? i + 1 : null)).filter(Boolean)} of ${flat.length}`);
        // D3: the time is the cube's own, first report to last — or a refusal for a one-turn algorithm.
        const time = await page.evaluate(() => window.__p.time());
        if (row.htm < 2) assert.match(time, /^— \(one turn has no time between turns\)$/, `${row.id} held ${hold}: ${time}`);
        else assert.ok(time.startsWith(`${((flat.length - 1) * STEP_MS / 1000).toFixed(2)} s, first turn to last`), `${row.id} held ${hold}: ${time}`);
        reps += 1;
      }
      // The record holds exactly the reps made: one per hold, under this row, every one clean, none with a lost turn.
      const { algs } = await recordOf(page);
      assert.deepEqual(Object.keys(algs), [row.id], `${row.id}: reps were filed under ${Object.keys(algs).join(', ') || 'nothing'}`);
      assert.equal(algs[row.id].length, ORIENTATIONS.length, `${row.id}: ${algs[row.id].length} reps on record for ${ORIENTATIONS.length} made`);
      assert.ok(algs[row.id].every((r) => r.clean === true && r.lostTurn === false), `${row.id}: a clean rep was filed as something else`);
    }
    assert.equal(reps, rows.length * ORIENTATIONS.length);
    assert.deepEqual(errors, [], 'the page raised an error');
    console.log(`# practice-relation: ${rows.length} rows × ${ORIENTATIONS.length} holds, ${reps} reps through cubusFeed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } finally {
    await context.close();
  }
});
