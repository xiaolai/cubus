// The Practice screen against a smart cube that is not there — `window.cubusFeed`, the real session path —
// in a real WebKit (dev-docs/algorithm-drill-v2-plan.md §6, work item WI-9; D1–D6, and WI-12's badge).
//
// THE RELATION, NOT THE PARTS. The first Drill had green suites on both halves and a page that printed one
// procedure while its checker judged another: 0 of 137 completed where the page said. So every case here reads
// the moves off the PAGE — the chips as drawn — turns them into the reports a cube would send in a given hold
// (a half turn as two quarters, a slice as its two faces in either order, a whole-cube turn as nothing), and
// feeds them through `cubusFeed`, the door the driver uses. If the screen judged anything but what it prints,
// the rep would not complete where these cases demand it does.
//
// The page, the stand-in cube and the sound stand-in are ./practice-page.mjs's, shared with
// test/browser/practice-screen.test.mjs. A sound that must NOT play is asserted as an absence, after waiting past
// the cue window.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { ORIENTATIONS } from '../../lib/cube-orientation.js';
import { toFacelets } from '../../lib/cube-pieces.js';
import { GESTURE_TURNS } from '../../lib/drill/engine.js';
import { lcg } from '../fixtures/seeded-scrambles.mjs';
import { LIVENESS_MS, startBrowserFixture } from './harness.mjs';
import {
  AXIS, PAST_WINDOW_MS, STEP_MS, after_, axesNear, feedRep, inverse, mixedOn, openPractice as openOn, randomStart, recordOf,
  reportsPerToken, settle, show,
} from './practice-page.mjs';

let fixture;
before(async () => { fixture = await startBrowserFixture(); });
after(async () => { await fixture?.close(); });

/** A page on the Practice library, with the stand-in cube connected unless a case says otherwise. */
const openPractice = (opts) => openOn(fixture, opts);

// ---- D1, D2: every row completes exactly at its last report, and the page prints what is judged ------------

