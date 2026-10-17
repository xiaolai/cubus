// The drill engine (`lib/drill/engine.js`) — dev-docs/algorithm-drill-v2-plan.md §3, work items WI-5 to WI-8.
//
// Every case drives the engine with the REPORTS a smart cube would make: one outer-face quarter turn each, in
// the cube's own frame, a half turn as two quarters in either direction, a slice as its two faces in either
// order, a rotation as nothing. The reports are generated through the interpreter and then CHECKED against
// cubejs, which shares no code with it, before any of them is believed (`the reports a cube would make …`).
//
// The assertions are as much about what must NOT happen as what must: no `off` for a slice's first half, a
// half turn's first quarter, a lost turn, or a start-over gesture inside the cue window; no completion before
// the last turn; no time for a one-turn algorithm or a broken stream. The last section re-runs some of these
// checks against MUTANTS of the engine and requires each mutant to fail one, so a check that cannot fail is
// found here rather than in a child's hands.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { applyIdentity, faceTurnsOf, toIdentity } from '../lib/cube-moves.js';
import { parse } from '../lib/cube-notation.js';
import { ORIENTATIONS, orientationPerm } from '../lib/cube-orientation.js';
import { SOLVED, applyAlg, applyMove, toFacelets } from '../lib/cube-pieces.js';
import { algIds, algRow } from '../lib/alg-library.js';
import { candidatesFor, htmOf } from '../lib/drill/candidates.js';
import { CUE_WINDOW_MS, GESTURE_MS, STATUS, createDrillEngine } from '../lib/drill/engine.js';
import { PAUSE_FACTOR, TIME_REFUSAL } from '../lib/drill/timing.js';
import { locate } from '../lib/script-track.js';
import { lcg, randomAlg } from './fixtures/seeded-scrambles.mjs';

const require = createRequire(import.meta.url);
const Cube = require('cubejs');

// EVERY ROW THE LEDGER HOLDS — the drill's whole library (`lib/alg-library.js`), not the sourced tables alone:
// the hand-written teaching sets and the proved fewest-turn tables are drillable too (plan §8, decision 4).
const ALL = await Promise.all((await algIds()).map(async (id) => ({ name: id, alg: (await algRow(id)).alg })));
const byName = (name) => {
  const row = ALL.find((r) => r.name === name);
  assert.ok(row, `no algorithm row ${name}`);
  return row.alg;
};
const QUARTERS = ['U', 'R', 'F', 'D', 'L', 'B'].flatMap((f) => [f, `${f}'`]);
const inverse = (q) => (q.endsWith("'") ? q[0] : `${q}'`);
const holdKey = ([u, f]) => `${u}${f}`;

/** A seeded random arrangement: forty seeded face turns from solved. */
const randomStart = (rnd) => applyAlg(SOLVED, randomAlg(rnd, 40));

// ---- the reports a cube would make ----------------------------------------------------------------------

/**
 * The quarter turns a cube held `hold` reports while a hand executes `alg`: every half turn as two quarters
 * in a direction drawn from `rnd`, every slice's two faces in an order drawn from `rnd`, rotations as nothing.
 */
const reportsFor = (alg, hold, rnd) => reportGroups(alg, hold, rnd).flat();

/** `reportsFor`, one array per token of `alg` — a rotation's is empty. */
function reportGroups(alg, hold, rnd) {
  let now = [...hold];
  return parse(alg).map((move) => {
    const identity = toIdentity(move, now);
    now = applyIdentity(identity, now, SOLVED).hold;
    const names = faceTurnsOf(identity).turns.map((t) => t.name).filter(Boolean);
    const ordered = names.length === 2 && rnd() < 0.5 ? [names[1], names[0]] : names;
    const out = [];
    for (const name of ordered) {
      if (!name.endsWith('2')) { out.push(name); continue; }
      const q = rnd() < 0.5 ? name[0] : `${name[0]}'`;
      out.push(q, q);
    }
    return out;
  });
}

/** cubejs's whole-cube turn that puts identity face `up` on top and `front` in front — found, not typed. */
const ROTATION_FOR = (() => {
  const map = new Map();
  for (const a of ['', 'x', 'x2', "x'", 'z', "z'"]) {
    for (const b of ['', 'y', 'y2', "y'"]) {
      const seq = `${a} ${b}`.trim();
      const s = new Cube();
      if (seq) s.move(seq);
      const f = s.asString();
      map.set(`${f[4]}${f[22]}`, seq);
    }
  }
  assert.equal(map.size, 24);
  return map;
})();

/** `facelets` is `other` turned as a whole — the same cube in some orientation, colours unrenamed. */
const sameUpToRotation = (facelets, other) => ORIENTATIONS.some(([u, f]) => {
  const perm = orientationPerm(u, f);
  return perm.every((from, i) => other[from] === facelets[i]);
});

// ---- a harness: a manual clock, a scheduler on it, and a cube that numbers its turns or not -------------

function harness({ alg, chunks, fixedHold, numbersMoves = true, lossyClear = false, create = createDrillEngine } = {}) {
  let clock = 0;
  let id = 0;
  const timers = new Map();
  const sounds = [];
  const events = [];
  const engine = create({
    alg,
    chunks,
    fixedHold,
    numbersMoves,
    setTimer: (fn, ms) => { id += 1; timers.set(id, { at: clock + ms, fn }); return id; },
    // A lossy scheduler cannot take a timer back — a late callback, which is the shape defect (d) had.
    clearTimer: (handle) => { if (!lossyClear) timers.delete(handle); },
    now: () => clock,
    sound: (name) => sounds.push(name),
    onEvent: (e) => events.push(e),
  });
  const advance = (ms) => {
    const until = clock + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      clock = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
    }
    clock = until;
  };
  let serial = 0;
  /** One report, `gap` ms after the last; `cubeTimestamp` on a clock of its own, offset from the host's. */
  const turn = (notation, { gap = 100, skip = 0, cubeClock = true, stamp } = {}) => {
    advance(gap);
    serial = (serial + 1 + skip) & 0xff;
    engine.report({
      notation,
      timestamp: clock + 37,
      cubeTimestamp: cubeClock ? (stamp ?? 500_000 + clock) : null,
      serial: numbersMoves ? serial : null,
    });
  };
  const count = (name) => sounds.filter((s) => s === name).length;
  const types = () => events.map((e) => e.type);
  return { engine, sounds, events, advance, turn, count, types, timers, get clock() { return clock; } };
}

const startAt = (h, state) => h.engine.start({ facelets: toFacelets(state) });

// ---- the reports are what a cube makes (the oracle under every later case) ------------------------------

test('the reports a cube would make are checked against cubejs, in all 24 holds, slices and rotations included', () => {
  // An oracle the scenario's answer is derived from cannot also score it (AGENTS §6): the generator uses
  // the interpreter, so cubejs — a hand holding the cube that way, then the algorithm — judges it.
  const rnd = lcg(0x5eed01);
  const sample = ['pll-H', 'pll-Ua', 'pll-E', 'pll-Aa', 'pll-Ja', 'f2l-13', 'f2l-15', 'oll-20', 'oll-49',
    'cmll-h-row', 'oll-56'].map(byName);
  for (const alg of sample) {
    for (const hold of ORIENTATIONS) {
      const start = randomStart(rnd);
      const reports = reportsFor(alg, hold, rnd);
      const ours = toFacelets(applyAlg(start, reports.join(' ')));
      const cube = Cube.fromString(toFacelets(start));
      const turn = ROTATION_FOR.get(holdKey(hold));
      if (turn) cube.move(turn);
      cube.move(alg);
      assert.ok(sameUpToRotation(ours, cube.asString()), `${alg} held ${hold}: the reports are not what a hand makes`);
    }
  }
});

// ---- WI-5: any start state, the hold inferred, completion exactly at the last turn ----------------------

