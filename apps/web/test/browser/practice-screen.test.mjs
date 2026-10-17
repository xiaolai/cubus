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
import { pace } from '../browser-wait.mjs';
import { lcg } from '../fixtures/seeded-scrambles.mjs';
import { toWorld } from './drawn-cube.mjs';
import { LIVENESS_MS, startBrowserFixture } from './harness.mjs';
import {
  AXIS, MAC, PAST_WINDOW_MS, after_, axesNear, feedRep, openPractice, randomStart, reportsPerToken, show,
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
    const kept = (await page.evaluate(() => window.__p.record())).algs.sune;
    assert.deepEqual(kept.map((r) => ({ c: r.c, l: r.l })), [{ c: true, l: false }], 'the rep was not filed clean');
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
    await page.click('#practiceMixed');
    const notice = () => page.evaluate(() => { const n = document.querySelector('#practiceRecordSay'); return { hidden: n.hidden, text: n.textContent }; });
    /** One clean rep of whatever the page shows, then the page once it has moved on to another algorithm. */
    const repAndMoveOn = async () => {
      const was = await page.evaluate(() => window.__p.data().alg);
      const chips = await page.evaluate(() => window.__p.chips());
      const dones = await feedRep(page, randomStart(rnd), reportsPerToken(chips.join(' '), ORIENTATIONS[0], rnd).flat());
      assert.equal(dones.at(-1), 1, `${was}: the rep did not complete`);
      await page.waitForFunction((w) => window.__p.data().alg !== w, was, { timeout: LIVENESS_MS });
    };
    // Storage refuses the record from here on — the quota-full, private-window case.
    await page.evaluate(() => {
      const write = Storage.prototype.setItem;
      window.__refuse = true;
      Storage.prototype.setItem = function setItem(k, v) {
        if (window.__refuse && k === 'cubusDrillRecord') throw new Error('quota exceeded (test)');
        return write.call(this, k, v);
      };
    });
    await repAndMoveOn();
    const unsaved = await notice();
    assert.equal(unsaved.hidden, false, 'moving on took away the only sign that a rep was not saved');
    assert.match(unsaved.text, /not saved/);
    // Saved again: the notice goes, because what it said is no longer true.
    await page.evaluate(() => { window.__refuse = false; });
    await repAndMoveOn();
    assert.equal((await notice()).hidden, true, 'a notice outlived the failure it was about');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- the library (row 26) ----------------------------------------------------------------------------------

test('the library draws no card or picture until a set is opened, and then that set\'s, once', async () => {
  const { page, context, errors } = await openPractice(fixture, { connect: false });
  try {
    const count = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
    assert.equal(await count('#practiceList details.alg-set'), await page.evaluate(async () => {
      const c = await window.__p.rows();
      return c.groups.flatMap((g) => g.phases.flatMap((p) => p.sets)).length;
    }), 'precondition: every set is listed');
    // What must NOT happen: every closed set's cards and pictures built on the UI thread at every visit.
    assert.deepEqual([await count('#practiceList svg'), await count('#practiceList [data-alg]')], [0, 0], 'closed sets drew their cards');
    const catalogue = await page.evaluate(() => window.__p.rows());
    const set = Object.values(catalogue.sets).reduce((a, b) => (b.ids.length > a.ids.length ? b : a));
    const block = `#practiceList details.alg-set[data-set="${set.id}"]`;
    await page.click(`${block} > summary`);
    await page.waitForFunction((sel) => document.querySelector(sel).querySelectorAll('[data-alg]').length > 0, block, { timeout: LIVENESS_MS });
    const opened = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      el.querySelector('[data-alg]').dataset.mark = 'first';
      return { cards: el.querySelectorAll('[data-alg]').length, pictures: el.querySelectorAll('[data-alg] svg').length, all: document.querySelectorAll('#practiceList [data-alg]').length };
    }, block);
    assert.deepEqual(opened, { cards: set.ids.length, pictures: set.ids.length, all: set.ids.length }, 'opening one set did not draw exactly its cards');
    // Closed and opened again: the same cards, not drawn twice.
    await page.click(`${block} > summary`);
    await page.click(`${block} > summary`);
    await page.evaluate((ms) => window.__p.wait(ms), 100);
    assert.equal(await page.evaluate((sel) => document.querySelector(sel).querySelectorAll('[data-alg]').length, block), set.ids.length);
    assert.equal(await page.evaluate((sel) => document.querySelector(sel).querySelector('[data-alg]').dataset.mark, block), 'first', 'reopening drew the cards again');
    // And a card still opens its algorithm.
    const id = await page.evaluate((sel) => document.querySelector(sel).querySelector('[data-alg]').dataset.alg, block);
    await page.click(`${block} [data-alg="${id}"]`);
    await page.waitForFunction((x) => window.__p.ready(x), id, { timeout: LIVENESS_MS });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---- a card's description (round 2, row 19) ------------------------------------------------------------------

test('a card opened on the screen is described by its own sentence, under an id no other card on the page uses', async () => {
  const { page, context, errors } = await openPractice(fixture, { connect: false });
  try {
    // A set taught by two methods is drawn twice: open BOTH listings, so their cards are on the page together.
    const blocks = await page.evaluate(() => {
      const by = new Map();
      for (const el of document.querySelectorAll('#practiceList details.alg-set')) by.set(el.dataset.set, [...(by.get(el.dataset.set) ?? []), el]);
      const twice = [...by.values()].find((els) => els.length > 1);
      for (const el of twice) el.open = true;
      return { set: twice[0].dataset.set, n: twice.length };
    });
    assert.ok(blocks.n > 1, 'precondition: a set listed twice');
    await page.waitForFunction((id) => [...document.querySelectorAll(`details.alg-set[data-set="${id}"]`)].every((el) => el.querySelector('[data-alg]')), blocks.set, { timeout: LIVENESS_MS });
    const cards = await page.evaluate(() => [...document.querySelectorAll('#practiceList [data-alg]')].map((card) => {
      const id = card.getAttribute('aria-describedby');
      const found = id ? document.querySelectorAll(`[id="${id}"]`) : [];
      return { alg: card.dataset.alg, id, found: found.length, onCard: found.length === 1 && card.contains(found[0]), text: found[0]?.textContent ?? null };
    }));
    const catalogue = await page.evaluate(() => window.__p.rows());
    assert.ok(cards.length >= 2 * catalogue.sets[blocks.set].ids.length, 'precondition: both listings drew their cards');
    for (const c of cards) {
      assert.ok(c.id, `${c.alg}: no description`);
      assert.equal(c.found, 1, `${c.alg}: its description id "${c.id}" names ${c.found} elements`);
      assert.ok(c.onCard, `${c.alg}: its description is not on the card`);
      assert.equal(c.text, catalogue.rows[c.alg].says, `${c.alg}: described by another sentence`);
    }
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

// ---- a record that cannot be read (round 2, rows 18 and 23) -------------------------------------------------

test('a record that cannot be read leaves the history unknown on the page — never "No reps yet"', async () => {
  const { page, context, errors } = await openPractice(fixture, {
    connect: false,
    // Something that is not the record stands under its key: the read refuses it rather than guess.
    prepare: (ctx) => ctx.addInitScript(() => localStorage.setItem('cubusDrillRecord', '{not json')),
  });
  try {
    await show(page, 'sune');
    const got = await page.evaluate(() => ({
      reps: document.querySelector('#practiceReps').textContent.trim(),
      notice: document.querySelector('#practiceRecordSay').hidden ? '' : document.querySelector('#practiceRecordSay').textContent,
      figures: [...document.querySelectorAll('.practice-figures dd')].map((d) => d.textContent),
    }));
    assert.match(got.notice, /could not be read/, 'precondition: the read failed and the page said so');
    assert.doesNotMatch(got.reps, /No reps yet/, 'an unreadable history was said to be empty');
    assert.match(got.reps, /could not be read/);
    assert.deepEqual(got.figures, ['—', '—', '—', '—'], 'a figure was given for a record nobody could read');
    assert.equal(await page.evaluate(() => localStorage.getItem('cubusDrillRecord')), '{not json', 'the unreadable record was written over');
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
