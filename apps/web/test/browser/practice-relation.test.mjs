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
// What is heard is read off the page's ONE AudioContext, replaced by a stand-in through `useAudioContextFactory`
// (the seam test/browser/sound.test.mjs uses): each sound is a fixed run of notes, so the notes say which sounds
// were made. A sound that must NOT play is asserted as an absence, after waiting past the cue window.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { parse } from '../../lib/cube-notation.js';
import { applyIdentity, faceTurnsOf, toIdentity } from '../../lib/cube-moves.js';
import { ORIENTATIONS } from '../../lib/cube-orientation.js';
import { SOLVED as PIECES, applyAlg, toFacelets } from '../../lib/cube-pieces.js';
import { CUE_WINDOW_MS, GESTURE_TURNS } from '../../lib/drill/engine.js';
import { pace } from '../browser-wait.mjs';
import { lcg, randomAlg } from '../fixtures/seeded-scrambles.mjs';
import { LIVENESS_MS, startBrowserFixture } from './harness.mjs';

let fixture;
before(async () => { fixture = await startBrowserFixture(); });
after(async () => { await fixture?.close(); });

/** Past the cue window, with room for a loaded machine to run the timer: an `off` that was coming has come. */
const PAST_WINDOW_MS = CUE_WINDOW_MS + 250;
const STEP_MS = 250;

const AXIS = { U: 'y', D: 'y', R: 'x', L: 'x', F: 'z', B: 'z' };
const inverse = (q) => (q.endsWith("'") ? q[0] : `${q}'`);

/**
 * The reports a cube makes for each written token, held `hold`: per token, the outer-face quarter turns in the
 * cube's own frame, worked out by the notation's one interpreter. A half turn's two quarters go one way or the
 * other, and a slice's two faces in either order, as `rnd` says.
 */
function reportsPerToken(alg, hold, rnd) {
  let now = [...hold];
  return parse(alg).map((move) => {
    const identity = toIdentity(move, now);
    now = applyIdentity(identity, now, PIECES).hold;
    const faces = faceTurnsOf(identity).turns.map((x) => x.name).filter(Boolean);
    if (faces.length > 1 && rnd() < 0.5) faces.reverse();
    return faces.flatMap((name) => {
      if (!name.endsWith('2')) return [name];
      const q = rnd() < 0.5 ? name[0] : `${name[0]}'`;
      return [q, q];
    });
  });
}

/** A random arrangement, in the cube's own frame, as 54 facelets and as pieces. */
const randomStart = (rnd) => applyAlg(PIECES, randomAlg(rnd, 20));
const after_ = (state, quarters) => quarters.reduce((s, q) => applyAlg(s, q), state);