/** Feed a whole rep and assert it completes at its last report and not one report sooner. */
function repCompletesExactlyAtLast(h, reports, label) {
  const doneBefore = h.count('done');
  const offBefore = h.count('off');
  reports.forEach((q, i) => {
    h.turn(q);
    const done = h.count('done') - doneBefore;
    if (i < reports.length - 1) assert.equal(done, 0, `${label}: completed at report ${i + 1} of ${reports.length}`);
    else assert.equal(done, 1, `${label}: did not complete at its last report`);
    assert.equal(h.engine.state.pending, false, `${label}: report ${i + 1} (${q}) was not accepted by any hold`);
  });
  assert.equal(h.count('off') - offBefore, 0, `${label}: sounded off on a correct execution`);
}

test('every ledger row completes at exactly its last turn, from a random state, in all 24 holds it may be held in', () => {
  // The founding relation (plan §6): EVERY row, EVERY hold, a fresh random start and fresh slice orders and
  // half-turn directions per rep — and the hold the engine inferred includes the one the reports were made in.
  const rnd = lcg(0xd411);
  let reps = 0;
  for (const row of ALL) {
    for (const hold of ORIENTATIONS) {
      const h = harness({ alg: row.alg });
      startAt(h, randomStart(rnd));
      repCompletesExactlyAtLast(h, reportsFor(row.alg, hold, rnd), `${row.name} held ${hold}`);
      const done = h.events.find((e) => e.type === 'done');
      assert.ok(done.result.holds.some((x) => holdKey(x) === holdKey(hold)), `${row.name}: the inferred holds left out ${hold}`);
      assert.equal(done.result.clean, true, row.name);
      reps += 1;
    }
  }
  assert.ok(ALL.length > 300, `the ledger read ${ALL.length} rows`);
  assert.equal(reps, ALL.length * 24);
});

const FEATURED = [
  'pll-H', 'pll-Ua', 'pll-Ub', 'oll-20', 'f2l-15', 'oll-4', // slices, M2 among them
  'f2l-13', 'pll-E', 'pll-Aa', 'pll-Ja', // rotations, leading and trailing
  'oll-49', 'cmll-h-row', 'f2l-6', // wide turns
];

test('slices, wide turns, rotations and a repeated sequence complete exactly at the last turn in all 24 holds', () => {
  const rnd = lcg(0xfea7);
  const algs = [...FEATURED.map(byName), "R U R' U' R U R' U'"];
  for (const alg of algs) {
    // Each rep draws its own slice orders and half-turn directions, so the 24 holds cover both of each.
    for (const hold of ORIENTATIONS) {
      const h = harness({ alg });
      startAt(h, randomStart(rnd));
      repCompletesExactlyAtLast(h, reportsFor(alg, hold, rnd), `${alg} held ${hold}`);
    }
  }
});

test('the hold: the first turn leaves the holds about its axis, the first turn on a second axis settles it', () => {
  const rnd = lcg(0x401d);
  for (const hold of ORIENTATIONS) {
    const h = harness({ alg: "R U R' U'" });
    startAt(h, randomStart(rnd));
    assert.equal(h.engine.state.holds.length, 24);
    const [first, second] = reportsFor("R U R' U'", hold, rnd);
    h.turn(first);
    assert.equal(h.engine.state.settled, false, `${hold}: one axis cannot settle a hold`);
    assert.equal(h.engine.state.holds.length, 4, `${hold}: the first turn leaves the four holds about its axis`);
    h.turn(second);
    assert.equal(h.engine.state.settled, true, `${hold}: a second axis settles it`);
    assert.deepEqual(h.engine.state.holds.map(holdKey), [holdKey(hold)]);
  }
});

test('the hold is settled only when ONE hold is left — an algorithm on one axis never settles it', () => {
  // `drop-in` is F2: one candidate track, carried by the four holds about the cube's F axis, which no report can
  // tell apart. One track left is not one hold known, and Practice draws the cube in `holds[0]` once settled —
  // an arbitrary one of four (audit-fix 2026-10-18 r2 #5). (M2 is the same in eight holds: half turns have no
  // direction, so turning the slice's axis end over end changes nothing either.)
  for (const [alg, left] of [[byName('drop-in'), 4], ["R L'", 4], ['M2', 8], ['R2 L2', 4]]) {
    const h = harness({ alg });
    startAt(h, SOLVED);
    for (const q of reportsFor(alg, ['U', 'F'], () => 0).slice(0, -1)) {
      h.turn(q);
      assert.equal(h.engine.state.holds.length, left, `${alg}: the holds about one axis were told apart`);
      assert.equal(h.engine.state.settled, false, `${alg}: settled with ${left} holds left`);
    }
  }
});

test('the first turn\'s direction is checked before any hold is known; its face cannot be', () => {
  for (const q of QUARTERS) {
    const h = harness({ alg: "R U R' U'" });
    startAt(h, SOLVED);
    h.turn(q);
    // A clockwise turn of any face is `R` in some hold; an anticlockwise one is `R` in none.
    assert.equal(h.engine.state.pending, q.endsWith("'"), `${q} as the first turn of R U R' U'`);
  }
});

test('a fixed hold judges in that hold only', () => {
  const h = harness({ alg: "R U R' U'", fixedHold: ['U', 'F'] });
  startAt(h, SOLVED);
  h.turn('F'); // R in hold [U, R]-ish holds, never R in [U, F]
  assert.equal(h.engine.state.pending, true);
  const g = harness({ alg: "R U R' U'", fixedHold: ['U', 'F'] });
  startAt(g, SOLVED);
  repCompletesExactlyAtLast(g, ['R', 'U', "R'", "U'"], 'fixed hold');
});

test('near-only tracking: a wrong turn onto an arrangement the algorithm reaches far ahead is not progress there', () => {
  // (R U R' U') six times is the identity, so the arrangement one turn from the end (after the last `U`
  // is undone) is the start turned by `U`. A cube at the start that is turned `U` by mistake is there; the
  // walk's "anywhere, first index" fallback would put it at position 23 and let `U'` complete the rep.
  nearOnlyCheck(createDrillEngine);
});

function nearOnlyCheck(create) {
  const alg = Array(6).fill("R U R' U'").join(' ');
  const h = harness({ alg, fixedHold: ['U', 'F'], create });
  startAt(h, SOLVED);
  // R and back: the rep has begun, so the engine holds the whole track, not just the first turns of it.
  h.turn('R');
  h.turn("R'");
  h.turn('U');
  h.turn("U'");
  assert.equal(h.count('done'), 0, 'four turns completed a 24-turn algorithm');
  assert.equal(h.engine.state.position, 0);
}

test('an undo across a run of regrips is one turn back, and two turns across one are two turns ahead', () => {
  // `R x y U`: R lands at position 1 and is carried through x and y to 3. Undoing R is one turn back to the
  // start, three POSITIONS away but one TURN; counting the regrips as distance called it off the plan and
  // offered R as the way back (audit-fix 2026-10-18 #30).
  for (const fixedHold of [['U', 'F'], null]) {
    const h = harness({ alg: "R x y U", fixedHold });
    startAt(h, SOLVED);
    h.turn('R');
    assert.equal(h.engine.state.position, 3);
    h.turn("R'");
    assert.equal(h.engine.state.pending, false, `${fixedHold}: undoing R across x y was taken for a mistake`);
    h.advance(CUE_WINDOW_MS * 10);
    assert.equal(h.count('off'), 0, `${fixedHold}: undoing R across x y sounded off`);
    assert.equal(h.engine.state.position, 0);
  }
  // `R x x L' U`: R and L' lie on one axis across two regrips, so a hand may make L' first. The second turn
  // lands two TURNS ahead, four positions on — and the track a rep arms with must already reach that far.
  const alg = "R x x L' U";
  const [a, b, ...rest] = reportsFor(alg, ['U', 'F'], () => 0);
  assert.equal(`${a} ${b}`, "R L'");
  const h = harness({ alg, fixedHold: ['U', 'F'] });
  startAt(h, SOLVED);
  h.turn(b);
  h.turn(a, { gap: CUE_WINDOW_MS - 1 });
  h.advance(CUE_WINDOW_MS * 10);
  assert.equal(h.count('off'), 0, 'L\' then R across x x sounded off');
  assert.equal(h.engine.state.position, 4);
  for (const q of rest) h.turn(q);
  assert.equal(h.count('done'), 1);
});

