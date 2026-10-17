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
import { CUE_WINDOW_MS, GESTURE_MS, GESTURE_TURNS, STATUS, createDrillEngine } from '../lib/drill/engine.js';
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

test('turns on a second axis settle the hold — unless every turn reads alike in more than one hold', () => {
  // H perm turns two axes and never settles: an M2 names an axis and not a side, and a U turn reads the same
  // held either way round, so [U, F] and [U, B] read every report alike to the end (audit-fix 2026-10-18 r3 #5).
  const hPerm = byName('pll-H');
  const h = harness({ alg: hPerm });
  startAt(h, SOLVED);
  const reports = reportsFor(hPerm, ['U', 'F'], () => 0);
  for (const q of reports.slice(0, 5)) h.turn(q);              // M2 U: the first turn on a second axis
  assert.deepEqual(h.engine.state.holds.map(holdKey).sort(), ['UB', 'UF']);
  for (const q of reports.slice(5, -1)) h.turn(q);
  assert.deepEqual(h.engine.state.holds.map(holdKey).sort(), ['UB', 'UF']);
  assert.equal(h.engine.state.settled, false, 'H perm settled a hold no report can tell');
  // The relation, for every ledger row: a rep leaves exactly the holds that read every one of its turns alike —
  // found here by comparing the reports each hold would make, never by asking the engine.
  const readsAs = (alg, hold) => {
    let now = [...hold];
    return parse(alg).map((move) => {
      const identity = toIdentity(move, now);
      now = applyIdentity(identity, now, SOLVED).hold;
      return reportWays(identity).map((w) => w.join(' ')).sort().join('|');
    }).join(' / ');
  };
  let symmetric = 0;
  for (const row of ALL) {
    const own = readsAs(row.alg, ['U', 'F']);
    const alike = ORIENTATIONS.filter((o) => readsAs(row.alg, o) === own).map(holdKey).sort();
    if (alike.length > 1) symmetric += 1;
    const g = harness({ alg: row.alg });
    startAt(g, SOLVED);
    for (const q of reportsFor(row.alg, ['U', 'F'], () => 0)) g.turn(q);
    const { result } = g.events.find((e) => e.type === 'done');
    assert.deepEqual(result.holds.map(holdKey).sort(), alike, `${row.name}: the holds left are not the holds that read it alike`);
  }
  assert.ok(symmetric >= 2, `only ${symmetric} ledger rows read alike in two holds: the relation checks little`);
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

test('a resync after an unnoticed lost turn looks again at the holds the false reports ruled out', () => {
  // `R U R' U'` on a cube that does not number its turns: R's report never arrives, U's does, and U as a first
  // turn is R in the holds where the cube's U is the child's R — so the hold the child really holds was ruled
  // out by a report that was not the turn it seemed. The snapshot shows R U, on no track still standing, and
  // the rep could never finish (audit-fix 2026-10-18 r3 #3).
  const h = harness({ alg: "R U R' U'", numbersMoves: false });
  startAt(h, SOLVED);
  h.turn('U');
  assert.ok(!h.engine.state.holds.some((x) => holdKey(x) === 'UF'), 'precondition: U as a first turn rules out [U, F]');
  h.engine.resync(toFacelets(applyAlg(SOLVED, 'R U')));
  assert.equal(h.engine.state.status, STATUS.UNCERTAIN);
  assert.ok(h.engine.state.holds.some((x) => holdKey(x) === 'UF'), 'the hold the child holds was not looked at again');
  assert.equal(h.engine.state.position, 2);
  h.turn("R'");
  h.turn("U'");
  const done = h.events.find((e) => e.type === 'done');
  assert.ok(done, 'the rep could not finish after the snapshot');
  assert.equal(done.result.refused, TIME_REFUSAL.STREAM_GAP);
  assert.ok(done.result.holds.some((x) => holdKey(x) === 'UF'));
  // A hold the reports settled is not kept for that: the holds after a resync are exactly the holds whose track
  // places the snapshot. Back where the rep began, that is every hold, at the start.
  const again = harness({ alg: "R U R' U'" });
  startAt(again, SOLVED);
  again.turn('R');
  again.turn('U');
  assert.deepEqual(again.engine.state.holds.map(holdKey), ['UF']);
  again.engine.gap();
  again.engine.resync(toFacelets(SOLVED));
  const placers = placersOf(trackArrangements("R U R' U'", SOLVED, lcg(0x5e7)), toFacelets(SOLVED));
  assert.equal(placers.length, 24, 'precondition: every hold places the arrangement the rep began in');
  assert.deepEqual(again.engine.state.holds.map(holdKey).sort(), placers, 'the holds are not the holds that place the snapshot');
  assert.equal(again.engine.state.position, 0);
});

/**
 * Each hold's arrangement at every position of `alg` from `start`, by cubejs — a hand holding the cube that way,
 * making the reports a cube makes, token by token — never the engine's own tracks. Keyed by `holdKey`.
 */
function trackArrangements(alg, start, rnd) {
  return new Map(ORIENTATIONS.map((hold) => {
    const cube = Cube.fromString(toFacelets(start));
    const at = [cube.asString()];
    for (const group of reportGroups(alg, hold, rnd)) {
      if (group.length) cube.move(group.join(' '));
      at.push(cube.asString());
    }
    return [holdKey(hold), at];
  }));
}

/** The holds whose track places the arrangement `f`, as sorted keys. */
const placersOf = (tracks, f) => [...tracks].flatMap(([key, at]) => (at.includes(f) ? [key] : [])).sort();

test('after a resync the holds are exactly those that place the snapshot, and it ends the rep only if all are at their end', () => {
  // The snapshot is the cube (audit-fix 2026-10-18 r3 #3, Codex's verify): a hold whose track holds it is not ruled
  // out by it, whatever the reports said, and a hold standing whose track does not hold it is. Two ways in: the
  // first report lost on a cube that does not number its turns, so every later report was judged against an
  // arrangement the cube was not in; and a hold settled by reports that were the turns, then a gap the app proved.
  const rnd = lcg(0x2e5c);
  const reached = { ended: 0, several: 0, back: 0 };
  for (const alg of [byName('course-corner-twist-back'), "R U R' U'", byName('pll-H'), byName('f2l-13')]) {
    const start = randomStart(rnd);
    const tracks = trackArrangements(alg, start, rnd);
    // Where a track's arrangement repeats only inside a run of regrips, "at its end" is the last run, exactly.
    const endRun = (at) => { let j = at.length - 1; while (j > 0 && at[j - 1] === at.at(-1)) j -= 1; return j; };
    for (const [key, at] of tracks) {
      at.forEach((f, i) => assert.ok(at.indexOf(f) === i || at[i - 1] === f, `precondition: ${alg} held ${key} passes ${i} twice`));
    }
    for (const hold of [['U', 'F'], ORIENTATIONS[Math.floor(rnd() * ORIENTATIONS.length)]]) {
      const groups = reportGroups(alg, hold, rnd);
      const own = tracks.get(holdKey(hold));
      for (let k = 1; k < own.length; k++) {
        const snapshot = own[k];
        const placers = placersOf(tracks, snapshot);
        const allAtEnd = placers.every((p) => tracks.get(p).indexOf(snapshot) >= endRun(tracks.get(p)));
        for (const way of ['the first report lost', 'settled, then a gap']) {
          const label = `${alg} held ${hold}, ${way}, the snapshot at ${k}`;
          const h = harness({ alg, numbersMoves: way !== 'the first report lost' });
          startAt(h, start);
          if (way === 'the first report lost') {
            for (const q of groups.slice(0, k).flat().slice(1)) h.turn(q);
          } else {
            for (const q of groups.slice(0, Math.min(2, k)).flat()) h.turn(q);
            h.engine.gap();
          }
          assert.equal(h.count('done'), 0, `precondition, ${label}: the rep was done before the snapshot`);
          const before = h.engine.state.holds.map(holdKey);
          h.engine.resync(snapshot);
          if (h.count('done')) {
            assert.ok(allAtEnd, `${label}: done while a hold places the cube part way`);
            reached.ended += 1;
            continue;
          }
          assert.deepEqual(h.engine.state.holds.map(holdKey).sort(), placers, `${label}: the holds are not the holds that place it`);
          if (placers.length > 1) reached.several += 1;
          if (placers.some((p) => !before.includes(p))) reached.back += 1;
          // Settled, a turn of the algorithm was matched; every hold at its end is then a rep that is done.
          assert.ok(!allAtEnd || way === 'the first report lost', `${label}: every hold has the cube at its end, and the rep is not done`);
        }
      }
    }
  }
  // A sweep that reached none of these would pass having checked nothing.
  assert.ok(reached.ended > 0, 'no snapshot ended a rep');
  assert.ok(reached.several > 0, 'no snapshot was placed by more than one hold');
  assert.ok(reached.back > 0, 'no hold the reports had ruled out came back');
  // A snapshot no hold places: the cube is off the algorithm, and the holds stand where they were.
  const h = harness({ alg: "R U R' U'" });
  startAt(h, SOLVED);
  h.turn('R');
  h.turn('U');
  h.engine.gap();
  const off = toFacelets(applyAlg(SOLVED, 'R U F'));
  assert.deepEqual(placersOf(trackArrangements("R U R' U'", SOLVED, lcg(1)), off), [], 'precondition: no hold places it');
  h.engine.resync(off);
  assert.deepEqual(h.engine.state.holds.map(holdKey), ['UF']);
  assert.equal(h.engine.state.position, 2);
  assert.equal(h.engine.state.status, STATUS.UNCERTAIN);
});

test('a hold that places the snapshot by chance decides nothing: course-corner-twist-back with its first report lost', () => {
  // `R' D' R D` four times. Its inverse, `D' R' D R`, is the same algorithm held [L, B] — the child's R is the cube's
  // D, the child's D the cube's R — and the commutator has order six, so a cube held [U, F] is at the END of [L, B]'s
  // track after turn 8 and at its turn 15 after turn 9; held [L, B], the same of [U, F]. With the first report lost,
  // the hold the child holds is ruled out by turns it never made. The snapshot after turn 9 was placed on the mirror
  // alone, which reads the child's last seven turns as turns taken back, so the rep never finished; after turn 8 it
  // put the mirror at its end, and done sounded half way (audit-fix 2026-10-18 r3 #3, found by Codex's verify).
  const alg = byName('course-corner-twist-back');
  assert.equal(alg, Array(4).fill("R' D' R D").join(' '));
  const rnd = lcg(0x7b1c);
  for (const [hold, mirror] of [[['U', 'F'], ['L', 'B']], [['L', 'B'], ['U', 'F']]]) {
    for (const turn of [8, 9]) {
      const label = `held ${hold}, the snapshot after turn ${turn}`;
      const h = harness({ alg, numbersMoves: false });
      const start = randomStart(rnd);
      startAt(h, start);
      const reports = reportsFor(alg, hold, rnd);
      for (const q of reports.slice(1, turn)) h.turn(q);
      assert.ok(!h.engine.state.holds.some((x) => holdKey(x) === holdKey(hold)), `precondition, ${label}: the hold the child holds is out`);
      const snapshot = toFacelets(applyAlg(start, reports.slice(0, turn).join(' ')));
      const theirs = trackArrangements(alg, start, rnd).get(holdKey(mirror));
      assert.equal(theirs.indexOf(snapshot), turn === 8 ? 16 : 15, `precondition, ${label}: the mirror places the cube`);
      h.engine.resync(snapshot);
      assert.equal(h.count('done'), 0, `${label}: done sounded half way, on the mirror's reading`);
      assert.ok(h.engine.state.holds.some((x) => holdKey(x) === holdKey(hold)), `${label}: the hold the child holds was not looked at again`);
      assert.equal(h.engine.state.position, turn, `${label}: the rep resumed on a reading other than the nearest`);
      reports.slice(turn).forEach((q, i) => {
        h.turn(q);
        assert.equal(h.count('done'), i === reports.length - turn - 1 ? 1 : 0, `${label}: done after turn ${turn + i + 1}`);
      });
      const done = h.events.find((e) => e.type === 'done');
      assert.equal(done.result.refused, TIME_REFUSAL.STREAM_GAP);
      assert.deepEqual(done.result.holds.map(holdKey), [holdKey(hold)]);
    }
  }
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

test('a start or restart that is refused changes nothing — the cue window, the attempt and the serial count stand', () => {
  // A malformed arrangement threw only after the cue window had been closed, the attempt counted and the serial
  // count set: a refused restart at serial 50 left the next turn, serial 3, reading as a lost one (audit-fix
  // 2026-10-18 r3 #4).
  for (const [what, call] of [
    ['restart, not a cube', (e) => e.restart({ facelets: 'not a cube', serial: 50 })],
    ['start, not a cube', (e) => e.start({ facelets: 'not a cube', serial: 50 })],
    ['restart, not a serial', (e) => e.restart({ facelets: toFacelets(SOLVED), serial: 300 })],
    ['start, not a serial', (e) => e.start({ facelets: toFacelets(SOLVED), serial: 'x' })],
  ]) {
    const h = harness({ alg: "R U R' U'" });
    startAt(h, SOLVED);
    h.turn('R');
    h.turn('L', { gap: 10 });                      // off every hold's plan: the cue window opens
    const { attempt } = h.engine.state;
    const facelets = h.engine.facelets;
    assert.throws(() => call(h.engine), what);
    assert.equal(h.engine.state.attempt, attempt, `${what}: a refused call counted an attempt`);
    assert.equal(h.engine.state.pending, true, `${what}: a refused call closed the cue window`);
    assert.equal(h.engine.facelets, facelets, what);
    h.advance(CUE_WINDOW_MS);
    assert.equal(h.count('off'), 1, `${what}: the cue the refused call took away never sounded`);
    h.turn("L'");                                  // serial 3, the next one
    assert.notEqual(h.engine.state.status, STATUS.UNCERTAIN, `${what}: a refused call moved the serial count`);
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

/** The bundle's text from the line starting `head` to the first line after it that is exactly `close`. */
function lift(bundle, head, close) {
  const lines = bundle.split('\n');
  const i = lines.findIndex((l) => l.startsWith(head));
  assert.ok(i >= 0, `the bundle no longer has ${head.trim()}`);
  const j = lines.findIndex((l, k) => k > i && l === close);
  return lines.slice(i, j + 1).join('\n');
}

test('two vendored drivers put host time into a cube timestamp, unmarked — and the drill refuses only what is marked', async () => {
  // timing.js says a span can hold an interval the cube never measured, from GAN Gen2's and MoYu32's drivers,
  // and that nothing in a report shows it (audit-fix 2026-10-18 #14, r2 #11, r3 #14). Each driver's own code is
  // taken from the bundle and run on hand-made move packets: R U R' U', the cube measuring every interval but
  // one. What the drill never reads — the cube's arrangement — is stubbed; the clocks are the bundle's.
  const bundle = readFileSync(new URL('../vendor/smartcube.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'drill-drivers-'));
  const load = async (name, lines) => {
    writeFileSync(join(dir, name), lines.join('\n'));
    return import(pathToFileURL(join(dir, name)).href);
  };
  const { GanGen2ProtocolDriver, setNow } = await load('gen2.mjs', [
    'let NOW = 0;', 'export const setNow = (t) => { NOW = t; };', 'const now = () => NOW;',
    lift(bundle, 'var GanBitReader = class', '};'),
    lift(bundle, 'function moveNotation(', '}'),
    lift(bundle, 'var GanGen2ProtocolDriver = class', '};'),
    'export { GanGen2ProtocolDriver };',
  ]);
  const { moyu } = await load('moyu32.mjs', [
    'const CubieCube = { CubeMult() {}, moveCube: [] };',
    'const moveDirectionFromNotation = (n) => (n.endsWith("\'") ? 1 : 0);',
    'export const moyu = (emit) => ({',
    "  prevMoveCnt: 0, deviceTime: 0, deviceTimeOffset: 0, prevCubie: { toFaceCube: () => '' }, curCubie: { toFaceCube: () => '' },",
    '  bus: { emit }, sendSimpleRequest: async () => {},',
    lift(bundle, '  handleMoves(bits, timestamp) {', '  }'),
    '});',
  ]);
  /** A packet's bits, `fields` as `[offset, length, value]`, most significant bit first. */
  const bitsOf = (length, fields) => {
    const bits = Array(length).fill(0);
    for (const [off, len, v] of fields) for (let k = 0; k < len; k++) bits[off + k] = (v >> (len - 1 - k)) & 1;
    return bits;
  };
  const MOVES = ['R', 'U', "R'", "U'"];

  // GAN Gen2: intervals 100, 150, 0, 200 ms, the zero arriving 5000 ms after the packet before it.
  const gen2 = [];
  const d = new GanGen2ProtocolDriver();
  d.lastSerial = 0;                                        // as after the first facelets event
  const GAN = { R: [1, 0], U: [0, 0], "R'": [1, 1], "U'": [0, 1] };
  for (const [k, [host, elapsed]] of [[1000, 100], [1150, 150], [6150, 0], [6350, 200]].entries()) {
    setNow(host);
    const [face, dir] = GAN[MOVES[k]];
    const bits = bitsOf(160, [[0, 4, 2], [4, 8, k + 1], [12, 4, face], [16, 1, dir], [47, 16, elapsed]]);
    const bytes = Uint8Array.from({ length: 20 }, (_, b) => bits.slice(8 * b, 8 * b + 8).reduce((a, x) => (a << 1) | x, 0));
    gen2.push(...(await d.handleStateEvent(null, bytes)).filter((e) => e.type === 'MOVE'));
  }
  // MoYu32: every interval 100 ms, the third packet arriving 5000 ms late, as after a radio stall.
  const moyu32 = [];
  const m = moyu((e) => { if (e.type === 'MOVE') moyu32.push(e); });
  const MOYU = { R: 10, U: 4, "R'": 11, "U'": 5 };         // "FBUDLR".charAt(code >> 1) + " '".charAt(code & 1)
  for (const [k, host] of [10000, 10100, 15200, 15300].entries()) {
    m.handleMoves(bitsOf(160, [[8, 16, 100], [88, 8, k + 1], [96, 5, MOYU[MOVES[k]]]]).join(''), host);
  }

  for (const [name, events, measured, filled] of [['GAN Gen2', gen2, 0, 5000], ['MoYu32', moyu32, 100, 5100]]) {
    assert.deepEqual(events.map((e) => e.move), MOVES, `${name}: the driver did not report the moves it was given`);
    // THE LIMIT. The cube measured `measured` ms before the third move; its stamp says `filled`, and nothing
    // marks it. The day this fails because the stamp is null, the fork's fix has landed: delete timing.js's
    // paragraph, and let the relation below assert the refusal.
    assert.equal(events[2].cubeTimestamp - events[1].cubeTimestamp, filled,
      `${name}: the driver no longer puts host time unmarked into the cube's ${measured} ms`);
    // THE RELATION, true before the fix and after it: a rep is refused exactly when a stamp is missing, and
    // otherwise timed from its stamps — the drill can do no better than what it is given.
    const h = harness({ alg: "R U R' U'" });
    startAt(h, SOLVED);
    for (const e of events) h.turn(e.move, e.cubeTimestamp === null ? { cubeClock: false } : { stamp: e.cubeTimestamp });
    const { result } = h.events.find((e) => e.type === 'done');
    const marked = events.some((e) => e.cubeTimestamp === null);
    assert.equal(result.refused, marked ? TIME_REFUSAL.NO_CUBE_CLOCK : null, name);
    if (!marked) assert.equal(result.ms, events.at(-1).cubeTimestamp - events[0].cubeTimestamp, name);
  }

  // timing.js names both, and the measurement it quotes for why no report can show it: a cube delta equal to the
  // host's is no tell, because measured intervals in the Gen2 captures have it too.
  const prose = readFileSync(new URL('../lib/drill/timing.js', import.meta.url), 'utf8').replace(/\n\/\/ */g, ' ');
  assert.match(prose, /WHAT THIS CANNOT SEE.*GanGen2ProtocolDriver.*Moyu32Connection/, 'timing.js no longer names what it cannot see');
  const captures = new URL('./fixtures/smartcube/', import.meta.url);
  const files = readdirSync(captures).filter((f) => f.includes('_gan-gen2_'));
  let pairs = 0;
  let equal = 0;
  for (const file of files) {
    const moves = JSON.parse(readFileSync(new URL(file, captures), 'utf8')).events.map((e) => e.event).filter((e) => e.type === 'MOVE');
    for (let k = 1; k < moves.length; k++) {
      pairs += 1;
      if (moves[k].cubeTimestamp - moves[k - 1].cubeTimestamp === moves[k].timestamp - moves[k - 1].timestamp) equal += 1;
    }
  }
  assert.equal(files.length, 3);
  assert.equal(`${equal} of ${pairs}`, '4 of 87');
  assert.match(prose, /4 of the 87 measured intervals in the vendored Gen2 captures/);
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

test('a gesture made across the end of a rep still starts over', () => {
  // Sune one turn from its end, and four quick R'. The first finishes the rep, and the next rep armed with it
  // used to forget it, so the other three left that rep running at position 1 (audit-fix 2026-10-18 r2 #4).
  const alg = "R U R' U R U2 R'";
  const h = harness({ alg });
  startAt(h, SOLVED);
  for (const q of ['R', 'U', "R'", 'U', 'R', 'U', 'U']) h.turn(q);
  const before = h.engine.facelets;
  for (let i = 0; i < 4; i++) h.turn("R'", { gap: 100 });
  assert.equal(h.count('done'), 1, 'the first R\' did not finish the rep');
  assert.equal(h.events.at(-1).type, 'gesture', 'four quick R\' across the end of a rep did not start over');
  assert.equal(h.engine.state.status, STATUS.ARMED);
  assert.equal(h.engine.facelets, before, 'four turns of one face change nothing');
});

/** Every way a cube may report one identity-frame move: a slice's faces in either order, a half turn either way. */
function reportWays(identity) {
  const names = faceTurnsOf(identity).turns.map((t) => t.name).filter(Boolean);
  const orders = names.length === 2 ? [names, [names[1], names[0]]] : [names];
  return orders.flatMap((order) => order.reduce((acc, name) => {
    const ways = name.endsWith('2') ? [[name[0], name[0]], [`${name[0]}'`, `${name[0]}'`]] : [[name]];
    return acc.flatMap((a) => ways.map((w) => [...a, ...w]));
  }, [[]]));
}

test('correct reps back to back never start over, however their turns run on across the end of a rep', () => {
  // What must NOT happen, for every ledger row: correct reps, held one way, whose reports put four identical
  // quarter turns across the end of a rep — an R2 drill, or one ending and starting on half turns of one face.
  // The engine must not read them as the gesture. The reports are chosen here from the algorithm, by the
  // test's own reading of it, never from the engine.
  const run = (seq, q) => { let k = 0; while (k < seq.length && seq[k] === q) k++; return k; };
  let risky = 0;
  for (const row of [...ALL, { name: 'R2', alg: 'R2' }, { name: 'R', alg: 'R' }, { name: 'U2', alg: 'U2' }]) {
    let hold = ['U', 'F'];
    const ways = parse(row.alg).map((move) => {
      const identity = toIdentity(move, hold);
      hold = applyIdentity(identity, hold, SOLVED).hold;
      return reportWays(identity);
    }).filter((w) => w[0].length);
    // One rep's reports, each token reported so the rep ends (`fromEnd`) or starts on as long a run of `q` as it
    // can: the tokens nearest that end take the way with the longest run until one cannot be all `q`.
    const pick = (q, fromEnd) => {
      const near = fromEnd ? [...ways].reverse() : ways;
      let open = true;
      const chosen = near.map((w) => {
        const len = (o) => run(fromEnd ? [...o].reverse() : o, q);
        const best = open ? w.reduce((a, b) => (len(b) > len(a) ? b : a)) : w[0];
        if (len(best) < best.length) open = false;
        return best;
      });
      return (fromEnd ? chosen.reverse() : chosen).flat();
    };
    for (const q of QUARTERS) {
      const last = pick(q, true);
      const next = pick(q, false);
      const whole = last.every((x) => x === q);
      if (run([...last].reverse(), q) + run(next, q) < GESTURE_TURNS) continue;
      risky += 1;
      // A rep that is all `q` runs on through every rep after it: enough reps to make four and one more.
      const reps = whole ? [...Array(Math.ceil(GESTURE_TURNS / last.length) + 1)].map(() => last) : [last, next];
      const h = harness({ alg: row.alg });
      startAt(h, SOLVED);
      for (const r of reps.flat()) h.turn(r, { gap: 50 });
      assert.ok(!h.types().includes('gesture'), `${row.name}: correct reps (${reps.map((r) => r.join(' ')).join(' | ')}) started over`);
      assert.equal(h.count('done'), reps.length, `${row.name}: correct reps did not all finish`);
      break;
    }
  }
  assert.ok(risky >= 4, `only ${risky} algorithms can run four identical turns across a rep's end: the check checks little`);
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
