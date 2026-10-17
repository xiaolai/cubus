// The Practice screen around the cube, in a real WebKit: what it does when the connection changes under it, while
// the reconnect question is open, when the stopwatch meets the cube's clock, when the record will not take a rep —
// and the library and the Settings row that go with it (audit-fix 2026-10-18, rows 17 to 29;
// dev-docs/algorithm-drill-v2-plan.md §3, §4).
//
// Each case asserts what must NOT happen beside what should: a sound for a cube no longer followed, a rep judged
// across two connections, a picture that is not the cube in the hand, a notice that went before it was answered.
// The page, the stand-in cube and the sound stand-in are ./practice-page.mjs's, shared with the relation suite.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { ORIENTATIONS } from '../../lib/cube-orientation.js';
import { SOLVED as PIECES, applyAlg, toFacelets } from '../../lib/cube-pieces.js';
import { lcg } from '../fixtures/seeded-scrambles.mjs';
import { LIVENESS_MS, startBrowserFixture } from './harness.mjs';
import {
  AXIS, MAC, PAST_WINDOW_MS, axesNear, feedRep, openPractice, randomStart, reportsPerToken, show,
} from './practice-page.mjs';

let fixture;
before(async () => { fixture = await startBrowserFixture(); });
after(async () => { await fixture?.close(); });

const SUNE = "R U R' U R U2 R'";
/** Reports a rep completes at: none before the last, one at it. */
const atLast = (n) => [...Array(n - 1).fill(0), 1];

// ---- one engine per connection (rows 18 and 23) ------------------------------------------------------------