// ---- WI-6: off the plan, back on, lost turns -----------------------------------------------------------

test('every wrong turn at every settled position sounds off once, after the window and not before', () => {
  // The ground truth is written from the algorithm, not read off the matcher: at a position the turns that
  // are NOT mistakes are the next token's faces (either way for a half turn) and the previous token's faces
  // undone. Everything else of the twelve is a wrong turn.
  const algs = ["R U R' U R U2 R'", "R U R' U' R' F R2 U' R' U' R U R' F'", "F R U' R' U' R U R' F'"];
  for (const alg of algs) {
    const tokens = alg.split(' ');
    const reports = reportsFor(alg, ['U', 'F'], () => 0);
    const reportsBefore = (p) => reportsFor(tokens.slice(0, p).join(' '), ['U', 'F'], () => 0).length;
    const facesOf = (token) => (token.endsWith('2') ? [token[0], `${token[0]}'`] : [token]);
    for (let p = 2; p < tokens.length; p++) {
      const fine = new Set([...facesOf(tokens[p]), ...facesOf(tokens[p - 1]).map(inverse)]);
      for (const q of QUARTERS) {
        const h = harness({ alg });
        startAt(h, SOLVED);
        for (const r of reports.slice(0, reportsBefore(p))) h.turn(r);
        h.turn(q);
        const label = `${alg}, position ${p}, ${q}`;
        if (fine.has(q)) {
          h.advance(CUE_WINDOW_MS * 10);
          assert.equal(h.count('off'), 0, `${label}: not a mistake, yet off sounded`);
          continue;
        }
        h.advance(CUE_WINDOW_MS - 1);
        assert.equal(h.count('off'), 0, `${label}: off sounded inside the window`);
        h.advance(1);
        assert.equal(h.count('off'), 1, `${label}: off did not sound when the window closed`);
        assert.equal(h.engine.state.status, STATUS.OFF);
        h.turn(QUARTERS.find((x) => !fine.has(x) && x !== inverse(q) && x[0] !== q[0]) ?? q);
        h.advance(CUE_WINDOW_MS * 10);
        assert.equal(h.count('off'), 1, `${label}: a second wrong turn sounded off again`);
      }
    }
  }
});

test('a slice\'s first face and a half turn\'s first quarter never sound off, whatever arrives inside the window', () => {
  sliceHalfCheck(createDrillEngine);
});

function sliceHalfCheck(create) {
  for (const [alg, reports] of [
    ["M2 U M2 U2 M2 U M2", ['R', 'R', 'L', 'L']],
    ["M2 U M2 U2 M2 U M2", ['L', 'R', 'L', 'R']],
    ["M' U M", ["R'", 'L']],
    ["M' U M", ['L', "R'"]],
    ["R2 U R2", ['R', 'R']],
    ["R2 U R2", ["R'", "R'"]],
  ]) {
    const h = harness({ alg, fixedHold: ['U', 'F'], create });
    startAt(h, SOLVED);
    for (const q of reports) {
      h.turn(q, { gap: CUE_WINDOW_MS - 50 });
      assert.equal(h.engine.state.pending, false, `${alg}: ${reports.join(' ')} — ${q} was taken for a mistake`);
    }
    h.advance(CUE_WINDOW_MS * 10);
    assert.equal(h.count('off'), 0, `${alg}: ${reports.join(' ')} sounded off`);
  }
}

test('two commuting turns made in the other order are silent when the second lands inside the window', () => {
  commutingCheck(createDrillEngine);
});

function commutingCheck(create) {
  const h = harness({ alg: "R L' U", fixedHold: ['U', 'F'], create });
  startAt(h, SOLVED);
  h.turn("L'");
  assert.equal(h.engine.state.pending, true, 'L\' first is not on the algorithm yet');
  h.turn('R', { gap: CUE_WINDOW_MS - 1 });
  h.advance(CUE_WINDOW_MS * 10);
  assert.equal(h.count('off'), 0);
  assert.equal(h.engine.state.position, 2);
}

test('back on the algorithm sounds capture once and the rep goes on to complete', () => {
  const h = harness({ alg: "R U R' U'" });
  startAt(h, SOLVED);
  h.turn('R');
  h.turn('U');
  h.turn('F');
  h.advance(CUE_WINDOW_MS);
  assert.equal(h.engine.state.status, STATUS.OFF);
  assert.deepEqual([...h.engine.state.wayBack.turns], ["F'"]);
  assert.deepEqual(h.engine.state.wayBack.held, ["F'"], 'the way back in the inferred hold\'s letters');
  h.turn("F'");
  assert.equal(h.count('capture'), 1);
  assert.equal(h.engine.state.status, STATUS.RUNNING);
  h.turn("R'");
  h.turn("U'");
  const done = h.events.find((e) => e.type === 'done');
  assert.ok(done);
  assert.equal(done.result.excursions, 1);
  assert.equal(done.result.clean, false);
  assert.equal(done.result.tps, null, 'a rep that left the algorithm has no turn rate');
  assert.notEqual(done.result.ms, null, 'its time is still the time it took');
});

test('the way back is in the letters of the hold the child holds the cube in, and replays onto the track', () => {
  // Held [F, U] — green on top, white in front: the child's `R` is the cube's own `L`.
  const hold = ['F', 'U'];
  const h = harness({ alg: "R U R' U'" });
  startAt(h, SOLVED);
  const [a, b] = reportsFor("R U R' U'", hold, () => 0);
  h.turn(a);
  h.turn(b);
  assert.equal(h.engine.state.settled, true);
  h.turn('D'); // a face the algorithm never turns
  h.advance(CUE_WINDOW_MS);
  const way = h.engine.state.wayBack;
  assert.deepEqual([...way.turns], ["D'"]);
  const replay = toFacelets(applyAlg(applyAlg(SOLVED, `${a} ${b} D`), way.turns.join(' ')));
  assert.equal(replay, toFacelets(applyAlg(SOLVED, `${a} ${b}`)));
  // The cube's own D is, held [F, U], the face at the child's back.
  assert.deepEqual([...way.held], ["B'"]);
});

test('before the hold settles, a way back that differs between holds is given in the cube\'s faces only', () => {
  const h = harness({ alg: "R U R' U'" });
  startAt(h, SOLVED);
  h.turn("R'"); // wrong direction on turn one: every hold refuses it
  h.advance(CUE_WINDOW_MS);
  assert.equal(h.engine.state.status, STATUS.OFF);
  assert.equal(h.engine.state.settled, false);
  // `R2` would finish the first turn in the four holds where the cube's R is the child's R, and be another
  // wrong turn in the other twenty; `R` undoes it in all 24, so `R` is the way back offered.
  assert.deepEqual([...h.engine.state.wayBack.turns], ['R']);
  // Which letter the child calls the cube's R is exactly what is not known yet.
  assert.equal(h.engine.state.wayBack.held, null);
});

test('a lost turn on a cube that numbers its turns is uncertain at once — never off, never a sound', () => {
  const h = harness({ alg: "R U R' U R U2 R'" });
  startAt(h, SOLVED);
  h.turn('R');
  h.turn('U');
  h.turn('U', { skip: 1 }); // the serial jumped: R' was lost
  h.advance(CUE_WINDOW_MS * 10);
  assert.equal(h.engine.state.status, STATUS.UNCERTAIN);
  assert.equal(h.engine.state.about, 'cube');
  for (const q of ['R', 'U2'.slice(0, 1), 'F', 'D']) h.turn(q);
  h.advance(CUE_WINDOW_MS * 10);
  assert.deepEqual(h.sounds, [], 'a lost turn made a sound');
  assert.ok(!h.types().includes('off'));
});

