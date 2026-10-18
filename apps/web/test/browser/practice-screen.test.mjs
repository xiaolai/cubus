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

import { NAV_DEFAULTS_VERSION } from '../../lib/app-settings.js';
import { ORIENTATIONS } from '../../lib/cube-orientation.js';
import { SOLVED as PIECES, applyAlg, toFacelets } from '../../lib/cube-pieces.js';
import { applyIdentity, run, toIdentity } from '../../lib/cube-moves.js';
import { parse } from '../../lib/cube-notation.js';
import { RECORD_DB, RECORD_ENTRY, RECORD_STORE } from '../../lib/drill/record-store.js';
import { pace } from '../browser-wait.mjs';
import { lcg } from '../fixtures/seeded-scrambles.mjs';
import { toWorld } from './drawn-cube.mjs';
import { LIVENESS_MS, startBrowserFixture } from './harness.mjs';
import {
  AXIS, MAC, PAST_WINDOW_MS, after_, axesNear, feedRep, mixedOn, openPractice, randomStart, recordOf, reportsPerToken, settle,
  show,
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
    const kept = (await recordOf(page)).algs.sune;
    assert.equal(kept.length, 2, 'the rep cut off by the disconnect was filed, or the new one was not');
    assert.deepEqual({ clean: kept[1].clean, lostTurn: kept[1].lostTurn }, { clean: true, lostTurn: false }, 'the new connection\'s first rep was filed with a lost turn');
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

test('a cube replaced before its first report leaves no picture of the cube before it — the page shows the case and points nowhere', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const rnd = lcg(316);
    await show(page, 'sune');
    const drawn = () => page.evaluate(() => ({ cube: ['facelets', 'alg', 'orientation', 'arrow'].map((a) => window.__p.cube().getAttribute(a)), data: window.__p.data(), say: window.__p.say() }));
    const demo = (await drawn()).cube;
    // Followed, part way through a rep: the walk and its arrow.
    const per = reportsPerToken(SUNE, ORIENTATIONS[0], rnd);
    await page.evaluate((f) => window.__p.facelets(f), toFacelets(randomStart(rnd)));
    await page.evaluate((qs) => { for (const q of qs) window.__p.move(q); }, [...per[0], ...per[1]]);
    const followed = await drawn();
    assert.equal(followed.cube[3], 'next', 'precondition: the walk points at the next turn');
    // Another cube takes its place in one task, and says nothing yet.
    await page.evaluate(() => { window.__p.disconnect(); window.__p.connect({ mac: 'AA:BB:CC:DD:EE:02', name: 'Second cube' }); });
    await page.waitForFunction(() => window.__p.data().status === 'idle', null, { timeout: LIVENESS_MS });
    const replaced = await drawn();
    assert.match(replaced.say, /Waiting for your cube/, 'precondition: the page waits for the new cube');
    // What must NOT happen: the old cube's walk, position and arrow standing under "waiting".
    assert.deepEqual(replaced.cube, demo, `the page waits for a new cube and still draws the old one: ${JSON.stringify(replaced.cube)}`);
    assert.equal(replaced.data.mode, 'demo');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
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

// ---- arming from a report that is current (round 2, rows 12 and 25) ------------------------------------------

test('Practice arms only from a report that accounts for every turn — entered between a turn and its snapshot, it waits, and the rep after is clean', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const rnd = lcg(121);
    const s0 = randomStart(rnd);
    // On the library: the cube reports where it is, and then is turned — the snapshot of that turn has not come yet.
    await page.evaluate((f) => window.__p.facelets(f), toFacelets(s0));
    await page.evaluate(() => window.__p.move('F'));
    const s1 = applyAlg(s0, 'F');
    await show(page, 'sune');
    // What must NOT happen: a rep armed from the report the cube has since turned away from.
    const entered = await page.evaluate(() => ({ status: window.__p.data().status, say: window.__p.say() }));
    assert.equal(entered.status, 'idle', `armed from a report one turn old (${entered.say})`);
    assert.match(entered.say, /Waiting for your cube to say where it is/);
    // The snapshot of that turn arms the rep; a snapshot that arrives part way through the rep agrees with it.
    const per = reportsPerToken(SUNE, ORIENTATIONS[0], rnd);
    const flat = per.flat();
    const dones = await page.evaluate(({ f, mid, qs }) => {
      window.__p.facelets(f);
      const seen = [];
      const out = qs.map((q, i) => {
        window.__p.move(q);
        if (i === 0) window.__p.facelets(mid);
        seen.push(window.__p.data().status);
        return window.__p.count('done');
      });
      return { out, seen };
    }, { f: toFacelets(s1), mid: toFacelets(applyAlg(s1, flat[0])), qs: flat });
    assert.ok(!dones.seen.includes('uncertain'), `a clean rep went uncertain: ${dones.seen.join(' ')}`);
    assert.deepEqual(dones.out, atLast(flat.length));
    const kept = (await recordOf(page)).algs.sune;
    assert.deepEqual(kept.map((r) => ({ clean: r.clean, lostTurn: r.lostTurn })), [{ clean: true, lostTurn: false }], 'the rep was not filed clean');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('a report the reconnect question held before Practice opened is where its first rep starts', async () => {
  const V = toFacelets(applyAlg(PIECES, "R U R' F"));
  const R0 = toFacelets(applyAlg(PIECES, 'F2 D'));
  const seenAt = Date.UTC(2026, 9, 17, 9, 0);
  const memory = { [MAC]: { name: 'Test cube', nickname: '', lastSeen: seenAt, last: { facelets: V, reported: R0, serial: 3, at: seenAt, how: 'cube' } } };
  const { page, context, errors } = await openPractice(fixture, {
    connect: false,
    prepare: (ctx) => ctx.addInitScript((m) => localStorage.setItem('cubusCubes', JSON.stringify(m)), memory),
  });
  try {
    const rnd = lcg(251);
    const start = randomStart(rnd);
    // On the library, before any row is open: the cube connects and its first report opens the question.
    await page.evaluate((f) => { window.__p.connect(); window.__p.facelets(f); }, toFacelets(start));
    assert.equal((await page.evaluate(() => window.__p.app())).reconnect?.reading, 'turned', 'precondition: the question holds the report');
    await show(page, 'sune');
    // No further snapshot: the held report is the one Practice must start from.
    const flat = reportsPerToken(SUNE, ORIENTATIONS[3], rnd).flat();
    const dones = await page.evaluate((qs) => qs.map((q) => { window.__p.move(q); return window.__p.count('done'); }), flat);
    const got = await page.evaluate(() => ({ status: window.__p.data().status, say: window.__p.say(), app: window.__p.app() }));
    assert.deepEqual(dones, atLast(flat.length), `the rep did not complete from the held report (${got.status}: ${got.say})`);
    assert.equal(got.app.reconnect?.reading, 'turned', 'Practice closed the reconnect question');
    assert.equal(got.app.live, null, 'a held report became live');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('a turn lost right after the snapshot a rep was armed from is caught — the snapshot\'s serial is where the count starts', async () => {
  // The engine counts serials from the one an arrangement was reported at (lib/drill/engine.js, `countFrom`); a page
  // that drops the snapshot's serial makes the next report compare with nothing, so a turn lost straight after it
  // is read as a turn made, in some hold, and the rep goes on from an arrangement the cube is not in.
  for (const where of ['a snapshot on the page', 'a report from before the page opened']) {
    const { page, context, errors } = await openPractice(fixture);
    try {
      const rnd = lcg(where.length);
      const f = toFacelets(randomStart(rnd));
      if (where === 'a snapshot on the page') {
        await show(page, 'sune');
        await page.evaluate((x) => { window.__p.serialFrom(40); window.__p.facelets(x); }, f);
      } else {
        await page.evaluate((x) => { window.__p.serialFrom(40); window.__p.facelets(x); }, f);
        await show(page, 'sune');
      }
      assert.equal((await page.evaluate(() => window.__p.data())).status, 'armed', `${where}: precondition: armed`);
      // The Sune's first turn is lost between the cube and the app; its second arrives one serial past the snapshot's next.
      const per = reportsPerToken(SUNE, ORIENTATIONS[0], rnd);
      await page.evaluate((q) => window.__p.move(q, { skip: 1 }), per[1][0]);
      const got = await page.evaluate(() => ({ status: window.__p.data().status, say: window.__p.say() }));
      assert.equal(got.status, 'uncertain', `${where}: a turn lost after the snapshot went unseen (${got.status}: ${got.say})`);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
});

test('a turn lost right after the algorithm changes is caught — the carried arrangement keeps its serial count', async () => {
  // A new row on the same cube carries the engine's model across (`makeEngine`). Carried with no serial, the next
  // report compared with nothing, and a turn lost straight after the switch went unseen (audit round 3, row 15).
  const { page, context, errors } = await openPractice(fixture);
  try {
    const rnd = lcg(315);
    await show(page, 'sune');
    await page.evaluate(() => window.__p.serialFrom(40));
    const flat = reportsPerToken(SUNE, ORIENTATIONS[0], rnd).flat();
    assert.equal((await feedRep(page, randomStart(rnd), flat)).at(-1), 1, 'precondition: a rep completed');
    // Another algorithm, in place: the cube is the same, and so is its stream.
    const rows = Object.values((await page.evaluate(() => window.__p.rows())).rows);
    const other = rows.find((r) => r.id !== 'sune' && r.alg.startsWith('R U '));
    await show(page, other.id);
    assert.equal((await page.evaluate(() => window.__p.data())).status, 'armed', 'precondition: armed from the carried arrangement');
    // Its first turn is lost; its second arrives one serial past.
    const per = reportsPerToken(other.alg, ORIENTATIONS[0], rnd);
    await page.evaluate((q) => window.__p.move(q, { skip: 1 }), per[1][0]);
    const got = await page.evaluate(() => ({ status: window.__p.data().status, say: window.__p.say() }));
    assert.equal(got.status, 'uncertain', `a turn lost right after the switch went unseen (${got.status}: ${got.say})`);
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

// ---- an engine that lost a turn (round 2, row 14) ------------------------------------------------------------

test('after a lost turn no next turn is pointed at until the cube says where it is — and then the arrow comes back', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const rnd = lcg(141);
    await show(page, 'sune');
    const seen = () => page.evaluate(() => ({ say: window.__p.say(), arrow: window.__p.arrow(), data: window.__p.data() }));
    const start = randomStart(rnd);
    const per = reportsPerToken(SUNE, ORIENTATIONS[4], rnd);
    await page.evaluate((f) => window.__p.facelets(f), toFacelets(start));
    await page.evaluate((qs) => { for (const q of qs) window.__p.move(q); }, [...per[0], ...per[1]]);
    assert.equal((await seen()).arrow, 'next', 'precondition: the walk points at the next turn');
    // The third turn never reaches the app; the fourth arrives one serial past it.
    await page.evaluate(({ qs, skip }) => qs.forEach((q, i) => window.__p.move(q, { skip: i === 0 ? skip : 0 })), { qs: per[3], skip: per[2].length });
    const lost = await seen();
    assert.equal(lost.data.status, 'uncertain', 'precondition: the lost turn was noticed');
    // What must NOT happen: an arrow at the next turn of a position the cube may not be at.
    assert.equal(lost.arrow, 'none', `an arrow drawn for an arrangement nobody knows (${lost.say})`);
    assert.doesNotMatch(lost.say, /arrow/, 'the page points the child at an arrow');
    // The cube says where it is: the walk resumes from there, and so does the arrow.
    await page.evaluate((f) => window.__p.facelets(f), toFacelets(after_(start, per.slice(0, 4).flat())));
    const back = await seen();
    assert.equal(back.arrow, 'next', `the arrow did not come back once the cube said where it is (${back.data.status}: ${back.say})`);
    assert.equal(back.data.position, '4', 'the walk did not resume where the cube is');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- the holds no report can tell apart (round 2, coordinator) -----------------------------------------------

/** The arrangement at every position of `alg` from solved, in the cube's own frame, held `hold` — worked out here
 *  from the notation's interpreter, never from the page. Two holds with one track pass the cube through the same
 *  arrangements, so one walk stands for both. */
const trackIn = (alg, hold) => {
  let now = { state: PIECES, hold: [...hold] };
  const out = [toFacelets(PIECES)];
  for (const m of parse(alg)) { now = applyIdentity(toIdentity(m, now.hold), now.hold, now.state); out.push(toFacelets(now.state)); }
  return out.join('|');
};

test('an algorithm whose hold no report settles still gets its walk and its arrow — drawn in a hold the cube may be in', async () => {
  // drop-in (F2) keeps the four holds about its axis to the end, the H perm two, end to end: the engine never
  // settles either (lib/drill/engine.js). The page drew no arrow and said the first turns would tell it the hold.
  const { page, context, errors } = await openPractice(fixture);
  try {
    const rnd = lcg(511);
    const rows = Object.values((await page.evaluate(() => window.__p.rows())).rows);
    for (const [id, from] of [['drop-in', 1], ['pll-H', 5]]) {
      const row = rows.find((r) => r.id === id);
      assert.ok(row, `precondition: the ledger holds ${id}`);
      await show(page, id);
      const hold = ORIENTATIONS[Math.floor(rnd() * 24)];
      const alike = ORIENTATIONS.filter((h) => trackIn(row.alg, h) === trackIn(row.alg, hold)).map((h) => h.join(' '));
      assert.ok(alike.length > 1, `precondition: ${id} has holds no report tells apart`);
      const flat = reportsPerToken(row.alg, hold, rnd).flat();
      const seen = await page.evaluate(({ f, qs }) => {
        const before = window.__p.count('done');
        window.__p.facelets(f);
        return qs.map((q) => {
          window.__p.move(q);
          return { arrow: window.__p.arrow(), say: window.__p.say(), data: window.__p.data(), done: window.__p.count('done') - before };
        });
      }, { f: toFacelets(randomStart(rnd)), qs: flat });
      assert.equal(seen.at(-1).done, 1, `${id}: precondition: the rep completed`);
      for (const [i, s] of seen.slice(from - 1, -1).entries()) {
        assert.equal(s.data.settled, 'false', `${id}: precondition: the hold is still not settled`);
        assert.notEqual(s.arrow, 'none', `${id} after report ${i + from}: no arrow (${s.say})`);
        assert.ok(alike.includes(s.data.hold), `${id} after report ${i + from}: the walk is drawn held ${s.data.hold}, which is not a hold the cube can be in`);
        assert.doesNotMatch(s.say, /how you are holding it/, `${id}: the page says the turns will tell it the hold`);
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- off the walk after a rotation (round 2, row 13) ---------------------------------------------------------

test('off the walk after a whole-cube turn or a slice, the cube is drawn in the hold the rep has reached — the one its way back is written in', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const rnd = lcg(131);
    const rows = Object.values((await page.evaluate(() => window.__p.rows())).rows);
    // The Aa perm turns the whole cube first (x); OLL 57 makes a slice (M') once two axes have settled the hold.
    for (const [opens, made] of [['x L2 D2 ', 3], ["R U R' U' M' ", 5]]) {
      const row = rows.find((r) => r.alg.startsWith(opens));
      assert.ok(row, `precondition: the ledger holds an algorithm that opens ${opens}`);
      await show(page, row.id);
      const hold = ORIENTATIONS[Math.floor(rnd() * 24)];
      const per = reportsPerToken(row.alg, hold, rnd);
      await page.evaluate((f) => window.__p.facelets(f), toFacelets(randomStart(rnd)));
      await page.evaluate((qs) => { for (const q of qs) window.__p.move(q); }, per.slice(0, made).flat());
      const before = await page.evaluate(() => window.__p.data());
      assert.deepEqual([before.settled, before.position], ['true', String(made)], `${row.id}: precondition: past ${opens}, the hold settled`);
      const wrong = 'URFDLB'.split('').find((f) => !axesNear(per, made).has(AXIS[f]));
      await page.evaluate((q) => window.__p.move(q), wrong);
      await page.evaluate((ms) => window.__p.wait(ms), PAST_WINDOW_MS);
      const got = await page.evaluate(() => ({ data: window.__p.data(), held: window.__p.cube().getAttribute('orientation'), say: window.__p.say() }));
      assert.equal(got.data.status, 'off', `${row.id}: precondition: off the walk`);
      const reached = run(parse(row.alg).slice(0, made), hold, PIECES).hold.join(' ');
      assert.notEqual(reached, hold.join(' '), `${row.id}: precondition: ${opens}turned the hold`);
      // What must NOT happen: the cube swung back to the hold the rep began in, against the letters of its way back.
      assert.equal(got.held, reached, `${row.id}: off the walk the cube is drawn held ${got.held}, not ${reached} (${got.say})`);
      await page.keyboard.press('Escape');
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- part way through a turn (row 21) ----------------------------------------------------------------------

/** What the cube in `window.__cube` shows, as a child sees it: the colour at every world facelet (its face letter). */
const shown = async (page) => toWorld(await page.evaluate(() => {
  const el = window.__cube;
  el.root.updateMatrixWorld(true);
  const letterOf = Object.fromEntries(Object.entries(el.drawnColours()).map(([face, hex]) => [hex.slice(1).toLowerCase(), face]));
  const V = el.stickers[0].position.constructor;
  return el.stickers.map((m) => {
    const s = m.getWorldPosition(new V());
    const c = m.parent.getWorldPosition(new V());
    return { face: letterOf[m.material.color.getHexString()] ?? '?', cubie: [c.x, c.y, c.z], offset: [s.x - c.x, s.y - c.y, s.z - c.z] };
  });
}));

/** What a fresh cube shows, drawn from `facelets` held `orientation`: the arrangement, with no sequence played. */
async function shownFresh(page, facelets, orientation) {
  await page.evaluate(({ f, o }) => {
    const el = document.createElement('cubus-cube');
    el.setAttribute('orientation', o);
    el.setAttribute('facelets', f);
    el.style.cssText = 'position:fixed;left:0;top:0;width:120px;height:120px';
    document.body.append(el);
    window.__cube = el;
  }, { f: facelets, o: orientation });
  await page.waitForFunction(() => window.__cube.stickers?.length > 0, null, { timeout: LIVENESS_MS });
  const out = await shown(page);
  await page.evaluate(() => window.__cube.remove());
  return out;
}

test('part way through a half turn or a slice the cube on screen is the cube as it is, with the turn still to make', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const rnd = lcg(211);
    const rows = Object.values((await page.evaluate(() => window.__p.rows())).rows).sort((a, b) => a.id.localeCompare(b.id));
    const picture = async () => {
      await page.evaluate(() => { window.__cube = window.__p.cube(); });
      return { drawn: await shown(page), orientation: await page.evaluate(() => window.__p.cube().getAttribute('orientation')) };
    };
    /**
     * The first move of `kind` that a cube reports as two turns — a half turn as two quarters of one face, a slice as
     * its two faces — and that comes after reports on two axes, when the hold is known: as `{ row, per, k }`.
     */
    const find = (kind) => {
      for (const row of rows) {
        const per = reportsPerToken(row.alg, ORIENTATIONS[7], rnd);
        const k = per.findIndex((qs, i) => qs.length === 2 && (kind === 'half turn' ? qs[0][0] === qs[1][0] : AXIS[qs[0][0]] === AXIS[qs[1][0]] && qs[0][0] !== qs[1][0])
          && new Set(per.slice(0, i).flat().map((q) => AXIS[q[0]])).size >= 2);
        if (k >= 0) return { row, per, k };
      }
      throw new Error(`no ledger row has a ${kind} after the hold is known`);
    };
    for (const kind of ['half turn', 'slice']) {
      const { row, per, k } = find(kind);
      const what = `${row.id}, ${kind} at move ${k + 1}`;
      await show(page, row.id);
      await page.keyboard.press('Escape');
      let state = randomStart(rnd);
      await page.evaluate((f) => window.__p.facelets(f), toFacelets(state));
      const lead = [...per.slice(0, k).flat(), per[k][0]];
      await page.evaluate((qs) => { for (const q of qs) window.__p.move(q); }, lead);
      state = after_(state, lead);
      const data = await page.evaluate(() => window.__p.data());
      assert.deepEqual([data.status, data.settled], ['running', 'true'], `${what}: precondition: running, the hold known`);
      const mid = await picture();
      assert.equal(mid.drawn, await shownFresh(page, toFacelets(state), mid.orientation), `${what}: part way through, the cube on screen is not the cube as it is`);
      // The arrow points the turn still to make — the move's second report, in the cube's own letters.
      const cube = await page.evaluate(() => ({ arrow: window.__p.arrow(), alg: window.__p.cube().getAttribute('alg') }));
      assert.equal(cube.arrow, 'next');
      assert.equal(cube.alg.split(' ')[0], per[k][1], `${what}: the next turn drawn is ${cube.alg.split(' ')[0]}, not the one still to make`);
      // The second report lands the move — the picture is the cube as it is again — and the rep finishes at its
      // last report, which may be that one.
      const before = await page.evaluate(() => window.__p.count('done'));
      await page.evaluate((q) => window.__p.move(q), per[k][1]);
      state = after_(state, [per[k][1]]);
      const whole = await picture();
      assert.equal(whole.drawn, await shownFresh(page, toFacelets(state), whole.orientation), `${what}: after the move, the cube on screen is not the cube as it is`);
      const rest = per.slice(k + 1).flat();
      const dones = await page.evaluate(({ qs, b }) => [window.__p.count('done') - b, ...qs.map((q) => { window.__p.move(q); return window.__p.count('done') - b; })], { qs: rest, b: before });
      assert.deepEqual(dones, atLast(rest.length + 1), `${what}: the rep did not finish at its last report`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- the record's notices (row 22) -------------------------------------------------------------------------

test('a rep that was not saved stays said as mixed practice moves on — until a rep is saved', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const catalogue = await page.evaluate(() => window.__p.rows());
    const set = Object.values(catalogue.sets).find((s) => s.ids.length >= 3 && s.ids.length <= 6);
    assert.ok(set, 'no set of three to six algorithms');
    const rnd = lcg(221);
    await show(page, set.ids[0]);
    await mixedOn(page);
    const notice = () => page.evaluate(() => { const n = document.querySelector('#practiceRecordSay'); return { hidden: n.hidden, text: n.textContent }; });
    /** One clean rep of whatever the page shows, then the page once it has moved on and the rep's save has settled. */
    const repAndMoveOn = async () => {
      const was = await page.evaluate(() => window.__p.data().alg);
      const chips = await page.evaluate(() => window.__p.chips());
      const dones = await feedRep(page, randomStart(rnd), reportsPerToken(chips.join(' '), ORIENTATIONS[0], rnd).flat());
      assert.equal(dones.at(-1), 1, `${was}: the rep did not complete`);
      await page.waitForFunction((w) => window.__p.data().alg !== w, was, { timeout: LIVENESS_MS });
      await settle(page);
    };
    // The record's every write refused from here on — the quota-full case.
    await page.evaluate(() => window.__p.failWrites(true));
    await repAndMoveOn();
    const unsaved = await notice();
    assert.equal(unsaved.hidden, false, 'moving on took away the only sign that a rep was not saved');
    // Named, now the page shows another algorithm: "that rep" would point at nothing on screen.
    assert.match(unsaved.text, /A rep of .+ was not saved/);
    // Saved again: the notice goes, because what it said is no longer true.
    await page.evaluate(() => window.__p.failWrites(false));
    await repAndMoveOn();
    assert.equal((await notice()).hidden, true, 'a notice outlived the failure it was about');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- start over in mixed practice (round 2, row 15) ----------------------------------------------------------

test('in mixed practice, starting over as a rep ends keeps the algorithm — by Escape, by Next, and by the cube\'s own gesture', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const catalogue = await page.evaluate(() => window.__p.rows());
    const set = Object.values(catalogue.sets).find((x) => x.ids.length >= 3 && x.ids.length <= 6);
    assert.ok(set, 'precondition: a set of three to six algorithms');
    const rnd = lcg(151);
    await show(page, set.ids[0]);
    await mixedOn(page);
    // The rep's last report and then, in the SAME task — before the advance its `done` queued can run — a start over.
    for (const how of ['escape', 'gesture', 'next']) {
      const was = await page.evaluate(() => window.__p.data().alg);
      const chips = await page.evaluate(() => window.__p.chips());
      const flat = reportsPerToken(chips.join(' '), ORIENTATIONS[0], rnd).flat();
      const wanted = await page.evaluate(({ f, qs, h, face }) => {
        const before = window.__p.count('done');
        window.__p.facelets(f);
        for (const q of qs) window.__p.move(q);
        const done = window.__p.count('done') - before;
        if (h === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        if (h === 'gesture') for (let i = 0; i < 4; i += 1) window.__p.move(face, { dt: 100 });
        if (h === 'next') document.querySelector('#practiceNext').click();
        return { done, now: window.__p.data().alg };
      }, { f: toFacelets(randomStart(rnd)), qs: flat, h: how, face: 'URFDLB'[Math.floor(rnd() * 6)] });
      assert.equal(wanted.done, 1, `${how}: precondition: the rep completed`);
      await page.evaluate((ms) => window.__p.wait(ms), 100);
      const after = await page.evaluate(() => window.__p.data().alg);
      if (how === 'next') {
        // One press of Next is ONE step on: the queued advance must not take a second.
        const order = await page.evaluate(() => window.__p.data().alg);
        assert.notEqual(order, was, 'next: Next did not move on');
        assert.equal(after, wanted.now, `next: the queued advance moved on again after Next (${wanted.now} then ${after})`);
      } else {
        // What must NOT happen: the start over carried out, and then the algorithm switched under it.
        assert.equal(after, was, `${how}: started over on ${was}, and the page moved on to ${after}`);
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- the catalogue cannot be read (round 2, row 16) ----------------------------------------------------------

test('when the algorithms cannot be read, the page offers Back and Try again, and no control that cannot work is pressable', async () => {
  const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 1012 } });
  // The library worker cannot be started while `__failLibrary` is set — the failure every question then meets.
  await context.addInitScript(() => {
    window.__failLibrary = true;
    const Real = window.Worker;
    window.Worker = class extends Real {
      constructor(url, opts) {
        if (window.__failLibrary && String(url).includes('library-worker')) throw new Error('no library worker (test)');
        super(url, opts);
      }
    };
  });
  try {
    const page = pace(await context.newPage());
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${fixture.base}/index.html#/practice`);
    // The library: it says why, and offers to ask again.
    await page.waitForSelector('#practiceListRetry', { timeout: LIVENESS_MS });
    // The page for one row: the same failure, met with its controls drawn.
    await page.evaluate(async () => {
      const { state } = await import('/lib/app-state.js');
      const { renderScreen } = await import('/lib/screen-shell.js');
      state.practiceAlg = 'sune';
      renderScreen();
    });
    await page.waitForFunction(() => /could not be read/.test(document.querySelector('#practiceSay')?.textContent ?? ''), null, { timeout: LIVENESS_MS });
    const failed = await page.evaluate(() => [...document.querySelectorAll('.practice-page button')]
      .filter((b) => !b.hidden).map((b) => ({ id: b.id, disabled: b.disabled })));
    // What must NOT happen: a control that looks pressable and does nothing.
    const pressable = failed.filter((b) => !b.disabled).map((b) => b.id).sort();
    assert.deepEqual(pressable, ['practiceBack', 'practiceRetry'], `pressable while nothing can work: ${pressable.join(', ')}`);
    assert.ok(failed.length > 4, 'precondition: the page drew its controls');
    // Back works: the library again.
    await page.click('#practiceBack');
    await page.waitForSelector('#practiceListRetry', { timeout: LIVENESS_MS });
    // Try again, once the worker can start: the library, then the page, load.
    await page.evaluate(() => { window.__failLibrary = false; });
    await page.click('#practiceListRetry');
    await page.waitForSelector('.practice-screen[data-ready="1"]', { timeout: LIVENESS_MS });
    await page.evaluate(async () => {
      window.__failLibrary = true;
      const { state } = await import('/lib/app-state.js');
      const { renderScreen } = await import('/lib/screen-shell.js');
      state.practiceAlg = 'sune';
      renderScreen();
    });
    // The catalogue is cached once read, so the page loads; its controls are live.
    await page.waitForFunction(() => document.querySelector('.practice-page')?.dataset.ready === '1', null, { timeout: LIVENESS_MS });
    const loaded = await page.evaluate(() => [...document.querySelectorAll('.practice-page button')].filter((b) => !b.hidden && b.disabled).map((b) => b.id));
    assert.deepEqual(loaded, [], `still disabled once the page loaded: ${loaded.join(', ')}`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- the cube's first drawing (round 2, row 17) --------------------------------------------------------------

test('the page\'s cube is connected already holding the row it draws — its case, its algorithm, its hold', async () => {
  // `connectedCallback` draws at once (AGENTS.md §2), so whatever the attributes say AT CONNECTION is a picture.
  for (const connect of [false, true]) {
    const { page, context, errors } = await openPractice(fixture, { connect });
    try {
      // A custom element's callbacks are fixed when it is defined, so the moment of connection is read at the door
      // instead: every way a node is put into the page, recording the cube's attributes as it goes in.
      await page.evaluate(() => {
        window.__atConnect = [];
        const seen = (parent, nodes) => {
          for (const n of nodes) {
            if (n?.localName === 'cubus-cube' && parent.closest?.('#practiceCube')) window.__atConnect.push(['facelets', 'alg', 'orientation'].map((a) => n.getAttribute(a)));
          }
        };
        for (const [proto, name] of [[Node.prototype, 'appendChild'], [Node.prototype, 'insertBefore'], [Element.prototype, 'append'], [Element.prototype, 'replaceChildren'], [Element.prototype, 'prepend']]) {
          const real = proto[name];
          proto[name] = function patched(...args) { seen(this, name === 'insertBefore' || name === 'appendChild' ? [args[0]] : args); return real.apply(this, args); };
        }
      });
      if (connect) await page.evaluate((f) => window.__p.facelets(f), toFacelets(randomStart(lcg(171))));
      await show(page, 'sune');
      const got = await page.evaluate(() => ({ at: window.__atConnect, now: ['facelets', 'alg', 'orientation'].map((a) => window.__p.cube().getAttribute(a)) }));
      assert.equal(got.at.length, 1, `${connect}: the cube was connected ${got.at.length} times`);
      // What must NOT happen: a first drawing of something the page then replaces — a solved cube, no hold, no moves.
      assert.deepEqual(got.at[0], got.now, `${connect ? 'followed' : 'demo'}: connected as ${JSON.stringify(got.at[0])}, then redrawn as ${JSON.stringify(got.now)}`);
      assert.ok(got.now[2], 'the cube has no hold');
      if (!connect) assert.ok(got.now[1], 'the demo cube has no algorithm');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
});

// ---- another window's reps (round 3, row 17) ----------------------------------------------------------------

test('what another window does to the record is shown here as it happens — a rep it adds, and the record it deletes', async () => {
  const first = await openPractice(fixture);
  const { page, context, errors } = first;
  try {
    const rnd = lcg(317);
    // A second window of the same origin: the same IndexedDB, and the record's broadcast in each of the other's writes.
    const second = await openPractice(fixture, { context });
    const shown = () => page.evaluate(() => ({
      reps: document.querySelectorAll('#practiceReps li').length,
      empty: /No reps yet/.test(document.querySelector('#practiceReps').textContent),
      count: document.querySelector('.practice-figures dd')?.textContent,
    }));
    await show(page, 'sune');
    assert.equal((await feedRep(page, randomStart(rnd), reportsPerToken(SUNE, ORIENTATIONS[0], rnd).flat())).at(-1), 1, 'precondition: a rep here');
    await settle(page);
    assert.deepEqual(await shown(), { reps: 1, empty: false, count: '1' }, 'precondition: this window shows its rep');
    // The other window makes a rep of the same algorithm.
    await show(second.page, 'sune');
    assert.equal((await feedRep(second.page, randomStart(rnd), reportsPerToken(SUNE, ORIENTATIONS[1], rnd).flat())).at(-1), 1, 'precondition: a rep there');
    await page.waitForFunction(() => document.querySelectorAll('#practiceReps li').length === 2, null, { timeout: LIVENESS_MS })
      .catch(() => {});
    // What must NOT happen: this window's figures and history standing as they were before the other's write.
    assert.deepEqual(await shown(), { reps: 2, empty: false, count: '2' }, 'another window\'s rep is not shown here');
    // The other window deletes the record — the database itself, as "clear site data" would.
    await second.page.evaluate(() => window.__p.drop());
    await page.waitForFunction(() => /No reps yet/.test(document.querySelector('#practiceReps').textContent), null, { timeout: LIVENESS_MS })
      .catch(() => {});
    // No reps on record is a count of zero, measured — a dash would say the record could not be read.
    assert.deepEqual(await shown(), { reps: 0, empty: true, count: '0' }, 'a record another window deleted is still shown here');
    assert.deepEqual([...errors, ...second.errors], []);
  } finally {
    await context.close();
  }
});

// ---- the library as tiles (dev-docs/practice-redesign-plan.md §4, WI-3; audit row 26) ---------------------------

/** Settings stored before the app starts, as a person's earlier choices would be. */
const stored = (values) => (ctx) => ctx.addInitScript((v) => {
  if (!sessionStorage.getItem('__seeded')) {
    localStorage.setItem('cubusSettings', JSON.stringify({ ...JSON.parse(localStorage.getItem('cubusSettings') || '{}'), ...v }));
    sessionStorage.setItem('__seeded', '1');
  }
}, values);

/** The library on `key`'s method, ready: chosen IN PLACE through the method row's menu, as a person chooses it. */
async function libraryOn(page, key) {
  await page.evaluate((k) => {
    if (document.querySelector('.practice-screen')?.dataset.method === k) return;
    document.querySelector(`.method-menu [data-method="${k}"]`).click();
  }, key);
  await page.waitForSelector(`.practice-screen[data-ready="1"][data-method="${key}"]`, { timeout: LIVENESS_MS });
}

/** The library on the method that teaches `set`, with that set's grid scrolled into view and drawn. */
async function gridOf(page, set) {
  const key = await page.evaluate(async (id) => {
    const { libraryKey } = await import('/lib/screens/practice/library-view.js');
    return libraryKey((await window.__p.rows()).groups.find((g) => g.phases.some((p) => p.sets.includes(id))));
  }, set);
  await libraryOn(page, key);
  await page.evaluate((id) => document.querySelector(`#practiceList .tiles[data-set="${id}"]`).scrollIntoView({ block: 'start' }), set);
  await page.waitForFunction((id) => document.querySelector(`#practiceList .tiles[data-set="${id}"]`).childElementCount > 0, set, { timeout: LIVENESS_MS });
  return `#practiceList .tiles[data-set="${set}"]`;
}

/** What the library draws now: its method, its record state, and its tiles and rings by grid. */
const libraryState = (page) => page.evaluate(() => {
  const screen = document.querySelector('.practice-screen');
  const body = document.querySelector('#practiceList');
  return {
    method: screen.dataset.method,
    record: body.dataset.record,
    stages: body.querySelectorAll('.stage-sec').length,
    rail: document.querySelectorAll('.rail [data-jump]').length,
    tiles: body.querySelectorAll('[data-alg]').length,
    rings: body.querySelectorAll('[data-alg] .badge svg.ring').length,
    counts: document.querySelectorAll('.practice-screen .ct svg.ring').length,
    grids: Object.fromEntries([...body.querySelectorAll('.tiles')].map((g) => [`${g.dataset.set}${g.dataset.part ? `/${g.dataset.part}` : ''}`, g.childElementCount])),
    notice: (() => { const n = document.querySelector('#practiceLibrarySay'); return n && !n.hidden ? n.textContent : ''; })(),
  };
});

test('the library opens on the solve tab\'s method — Quick on Beginner\'s 12 — and CFOP (full) is 124 tiles in three stages', async () => {
  const fresh = await openPractice(fixture, { connect: false });
  try {
    // A fresh install walks Quick, which teaches no algorithm: the library opens on Beginner, all of it in view.
    await fresh.page.waitForFunction(() => document.querySelectorAll('#practiceList [data-alg]').length === 12, null, { timeout: LIVENESS_MS });
    const now = await libraryState(fresh.page);
    assert.deepEqual([now.method, now.tiles, now.stages, now.rail], ['beginner', 12, 4, 4], 'a fresh install did not open on Beginner\'s 12');
    assert.deepEqual(fresh.errors, []);
  } finally {
    await fresh.context.close();
  }
  const cfop = await openPractice(fixture, { connect: false, prepare: stored({ solveMethod: 'cfop' }) });
  try {
    const now = await libraryState(cfop.page);
    assert.deepEqual([now.method, now.stages, now.rail], ['cfop', 3, 3], 'the library did not open on the solve tab\'s CFOP (full)');
    const total = await cfop.page.evaluate(async () => {
      const { stageIds } = await import('/lib/screens/practice/library-view.js');
      const c = await window.__p.rows();
      return c.groups.find((g) => g.method === 'cfop').phases.reduce((n, p) => n + stageIds(c, p).length, 0);
    });
    assert.equal(total, 124);
    assert.deepEqual(cfop.errors, []);
  } finally {
    await cfop.context.close();
  }
});

test('a method chosen in the library is the library\'s own: kept for its next visit, and the solve tab\'s method never moves', async () => {
  const { page, context, errors } = await openPractice(fixture, { connect: false, prepare: stored({ solveMethod: 'cfop' }) });
  try {
    await page.waitForSelector('.practice-screen[data-method="cfop"]', { timeout: LIVENESS_MS });
    // Through the row the solve tab uses: one pill and a "More methods" menu, grouped.
    await page.click('#moreMethodsBtn');
    const headings = await page.evaluate(() => [...document.querySelectorAll('.method-menu .menu-h')].map((h) => h.textContent));
    assert.deepEqual(headings, ['First steps', 'Getting faster', 'Competition', 'Not in the app’s solver yet', 'Tables']);
    await page.click('.method-menu [data-method="mehta"]');
    await page.waitForSelector('.practice-screen[data-ready="1"][data-method="mehta"]', { timeout: LIVENESS_MS });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cubusSettings')));
    assert.equal(saved.practiceMethod, 'mehta', 'the library\'s choice was not stored');
    // What must NOT happen: choosing what to PRACTISE changing what the solve tab walks.
    assert.equal(saved.solveMethod, 'cfop', 'choosing in the library wrote the solve method');
    assert.equal(await page.evaluate(() => window.__p.settings.solveMethod), 'cfop');
    assert.equal(await page.evaluate(() => document.querySelector('#methodRow [data-method]').textContent), 'Mehta', 'the pill does not name the method on screen');
    // The next visit opens where the library was left.
    await page.reload();
    await page.waitForSelector('.practice-screen[data-ready="1"]', { timeout: LIVENESS_MS });
    assert.equal(await page.evaluate(() => document.querySelector('.practice-screen').dataset.method), 'mehta', 'the next visit forgot the library\'s method');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('a stage\'s tiles are drawn only when its section comes near the view, and once', async () => {
  const { page, context, errors } = await openPractice(fixture, { connect: false, prepare: stored({ practiceMethod: 'cfop' }) });
  try {
    await page.waitForFunction(() => document.querySelectorAll('#practiceList [data-alg]').length > 0, null, { timeout: LIVENESS_MS });
    await page.evaluate((ms) => window.__p.wait(ms), 300);
    const first = await libraryState(page);
    // What must NOT happen: the last stage's tiles built on the UI thread for a section nobody has scrolled near.
    assert.equal(first.grids['pll-human'], 0, 'the last stage drew its tiles before it came near the view');
    assert.ok(first.tiles > 0 && first.tiles < 124, `${first.tiles} tiles drawn on opening`);
    // The rail takes the reader there; that stage's grid is drawn, exactly its rows.
    await page.click('.rail [data-jump="2"]');
    await page.waitForFunction(() => document.querySelector('#practiceList .tiles[data-set="pll-human"]').childElementCount > 0, null, { timeout: LIVENESS_MS });
    const pll = await page.evaluate(async () => {
      const grid = document.querySelector('#practiceList .tiles[data-set="pll-human"]');
      grid.querySelector('[data-alg]').dataset.mark = 'first';
      return { ids: [...grid.querySelectorAll('[data-alg]')].map((t) => t.dataset.alg), want: (await window.__p.rows()).sets['pll-human'].ids };
    });
    assert.deepEqual(pll.ids, pll.want, 'the stage drew other rows, or out of order');
    assert.equal(await page.evaluate(() => document.querySelector('.rail [data-jump="2"]').classList.contains('on')), true, 'the rail does not say where the reader is');
    // Away and back: the same tiles, not drawn twice.
    await page.click('.rail [data-jump="0"]');
    await page.click('.rail [data-jump="2"]');
    await page.evaluate((ms) => window.__p.wait(ms), 200);
    assert.equal(await page.evaluate(() => document.querySelector('#practiceList .tiles[data-set="pll-human"] [data-alg]').dataset.mark), 'first', 'coming back drew the tiles again');
    // And a tile opens its algorithm.
    await page.click(`#practiceList [data-alg="${pll.ids[0]}"]`);
    await page.waitForFunction((x) => window.__p.ready(x), pll.ids[0], { timeout: LIVENESS_MS });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('the rings are a read that has completed: none while the record is read, none when it cannot be — and then said why', async () => {
  const { page, context, errors } = await openPractice(fixture, { connect: false });
  try {
    await page.waitForFunction(() => document.querySelector('#practiceList')?.dataset.record === 'read', null, { timeout: LIVENESS_MS });
    // Read, and zero: an empty ring on every tile, and a count on the method and every stage.
    let now = await libraryState(page);
    assert.equal(now.rings, now.tiles, 'a tile has no ring once the record is read');
    assert.equal(now.counts, 1 + 4 + 4, 'the method, its stages and its rail items are not all counted');
    // While a read is held: no ring anywhere, and no count — only how many rows a stage holds.
    await page.evaluate(() => window.__p.hold());
    await page.evaluate(async () => { const { refreshScreen } = await import('/lib/screen-shell.js'); refreshScreen(); });
    await page.waitForSelector('.practice-screen[data-ready="1"]', { timeout: LIVENESS_MS });
    await page.waitForFunction(() => document.querySelectorAll('#practiceList [data-alg]').length === 12, null, { timeout: LIVENESS_MS });
    now = await libraryState(page);
    assert.deepEqual([now.record, now.rings, now.counts], ['reading', 0, 0], 'a ring or a count drawn for a record still being read');
    await page.evaluate(() => window.__p.release());
    await page.waitForFunction(() => document.querySelectorAll('#practiceList [data-alg] .badge svg.ring').length === 12, null, { timeout: LIVENESS_MS });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
  const foreign = { v: 99, algs: {} };
  const bad = await openPractice(fixture, {
    connect: false,
    prepare: (ctx) => ctx.addInitScript(({ db, store, entry, value }) => {
      const open = indexedDB.open(db, 1);
      open.onupgradeneeded = () => { open.result.createObjectStore(store).put(value, entry); };
      open.onsuccess = () => open.result.close();
    }, { db: RECORD_DB, store: RECORD_STORE, entry: RECORD_ENTRY, value: foreign }),
  });
  try {
    await bad.page.waitForFunction(() => document.querySelector('#practiceList')?.dataset.record === 'unreadable', null, { timeout: LIVENESS_MS });
    await bad.page.waitForFunction(() => document.querySelectorAll('#practiceList [data-alg]').length === 12, null, { timeout: LIVENESS_MS });
    const now = await libraryState(bad.page);
    // What must NOT happen: an unknown record drawn as empty rings, or as nothing with nothing said.
    assert.deepEqual([now.rings, now.counts], [0, 0], 'a ring drawn over a record nobody could read');
    assert.match(now.notice, /could not be read \(foreign\)/, 'the library did not say why it shows no progress');
    assert.deepEqual(bad.errors, []);
  } finally {
    await bad.context.close();
  }
});

test('no sentence in the library until a book is opened: a tile is named for its row, and the book says what each set is for', async () => {
  const { page, context, errors } = await openPractice(fixture, { connect: false, prepare: stored({ practiceMethod: 'cfop' }) });
  try {
    await page.waitForFunction(() => document.querySelector('#practiceList')?.dataset.record === 'read', null, { timeout: LIVENESS_MS });
    const look = () => page.evaluate(async () => {
      const c = await window.__p.rows();
      const { rowName } = await import('/lib/screens/practice/library-view.js');
      const text = document.querySelector('.practice-screen').innerText;
      const sentences = [...new Set([...Object.values(c.sets).map((s) => s.purpose), ...Object.values(c.rows).map((r) => r.says)].filter(Boolean))];
      return {
        said: sentences.filter((x) => text.includes(x)),
        names: [...document.querySelectorAll('#practiceList [data-alg]')].filter((t) => t.getAttribute('aria-label') !== rowName(c.rows[t.dataset.alg])).map((t) => t.dataset.alg),
        described: document.querySelectorAll('#practiceList [aria-describedby]').length,
        purposes: c.groups.find((g) => g.method === 'cfop').phases[0].sets.map((id) => c.sets[id].purpose).filter(Boolean),
      };
    });
    const before = await look();
    assert.deepEqual(before.said, [], 'a purpose or a row\'s sentence is drawn in the library');
    assert.deepEqual(before.names, [], 'a tile with no progress is named for something besides its row');
    assert.equal(before.described, 0, 'a tile is described by a sentence');
    // The first stage's book: every set's purpose, said on request.
    await page.click('#practiceList [data-about="0"]');
    const shown = await page.evaluate(() => [...document.querySelectorAll('.about-menu')].filter((m) => !m.hidden).map((m) => m.innerText).join('\n'));
    for (const p of before.purposes) assert.ok(shown.includes(p), `the book does not say "${p.slice(0, 40)}…"`);
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- the case photographs (dev-docs/practice-redesign-plan.md §3.5, WI-1) -------------------------------------
//
// A net row's tile is a photograph of the app's own cube, taken by the one parked renderer while the library draws
// none. What must NOT happen: a tile that shows its net and then swaps to a cube; a grid that moves at rest; a
// renderer left in a tile the pointer has left; a pinned clock carried to the next screen's cube.

/** The F2L set: 41 photographed net rows. */
const PHOTO_SET = 'f2l-human';

/** Bring `set`'s grid into view and wait until every photograph well in it has its photograph (or its flat picture). */
async function openPhotos(page, set = PHOTO_SET) {
  const grid = await gridOf(page, set);
  await page.waitForFunction((sel) => !document.querySelector(sel).querySelector('.case-photo[data-photo="pending"]'), grid, { timeout: LIVENESS_MS });
}

/** What the library holds now: renderers in tiles, animations in tiles, wells by state, flat pictures on photographed rows. */
const libraryNow = (page, set = PHOTO_SET) => page.evaluate(async (id) => {
  const { isPhotographed } = await import('/lib/case-photo.js');
  const rows = (await window.__p.rows()).rows;
  const block = document.querySelector(`#practiceList .tiles[data-set="${id}"]`);
  const cards = [...block.querySelectorAll('[data-alg]')];
  return {
    cards: cards.length,
    photographed: cards.filter((c) => isPhotographed(rows[c.dataset.alg])).length,
    shown: block.querySelectorAll('.case-photo[data-photo="shown"] > img[src^="blob:"]').length,
    netOnPhotoRow: cards.filter((c) => isPhotographed(rows[c.dataset.alg]) && c.querySelector('svg:not(.ring)')).length,
    renderersInCards: document.querySelectorAll('#practiceList cubus-cube').length,
    renderers: document.querySelectorAll('cubus-cube').length,
    animationsInCards: document.getAnimations().filter((a) => a.effect?.target?.closest?.('#practiceList [data-alg]')).length,
  };
}, set);

test('a net row\'s tile waits in an empty well and then shows its photograph — never its net first — and at rest nothing in the grid moves', async () => {
  const { page, context, errors } = await openPractice(fixture, { connect: false, prepare: stored({ practiceMethod: 'cfop' }) });
  try {
    // Every flat picture ever put into a photographed row's tile, from before its grid is drawn.
    await page.evaluate(async () => {
      const { isPhotographed } = await import('/lib/case-photo.js');
      const rows = (await window.__p.rows()).rows;
      window.__netsOnPhotoRows = [];
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (n.nodeType !== 1) continue;
            for (const c of [n.closest('[data-alg]'), ...n.querySelectorAll('[data-alg]')].filter(Boolean)) {
              if (isPhotographed(rows[c.dataset.alg]) && c.querySelector('svg:not(.ring)')) window.__netsOnPhotoRows.push(c.dataset.alg);
            }
          }
        }
      }).observe(document.querySelector('.practice-screen'), { childList: true, subtree: true });
    });
    await openPhotos(page);
    const now = await libraryNow(page);
    assert.ok(now.photographed > 30, `precondition: ${now.photographed} photographed rows in ${PHOTO_SET}`);
    assert.equal(now.shown, now.photographed, 'a photographed row has no photograph');
    assert.equal(now.netOnPhotoRow, 0, 'a photographed row drew its net');
    assert.deepEqual(await page.evaluate(() => window.__netsOnPhotoRows), [], 'a photographed row showed its net before its photograph');
    // At rest: no renderer in any tile, and nothing animating in one. The one renderer waits in its slot.
    assert.equal(now.renderersInCards, 0, 'a renderer sits in a tile at rest');
    assert.equal(now.animationsInCards, 0, 'something in the grid animates at rest');
    assert.equal(now.renderers, 1, 'the library holds more than the one renderer');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('pointing at or focusing a photographed tile puts the one renderer in it, live, with its case\'s marking — and leaving takes it out', async () => {
  const { page, context, errors } = await openPractice(fixture, { connect: false });
  try {
    await openPhotos(page);
    const id = await page.evaluate((set) => document.querySelector(`#practiceList .tiles[data-set="${set}"] .case-photo[data-photo="shown"]`).closest('[data-alg]').dataset.alg, PHOTO_SET);
    const want = await page.evaluate(async (x) => {
      const { photoAttrs } = await import('/lib/case-photo.js');
      const c = await window.__p.rows();
      return photoAttrs(c.rows[x], c.sets[c.rows[x].set].region);
    }, id);
    const live = () => page.evaluate((x) => {
      const cubes = [...document.querySelectorAll('#practiceList cubus-cube')];
      return cubes.map((el) => ({
        inCard: el.closest('[data-alg]')?.dataset.alg ?? null,
        attrs: { orientation: el.getAttribute('orientation'), facelets: el.getAttribute('facelets'), highlight: el.getAttribute('highlight'), ghosts: el.getAttribute('ghosts') },
        focus: el.getAttribute('focus'),
        pinned: el.clock !== null,
        stillHidden: getComputedStyle(el.closest('.case-photo').querySelector('img')).visibility === 'hidden',
      }));
    }, id);
    const card = `#practiceList [data-alg="${id}"]`;
    for (const how of ['pointer', 'focus']) {
      if (how === 'pointer') await page.hover(`${card} .case-photo`);
      else await page.focus(card);
      await page.waitForFunction((x) => document.querySelector(`#practiceList [data-alg="${x}"] cubus-cube`), id, { timeout: LIVENESS_MS });
      assert.deepEqual(await live(), [{ inCard: id, attrs: { ...want }, focus: null, pinned: false, stillHidden: true }], `${how}: the live renderer is not the case's, or not live`);
      if (how === 'pointer') await page.mouse.move(2, 2);
      else await page.evaluate(() => document.activeElement.blur());
      await page.waitForFunction(() => !document.querySelector('#practiceList cubus-cube'), null, { timeout: LIVENESS_MS });
      assert.equal((await libraryNow(page)).renderers, 1, `${how}: leaving lost the renderer, or made another`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('the live marking breathes, and holds still under reduced motion — the renderer\'s own freeze, not ours', async () => {
  for (const reducedMotion of ['reduce', 'no-preference']) {
    const shared = await fixture.browser.newContext({ viewport: { width: 1280, height: 1012 }, reducedMotion });
    const { page, context, errors } = await openPractice(fixture, { connect: false, context: shared });
    try {
      await openPhotos(page);
      const well = `#practiceList .tiles[data-set="${PHOTO_SET}"] .case-photo[data-photo="shown"]`;
      await page.hover(well);
      await page.waitForFunction((sel) => document.querySelector(sel)?.querySelector('cubus-cube'), well, { timeout: LIVENESS_MS });
      const first = await page.locator(well).first().screenshot();
      await page.evaluate((ms) => window.__p.wait(ms), 600);
      const second = await page.locator(well).first().screenshot();
      if (reducedMotion === 'reduce') assert.ok(first.equals(second), 'under reduced motion the hovered tile changed');
      else assert.ok(!first.equals(second), 'with motion the hovered tile did not breathe — is the renderer live at all?');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
});

test('a palette change re-photographs: the same tile\'s photograph is another picture', async () => {
  const { page, context, errors } = await openPractice(fixture, { connect: false });
  try {
    await openPhotos(page);
    const first = `#practiceList .tiles[data-set="${PHOTO_SET}"] [data-alg] .case-photo > img`;
    const id = await page.evaluate((sel) => document.querySelector(sel).closest('[data-alg]').dataset.alg, first);
    const src = () => page.evaluate((x) => document.querySelector(`#practiceList [data-alg="${x}"] .case-photo > img`)?.src ?? null, id);
    const before = await src();
    const palette = await page.evaluate(async () => {
      const { refreshScreen } = await import('/lib/screen-shell.js');
      window.__p.settings.palette = window.__p.settings.palette === 'muted' ? 'classic' : 'muted';
      refreshScreen();
      return window.__p.settings.palette;
    });
    await page.waitForSelector('.practice-screen[data-ready="1"]', { timeout: LIVENESS_MS });
    await openPhotos(page);
    const after_ = await src();
    assert.ok(before && after_, 'precondition: both photographs landed');
    assert.notEqual(after_, before, `the ${palette} tile kept the photograph taken in the other palette`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('with no WebGL the library says so once and every tile draws its flat picture — never an empty well', async () => {
  // Heard from the context, before the page loads: the library photographs its first method's tiles as it opens.
  const warned = [];
  const { page, context, errors } = await openPractice(fixture, {
    connect: false,
    prepare: async (ctx) => {
      ctx.on('console', (m) => { if (m.type() === 'warning' && m.text().startsWith('case-photo:')) warned.push(m.text()); });
      await ctx.addInitScript(() => {
        const real = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function getContext(kind, ...rest) {
          return /webgl/i.test(String(kind)) ? null : real.call(this, kind, ...rest);
        };
      });
    },
  });
  try {
    const grid = await gridOf(page, PHOTO_SET);
    await page.waitForFunction((sel) => !document.querySelector(sel).querySelector('.case-photo'), grid, { timeout: LIVENESS_MS });
    const now = await page.evaluate(async (sel) => {
      const { casePhotoCounts } = await import('/lib/case-photo.js');
      const block = document.querySelector(sel);
      return {
        cards: block.querySelectorAll('[data-alg]').length,
        flat: block.querySelectorAll('[data-alg] > svg').length,
        state: document.querySelector('.practice-screen').dataset.photos ?? null,
        unavailable: casePhotoCounts.unavailable,
      };
    }, grid);
    assert.equal(now.flat, now.cards, 'a tile has no picture');
    assert.equal(now.state, 'unavailable');
    assert.equal(now.unavailable, 1, 'the missing renderer was not counted once');
    assert.equal(warned.length, 1, `said ${warned.length} times`);
    // The renderer's own refusal to build without a context is the only error.
    assert.ok(errors.every((e) => /WebGL/i.test(e)), `other errors: ${errors.join(' | ')}`);
  } finally {
    await context.close();
  }
});

test('photographs land in reading order, each shown as it lands — and coming back to a stage takes none again', async () => {
  // Plan §13 item 3, as amended: the tiles fill in reading order, one at a time; and a return to a stage in the same
  // session is answered from the session's photographs — asserted as a COUNT of photographs taken, never a time.
  const { page, context, errors } = await openPractice(fixture, {
    connect: false,
    prepare: async (ctx) => {
      await stored({ practiceMethod: 'cfop' })(ctx);
      // From before the app starts: every well as it is shown, with how many wells were still waiting at that moment.
      await ctx.addInitScript(() => {
        window.__shown = [];
        new MutationObserver((records) => {
          for (const r of records) {
            if (r.attributeName !== 'data-photo' || r.target.dataset.photo !== 'shown') continue;
            window.__shown.push({ alg: r.target.closest('[data-alg]').dataset.alg, pending: document.querySelectorAll('.case-photo[data-photo="pending"]').length });
          }
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-photo'] });
      });
    },
  });
  try {
    const landed = () => page.waitForFunction(() => document.querySelectorAll('#practiceList .case-photo').length > 0
      && !document.querySelector('#practiceList .case-photo[data-photo="pending"]'), null, { timeout: LIVENESS_MS });
    await landed();
    const first = await page.evaluate(async () => {
      const { casePhotoCounts } = await import('/lib/case-photo.js');
      return {
        reading: [...document.querySelectorAll('#practiceList .case-photo')].map((w) => w.closest('[data-alg]').dataset.alg),
        shown: window.__shown, taken: casePhotoCounts.taken,
      };
    });
    assert.ok(first.reading.length >= 14, `precondition: ${first.reading.length} photographed tiles on opening`);
    // (c) The ORDER: shown exactly in reading order — the order the wells sit in the page.
    assert.deepEqual(first.shown.map((x) => x.alg), first.reading, 'the photographs were shown out of reading order');
    // Each AS IT LANDS: when the k-th tile is shown, every tile after it is still waiting — none held back for a batch.
    // (The observer hears each attribute write as its own record, so a batch would show the first with none waiting.)
    const n = first.reading.length;
    first.shown.forEach((x, k) => assert.equal(x.pending, n - k - 1, `tile ${k} was shown with ${x.pending} waiting, not ${n - k - 1}`));

    // (d) Back to the same stage, two ways, and not one photograph taken again.
    const taken = () => page.evaluate(async () => (await import('/lib/case-photo.js')).casePhotoCounts.taken);
    // Through a page and Back: a new mount of the library, the same session.
    await page.click(`#practiceList [data-alg="${first.reading[0]}"]`);
    await page.waitForFunction((x) => window.__p.ready(x), first.reading[0], { timeout: LIVENESS_MS });
    // The click pointed at the tile, so the pulse sized the renderer for its well; the page's cube is that renderer,
    // and must not keep the well's size or place (E9 — a library left mid-pulse once keyed every photograph anew).
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('cubus-cube')].map((c) => c.getAttribute('style') ?? '')
      .filter((st) => /inset|left|top|\dpx/.test(st))), [], 'the page\'s cube kept the pulse\'s size and place');
    const beforeBack = await taken();
    await page.click('#practiceBack');
    await page.waitForSelector('.practice-screen[data-composition="library"][data-ready="1"][data-method="cfop"]', { timeout: LIVENESS_MS });
    await landed();
    assert.equal(await taken(), beforeBack, 'coming back through a page took photographs again');
    // Another method and back, in place.
    await libraryOn(page, 'beginner');
    await landed();
    const beforeReturn = await taken();
    await libraryOn(page, 'cfop');
    await landed();
    assert.equal(await taken(), beforeReturn, 'choosing the method again took photographs again');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('leaving the library hands the renderer on with its clock let go — the page\'s cube is the same element, and it runs', async () => {
  const { page, context, errors } = await openPractice(fixture, { connect: false });
  try {
    await openPhotos(page);
    await page.evaluate(() => { window.__photoCube = document.querySelector('.case-photo-slot cubus-cube'); });
    const id = await page.evaluate((set) => document.querySelector(`#practiceList .tiles[data-set="${set}"] [data-alg]`).dataset.alg, PHOTO_SET);
    await page.click(`#practiceList [data-alg="${id}"]`);
    await page.waitForFunction((x) => window.__p.ready(x), id, { timeout: LIVENESS_MS });
    assert.deepEqual(await page.evaluate(() => ({ same: window.__p.cube() === window.__photoCube, pinned: window.__p.cube().clock !== null })),
      { same: true, pinned: false }, 'the page did not get the library\'s renderer, or got it with its clock still pinned');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- a rep with one turn the cube did not time (round 2, row 22) ---------------------------------------------

test('a rep where one turn came without the cube\'s own time is refused about that turn, never about the cube', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const rnd = lcg(222);
    await show(page, 'sune');
    const flat = reportsPerToken(SUNE, ORIENTATIONS[0], rnd).flat();
    // Every report carries the cube's clock but one — what a clock-capable GAN cube sends for a move it recovered.
    const dones = await page.evaluate(({ f, qs }) => {
      const before = window.__p.count('done');
      window.__p.facelets(f);
      return qs.map((q, i) => {
        if (i === 2) window.cubusFeed.move({ notation: q, timestamp: performance.now() });
        else window.__p.move(q);
        return window.__p.count('done') - before;
      });
    }, { f: toFacelets(randomStart(rnd)), qs: flat });
    assert.deepEqual(dones, atLast(flat.length), 'precondition: the rep completed at its last report');
    const time = await page.evaluate(() => window.__p.time());
    // What must NOT happen: a cube that sent its clock for every other turn said to have no clock of its own.
    assert.doesNotMatch(time, /does not send a clock/, `the time blames the cube: ${time}`);
    assert.equal(time, '— (a turn in this rep came without the cube’s own time)');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('a clean rep with a long gap between two turns is marked as paused, and puts the row of clean reps back to zero', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const rnd = lcg(223);
    await show(page, 'sune');
    for (let i = 0; i < 2; i++) {
      const dones = await feedRep(page, randomStart(rnd), reportsPerToken(SUNE, ORIENTATIONS[0], rnd).flat());
      assert.equal(dones.at(-1), 1, 'precondition: an even rep completed');
      await settle(page);
    }
    const fingers = () => page.evaluate(() => document.querySelector('#practiceFingers').textContent);
    assert.match(await fingers(), /2 of 7/, 'precondition: two clean reps make a row of two');
    // The same algorithm, every turn on time but one: twenty times the usual gap before the fourth turn.
    const per = reportsPerToken(SUNE, ORIENTATIONS[0], rnd);
    const late = per.slice(0, 3).flat().length;
    const flat = per.flat();
    const dones = await page.evaluate(({ f, qs, at }) => {
      const before = window.__p.count('done');
      window.__p.facelets(f);
      return qs.map((q, i) => { window.__p.move(q, i === at ? { dt: 5000 } : {}); return window.__p.count('done') - before; });
    }, { f: toFacelets(randomStart(rnd)), qs: flat, at: late });
    assert.deepEqual(dones, atLast(flat.length), 'precondition: the paused rep completed at its last report');
    const stored = (await recordOf(page)).algs.sune.at(-1);
    assert.equal(stored.clean, true, 'precondition: the paused rep was clean');
    assert.ok(stored.pauses >= 1, `precondition: the pause was marked (pauses = ${stored.pauses})`);
    // What must NOT happen: a paused rep counted toward the target, as "3 of 7".
    assert.match(await fingers(), /0 of 7/);
    assert.equal(await page.evaluate(() => window.__p.fingers()), 'false');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- a record that cannot be read (round 2, rows 18 and 23; IndexedDB) ----------------------------------------

/** What the page shows of the record: the history's words, the notice, and the four figures. */
const recordShown = (page) => page.evaluate(() => ({
  reps: document.querySelector('#practiceReps').textContent.trim(),
  notice: document.querySelector('#practiceRecordSay').hidden ? '' : document.querySelector('#practiceRecordSay').textContent,
  figures: [...document.querySelectorAll('.practice-figures dd')].map((d) => d.textContent),
}));

test('a record that cannot be read leaves the history unknown on the page — never "No reps yet" — and no rep is saved over it', async () => {
  const foreign = { v: 99, algs: {} };
  const { page, context, errors } = await openPractice(fixture, {
    // Something that is not the record stands under its key, put there before the app opens the database.
    prepare: (ctx) => ctx.addInitScript(({ db, store, entry, value }) => {
      const open = indexedDB.open(db, 1);
      open.onupgradeneeded = () => { open.result.createObjectStore(store).put(value, entry); };
      open.onsuccess = () => open.result.close();
    }, { db: RECORD_DB, store: RECORD_STORE, entry: RECORD_ENTRY, value: foreign }),
  });
  try {
    const rnd = lcg(958);
    await show(page, 'sune');
    await settle(page);
    const got = await recordShown(page);
    assert.match(got.notice, /could not be read \(foreign\)/, 'precondition: the read failed and the page said so');
    assert.doesNotMatch(got.reps, /No reps yet/, 'an unreadable history was said to be empty');
    assert.match(got.reps, /could not be read/);
    assert.deepEqual(got.figures, ['—', '—', '—', '—'], 'a figure was given for a record nobody could read');
    // A rep made on it is not saved, and the page says so; what was stored is left as it was.
    assert.equal((await feedRep(page, randomStart(rnd), reportsPerToken(SUNE, ORIENTATIONS[0], rnd).flat())).at(-1), 1, 'precondition: a rep');
    await settle(page);
    assert.match((await recordShown(page)).notice, /That rep was not saved/);
    assert.deepEqual(await page.evaluate(() => window.__p.stored()), foreign, 'the unreadable record was written over');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('an earlier record that cannot be read is said and kept as it was — and the reps made now are saved', async () => {
  const { page, context, errors } = await openPractice(fixture, {
    // The record as localStorage held it before IndexedDB, unreadable: the record takes nothing from it.
    prepare: (ctx) => ctx.addInitScript(() => localStorage.setItem('cubusDrillRecord', '{not json')),
  });
  try {
    const rnd = lcg(959);
    await show(page, 'sune');
    await settle(page);
    assert.match((await recordShown(page)).notice, /earlier practice record is not in this one/, 'the earlier record went unsaid');
    assert.equal((await feedRep(page, randomStart(rnd), reportsPerToken(SUNE, ORIENTATIONS[0], rnd).flat())).at(-1), 1, 'precondition: a rep');
    await settle(page);
    const got = await recordShown(page);
    // What must NOT happen: practice stopped by a record nobody can read, or that record removed.
    assert.equal(got.figures[0], '1', 'the rep made now was not saved');
    assert.match(got.notice, /earlier practice record is not in this one/, 'a saved rep took away the only sign of the earlier record');
    assert.equal(await page.evaluate(() => localStorage.getItem('cubusDrillRecord')), '{not json', 'the earlier record was not kept as it was');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- the record answers later (IndexedDB) -------------------------------------------------------------------

/** Every paint of the figures from here on, with the algorithm on the page as it was made. */
const watchFigures = (page) => page.evaluate(() => {
  window.__paints = [];
  new MutationObserver(() => {
    const d = document.querySelector('.practice-page').dataset;
    window.__paints.push({ alg: d.alg, record: d.record, reps: document.querySelector('.practice-figures dd')?.textContent });
  }).observe(document.querySelector('#practiceFigures'), { childList: true });
});

test('a rep reaches the figures only once its save has landed — and nothing a read or a save answers late paints another algorithm', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const rnd = lcg(402);
    const other = 'pll-T';
    const sune = () => feedRep(page, randomStart(rnd), reportsPerToken(SUNE, ORIENTATIONS[0], rnd).flat());
    await show(page, 'sune');
    assert.equal((await sune()).at(-1), 1, 'precondition: a rep');
    await settle(page);
    assert.equal((await recordShown(page)).figures[0], '1', 'precondition: one rep on record');
    // The record held: every save and read the page asks for from here waits behind another transaction.
    await page.evaluate(() => window.__p.hold());
    assert.equal((await sune()).at(-1), 1, 'precondition: a second rep');
    const pending = await page.evaluate(() => ({ ...window.__p.data(), items: document.querySelectorAll('#practiceReps li').length }));
    assert.equal(pending.saving, '1', 'precondition: the second rep\'s save is in flight');
    // What must NOT happen: the rep on the screen before the record has it.
    assert.equal((await recordShown(page)).figures[0], '1', 'a rep was counted before its save landed');
    assert.equal(pending.items, 1, 'a rep was listed before its save landed');
    // Away to another algorithm, back, and away again — each a read that waits, and only the last may paint.
    await watchFigures(page);
    await show(page, other);
    await show(page, 'sune');
    await show(page, other);
    // While its read is pending the figures are unknown: never sune's, and never an empty record's zero.
    assert.deepEqual(await recordShown(page).then((g) => g.figures), ['—', '—', '—', '—'], 'a figure was shown before its read completed');
    await page.evaluate(() => window.__p.release());
    await settle(page);
    const paints = await page.evaluate(() => window.__paints);
    const wrong = paints.filter((x) => x.alg === other && x.reps !== '—' && x.reps !== '0');
    assert.deepEqual(wrong, [], `another algorithm's figures were painted on ${other}`);
    assert.equal((await recordShown(page)).figures[0], '0', `${other} does not show its own record`);
    // The rep was saved, under sune, and shows there once read.
    const rec = await recordOf(page);
    assert.deepEqual([rec.algs.sune?.length, rec.algs[other]], [2, undefined]);
    await show(page, 'sune');
    await settle(page);
    assert.equal((await recordShown(page)).figures[0], '2');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('mixed practice steps on inside a round without the record — and starts the next round only once the reps it orders by are saved', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const catalogue = await page.evaluate(() => window.__p.rows());
    const set = Object.values(catalogue.sets).find((x) => x.ids.length >= 3 && x.ids.length <= 6);
    assert.ok(set, 'precondition: a set of three to six algorithms');
    const n = set.ids.length;
    const rnd = lcg(403);
    await show(page, set.ids[0]);
    await mixedOn(page);
    await settle(page);
    const rep = async () => {
      const chips = await page.evaluate(() => window.__p.chips());
      const dones = await feedRep(page, randomStart(rnd), reportsPerToken(chips.join(' '), ORIENTATIONS[0], rnd).flat());
      assert.equal(dones.at(-1), 1, 'precondition: the rep completed');
    };
    const movedOn = (was) => page.waitForFunction((w) => window.__p.data().alg !== w, was, { timeout: LIVENESS_MS });
    // Each step on, as it is made: whether the rep before it was saved yet, and what the figures then said.
    await page.evaluate(() => {
      window.__steps = [];
      const p = document.querySelector('.practice-page');
      new MutationObserver(() => {
        window.__steps.push({ alg: p.dataset.alg, saving: p.dataset.saving, record: p.dataset.record, reps: document.querySelector('.practice-figures dd')?.textContent });
      }).observe(p, { attributes: true, attributeFilter: ['data-alg'] });
    });
    await page.evaluate(() => window.__p.hold());
    // Inside the round: every step on is taken while the record cannot answer at all.
    for (let k = 1; k < n; k += 1) {
      const was = await page.evaluate(() => window.__p.data().alg);
      await rep();
      await movedOn(was);
    }
    // The round's last rep: the next round is ordered by the record, so the step on waits for it.
    const last = await page.evaluate(() => window.__p.data().alg);
    await rep();
    // One turn of the page's timers after the rep: the step its `done` queued has run, and is waiting on the record.
    await page.evaluate(() => new Promise((r) => { setTimeout(r, 0); }));
    const waiting = await page.evaluate(() => window.__p.data());
    assert.equal(waiting.alg, last, 'the next round began while the reps it is ordered by were not saved');
    assert.equal(waiting.saving, String(n), 'precondition: every rep of the round is still being saved');
    await page.evaluate(() => window.__p.release());
    await movedOn(last);
    const steps = await page.evaluate(() => window.__steps);
    assert.equal(steps.length, n, `steps on: ${JSON.stringify(steps)}`);
    steps.slice(0, -1).forEach((x, i) => {
      // What must NOT happen inside a round: a step on that waited for the record, or figures from before its read.
      assert.equal(x.saving, String(i + 1), `step ${i + 1} waited for a save`);
      assert.deepEqual([x.record, x.reps], ['reading', '—'], `step ${i + 1} showed figures no read had given`);
    });
    // What must NOT happen at a round's end: the next round ordered from a record without the round's reps.
    assert.equal(steps.at(-1).saving, '0', 'the next round began with a save of the round before it in flight');
    const rec = await recordOf(page);
    assert.deepEqual(set.ids.map((id) => rec.algs[id]?.length ?? 0), set.ids.map(() => 1), 'a rep of the round is not on record');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('a mixed-practice order still being read is dropped by a start over or a new attempt — it never changes the algorithm under a rep', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const catalogue = await page.evaluate(() => window.__p.rows());
    const set = Object.values(catalogue.sets).find((x) => x.ids.length >= 3 && x.ids.length <= 6);
    assert.ok(set, 'precondition: a set of three to six algorithms');
    const rnd = lcg(404);
    const practised = set.ids[0];
    await show(page, practised);
    const chips = await page.evaluate(() => window.__p.chips());
    const reps = () => reportsPerToken(chips.join(' '), ORIENTATIONS[0], rnd).flat();
    // One rep, so this algorithm comes LAST in any order the record gives: an order that lands always changes it.
    assert.equal((await feedRep(page, randomStart(rnd), reps())).at(-1), 1, 'precondition: a rep');
    await settle(page);
    for (const how of ['start over', 'a new attempt']) {
      // The record held, so the order Mixed asks for waits — and meanwhile the child starts over, or starts a rep.
      await page.evaluate(() => window.__p.hold());
      await page.click('#practiceMixed');
      if (how === 'start over') await page.click('#practiceRestart');
      // Turned from where the cube is — no new arrangement, which would be a start over of its own.
      else await page.evaluate((qs) => { for (const q of qs) window.__p.move(q); }, reps().slice(0, 2));
      await page.evaluate(() => window.__p.release());
      // Held and let go once more: every read asked for before it has answered, and what it answered has been used.
      await page.evaluate(() => window.__p.hold());
      await page.evaluate(() => window.__p.release());
      const got = await page.evaluate(() => ({
        alg: window.__p.data().alg, status: window.__p.data().status,
        pressed: document.querySelector('#practiceMixed').getAttribute('aria-pressed'),
      }));
      // What must NOT happen: the order lands and replaces the algorithm the child has started over on, or is turning.
      assert.equal(got.alg, practised, `${how}: the mixed order replaced the algorithm with ${got.alg}`);
      assert.equal(got.pressed, 'false', `${how}: a mixed choice made before it was taken up after it`);
      if (how === 'a new attempt') assert.equal(got.status, 'running', 'the attempt did not go on');
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('the next round\'s order is dropped when a rep has begun while it was read — the step on never lands under a rep', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const catalogue = await page.evaluate(() => window.__p.rows());
    const set = Object.values(catalogue.sets).find((x) => x.ids.length >= 3 && x.ids.length <= 6);
    assert.ok(set, 'precondition: a set of three to six algorithms');
    const rnd = lcg(405);
    await show(page, set.ids[0]);
    await mixedOn(page);
    const repOf = (chips) => reportsPerToken(chips.join(' '), ORIENTATIONS[0], rnd).flat();
    // Every algorithm of the round but the last, each moving on as it is done.
    for (let k = 1; k < set.ids.length; k += 1) {
      const was = await page.evaluate(() => window.__p.data().alg);
      const flat = repOf(await page.evaluate(() => window.__p.chips()));
      assert.equal((await feedRep(page, randomStart(rnd), flat)).at(-1), 1, 'precondition: a rep');
      await page.waitForFunction((w) => window.__p.data().alg !== w, was, { timeout: LIVENESS_MS });
    }
    // The round's last rep with the record held, so the next round's order waits — and a rep of it begins meanwhile.
    const last = await page.evaluate(() => window.__p.data().alg);
    const chips = await page.evaluate(() => window.__p.chips());
    await page.evaluate(() => window.__p.hold());
    assert.equal((await feedRep(page, randomStart(rnd), repOf(chips))).at(-1), 1, 'precondition: the round\'s last rep');
    await page.evaluate(() => new Promise((r) => { setTimeout(r, 0); }));   // the step its `done` queued has run
    // Turned from where the rep left it — no new arrangement, which would be a start over of its own.
    await page.evaluate((qs) => { for (const q of qs) window.__p.move(q); }, repOf(chips).slice(0, 2));
    await page.evaluate(() => window.__p.release());
    // Held and let go once more: every read asked for before it has answered, and what it answered has been used.
    await page.evaluate(() => window.__p.hold());
    await page.evaluate(() => window.__p.release());
    const got = await page.evaluate(() => window.__p.data());
    // What must NOT happen: the next round's first algorithm put in place of the one the child is turning.
    assert.equal(got.alg, last, `the next round replaced ${last} with ${got.alg} under a rep`);
    assert.equal(got.status, 'running', 'the rep did not go on');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('a rep whose save fails after its page has gone is said where the child is — the library, then the next page — until a rep is saved', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const rnd = lcg(406);
    await show(page, 'sune');
    await settle(page);
    // The record held and its writes refused: the rep's save waits, and fails once it runs.
    await page.evaluate(() => window.__p.hold());
    await page.evaluate(() => window.__p.failWrites(true));
    assert.equal((await feedRep(page, randomStart(rnd), reportsPerToken(SUNE, ORIENTATIONS[0], rnd).flat())).at(-1), 1, 'precondition: a rep');
    assert.equal((await page.evaluate(() => window.__p.data())).saving, '1', 'precondition: its save is in flight');
    // Back to the library while the save is in flight; then the record lets it run.
    await page.click('#practiceBack');
    await page.waitForSelector('.practice-screen[data-composition="library"][data-ready="1"]', { timeout: LIVENESS_MS });
    await page.evaluate(() => window.__p.release());
    // Held and let go once more: the save asked for before it has settled, and what it answered has been used.
    await page.evaluate(() => window.__p.hold());
    await page.evaluate(() => window.__p.release());
    const library = await page.evaluate(() => { const n = document.querySelector('#practiceLibrarySay'); return n && !n.hidden ? n.textContent : ''; });
    // What must NOT happen: a rep lost after its page went, and nothing said anywhere.
    assert.match(library, /A rep of .+ was not saved/, 'a save that failed after its page had gone went unsaid in the library');
    assert.equal((await page.evaluate(() => window.__p.record())).algs.sune, undefined, 'precondition: the rep is not on record');
    // The next page says it too — and a rep saved there takes it away, because what it said is no longer the newest.
    await page.evaluate(() => window.__p.failWrites(false));
    await show(page, 'sune');
    await settle(page);
    const notice = () => page.evaluate(() => { const n = document.querySelector('#practiceRecordSay'); return n.hidden ? '' : n.textContent; });
    assert.match(await notice(), /A rep of .+ was not saved/, 'the next page did not say the rep that was not saved');
    assert.equal((await feedRep(page, randomStart(rnd), reportsPerToken(SUNE, ORIENTATIONS[0], rnd).flat())).at(-1), 1, 'precondition: a rep');
    await settle(page);
    assert.equal(await notice(), '', 'the notice outlived a rep that was saved');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('a rep begun before the round\'s step on has run drops that step — the next round never lands under it', async () => {
  const { page, context, errors } = await openPractice(fixture);
  try {
    const catalogue = await page.evaluate(() => window.__p.rows());
    const set = Object.values(catalogue.sets).find((x) => x.ids.length >= 3 && x.ids.length <= 6);
    assert.ok(set, 'precondition: a set of three to six algorithms');
    const rnd = lcg(406);
    await show(page, set.ids[0]);
    await mixedOn(page);
    const repOf = (chips) => reportsPerToken(chips.join(' '), ORIENTATIONS[0], rnd).flat();
    for (let k = 1; k < set.ids.length; k += 1) {
      const was = await page.evaluate(() => window.__p.data().alg);
      const flat = repOf(await page.evaluate(() => window.__p.chips()));
      assert.equal((await feedRep(page, randomStart(rnd), flat)).at(-1), 1, 'precondition: a rep');
      await page.waitForFunction((w) => window.__p.data().alg !== w, was, { timeout: LIVENESS_MS });
    }
    // The round's last rep, and the first turns of a new one in the SAME task: the step its `done` queued has not run.
    const last = await page.evaluate(() => window.__p.data().alg);
    const chips = await page.evaluate(() => window.__p.chips());
    await page.evaluate(() => window.__p.hold());
    const done = await page.evaluate(({ f, qs, more }) => {
      const before = window.__p.count('done');
      window.__p.facelets(f);
      for (const q of qs) window.__p.move(q);
      const n = window.__p.count('done') - before;
      for (const q of more) window.__p.move(q);
      return n;
    }, { f: toFacelets(randomStart(rnd)), qs: repOf(chips), more: repOf(chips).slice(0, 2) });
    assert.equal(done, 1, 'precondition: the round\'s last rep');
    await page.evaluate(() => new Promise((r) => { setTimeout(r, 0); }));   // the step its `done` queued has run
    await page.evaluate(() => window.__p.release());
    // Held and let go once more: every read asked for before it has answered, and what it answered has been used.
    await page.evaluate(() => window.__p.hold());
    await page.evaluate(() => window.__p.release());
    const got = await page.evaluate(() => window.__p.data());
    // What must NOT happen: the next round's first algorithm put in place of the one the child is turning.
    assert.equal(got.alg, last, `the next round replaced ${last} with ${got.alg} under a rep`);
    assert.equal(got.status, 'running', 'the rep did not go on');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- the Settings row (row 29) -----------------------------------------------------------------------------

test('the Settings stepper keeps keyboard focus on a control when a press reaches either bound', async () => {
  const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 1012 } });
  try {
    // Practice shown, so the stepper is in a card of its own; one press short of the maximum.
    await context.addInitScript((v) => localStorage.setItem('cubusSettings', JSON.stringify({ navHidden: [], navDefaults: v, fingersN: 29 })), NAV_DEFAULTS_VERSION);
    const page = pace(await context.newPage());
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${fixture.base}/index.html#/settings`);
    await page.waitForSelector('#setFingers-more', { timeout: LIVENESS_MS });
    const press = async (id, want) => {
      await page.focus(`#${id}`);
      await page.keyboard.press('Enter');
      await page.waitForFunction((n) => document.querySelector('#fingersN')?.textContent === n, want, { timeout: LIVENESS_MS });
      return page.evaluate((pressed) => ({ focus: document.activeElement?.id || document.activeElement?.tagName, disabled: document.getElementById(pressed).disabled }), id);
    };
    const top = await press('setFingers-more', '30');
    assert.equal(top.disabled, true, 'precondition: "more" is disabled at the maximum');
    assert.equal(top.focus, 'setFingers-less', 'reaching the maximum dropped keyboard focus');
    await page.evaluate(async () => {
      const { settings } = await import('/lib/app-settings.js');
      const { renderScreen } = await import('/lib/screen-shell.js');
      settings.fingersN = 4;
      renderScreen();
    });
    const bottom = await press('setFingers-less', '3');
    assert.equal(bottom.disabled, true, 'precondition: "fewer" is disabled at the minimum');
    assert.equal(bottom.focus, 'setFingers-more', 'reaching the minimum dropped keyboard focus');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