test('a cube that drops and is back inside one presence tick starts a fresh rep — its first turn is not a turn gone missing', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const rnd = lcg(181);
    await show(page, 'sune');
    const first = reportsPerToken(SUNE, ORIENTATIONS[0], rnd).flat();
    assert.equal((await feedRep(page, randomStart(rnd), first)).at(-1), 1, 'precondition: a first rep completed');
    // A rep cut off part way: the engine has a serial behind it and a rep in flight.
    await feedRep(page, randomStart(rnd), reportsPerToken(SUNE, ORIENTATIONS[0], rnd).flat().slice(0, 3));
    assert.equal((await page.evaluate(() => window.__p.data())).status, 'running', 'precondition: a rep in flight');
    // Gone and back in ONE task, so no presence tick can see the gap; the new cube counts from its own number.
    await page.evaluate(() => { window.__p.disconnect(); window.__p.connect(); window.__p.serialFrom(200); });
    const flat = reportsPerToken(SUNE, ORIENTATIONS[5], rnd).flat();
    const dones = await feedRep(page, randomStart(rnd), flat);
    const got = await page.evaluate(() => ({ data: window.__p.data(), say: window.__p.say(), time: window.__p.time() }));
    assert.deepEqual(dones, atLast(flat.length), `the new connection's rep did not complete at its last report (${got.data.status}: ${got.say})`);
    assert.match(got.time, /first turn to last/, `the new connection's rep was not timed: ${got.time}`);
    const kept = (await page.evaluate(() => window.__p.record())).algs.sune;
    assert.equal(kept.length, 2, 'the rep cut off by the disconnect was filed, or the new one was not');
    assert.deepEqual({ c: kept[1].c, l: kept[1].l }, { c: true, l: false }, 'the new connection\'s first rep was filed with a lost turn');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('an `off` whose cue window outlives its cube is never heard — the cube left, or another took its place', async () => {
  for (const how of ['gone', 'replaced']) {
    const { page, context, errors } = await openPractice(fixture);
    try {
      const rnd = lcg(how === 'gone' ? 231 : 232);
      await show(page, 'sune');
      const per = reportsPerToken(SUNE, ORIENTATIONS[0], rnd);
      await page.evaluate((f) => window.__p.facelets(f), toFacelets(randomStart(rnd)));
      await page.evaluate((qs) => { for (const q of qs) window.__p.move(q); }, [...per[0], ...per[1]]);
      assert.equal((await page.evaluate(() => window.__p.data())).settled, 'true', `${how}: precondition: the hold is settled`);
      const wrong = 'URFDLB'.split('').find((f) => !axesNear(per, 2).has(AXIS[f]));
      const before = await page.evaluate(() => window.__p.heard().length);
      // The wrong turn, and in the same task the cube goes (and, replaced, another comes) — inside the cue window.
      await page.evaluate(({ q, swap }) => {
        window.__p.move(q);
        window.__p.disconnect();
        if (swap) window.__p.connect();
      }, { q: wrong, swap: how === 'replaced' });
      await page.evaluate((ms) => window.__p.wait(ms), PAST_WINDOW_MS);
      const got = await page.evaluate(() => ({ heard: window.__p.heard(), say: window.__p.say() }));
      assert.deepEqual(got.heard.slice(before), [], `${how}: heard ${got.heard.slice(before)} for a turn of a cube no longer followed`);
      assert.doesNotMatch(got.say, /left the algorithm/, `${how}: the page blames a turn of a cube no longer followed`);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
});

// ---- the reconnect question (row 17) -----------------------------------------------------------------------

test('a remembered cube is followed while the reconnect question is open — and Practice neither answers it nor takes the report as where the cube is', async () => {
  const V = toFacelets(applyAlg(PIECES, "R U R' F"));
  const R0 = toFacelets(applyAlg(PIECES, 'F2 D'));
  const seenAt = Date.UTC(2026, 9, 17, 9, 0);
  const memory = { [MAC]: { name: 'Test cube', nickname: '', lastSeen: seenAt, last: { facelets: V, reported: R0, serial: 3, at: seenAt, how: 'cube' } } };
  const { page, context, errors } = await openPractice(fixture, {
    connect: false,
    // A returning cube's memory is on disk before the app boots.
    prepare: (ctx) => ctx.addInitScript((m) => localStorage.setItem('cubusCubes', JSON.stringify(m)), memory),
  });
  try {
    const rnd = lcg(171);
    await show(page, 'sune');
    await page.evaluate(() => window.__p.connect());
    const start = randomStart(rnd);
    // The connection's first report, from a cube turned since it was last seen: the question opens over it.
    await page.evaluate((f) => window.__p.facelets(f), toFacelets(start));
    const asked = await page.evaluate(() => window.__p.app());
    assert.equal(asked.reconnect?.reading, 'turned', 'precondition: the reconnect question is open');
    assert.equal(asked.live, null, 'precondition: the question holds the report back from live');
    // A rep from the report the question holds, then one from a held snapshot of the cube set down elsewhere.
    for (const from of [start, randomStart(rnd)]) {
      const flat = reportsPerToken(SUNE, ORIENTATIONS[Math.floor(rnd() * 24)], rnd).flat();
      const dones = await feedRep(page, from, flat);
      const got = await page.evaluate(() => ({ status: window.__p.data().status, say: window.__p.say() }));
      assert.deepEqual(dones, atLast(flat.length), `a rep on a remembered cube did not complete at its last report (${got.status}: ${got.say})`);
    }
    // What must NOT happen: Practice answering the question, or taking the cube's report as where the cube is.
    const later = await page.evaluate(() => window.__p.app());
    assert.equal(later.reconnect?.reading, 'turned', 'Practice closed the reconnect question');
    assert.equal(later.reconnect?.candidate, asked.reconnect.candidate, 'the picture being asked about changed');
    assert.equal(later.live, null, 'a held report became live');
    assert.equal(later.trusted, false, 'following the cube granted trust');
    assert.equal(later.subject, asked.subject, 'the subject moved while the question was open');
    const stored = await page.evaluate((mac) => JSON.parse(localStorage.getItem('cubusCubes'))[mac]?.last, MAC);
    assert.deepEqual(stored, memory[MAC].last, 'the remembered arrangement was rewritten from a cube nobody confirmed');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- the hold line (row 24) --------------------------------------------------------------------------------

test('the hold line follows the cube: "any way you like" only while a cube is followed', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const rnd = lcg(241);
    await show(page, 'sune');
    const holdLine = () => page.evaluate(() => [...document.querySelectorAll('#practiceAbout .sub')]
      .map((e) => e.textContent).find((text) => /The letters are written/.test(text)));
    await page.evaluate((f) => window.__p.facelets(f), toFacelets(randomStart(rnd)));
    assert.equal((await page.evaluate(() => window.__p.data())).mode, 'cube', 'precondition: the cube is followed');
    assert.match(await holdLine(), /any way you like/);
    await page.evaluate(() => window.__p.disconnect());
    await page.waitForFunction(() => window.__p.data().mode === 'demo', null, { timeout: LIVENESS_MS });
    const gone = await holdLine();
    assert.doesNotMatch(gone, /any way you like/, 'with no cube, the page still says to hold it any way you like');
    assert.match(gone, /written for this hold/);
    await page.evaluate(() => window.__p.connect());
    await page.evaluate((f) => window.__p.facelets(f), toFacelets(randomStart(rnd)));
    await page.waitForFunction(() => window.__p.data().mode === 'cube', null, { timeout: LIVENESS_MS });
    assert.match(await holdLine(), /any way you like/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- the stopwatch and the cube's clock (row 19) -----------------------------------------------------------

test('a stopwatch running when a cube starts being followed stops — it never writes over the cube\'s own time', async () => {
  const { page, context, errors } = await openPractice(fixture, { connect: false });
  try {
    const rnd = lcg(191);
    await show(page, 'sune');
    await page.click('#practiceClock');
    assert.match(await page.evaluate(() => document.querySelector('#practiceClock').textContent), /Stop the stopwatch/, 'precondition: the stopwatch runs');
    await page.evaluate(() => window.__p.connect());
    const flat = reportsPerToken(SUNE, ORIENTATIONS[0], rnd).flat();
    assert.equal((await feedRep(page, randomStart(rnd), flat)).at(-1), 1, 'precondition: the rep completed');
    const measured = await page.evaluate(() => window.__p.time());
    assert.match(measured, /first turn to last/, `the cube's time is not what the page shows: ${measured}`);
    // Long enough for the stopwatch's tick (every 50 ms) to have written over it many times.
    await page.evaluate(() => window.__p.wait(400));
    assert.equal(await page.evaluate(() => window.__p.time()), measured, 'the stopwatch wrote over the cube\'s measured time');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- the arrow the page speaks of (row 20) -----------------------------------------------------------------

test('the page speaks of an arrow only where one is drawn — before the hold is known, and with turn arrows off', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const rnd = lcg(201);
    await show(page, 'sune');
    const seen = () => page.evaluate(() => ({ say: window.__p.say(), arrow: window.__p.arrow(), data: window.__p.data() }));
    /** The relation, in every state sampled: a sentence that sends the child to an arrow has one to follow. */
    const truthful = (got, what) => {
      if (/arrow/.test(got.say)) assert.notEqual(got.arrow, 'none', `${what}: "${got.say}" — and no arrow is drawn`);
    };
    // Sune opens with a clockwise turn in every hold, so a counter-clockwise first turn is off in all of them. Each
    // round starts over first, so the cube set down elsewhere is a new start rather than a snapshot mid-rep.
    const offFirst = async () => {
      await page.keyboard.press('Escape');
      await page.evaluate((f) => window.__p.facelets(f), toFacelets(randomStart(rnd)));
      await page.evaluate(() => window.__p.move("R'"));
      await page.evaluate((ms) => window.__p.wait(ms), PAST_WINDOW_MS);
      return seen();
    };
    const on = await offFirst();
    assert.deepEqual([on.data.status, on.data.settled], ['off', 'false'], 'precondition: off, before the hold is known');
    truthful(on, 'off before the hold is known');
    // The way back is drawn in the cube's own letters, which need no hold: undo the turn.
    assert.equal(on.arrow, 'R', `"${on.say}": the arrow does not show the way back`);

    // Turn arrows off: no sentence may send the child to an arrow, in any state.
    await page.evaluate(() => { window.__p.settings.turnArrows = false; });
    const off = await offFirst();
    assert.equal(off.data.status, 'off');
    assert.equal(off.arrow, 'none', 'an arrow drawn with turn arrows off');
    truthful(off, 'off, with turn arrows off');
    // Back where it began, and on into the algorithm from there until the hold is known.
    await page.evaluate(() => window.__p.move('R'));
    truthful(await seen(), 'back on, with turn arrows off');
    const per = reportsPerToken(SUNE, ORIENTATIONS[2], rnd);
    await page.evaluate((qs) => { for (const q of qs) window.__p.move(q); }, [...per[0], ...per[1]]);
    const running = await seen();
    assert.deepEqual([running.data.status, running.data.settled], ['running', 'true'], 'precondition: running, the hold known');
    truthful(running, 'running, with turn arrows off');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