test('on a cube that does not number its turns, the app\'s gap() inside the window takes the cue back', () => {
  const h = harness({ alg: "R U R' U R U2 R'", numbersMoves: false });
  startAt(h, SOLVED);
  h.turn('R');
  h.turn('F'); // what looks wrong may be the turn after a lost one
  h.advance(CUE_WINDOW_MS - 10);
  h.engine.gap();
  h.advance(CUE_WINDOW_MS * 10);
  assert.equal(h.count('off'), 0);
  assert.equal(h.engine.state.status, STATUS.UNCERTAIN);
});

test('an off on a cube that does not number its turns is worded about the cube; on one that does, the turn', () => {
  for (const [numbersMoves, about] of [[false, 'cube'], [true, 'turn']]) {
    const h = harness({ alg: "R U R' U'", numbersMoves });
    startAt(h, SOLVED);
    h.turn('R');
    h.turn('U');
    h.turn('D');
    h.advance(CUE_WINDOW_MS);
    assert.equal(h.engine.state.about, about);
    assert.equal(h.events.find((e) => e.type === 'off').about, about);
    // The self-check proves the loss later: the rep becomes uncertain, and the off is not repeated.
    h.engine.gap();
    assert.equal(h.engine.state.status, STATUS.UNCERTAIN);
    assert.equal(h.count('off'), 1);
  }
});

test('after a lost turn, the reconciled arrangement resumes tracking silently, and the rep\'s time is refused', () => {
  const alg = "R U R' U R U2 R'";
  const h = harness({ alg });
  startAt(h, SOLVED);
  h.turn('R');
  h.turn('U', { skip: 1 }); // a turn the engine never saw: say the child really made U then... it was lost
  assert.equal(h.engine.state.status, STATUS.UNCERTAIN);
  // The app reconciles from a snapshot: the cube really is at R U R' (the lost turn was R').
  h.engine.resync(toFacelets(applyAlg(SOLVED, "R U R'")));
  assert.equal(h.engine.state.position, 3);
  for (const q of ['U', 'R', 'U', 'U', "R'"]) h.turn(q);
  const done = h.events.find((e) => e.type === 'done');
  assert.ok(done, 'the rep could not complete after the stream was mended');
  assert.equal(done.result.ms, null);
  assert.equal(done.result.refused, TIME_REFUSAL.STREAM_GAP);
  assert.deepEqual(h.sounds, ['done'], 'only the completion sounded');
});

test('a rep is done only where the cube IS at the end — a turn away from it after a resync is not done', () => {
  // `R U R' U2`, a lost turn, and the snapshot puts the cube at the end. A `U` then takes it to the midpoint
  // of the last half turn: `locate` keeps the position it had, the last one, but the cube has LEFT the end
  // (audit-fix 2026-10-18 #6).
  const alg = "R U R' U2";
  const h = harness({ alg });
  startAt(h, SOLVED);
  h.engine.gap();
  h.engine.resync(toFacelets(applyAlg(SOLVED, alg)));
  assert.equal(h.count('done'), 0, 'a resync with no turn matched completed the rep');
  h.turn('U');
  assert.equal(h.count('done'), 0, 'a turn away from the end completed the rep');
  assert.equal(h.engine.state.status, STATUS.UNCERTAIN);
  // Back to R U R', then the half turn made again, the other way round (four Us in a row would be the
  // start-over gesture): the cube is at the end, and only now is the rep done.
  h.turn('U');
  assert.equal(h.engine.state.position, 3);
  h.turn("U'");
  assert.equal(h.count('done'), 0, 'the half turn\'s first quarter completed the rep');
  h.turn("U'");
  assert.equal(h.count('done'), 1);
  assert.equal(h.events.find((e) => e.type === 'done').result.refused, TIME_REFUSAL.STREAM_GAP);
});

test('a stop, or a start, forgets the last serial; the next rep, armed by itself, keeps it', () => {
  // A cube away from the app — disconnected, or simply not being drilled — goes on numbering its turns, so
  // the first report after a fresh start is compared with nothing (audit-fix 2026-10-18 #4).
  for (const fresh of [
    (h) => { h.engine.stop(); startAt(h, SOLVED); },
    (h) => startAt(h, SOLVED),
    // A stopped engine re-armed from the screen, with the cube as it is now — no `start` on the way.
    (h) => { h.engine.stop(); h.engine.restart({ facelets: toFacelets(SOLVED) }); },
  ]) {
    const h = harness({ alg: "R U R' U'" });
    startAt(h, SOLVED);
    h.turn('R');
    h.turn('U');
    fresh(h);
    h.turn('R', { skip: 5 });
    assert.equal(h.engine.state.status, STATUS.RUNNING, 'a fresh start compared its first serial with the last session\'s');
    h.turn('U', { skip: 1 });
    assert.equal(h.engine.state.status, STATUS.UNCERTAIN, 'a jump after the first report of a fresh start was missed');
  }
  // The next rep arms itself in the same stream: a turn lost between two reps is still a lost turn.
  const h = harness({ alg: "R U R' U'" });
  startAt(h, SOLVED);
  for (const q of ['R', 'U', "R'", "U'"]) h.turn(q);
  assert.equal(h.events.at(-1).type, 'next');
  h.turn('R', { skip: 1 });
  assert.equal(h.engine.state.status, STATUS.UNCERTAIN, 'a turn lost between two reps went unnoticed');
});

test('an arrangement handed in sets the serial count: to the serial it was reported at, or to none', () => {
  // R serial 1; U, serial 2, never arrives; a snapshot taken at serial 2 shows R U, so the resync completes the
  // rep and the next one arms. R serial 3 is that rep's first turn — the loss is in the snapshot already — yet
  // it was compared with serial 1 and read as another loss (audit-fix 2026-10-18 r2 #3).
  for (const serial of [2, undefined]) {
    const h = harness({ alg: 'R U' });
    startAt(h, SOLVED);
    h.turn('R');
    h.engine.resync(toFacelets(applyAlg(SOLVED, 'R U')), { serial });
    assert.equal(h.count('done'), 1);
    assert.equal(h.events.at(-1).type, 'next');
    h.turn('R', { skip: 1 });
    assert.equal(h.engine.state.status, STATUS.RUNNING, `snapshot serial ${serial}: the turn after a mended loss read as a loss`);
  }
  // Given the snapshot's serial, a turn lost AFTER the snapshot is still caught at the next report.
  const after = harness({ alg: 'R U' });
  startAt(after, SOLVED);
  after.turn('R');
  after.engine.resync(toFacelets(applyAlg(SOLVED, 'R U')), { serial: 2 });
  after.turn('R', { skip: 2 });
  assert.equal(after.engine.state.status, STATUS.UNCERTAIN, 'a turn lost after the snapshot went unnoticed');
  // A restart from a snapshot, and a start, take the same count: serial 7 makes 8 the next turn and 9 a loss.
  for (const [arm, next, status] of [
    ['restart', 6, STATUS.RUNNING], ['restart', 7, STATUS.UNCERTAIN], ['start', 6, STATUS.RUNNING], ['start', 7, STATUS.UNCERTAIN],
  ]) {
    const h = harness({ alg: "R U R' U'" });
    startAt(h, SOLVED);
    h.turn('R');                                       // serial 1
    h.engine[arm]({ facelets: toFacelets(SOLVED), serial: 7 });
    h.turn('R', { skip: next });                       // serial 2 + skip
    assert.equal(h.engine.state.status, status, `${arm} at serial 7, then serial ${2 + next}`);
  }
  // A restart from the engine's own model keeps the count: that model is the reports'.
  const own = harness({ alg: "R U R' U'" });
  startAt(own, SOLVED);
  own.turn('R');
  own.engine.restart();
  own.turn('R', { skip: 1 });
  assert.equal(own.engine.state.status, STATUS.UNCERTAIN, 'a restart from the model forgot the count');
  // A serial that is not one is refused, not taken.
  for (const serial of [256, -1, 1.5, '3']) {
    assert.throws(() => own.engine.resync(toFacelets(SOLVED), { serial }), /serial/, String(serial));
  }
});