test('every ledger row completes exactly at its last report — never before — from random starts, in all 24 holds', async () => {
  // THE FOUNDING TEST of plan §6, as it is written: every row, every hold, through `cubusFeed` and the real
  // session path. The engine's own sweep (test/drill-engine.test.mjs) covers the same 7416 reps with no page; what
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

// ---- D4: a wrong turn is heard once; a lost turn, a slice's first face, a half turn's first quarter never ----

/**
 * Feed `row` from a random start to the first position after the hold is settled where a face turn on a free
 * axis exists, and answer the position, the wrong turn and the arrangement so far.
 */
async function toWrongTurn(page, row, rnd, opts = {}) {
  const hold = ORIENTATIONS[Math.floor(rnd() * ORIENTATIONS.length)];
  const per = reportsPerToken(row.alg, hold, rnd);
  let state = randomStart(rnd);
  await page.evaluate((f) => window.__p.facelets(f), toFacelets(state));
  for (let k = 0; k < per.length - 1; k++) {
    await page.evaluate(({ qs, o }) => { for (const q of qs) window.__p.move(q, o); }, { qs: per[k], o: opts });
    state = after_(state, per[k]);
    const { settled } = await page.evaluate(() => window.__p.data());
    if (settled !== 'true' || per[k].length === 0) continue;
    const used = axesNear(per, k + 1);
    const face = 'URFDLB'.split('').find((f) => !used.has(AXIS[f]));
    if (face) return { per, k: k + 1, wrong: face, state };
  }
  throw new Error(`${row.id}: no settled position with a face turn on a free axis — pick another row`);
}

/** Rows that stress the reading: slices, wide turns, rotations, a repeated sequence, an early half turn. */
function featured(rows) {
  const by = (pred, why) => {
    const row = rows.find(pred);
    assert.ok(row, `no ledger row ${why}`);
    return row;
  };
  const repeated = (alg) => {
    const tok = alg.split(' ');
    for (let i = 0; i + 8 <= tok.length; i++) if (tok.slice(i, i + 4).join(' ') === tok.slice(i + 4, i + 8).join(' ')) return true;
    return false;
  };
  return [
    by((r) => r.id === 'sune', 'named sune'),
    by((r) => r.kinds.includes('slice') && r.htm >= 6, 'with a slice'),
    by((r) => r.kinds.includes('wide') && !r.kinds.includes('slice'), 'with a wide turn'),
    by((r) => r.kinds.includes('rotation'), 'with a rotation'),
    by((r) => repeated(r.alg), 'with a repeated sequence of four'),
  ];
}

test('a wrong turn sounds `off` once after the cue window, shows the way back, and the rep still ends at its last report', async () => {
  for (const numbered of [true, false]) {
    const { page, context, errors } = await openPractice({ numbered });
    try {
      const catalogue = await page.evaluate(() => window.__p.rows());
      const rnd = lcg(numbered ? 7 : 8);
      for (const row of featured(Object.values(catalogue.rows))) {
        await show(page, row.id);
        const { per, k, wrong } = await toWrongTurn(page, row, rnd, { numbered });
        const before = await page.evaluate(() => window.__p.heard().length);
        await page.evaluate(({ q, o }) => window.__p.move(q, o), { q: wrong, o: { numbered } });
        // Inside the window nothing has sounded yet — the second half of a slice could still arrive.
        assert.deepEqual((await page.evaluate(() => window.__p.heard())).slice(before), [], `${row.id}: a sound inside the cue window`);
        await page.evaluate((ms) => window.__p.wait(ms), PAST_WINDOW_MS);
        const got = await page.evaluate(() => ({ heard: window.__p.heard(), say: window.__p.say(), arrow: window.__p.arrow(), data: window.__p.data() }));
        assert.deepEqual(got.heard.slice(before), ['off'], `${row.id}: heard ${got.heard.slice(before)} for one wrong turn`);
        assert.equal(got.data.status, 'off');
        // Worded about the TURN only where the cube numbers its turns; otherwise about the cube (plan §3.4).
        assert.match(got.say, numbered ? /^That turn left the algorithm\./ : /^Your cube left the algorithm\./, got.say);
        assert.equal(got.arrow, inverse(wrong), `${row.id}: the arrow does not show the way back`);
        // Waiting longer says nothing more: once per excursion.
        await page.evaluate((ms) => window.__p.wait(ms), PAST_WINDOW_MS);
        assert.deepEqual((await page.evaluate(() => window.__p.heard())).slice(before), ['off'], `${row.id}: \`off\` repeated`);
        // Back on, heard as `capture`, and the rest completes exactly at the last report.
        const rest = [inverse(wrong), ...per.slice(k).flat()];
        const dones = await page.evaluate(({ qs, o }) => {
          const b = window.__p.count('done');
          return qs.map((q) => { window.__p.move(q, o); return window.__p.count('done') - b; });
        }, { qs: rest, o: { numbered } });
        assert.deepEqual(dones, [...Array(rest.length - 1).fill(0), 1], `${row.id}: did not complete exactly at its last report`);
        assert.deepEqual((await page.evaluate(() => window.__p.heard())).slice(before), ['off', 'capture', 'done']);
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
});

test('a slice\'s first face, a half turn\'s first quarter and a lost turn never sound `off`', async () => {
  const { page, context, errors } = await openPractice();
  try {
    const catalogue = await page.evaluate(() => window.__p.rows());
    const rows = Object.values(catalogue.rows);
    const rnd = lcg(31);
    // A slice and a half turn: their first report, then a wait past the window, then the rest.
    for (const row of [rows.find((r) => r.kinds.includes('slice')), rows.find((r) => /2/.test(r.alg) && r.htm >= 4)]) {
      await show(page, row.id);
      const per = reportsPerToken(row.alg, ORIENTATIONS[0], rnd);
      const split = per.findIndex((qs) => qs.length > 1);
      const before = await page.evaluate(() => window.__p.heard().length);
      await page.evaluate((f) => window.__p.facelets(f), toFacelets(randomStart(rnd)));
      const head = [...per.slice(0, split).flat(), per[split][0]];
      await page.evaluate((qs) => { for (const q of qs) window.__p.move(q); }, head);
      await page.evaluate((ms) => window.__p.wait(ms), PAST_WINDOW_MS);
      assert.deepEqual((await page.evaluate(() => window.__p.heard())).slice(before), [], `${row.id}: a half of one move sounded`);
      const tail = [...per[split].slice(1), ...per.slice(split + 1).flat()];
      const dones = await page.evaluate((qs) => {
        const b = window.__p.count('done');
        return qs.map((q) => { window.__p.move(q); return window.__p.count('done') - b; });
      }, tail);
      assert.deepEqual(dones, [...Array(tail.length - 1).fill(0), 1]);
      assert.deepEqual((await page.evaluate(() => window.__p.heard())).slice(before), ['done'], `${row.id}: heard more than the finish`);
    }
    // A lost turn: then even a wrong turn is not judged, and nothing sounds until the cube says where it is.
    const sune = rows.find((r) => r.id === 'sune');
    await show(page, sune.id);
    const per = reportsPerToken(sune.alg, ORIENTATIONS[3], rnd);
    let state = randomStart(rnd);
    const before = await page.evaluate(() => window.__p.heard().length);
    await page.evaluate((f) => window.__p.facelets(f), toFacelets(state));
    await page.evaluate((qs) => { for (const q of qs) window.__p.move(q); }, [...per[0], ...per[1]]);
    state = after_(state, [...per[0], ...per[1]]);
    await page.evaluate(() => window.__p.lost());
    const wrong = 'URFDLB'.split('').find((f) => !axesNear(per, 2).has(AXIS[f]));
    await page.evaluate((q) => window.__p.move(q), wrong);
    state = after_(state, [wrong]);
    await page.evaluate((ms) => window.__p.wait(ms), PAST_WINDOW_MS);
    const mid = await page.evaluate(() => ({ heard: window.__p.heard(), say: window.__p.say(), data: window.__p.data() }));
    assert.deepEqual(mid.heard.slice(before), [], 'a lost turn, or a turn after one, sounded');
    assert.equal(mid.data.status, 'uncertain');
    assert.match(mid.say, /not judged/);
    // The cube says where it is; the rep goes on, untimed, and is filed as a rep with a lost turn.
    await page.evaluate((f) => window.__p.facelets(f), toFacelets(state));
    const rest = [inverse(wrong), ...per.slice(2).flat()];
    const dones = await page.evaluate((qs) => {
      const b = window.__p.count('done');
      return qs.map((q) => { window.__p.move(q); return window.__p.count('done') - b; });
    }, rest);
    assert.deepEqual(dones, [...Array(rest.length - 1).fill(0), 1]);
    assert.deepEqual((await page.evaluate(() => window.__p.heard())).slice(before), ['done'], 'a sound other than the finish');
    assert.match(await page.evaluate(() => window.__p.time()), /^— \(a turn went missing on the way from the cube\)$/);
    const kept = (await recordOf(page)).algs.sune.at(-1);
    assert.deepEqual({ clean: kept.clean, lostTurn: kept.lostTurn, ms: kept.ms, refused: kept.refused }, { clean: false, lostTurn: true, ms: null, refused: 'stream-gap' });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- D3: the clock refuses rather than guesses --------------------------------------------------------------

test('a skipped serial refuses the time with its reason, and a cube with no clock is never timed', async () => {
  const { page, context, errors } = await openPractice();
  try {
    const rnd = lcg(5);
    await show(page, 'sune');
    const per = reportsPerToken("R U R' U R U2 R'", ORIENTATIONS[0], rnd);
    let state = randomStart(rnd);
    await page.evaluate((f) => window.__p.facelets(f), toFacelets(state));
    await page.evaluate((qs) => { for (const q of qs) window.__p.move(q); }, per[0]);
    // The next report arrives two serials on: a turn went missing between the cube and the app.
    await page.evaluate((q) => window.__p.move(q, { skip: 1 }), per[1][0]);
    state = after_(state, [...per[0], ...per[1]]);
    assert.equal((await page.evaluate(() => window.__p.data())).status, 'uncertain');
    await page.evaluate((f) => window.__p.facelets(f), toFacelets(state));
    const dones = await page.evaluate((qs) => qs.map((q) => { window.__p.move(q); return window.__p.count('done'); }), per.slice(2).flat());
    assert.equal(dones.at(-1), 1);
    assert.match(await page.evaluate(() => window.__p.time()), /^— \(a turn went missing on the way from the cube\)$/);
    // No cube clock: every report carries the host's time and no cube timestamp.
    await page.evaluate((f) => window.__p.facelets(f), toFacelets(randomStart(rnd)));
    await page.evaluate((qs) => {
      for (const q of qs) window.cubusFeed.move({ notation: q, timestamp: performance.now() });
    }, per.flat());
    assert.match(await page.evaluate(() => window.__p.time()), /^— \(a turn in this rep came without the cube’s own time\)$/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- D5: start over from every state — the button, the key, and the cube's own gesture ------------------------

test('start over works from armed, running, off and uncertain — by button, by key and by four turns of one face', async () => {
  const { page, context, errors } = await openPractice();
  try {
    const rnd = lcg(55);
    await show(page, 'sune');
    const alg = "R U R' U R U2 R'";
    /** Bring the page to a state, start over by `how`, then do the whole algorithm from wherever the cube is. */
    const caseOf = async (from, how) => {
      const per = reportsPerToken(alg, ORIENTATIONS[Math.floor(rnd() * 24)], rnd);
      let state = randomStart(rnd);
      const before = await page.evaluate(() => window.__p.count('done'));
      await page.evaluate((f) => window.__p.facelets(f), toFacelets(state));
      const lead = from === 'armed' ? [] : [...per[0], ...per[1]];
      await page.evaluate((qs) => { for (const q of qs) window.__p.move(q); }, lead);
      state = after_(state, lead);
      let wrongTurn = null;
      if (from === 'off') {
        const wrong = 'URFDLB'.split('').find((f) => !axesNear(per, 2).has(AXIS[f]));
        await page.evaluate((q) => window.__p.move(q), wrong);
        state = after_(state, [wrong]);
        wrongTurn = wrong;
        await page.evaluate((ms) => window.__p.wait(ms), PAST_WINDOW_MS);
      }
      if (from === 'uncertain') await page.evaluate(() => window.__p.lost());
      assert.equal((await page.evaluate(() => window.__p.data())).status, from, `could not bring the page to ${from}`);
      const heardBefore = await page.evaluate(() => window.__p.heard().length);
      if (how === 'button') await page.click('#practiceRestart');
      else if (how === 'key') await page.keyboard.press('Escape');
      else {
        // Four identical quarter turns of one face change nothing, and are the cube's own "start over". Not the
        // face last turned: a run of five would count that turn into the four and leave the fifth over.
        const last = from === 'off' ? wrongTurn : lead.at(-1);
        const face = 'URFDLB'.split('').filter((f) => f !== last?.[0])[Math.floor(rnd() * 5)];
        await page.evaluate(({ q, n }) => { for (let i = 0; i < n; i++) window.__p.move(q, { dt: 150 }); }, { q: face, n: GESTURE_TURNS });
        await page.evaluate((ms) => window.__p.wait(ms), PAST_WINDOW_MS);
      }
      if (from === 'uncertain' && how !== 'gesture') {
        // A lost turn leaves the arrangement unknown: start over waits for the cube to say where it is.
        assert.match(await page.evaluate(() => window.__p.say()), /Waiting for the cube to say/);
        await page.evaluate((f) => window.__p.facelets(f), toFacelets(state));
      }
      if (from === 'uncertain' && how === 'gesture') {
        await page.evaluate((f) => window.__p.facelets(f), toFacelets(state));
      }
      const data = await page.evaluate(() => window.__p.data());
      assert.equal(data.status, 'armed', `${how} from ${from}: the rep did not start over (${data.status})`);
      const flat = reportsPerToken(alg, ORIENTATIONS[Math.floor(rnd() * 24)], rnd).flat();
      const dones = await page.evaluate(({ qs, b }) => qs.map((q) => { window.__p.move(q); return window.__p.count('done') - b; }), { qs: flat, b: before });
      assert.deepEqual(dones, [...Array(flat.length - 1).fill(0), 1], `${how} from ${from}: did not complete exactly at the last report`);
      const sounds = (await page.evaluate(() => window.__p.heard())).slice(heardBefore);
      assert.deepEqual(sounds, ['done'], `${how} from ${from}: heard ${sounds}`);
    };
    for (const from of ['armed', 'running', 'off', 'uncertain']) {
      for (const how of ['button', 'key', 'gesture']) {
        if (how === 'gesture' && from === 'uncertain') continue; // the engine's model is unknown: its gesture re-arm is refused, and the button case covers the wait
        await caseOf(from, how);
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- WI-12: "in the fingers" at exactly the Nth clean rep, and a slip resets it -----------------------------

test('"in the fingers" appears at the 7th clean rep in a row — not the 6th — and an unclean rep takes it away', async () => {
  const { page, context, errors } = await openPractice();
  try {
    const rnd = lcg(12);
    await show(page, 'sune');
    const seen = [];
    for (let i = 1; i <= 7; i++) {
      await feedRep(page, randomStart(rnd), reportsPerToken('R U R\' U R U2 R\'', ORIENTATIONS[0], rnd).flat());
      // The streak is a read of the record, which answers once the rep's save has landed.
      await settle(page);
      seen.push(await page.evaluate(() => window.__p.fingers()));
    }
    assert.deepEqual(seen, ['false', 'false', 'false', 'false', 'false', 'false', 'true']);
    // One rep with a wrong turn taken back inside the window: not the algorithm alone, so not clean.
    const per = reportsPerToken('R U R\' U R U2 R\'', ORIENTATIONS[0], rnd);
    await page.evaluate((f) => window.__p.facelets(f), toFacelets(randomStart(rnd)));
    await page.evaluate((qs) => { for (const q of qs) window.__p.move(q); }, [...per[0], 'F', "F'", ...per.slice(1).flat()]);
    await settle(page);
    assert.equal(await page.evaluate(() => window.__p.fingers()), 'false', 'the badge stayed after an unclean rep');
    assert.match(await page.evaluate(() => document.querySelector('#practiceFingers').textContent), /0 of 7/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- D3 on the page: a timed rep shows each part's own time on the cube's clock ------------------------------

test('a timed rep shows each named part\'s own time, first report of the part to last, and no pause it did not make', async () => {
  const { page, context, errors } = await openPractice();
  try {
    const catalogue = await page.evaluate(() => window.__p.rows());
    const row = Object.values(catalogue.rows).find((r) => r.chunks.length >= 2 && !r.kinds.includes('rotation'));
    assert.ok(row, 'no ledger row with two named parts and no whole-cube turn');
    const rnd = lcg(14);
    const printed = await show(page, row.id);
    const per = reportsPerToken(printed.chips.join(' '), ORIENTATIONS[0], rnd);
    // The report that reaches a token boundary: the last of the tokens before it. Every report is STEP_MS apart.
    const reached = (k) => per.slice(0, k).flat().length - 1;
    const dones = await feedRep(page, randomStart(rnd), per.flat());
    assert.equal(dones.at(-1), 1, `${row.id}: the rep did not complete`);
    const parts = await page.evaluate(() => {
      const box = document.querySelector('#practiceParts');
      return { hidden: box.hidden, text: box.textContent };
    });
    assert.equal(parts.hidden, false, `${row.id}: a timed rep with named parts showed none`);
    for (const c of row.chunks) {
      const ms = (reached(c.to) - (c.from === 0 ? 0 : reached(c.from))) * STEP_MS;
      const want = `${catalogue.triggers[c.trigger].name} ${(ms / 1000).toFixed(2)} s`;
      assert.ok(parts.text.includes(want), `${row.id}: "${parts.text}" does not say ${want}`);
    }
    // Evenly spaced reports make no pause, so none may be marked.
    assert.doesNotMatch(parts.text, /pause/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- WI-13 on the screen: mixed practice, weakest first, each algorithm once a round, none twice running ----

test('mixed practice goes through the whole set weakest first, each once a round, and never one twice in a row', async () => {
  const { page, context, errors } = await openPractice();
  try {
    const catalogue = await page.evaluate(() => window.__p.rows());
    const set = Object.values(catalogue.sets).find((s) => s.ids.length >= 3 && s.ids.length <= 6);
    assert.ok(set, 'no set of three to six algorithms');
    const n = set.ids.length;
    const rnd = lcg(13);
    const rep = async (id) => {
      const chips = await page.evaluate(() => window.__p.chips());
      const dones = await feedRep(page, randomStart(rnd), reportsPerToken(chips.join(' '), ORIENTATIONS[0], rnd).flat());
      assert.equal(dones.at(-1), 1, `${id}: the rep did not complete`);
    };
    /** The page once it is ready on an algorithm other than `was`. */
    const movedOn = async (was) => {
      await page.waitForFunction((w) => {
        const d = document.querySelector('.practice-page')?.dataset;
        return d?.ready === '1' && d.alg !== w;
      }, was, { timeout: LIVENESS_MS });
      return page.evaluate(() => window.__p.data().alg);
    };
    // One clean rep of the set's first algorithm: it now has a record and no other has, so it is the one
    // mixing must put LAST — an algorithm with nothing on record comes first (lib/drill/mix.js, step 1).
    const practised = set.ids[0];
    await show(page, practised);
    await rep(practised);
    await mixedOn(page);
    assert.equal(await page.evaluate(() => document.querySelector('#practiceNext').hidden), false, 'mixed shows no way to the next algorithm');
    // Each rep is filed, then the page moves on by itself; waiting for a DIFFERENT algorithm is the check that
    // none comes twice in a row, across the end of the round as well.
    const seen = [await movedOn(practised)];
    for (let i = 0; i < n; i++) {
      await rep(seen.at(-1));
      seen.push(await movedOn(seen.at(-1)));
    }
    const round = seen.slice(0, n);
    assert.deepEqual([...round].sort(), [...set.ids].sort(), `a round of ${set.id} was ${round.join(', ')}`);
    assert.equal(round.at(-1), practised, `the practised algorithm came at ${round.indexOf(practised) + 1} of ${n}, not last`);
    // Every rep is on record under the algorithm it was made on: the first, then one each in the round.
    const record = await recordOf(page);
    for (const id of set.ids) {
      const want = id === practised ? 2 : 1;
      assert.equal((record.algs[id] ?? []).length, want, `${id}: ${(record.algs[id] ?? []).length} reps on record, not ${want}`);
    }
    // One at a time again: the next rep stays on the algorithm it was made on.
    await page.click('#practiceBlocked');
    const here = seen.at(-1);
    await rep(here);
    await page.evaluate((ms) => window.__p.wait(ms), PAST_WINDOW_MS);
    assert.equal(await page.evaluate(() => window.__p.data().alg), here, 'one at a time moved on after a rep');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- D6: no cube — the transport walks the moves, the stopwatch works, and nothing is judged or timed by the app ----------

test('with no cube the transport walks the moves and the stopwatch runs — and no verdict or measured time appears', async () => {
  const { page, context, errors } = await openPractice({ connect: false });
  try {
    await show(page, 'sune');
    const start = await page.evaluate(() => window.__p.data());
    assert.equal(start.mode, 'demo');
    await page.click('#demoNext');
    await page.waitForFunction(() => document.querySelectorAll('#practiceAlg .chip-m.played').length > 0, null, { timeout: LIVENESS_MS });
    await page.click('#practiceClock');
    await page.evaluate(() => window.__p.wait(300));
    await page.click('#practiceClock');
    const got = await page.evaluate(() => ({
      time: window.__p.time(),
      // Everything the page says, the book included: no verdict anywhere, not only in one region.
      sheet: document.querySelector('.practice-page').textContent + document.querySelector('#practiceInfo').textContent,
      heard: window.__p.heard(),
      fingers: document.querySelector('#practiceFingers').textContent,
      say: window.__p.say(),
    }));
    assert.match(got.time, /^\d+\.\d\d s on your stopwatch$/, got.time);
    assert.match(got.say, /No smart cube connected/);
    // What must NOT be there: a verdict, a time the app measured, a sound, a rep on record.
    assert.doesNotMatch(got.sheet, /correct|first turn to last|turns a second/i);
    assert.deepEqual(got.heard, []);
    assert.deepEqual((await recordOf(page)).algs, {}, 'a rep was recorded with no cube');
    assert.match(got.fingers, /— of 7/);
    // Space is the stopwatch too, and Escape starts over.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Space');
    assert.match(await page.evaluate(() => document.querySelector('#practiceClock').textContent), /Stop the stopwatch/);
    await page.keyboard.press('Escape');
    assert.match(await page.evaluate(() => document.querySelector('#practiceClock').textContent), /Start the stopwatch/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