/** A page on the Practice library, a stand-in cube connected, and the sound stand-in installed. */
async function openPractice({ numbered = true, connect = true } = {}) {
  const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 1012 } });
  const page = pace(await context.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${fixture.base}/index.html#/practice`);
  await page.waitForSelector('.practice-screen[data-ready="1"]', { timeout: LIVENESS_MS });
  await page.addScriptTag({
    type: 'module',
    content: `
      import { useAudioContextFactory } from '/lib/sound.js';
      import { state } from '/lib/app-state.js';
      import { refreshScreen } from '/lib/screen-shell.js';
      import { library } from '/lib/drill/library-client.js';
      // Each sound is a fixed run of notes (lib/sound.js); read back, the notes say which sounds were made.
      const SOUNDS = {
        capture: [659.25, 880], done: [523.25, 659.25, 783.99, 1046.5], off: [440, 392],
        again: [523.25, 523.25], ask: [587.33, 783.99, 587.33, 783.99], help: [349.23, 261.63],
      };
      const notes = [];
      useAudioContextFactory(() => ({
        state: 'running', currentTime: 0, destination: {},
        resume: () => Promise.resolve(), suspend: () => Promise.resolve(),
        createOscillator() {
          const o = { frequency: { value: 0 }, connect: (g) => g, start() { notes.push(o.frequency.value); }, stop() {}, onended: null };
          return o;
        },
        createGain() {
          return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d) => d };
        },
      }));
      // The page's one gesture, which is what makes its AudioContext.
      document.dispatchEvent(new Event('pointerdown'));
      const heard = () => {
        const out = [];
        for (let i = 0; i < notes.length;) {
          const hit = Object.entries(SOUNDS).find(([, run]) => run.every((f, k) => notes[i + k] === f));
          if (!hit) throw new Error('a run of notes no sound makes: ' + notes.slice(i, i + 4).join(','));
          out.push(hit[0]);
          i += hit[1].length;
        }
        return out;
      };
      let serial = 0;
      let clock = 1000;
      const page = () => document.querySelector('.practice-page');
      window.__p = {
        heard,
        count: (name) => heard().filter((n) => n === name).length,
        rows: () => library.catalogue(),
        show(id) { state.practiceAlg = id; refreshScreen(); },
        ready: (id) => page()?.dataset.ready === '1' && page()?.dataset.alg === id,
        facelets: (f) => window.cubusFeed.facelets(f, serial),
        /** One report. \`numbered\` false sends no serial, as a cube that does not number its turns does; \`skip\` drops a serial. */
        move(notation, { numbered = true, skip = 0, dt = ${STEP_MS} } = {}) {
          serial = (serial + 1 + skip) & 0xff;
          clock += dt;
          window.cubusFeed.move({ notation, timestamp: clock, cubeTimestamp: clock, ...(numbered ? { serial } : {}) });
        },
        lost: () => window.cubusFeed.movesLost(),
        data: () => ({ ...page().dataset }),
        say: () => document.querySelector('#practiceSay').textContent,
        time: () => document.querySelector('#practiceTime').textContent,
        arrow: () => document.querySelector('#practiceCube cubus-cube').getAttribute('arrow'),
        chips: () => [...document.querySelectorAll('#practiceAlg .chip-m')].map((c) => c.textContent),
        record: () => JSON.parse(localStorage.getItem('cubusDrillRecord') ?? 'null'),
        fingers: () => document.querySelector('#practiceFingers')?.dataset.reached,
        wait: (ms) => new Promise((r) => { setTimeout(r, ms); }),
      };
    `,
  });
  await page.waitForFunction(() => Boolean(window.__p));
  if (connect) {
    await page.evaluate((isNumbered) => {
      window.cubusFeed.useConnection({
        mac: 'AA:BB:CC:DD:EE:01', name: 'Test cube', requestBattery: async () => 80, disconnect: async () => {},
        mayFollow: () => true, numbersMoves: () => isNumbered,
      });
    }, numbered);
  }
  return { page, context, errors };
}

/** Open row `id` on the page and return what it prints — read off the DOM, never off the ledger. */
async function show(page, id) {
  await page.evaluate((x) => window.__p.show(x), id);
  await page.waitForFunction((x) => window.__p.ready(x), id, { timeout: LIVENESS_MS });
  return page.evaluate(() => ({ chips: window.__p.chips(), data: window.__p.data() }));
}

/** Feed a start arrangement and then `flat`, answering how many `done` sounds each report had made by then. */
const feedRep = (page, start, flat, opts = {}) => page.evaluate(({ f, qs, o }) => {
  const before = window.__p.count('done');
  window.__p.facelets(f);
  return qs.map((q) => { window.__p.move(q, o); return window.__p.count('done') - before; });
}, { f: toFacelets(start), qs: flat, o: opts });

// ---- D1, D2: every row completes exactly at its last report, and the page prints what is judged ------------