test('a gesture after a lost turn is refused until the arrangement is known again', () => {
  const h = harness({ alg: "R U R' U'" });
  startAt(h, SOLVED);
  h.turn('R');
  h.turn('U', { skip: 2 });
  for (let i = 0; i < 4; i++) h.turn('F', { gap: 100 });
  assert.equal(h.engine.state.status, STATUS.UNCERTAIN);
  assert.ok(h.types().includes('refused'));
  assert.equal(h.engine.restart(), false, 'restart with no arrangement after a lost turn');
  assert.equal(h.engine.restart({ facelets: toFacelets(SOLVED) }), true);
  assert.equal(h.engine.state.status, STATUS.ARMED);
});

// ---- WI-7: timing --------------------------------------------------------------------------------------

test('a known feed is timed to the millisecond on the cube\'s clock, first turn to last turn', () => {
  const alg = "R U R' U R U2 R'";
  const h = harness({ alg, chunks: [{ from: 0, to: 4 }, { from: 4, to: 7 }] });
  startAt(h, SOLVED);
  const stamps = [1000, 1180, 1330, 1500, 1640, 1800, 1950, 2500];
  ['R', 'U', "R'", 'U', 'R', 'U', 'U', "R'"].forEach((q, i) => h.turn(q, { stamp: stamps[i] }));
  const { result } = h.events.find((e) => e.type === 'done');
  assert.equal(result.ms, 1500, 'last stamp minus first stamp, and nothing estimated for the first turn');
  assert.equal(result.span, 'first-turn-to-last-turn');
  assert.equal(result.htm, 7);
  // The span holds every turn that ENDS after the first report: six of the seven.
  assert.deepEqual({ ...result.tps }, { value: 6 / 1.5, metric: 'HTM', turns: 6 });
  // Splits: R U R' U (from the first report to the fourth), then R U2 R' (fourth to eighth).
  assert.deepEqual(result.splits.map((s) => ({ ...s })), [{ from: 0, to: 4, ms: 500 }, { from: 4, to: 7, ms: 1000 }]);
  // Gaps 180 150 170 140 160 150 550. The 150 after report 5 is inside U2, between its two quarters, so the
  // usual gap between turns is the median of the other six, 165 — and only 550 is over three times it.
  assert.deepEqual(result.pauses.map((p) => ({ ...p })), [{ afterReport: 6, ms: 550 }]);
  assert.equal(PAUSE_FACTOR, 3);
});

test('two commuting opening turns made in the other order: the span starts at the first of them', () => {
  // oll-19 opens `r' R`: one axis, so a hand may make R first. R alone is on no track and waits in the cue
  // window; the span still starts at it, because it is one of the algorithm's turns, and the turn rate counts
  // the turns the span holds (audit-fix 2026-10-18 #3: the span began at the second report — 1100 ms for
  // 1200 — and the rate was inflated, on a rep marked clean).
  const alg = byName('oll-19');
  const [a, b, ...rest] = reportsFor(alg, ['U', 'F'], () => 0);
  assert.equal(`${a} ${b}`, "L' R", 'oll-19 no longer opens with two turns on one axis');
  const swapped = [b, a, ...rest];
  const h = harness({ alg });
  startAt(h, SOLVED);
  swapped.forEach((q, i) => h.turn(q, { stamp: 1000 + 100 * i }));
  const { result } = h.events.find((e) => e.type === 'done');
  const htm = htmOf(alg);
  assert.equal(result.clean, true);
  assert.equal(result.ms, 100 * (swapped.length - 1), 'the span left out the first turn the hand made');
  assert.deepEqual({ ...result.tps }, { value: (htm - 1) / (result.ms / 1000), metric: 'HTM', turns: htm - 1 });
});

test('a first report that is a quarter of a LATER half turn ends no turn, so every turn is in the span', () => {
  // `R L2 U`, the hand starting on L: that quarter is half of L2, not a turn of its own — the turn counted out
  // of the span must be the one the first report belongs to, wherever it lies.
  const h = harness({ alg: "R L2 U", fixedHold: ['U', 'F'] });
  startAt(h, SOLVED);
  ['L', 'R', 'L', 'U'].forEach((q, i) => h.turn(q, { stamp: 100 * i }));
  const { result } = h.events.find((e) => e.type === 'done');
  assert.equal(result.clean, true);
  assert.equal(result.ms, 300);
  assert.deepEqual({ ...result.tps }, { value: 3 / 0.3, metric: 'HTM', turns: 3 });
});

/** Reports for `alg` held [U, F], stamped: `between` ms before each move's first report, and inside a move
 *  `slice` ms between two faces and `quarter` ms between a half turn's two quarters. */
function pacedReports(alg, { between, slice, quarter }) {
  let t = 1000;
  const out = [];
  for (const group of reportGroups(alg, ['U', 'F'], () => 0)) {
    group.forEach((q, i) => {
      t += i === 0 ? (out.length ? between : 0) : q === out.at(-1).q ? quarter : slice;
      out.push({ q, t });
    });
  }
  return out;
}

test('a pause is measured against the usual gap BETWEEN turns, never the gaps inside one', () => {
  // A real GAN 16 ui stamped both faces of 29 of 75 slices on one millisecond (gan16ui-2026-10-17), so on a
  // slice algorithm most REPORT gaps can be zero and the median of them zero: no gap was ever over three times
  // it, and every pause went unmarked (audit-fix 2026-10-18 #15). The same gaps, a few ms rather than none,
  // made every ordinary gap between turns a "pause". The usual gap is the one between turns.
  const run = (alg, paced) => {
    const h = harness({ alg, fixedHold: ['U', 'F'] });
    startAt(h, SOLVED);
    for (const { q, t } of paced) h.turn(q, { stamp: t });
    return h.events.find((e) => e.type === 'done').result;
  };
  // Slices stamped on one millisecond; one gap between turns of 2 s among gaps of 300 ms.
  const alg = "M E M' E'";
  const paced = pacedReports(alg, { between: 300, slice: 0, quarter: 0 });
  paced.slice(-2).forEach((r) => { r.t += 1700; });
  const gaps = paced.slice(1).map((r, i) => r.t - paced[i].t);
  assert.deepEqual(gaps, [0, 300, 0, 300, 0, 2000, 0], 'the feed is not the one described');
  const marked = run(alg, paced);
  assert.equal(marked.ms, 2600);
  assert.deepEqual(marked.pauses.map((p) => ({ ...p })), [{ afterReport: 5, ms: 2000 }]);
  // An evenly paced H perm, slice faces 0 or 8 ms apart and half-turn quarters 80 ms: NO pause.
  const hPerm = "M2 U M2 U2 M2 U M2";
  for (const slice of [0, 8]) {
    const even = run(hPerm, pacedReports(hPerm, { between: 300, slice, quarter: 80 }));
    assert.notEqual(even.ms, null);
    assert.deepEqual([...even.pauses], [], `an even H perm (slice faces ${slice} ms apart) was marked with pauses`);
  }
  // Two turns of their own made at one instant — `R L'` as two tokens, stamped on one millisecond — leave a
  // zero gap BETWEEN turns. No time passed, so it says nothing about the hand's pace and is not the usual gap.
  const pairs = "R L' U D' R L' U D'";
  const together = reportsFor(pairs, ['U', 'F'], () => 0).map((q, i) => ({ q, t: 1000 + 300 * (i >> 1) }));
  assert.deepEqual([...run(pairs, together).pauses], [], 'turns made together made the usual gap zero');
  // The audit's own feed, `M E` stamped 0 0 1000 1000: its one gap between turns IS the usual gap, and a gap
  // is never a pause against itself.
  const single = run('M E', [0, 0, 1000, 1000].map((t, i) => ({ q: reportsFor('M E', ['U', 'F'], () => 0)[i], t })));
  assert.equal(single.ms, 1000);
  assert.deepEqual([...single.pauses], []);
});

test('a turn taken back before the rep began is not in its span', () => {
  // The other side of the line: a wrong first turn undone puts the cube back where the rep was armed, so the
  // rep's turns begin after the undo. (Anticlockwise, because a clockwise first turn of any face is R in some
  // hold.)
  const h = harness({ alg: "R U R' U'" });
  startAt(h, SOLVED);
  ["F'", 'F', 'R', 'U', "R'", "U'"].forEach((q, i) => h.turn(q, { stamp: 1000 * i }));
  const { result } = h.events.find((e) => e.type === 'done');
  assert.equal(result.ms, 3000, 'the span reached back past the cube standing where the rep was armed');
  assert.equal(result.clean, false, 'two turns beyond the algorithm\'s own were made');
});

test('a first turn that is half of a half turn leaves every turn in the span', () => {
  const h = harness({ alg: "R2 U" });
  startAt(h, SOLVED);
  h.turn('R', { stamp: 0 });
  h.turn('R', { stamp: 100 });
  h.turn('U', { stamp: 300 });
  const { result } = h.events.find((e) => e.type === 'done');
  assert.deepEqual({ ...result.tps }, { value: 2 / 0.3, metric: 'HTM', turns: 2 });
});

test('the refusals: a one-turn algorithm, a missing cube clock, a clock that ran backwards — each with no time', () => {
  for (const alg of ['R', 'R2', "y R y'", 'U2']) {
    const h = harness({ alg });
    startAt(h, SOLVED);
    for (const q of reportsFor(alg, ['U', 'F'], () => 0)) h.turn(q);
    const { result } = h.events.find((e) => e.type === 'done');
    assert.equal(htmOf(alg), 1);
    assert.equal(result.ms, null, `${alg}: a one-turn algorithm was timed`);
    assert.equal(result.tps, null);
    assert.equal(result.refused, TIME_REFUSAL.ONE_TURN, alg);
  }
  const noClock = harness({ alg: "R U R' U'" });
  startAt(noClock, SOLVED);
  ['R', 'U', "R'"].forEach((q) => noClock.turn(q));
  noClock.turn("U'", { cubeClock: false });
  assert.equal(noClock.events.find((e) => e.type === 'done').result.refused, TIME_REFUSAL.NO_CUBE_CLOCK);
  assert.equal(noClock.events.find((e) => e.type === 'done').result.ms, null);
  const reset = harness({ alg: "R U R' U'" });
  startAt(reset, SOLVED);
  [[`R`, 500], ['U', 600], ["R'", 10], ["U'", 120]].forEach(([q, stamp]) => reset.turn(q, { stamp }));
  assert.equal(reset.events.find((e) => e.type === 'done').result.refused, TIME_REFUSAL.CLOCK_RESET);
});