test('every ledger row completes exactly at its last report — never before — from random starts in several holds', async () => {
  const { page, context, errors } = await openPractice();
  const t0 = Date.now();
  try {
    const catalogue = await page.evaluate(() => window.__p.rows());
    const rows = Object.values(catalogue.rows);
    assert.ok(rows.length > 300, `the library read ${rows.length} rows`);
    const rnd = lcg(20261017);
    const counts = new Map();
    let reps = 0;
    for (const row of rows) {
      const printed = await show(page, row.id);
      // THE RELATION's first half: the page prints the row as written, and the engine was handed that string.
      assert.equal(printed.chips.join(' '), row.alg.trim().replace(/\s+/g, ' '), `${row.id}: the page prints something else`);
      assert.equal(printed.data.judging, row.alg, `${row.id}: the engine was given something other than the row`);
      // Two holds per row, drawn at random from the 24 — reports built from the PRINTED chips.
      for (let h = 0; h < 2; h++) {
        const hold = ORIENTATIONS[Math.floor(rnd() * ORIENTATIONS.length)];
        const flat = reportsPerToken(printed.chips.join(' '), hold, rnd).flat();
        const dones = await feedRep(page, randomStart(rnd), flat);
        assert.deepEqual(dones, [...Array(flat.length - 1).fill(0), 1],
          `${row.id} held ${hold}: done after reports ${dones.map((d, i) => (d ? i + 1 : null)).filter(Boolean)} of ${flat.length}`);
        // D3: the time is the cube's own, first report to last — or a refusal for a one-turn algorithm.
        const time = await page.evaluate(() => window.__p.time());
        if (row.htm < 2) assert.match(time, /^— \(one turn has no time between turns\)$/, `${row.id}: ${time}`);
        else assert.ok(time.startsWith(`${((flat.length - 1) * STEP_MS / 1000).toFixed(2)} s, first turn to last`), `${row.id}: ${time}`);
        counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
        reps += 1;
      }
    }
    // The record holds exactly the reps made: as many per algorithm, every one clean, none with a lost turn.
    const record = await page.evaluate(() => window.__p.record());
    for (const [id, n] of counts) {
      const kept = record.algs[id] ?? [];
      assert.equal(kept.length, n, `${id}: ${kept.length} reps on record for ${n} made`);
      assert.ok(kept.every((r) => r.c === true && r.l === false), `${id}: a clean rep was filed as something else`);
    }
    assert.equal(Object.values(record.algs).flat().length, reps, 'the record holds a rep nobody made');
    assert.deepEqual(errors, [], 'the page raised an error');
    console.log(`# practice-relation: ${rows.length} rows, ${reps} reps through cubusFeed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } finally {
    await context.close();
  }
});

// ---- D4: a wrong turn is heard once; a lost turn, a slice's first face, a half turn's first quarter never ----

/** Tokens' identity faces as they are reported, for choosing a turn that is surely off the plan. */
const axesNear = (per, k) => new Set([k - 1, k, k + 1].flatMap((i) => (per[i] ?? []).map((q) => AXIS[q[0]])));

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
    const kept = (await page.evaluate(() => window.__p.record())).algs.sune.at(-1);
    assert.deepEqual({ c: kept.c, l: kept.l, ms: kept.ms, r: kept.r }, { c: false, l: true, ms: null, r: 'stream-gap' });
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
    assert.match(await page.evaluate(() => window.__p.time()), /^— \(this cube does not send a clock of its own\)$/);
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
      seen.push(await page.evaluate(() => window.__p.fingers()));
    }
    assert.deepEqual(seen, ['false', 'false', 'false', 'false', 'false', 'false', 'true']);
    // One rep with a wrong turn taken back inside the window: not the algorithm alone, so not clean.
    const per = reportsPerToken('R U R\' U R U2 R\'', ORIENTATIONS[0], rnd);
    await page.evaluate((f) => window.__p.facelets(f), toFacelets(randomStart(rnd)));
    await page.evaluate((qs) => { for (const q of qs) window.__p.move(q); }, [...per[0], 'F', "F'", ...per.slice(1).flat()]);
    assert.equal(await page.evaluate(() => window.__p.fingers()), 'false', 'the badge stayed after an unclean rep');
    assert.match(await page.evaluate(() => document.querySelector('#practiceFingers').textContent), /0 of 7/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- D6: no cube — the demo plays, the stopwatch works, and nothing is judged or timed by the app ----------

test('with no cube the demo plays part by part and the stopwatch runs — and no verdict or measured time appears', async () => {
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
      sheet: document.querySelector('.practice-sheet').textContent,
      heard: window.__p.heard(),
      record: window.__p.record(),
      fingers: document.querySelector('#practiceFingers').textContent,
      say: window.__p.say(),
    }));
    assert.match(got.time, /^\d+\.\d\d s on your stopwatch$/, got.time);
    assert.match(got.say, /No smart cube connected/);
    // What must NOT be there: a verdict, a time the app measured, a sound, a rep on record.
    assert.doesNotMatch(got.sheet, /correct|first turn to last|turns a second/i);
    assert.deepEqual(got.heard, []);
    assert.equal(got.record, null, 'a rep was recorded with no cube');
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