test('the GAN Gen2 decoder still puts host time into a cube timestamp, unmarked — as timing.js says', () => {
  // timing.js says a span can hold an interval the cube never measured and that nothing in a report shows it
  // (audit-fix 2026-10-18 #14). That is a claim about the vendored protocol layer, so it is checked there: the
  // day the bundle stops substituting, or marks what it substitutes, this fails and the paragraph goes.
  const bundle = readFileSync(new URL('../vendor/smartcube.js', import.meta.url), 'utf8');
  const at = bundle.indexOf('var GanGen2ProtocolDriver = class');
  const end = bundle.indexOf('var GanGen3ProtocolDriver = class', at);
  assert.ok(at >= 0 && end > at, 'the bundle no longer holds a GAN Gen2 driver where it did');
  const driver = bundle.slice(at, end);
  assert.match(driver, /if \(elapsed === 0\) \{\s*elapsed = this\.lastMoveTimestamp > 0 \? timestamp - this\.lastMoveTimestamp : 0;/,
    'the Gen2 driver no longer adds host time for a zero interval');
  assert.match(driver, /this\.cubeTimestamp \+= elapsed;/);
  assert.match(driver, /cubeTimestamp: this\.cubeTimestamp,/, 'the Gen2 driver now marks a move whose interval it filled in');
  const timing = readFileSync(new URL('../lib/drill/timing.js', import.meta.url), 'utf8');
  assert.match(timing, /WHAT THIS CANNOT SEE[\s\S]*GanGen2ProtocolDriver/, 'timing.js no longer names what it cannot see');
  // And why the app cannot spot one from outside: a cube delta equal to the host's is no tell, because
  // measured intervals in the Gen2 captures have it too — the count timing.js quotes.
  const dir = new URL('./fixtures/smartcube/', import.meta.url);
  const gen2 = readdirSync(dir).filter((f) => f.includes('_gan-gen2_'));
  let pairs = 0;
  let equal = 0;
  for (const file of gen2) {
    const moves = JSON.parse(readFileSync(new URL(file, dir), 'utf8')).events.map((e) => e.event).filter((e) => e.type === 'MOVE');
    for (let k = 1; k < moves.length; k++) {
      pairs += 1;
      if (moves[k].cubeTimestamp - moves[k - 1].cubeTimestamp === moves[k].timestamp - moves[k - 1].timestamp) equal += 1;
    }
  }
  assert.equal(gen2.length, 3);
  assert.equal(`${equal} of ${pairs}`, '4 of 87');
  assert.match(timing, /4 of the 87 measured\s+\/\/ intervals in the vendored Gen2 captures/);
});

test('a turn taken back inside the window is in the time but not in a turn rate', () => {
  const h = harness({ alg: "R U R' U'" });
  startAt(h, SOLVED);
  // L after R is off in every hold (one axis cannot be two of the algorithm's), and is undone at once.
  for (const q of ['R', 'L', "L'", 'U', "R'", "U'"]) h.turn(q);
  const { result } = h.events.find((e) => e.type === 'done');
  assert.equal(h.count('off'), 0);
  assert.equal(result.extraTurns, 2);
  assert.equal(result.clean, false);
  assert.equal(result.tps, null);
  assert.equal(result.ms, 500);
});

test('reps run on: each next rep arms from where the cube now is, and Sune six times brings it back', () => {
  const alg = "R U R' U R U2 R'";
  const rnd = lcg(0x5e4e);
  const start = randomStart(rnd);
  const h = harness({ alg });
  startAt(h, start);
  const attempts = new Set();
  for (let rep = 0; rep < 6; rep++) {
    attempts.add(h.engine.state.attempt);
    repCompletesExactlyAtLast(h, reportsFor(alg, ['U', 'F'], rnd), `rep ${rep + 1}`);
    assert.equal(h.engine.state.status, STATUS.ARMED);
    assert.equal(h.events.at(-1).type, 'next');
  }
  assert.equal(attempts.size, 6, 'every rep had an attempt of its own');
  assert.equal(h.engine.facelets, toFacelets(start), 'Sune has order 6');
  assert.equal(h.count('done'), 6);
});

// ---- WI-8: start over ----------------------------------------------------------------------------------

test('four identical quarter turns inside the window restart from the same arrangement, with no off', () => {
  for (const at of [0, 2]) {
    const h = harness({ alg: "R U R' U R U2 R'" });
    startAt(h, SOLVED);
    for (const q of ['R', 'U'].slice(0, at)) h.turn(q);
    const before = h.engine.facelets;
    const attempt = h.engine.state.attempt;
    for (let i = 0; i < 4; i++) h.turn('F', { gap: CUE_WINDOW_MS / 4 - 1 });
    h.advance(CUE_WINDOW_MS * 10);
    assert.equal(h.count('off'), 0, `at position ${at}: the gesture sounded off`);
    assert.equal(h.engine.state.status, STATUS.ARMED);
    assert.equal(h.engine.state.attempt, attempt + 1);
    assert.equal(h.engine.facelets, before, 'four turns of one face change nothing');
    assert.equal(h.events.at(-1).type, 'gesture');
    assert.equal(h.events.at(-1).facelets, before);
  }
});

test('a gesture slower than the window still restarts — and the off it sounded on the way stays sounded', () => {
  const h = harness({ alg: "R U R' U'" });
  startAt(h, SOLVED);
  h.turn('R');
  for (let i = 0; i < 4; i++) h.turn('F', { gap: 400 });
  assert.equal(h.count('off'), 1, 'the first F was off the plan for longer than the window: that is the honest record');
  assert.equal(h.engine.state.status, STATUS.ARMED);
  assert.equal(h.events.at(-1).type, 'gesture');
});

test('the gesture is the LATEST four identical turns: a slow one before them does not hide it', () => {
  // One F, five seconds, then four quick Fs. Counting the whole run of Fs reached four at the third quick one,
  // too slow, and never reached four again — no number of further Fs could restart (audit-fix 2026-10-18 #5).
  const h = harness({ alg: "R U R' U'" });
  startAt(h, SOLVED);
  h.turn('R');
  h.turn('F');
  h.advance(5000);
  for (let i = 0; i < 3; i++) h.turn('F', { gap: 100 });
  assert.ok(!h.types().includes('gesture'), 'the slow F counted towards the gesture');
  h.turn('F', { gap: 100 });
  assert.equal(h.types().filter((t) => t === 'gesture').length, 1, 'four quick Fs after a slow one did not restart');
  assert.equal(h.engine.state.status, STATUS.ARMED);
  assert.equal(h.events.at(-1).type, 'gesture');
});

test('four identical turns slower than the gesture limit are not a restart', () => {
  const h = harness({ alg: "R U R' U'" });
  startAt(h, SOLVED);
  h.turn('R');
  for (let i = 0; i < 4; i++) h.turn('F', { gap: GESTURE_MS / 3 + 1 });
  assert.notEqual(h.events.at(-1).type, 'gesture');
  assert.ok(!h.types().includes('gesture'));
});

test('no shipped algorithm makes four identical quarter turns in a row, in any order a cube may report it', () => {
  // Otherwise executing it correctly would restart it. Every ordering of slice faces and every direction of
  // every half turn is tried, so the claim is not about one lucky spelling.
  for (const row of ALL) {
    const tokens = parse(row.alg);
    let worst = 0;
    // The longest run of one quarter turn: walk every choice by depth-first search over report sequences.
    const parts = [];
    let now = ['U', 'F'];
    for (const move of tokens) {
      const identity = toIdentity(move, now);
      now = applyIdentity(identity, now, SOLVED).hold;
      const names = faceTurnsOf(identity).turns.map((t) => t.name).filter(Boolean);
      if (names.length) parts.push(names);
    }
    const options = (names) => {
      const orders = names.length === 2 ? [names, [names[1], names[0]]] : [names];
      return orders.flatMap((order) => order.reduce((acc, name) => {
        const choices = name.endsWith('2') ? [[name[0], name[0]], [`${name[0]}'`, `${name[0]}'`]] : [[name]];
        return acc.flatMap((a) => choices.map((c) => [...a, ...c]));
      }, [[]]));
    };
    const dfs = (i, last, run) => {
      worst = Math.max(worst, run);
      if (i === parts.length || worst >= 4) return;
      for (const seq of options(parts[i])) {
        let l = last;
        let r = run;
        for (const q of seq) { r = q === l ? r + 1 : 1; l = q; worst = Math.max(worst, r); }
        dfs(i + 1, l, r);
      }
    };
    dfs(0, null, 0);
    assert.ok(worst < 4, `${row.name} (${row.alg}) can report four identical turns in a row`);
  }
});

test('restart from the screen works from every state, re-arms from the cube now, and kills the old window', () => {
  const setups = {
    idle: (h) => h,
    armed: (h) => startAt(h, SOLVED),
    running: (h) => { startAt(h, SOLVED); h.turn('R'); },
    'running, window open': (h) => { startAt(h, SOLVED); h.turn('R'); h.turn('L'); },
    off: (h) => { startAt(h, SOLVED); h.turn('R'); h.turn('L'); h.advance(CUE_WINDOW_MS); },
    uncertain: (h) => { startAt(h, SOLVED); h.turn('R'); h.turn('U', { skip: 1 }); },
    'after done': (h) => { startAt(h, SOLVED); for (const q of ['R', 'U', "R'", "U'"]) h.turn(q); },
  };
  for (const [name, setup] of Object.entries(setups)) {
    const h = harness({ alg: "R U R' U'", lossyClear: true });
    setup(h);
    const offsBefore = h.count('off');
    const attempt = h.engine.state.attempt;
    const now = toFacelets(applyAlg(SOLVED, "B L'"));
    assert.equal(h.engine.restart({ facelets: now }), true, name);
    assert.equal(h.engine.state.status, STATUS.ARMED, name);
    assert.equal(h.engine.state.attempt, attempt + 1, `${name}: a restart is a new attempt`);
    assert.equal(h.engine.state.pending, false, name);
    assert.equal(h.engine.facelets, now, `${name}: re-armed from the cube as it is now`);
    // The lossy scheduler fires the old window anyway: it must act on nothing.
    h.advance(CUE_WINDOW_MS * 10);
    assert.equal(h.count('off'), offsBefore, `${name}: a timer from the last attempt sounded in this one`);
    assert.equal(h.engine.state.status, STATUS.ARMED, name);
    // And the new rep runs from there.
    repCompletesExactlyAtLast(h, ['R', 'U', "R'", "U'"], `${name}, then a rep`);
  }
});

test('restart with no arrangement re-arms from the engine\'s own model, and is refused before start', () => {
  const h = harness({ alg: "R U R' U'" });
  assert.throws(() => h.engine.restart(), /start first/);
  startAt(h, SOLVED);
  h.turn('R');
  assert.equal(h.engine.restart(), true);
  assert.equal(h.engine.facelets, toFacelets(applyMove(SOLVED, 'R')));
});

test('every transition: the state table, from each state, for each input', () => {
  const S = STATUS;
  const setups = {
    [S.IDLE]: () => {},
    [S.ARMED]: (h) => startAt(h, SOLVED),
    [S.RUNNING]: (h) => { startAt(h, SOLVED); h.turn('R'); },
    [S.OFF]: (h) => { startAt(h, SOLVED); h.turn('R'); h.turn('L'); h.advance(CUE_WINDOW_MS); },
    [S.UNCERTAIN]: (h) => { startAt(h, SOLVED); h.turn('R'); h.engine.gap(); },
  };
  const inputs = {
    start: (h) => startAt(h, SOLVED),
    'right turn': (h) => h.turn(h.engine.state.status === S.OFF ? "L'" : h.engine.state.position === 1 ? 'U' : 'R'),
    // Wrong in EVERY hold: anticlockwise as a first turn, the far face of the first turn's axis after it.
    'wrong turn': (h) => { h.turn(h.engine.state.status === S.ARMED ? "D'" : 'L'); h.advance(CUE_WINDOW_MS); },
    gap: (h) => h.engine.gap(),
    'last turn': (h) => { for (const q of ['R', 'U', "R'", "U'"].slice(h.engine.state.position ?? 0)) h.turn(q); },
    stop: (h) => h.engine.stop(),
  };
  // What each state becomes. `done` is never a resting state: the next rep is armed in the same report.
  const expected = {
    [S.IDLE]: { start: S.ARMED, 'right turn': S.IDLE, 'wrong turn': S.IDLE, gap: S.IDLE, 'last turn': S.IDLE, stop: S.IDLE },
    [S.ARMED]: { start: S.ARMED, 'right turn': S.RUNNING, 'wrong turn': S.OFF, gap: S.UNCERTAIN, 'last turn': S.ARMED, stop: S.IDLE },
    [S.RUNNING]: { start: S.ARMED, 'right turn': S.RUNNING, 'wrong turn': S.OFF, gap: S.UNCERTAIN, 'last turn': S.ARMED, stop: S.IDLE },
    [S.OFF]: { start: S.ARMED, 'right turn': S.RUNNING, 'wrong turn': S.OFF, gap: S.UNCERTAIN, 'last turn': S.OFF, stop: S.IDLE },
    [S.UNCERTAIN]: { start: S.ARMED, 'right turn': S.UNCERTAIN, 'wrong turn': S.UNCERTAIN, gap: S.UNCERTAIN, 'last turn': S.UNCERTAIN, stop: S.IDLE },
  };
  for (const [from, setup] of Object.entries(setups)) {
    for (const [input, act] of Object.entries(inputs)) {
      const h = harness({ alg: "R U R' U'" });
      setup(h);
      assert.equal(h.engine.state.status, from, `setup for ${from}`);
      const sounds = h.sounds.length;
      act(h);
      assert.equal(h.engine.state.status, expected[from][input], `${from} + ${input}`);
      const heard = h.sounds.slice(sounds);
      // The sounds each transition may make, and no others.
      if (from === S.UNCERTAIN || input === 'gap' || input === 'stop' || input === 'start') {
        assert.deepEqual(heard, [], `${from} + ${input} made a sound`);
      }
      if (from === S.OFF && input === 'wrong turn') assert.deepEqual(heard, [], 'off twice in one excursion');
      if (from === S.OFF && input === 'right turn') assert.deepEqual(heard, ['capture']);
      if ((from === S.ARMED || from === S.RUNNING) && input === 'last turn') assert.deepEqual(heard, ['done']);
    }
  }
});

test('every event names its attempt, and a stopped engine\'s late window acts on nothing', () => {
  const h = harness({ alg: "R U R' U'", lossyClear: true });
  startAt(h, SOLVED);
  h.turn('R');
  h.turn('L');
  assert.equal(h.engine.state.pending, true);
  h.engine.stop();
  h.advance(CUE_WINDOW_MS * 10);
  assert.equal(h.count('off'), 0);
  assert.ok(h.events.every((e) => Number.isInteger(e.attempt)));
});

test('a timer that outlives its attempt does nothing to the next one (defect (d) of the first Drill)', () => {
  staleTimerCheck(createDrillEngine);
});

function staleTimerCheck(create) {
  const h = harness({ alg: "R U R' U'", lossyClear: true, create });
  startAt(h, SOLVED);
  h.turn('R');
  h.turn('L', { gap: 10 });       // the window opens on attempt 1
  assert.equal(h.engine.state.pending, true);
  h.engine.restart({ facelets: h.engine.facelets });
  h.advance(CUE_WINDOW_MS * 10);  // a scheduler that could not take it back fires it
  assert.equal(h.count('off'), 0, 'attempt 1\'s window sounded in attempt 2');
  assert.equal(h.engine.state.status, STATUS.ARMED);
}

function completesCheck(create) {
  const h = harness({ alg: "R U R' U R U2 R'", create });
  startAt(h, SOLVED);
  repCompletesExactlyAtLast(h, ['R', 'U', "R'", 'U', 'R', 'U', 'U', "R'"], 'Sune');
}

function settlesCheck(create) {
  const h = harness({ alg: "R U R' U'", create });
  startAt(h, SOLVED);
  h.turn('R');
  h.turn('U');
  assert.equal(h.engine.state.settled, true, 'two axes did not settle the hold');
}

test('a report that is not one quarter turn of an outer face is refused loudly', () => {
  const h = harness({ alg: "R U R' U'" });
  startAt(h, SOLVED);
  for (const notation of ['R2', 'M', 'x', '', undefined, "R'2"]) {
    assert.throws(() => h.engine.report({ notation, timestamp: 0, cubeTimestamp: 0, serial: null }), /quarter turn/);
  }
  assert.throws(() => createDrillEngine({ alg: 'y x', setTimer() {}, clearTimer() {}, now: () => 0 }), /turns no face/);
  assert.throws(() => createDrillEngine({ alg: 'R', setTimer() {}, clearTimer() {} }), /injected/);
  assert.throws(() => createDrillEngine({ alg: 'R U', chunks: [{ from: 1, to: 3 }], setTimer() {}, clearTimer() {}, now: () => 0 }), /chunk/);
});

test('the window and the gesture limit say what measured them, and where the measurement is held', () => {
  // They shipped as PROVISIONAL AND UNMEASURED until the hardware session (WI-14) recorded a real cube; now
  // each must name its measurement and the replay test that holds it to the recording.
  const src = readFileSync(new URL('../lib/drill/engine.js', import.meta.url), 'utf8');
  assert.equal(CUE_WINDOW_MS, 300);
  for (const name of ['CUE_WINDOW_MS', 'GESTURE_MS']) {
    const at = src.indexOf(`export const ${name}`);
    const doc = src.slice(src.lastIndexOf('/**', at), at);
    assert.match(doc, /MEASURED 2026-10-17/, `${name} must say what measured it`);
    assert.match(doc, /drill-hardware-replay\.test\.mjs/, `${name} must name the test that holds it to the recording`);
  }
});

// ---- the checks fail on a broken engine ----------------------------------------------------------------

/** A mutant of the engine: its source with `from` replaced by `to`, imported from a scratch directory. */
async function mutant(from, to) {
  const lib = new URL('../lib/', import.meta.url);
  const src = readFileSync(new URL('drill/engine.js', lib), 'utf8');
  assert.ok(src.includes(from), `the mutation target is gone from the engine: ${from}`);
  const mutated = src.replaceAll(from, to)
    .replaceAll("from '../", `from '${lib.href}`)
    .replaceAll("from './", `from '${new URL('drill/', lib).href}`);
  const dir = mkdtempSync(join(tmpdir(), 'drill-mutant-'));
  const file = join(dir, 'engine.js');
  writeFileSync(file, mutated);
  return (await import(pathToFileURL(file).href)).createDrillEngine;
}

test('a broken engine fails these checks: each mutant is caught by the check written for it', async () => {
  const cases = [
    ['the walk\'s "anywhere" fallback', "{ near: true }", '{ near: false }', nearOnlyCheck],
    ['candidates never dropped',
      "const accepted = live.flatMap((e, i) => (results[i].kind === 'off' ? [] : [{ e, r: results[i] }]));",
      "const accepted = results.some((r) => r.kind !== 'off') ? live.map((e, i) => ({ e, r: results[i].kind === 'off' ? { kind: 'step', idx: e.idx } : results[i] })) : [];",
      settlesCheck],
    ['no cue window', 'pending = { token, handle: setTimer(() => cueOff(mine, token), CUE_WINDOW_MS) };',
      'pending = { token, handle: null }; cueOff(mine, token);', commutingCheck],
    ['survivors never given their whole track', 'if (progress) wholeTracks(logIdx);', '', completesCheck],
    ['no attempt guard on the window', 'if (mine !== attempt || !pending || pending.token !== token) return;',
      'if (false) return;', staleTimerCheck],
  ];
  for (const [what, from, to, check] of cases) {
    check(createDrillEngine); // the real engine passes
    const broken = await mutant(from, to);
    assert.throws(() => check(broken), assert.AssertionError, `${what}: the mutant passed its check`);
  }
});

test('locate keeps its fallback for the walk, and drops it only when asked', () => {
  // The option is additive: existing callers (the cube screen's walk) see no change.
  const alg = Array(6).fill("R U R' U'").join(' ');
  const [c] = candidatesFor(alg, SOLVED, { fixedHold: ['U', 'F'] });
  const f = toFacelets(applyMove(SOLVED, 'U'));
  assert.deepEqual(locate(c.track, f, 0), { kind: 'step', idx: 23 });
  assert.deepEqual(locate(c.track, f, 0, { near: true }), { kind: 'off' });
});
