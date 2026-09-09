// The generated F2L table, replayed on this repository's own cube.
//
// `crates/optimal-solver/tables/f2l.json` is produced by an IDA* search over an exact distance
// ball, in Rust, against a cube model written in Rust. Its certificates prove it is internally
// complete and its brute-force cross-check proves the lengths are minimal — but every one of those
// checks is downstream of the same projection. If that projection were subtly wrong, they would all
// agree with each other and all be wrong together.
//
// So this file asks the question from the other side, in the other language: take each algorithm,
// apply it with `cube-pieces.js` to a cube this repository built, and see whether the pair goes in
// and nothing else moves. `slotSafe` here is the app's own function — the definition the pairing
// rung is written against, not a restatement of it — which is what makes the agreement worth
// something. Nothing is imported from the generator; the only thing shared is the file.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CORNER, EDGE, CORNERS, EDGES, applyAlg, cornerSolved, edgeSolved } from '../lib/cube-pieces.js';
import { PROTECTED_CORNERS, PROTECTED_EDGES, configuration } from './fixtures/f2l-positions.mjs';
import { PAIRS_RUNGS } from '../lib/methods/pairs.js';
import { __testing } from '../lib/method-solver.js';

const { slotSafe, f2lCaseName } = __testing;

const TABLE = new URL('../../../crates/optimal-solver/tables/f2l.json', import.meta.url);

/** The table, or a failure that says what is missing. Committed, so absence is a lost file. */
function load() {
  assert.ok(existsSync(TABLE),
    'crates/optimal-solver/tables/f2l.json is missing — it is committed, so this is a lost file, '
    + 'not an ungenerated one; restore it or regenerate it with the gen-f2l binary');
  const data = JSON.parse(readFileSync(TABLE, 'utf8'));
  assert.equal(data.kind, 'f2l');
  assert.equal(data.scope, 'f2l-projection');
  return data;
}

const moves = (alg) => (alg.trim() ? alg.trim().split(/\s+/) : []);

test('every generated algorithm places its pair and disturbs nothing else', () => {
  // The claim the whole table rests on, asked of the app's own `slotSafe`. The generator asserts
  // the same thing from its side; this is the half that would catch the two definitions being
  // about different cubes — which is exactly what went wrong once already, when a case's name was
  // read in one frame and its flip in another.
  const { cases } = load();
  assert.equal(cases.length, 42, 'the 41 cases and the one where the pair is already placed');
  let placed = 0;
  for (const entry of cases) {
    const before = configuration(entry.cornerSlot, entry.cornerTwist, entry.edgeSlot, entry.edgeFlip);
    const after = applyAlg(before, entry.alg);
    const where = `${entry.name} (${entry.case}) "${entry.alg}"`;
    assert.ok(cornerSolved(after, CORNER.DFR), `${where}: the corner is not in its slot`);
    assert.ok(edgeSolved(after, EDGE.FR), `${where}: the edge is not beside it`);
    assert.ok(slotSafe(entry.alg, PROTECTED_CORNERS, PROTECTED_EDGES, 0),
      `${where}: it moves something it must leave alone`);
    assert.equal(moves(entry.alg).length, entry.length, `${where}: the length is not the algorithm's`);
    placed += 1;
  }
  assert.equal(placed, 42);
});

test('the table names its cases the way the app names them', () => {
  // The interop point, and the one place a table can be perfectly correct and still useless: the
  // app looks a case up by the name IT computes, so a table keyed by a name computed differently
  // would miss on every lookup while every algorithm in it was right.
  const { cases } = load();
  for (const entry of cases) {
    const state = configuration(entry.cornerSlot, entry.cornerTwist, entry.edgeSlot, entry.edgeFlip);
    assert.equal(f2lCaseName(state, 0), entry.name,
      `${entry.case}: the generator calls this ${entry.name}`);
    // And the name really describes the position it is filed under.
    assert.equal(entry.name,
      `${CORNERS[entry.cornerSlot]}${entry.cornerTwist}/${EDGES[entry.edgeSlot]}${entry.edgeFlip}`);
  }
  const names = new Set(cases.map((c) => c.name));
  assert.equal(names.size, 42, 'two cases share a name, so one of them can never be looked up');
});

test('the table is at least as short as the rung that ships, and usually shorter', () => {
  // What the table is FOR. Rung 1 searches compositions of six triggers; this searches every
  // maneuver there is, so it cannot be longer — and if it were never shorter, rung 2 would be a
  // second name for rung 1 and §10's "the step-count ladder is flat" would apply to it.
  const { cases } = load();
  let compared = 0;
  let shorter = 0;
  let saved = 0;
  for (const entry of cases) {
    if (entry.length === 0) continue;
    const state = configuration(entry.cornerSlot, entry.cornerTwist, entry.edgeSlot, entry.edgeFlip);
    const steps = [];
    PAIRS_RUNGS[1].run(state, steps);
    const step = steps.find((s) => s.stage === 'f2l' && s.parts);
    // Every case here is reachable by construction, so rung 1 must produce a pair step for it.
    assert.ok(step, `${entry.name}: rung 1 fell back on a case that is not buried`);
    const rung1 = moves(step.alg).length;
    assert.ok(entry.length <= rung1,
      `${entry.name}: the "optimal" ${entry.length} is longer than rung 1's ${rung1} — `
      + '"optimal" is then a claim the search has just refuted');
    compared += 1;
    if (entry.length < rung1) shorter += 1;
    saved += rung1 - entry.length;
  }
  assert.equal(compared, 41);
  assert.ok(shorter > 0, 'the generated table matches rung 1 everywhere, so it teaches nothing new');
  // Reported rather than asserted at a threshold: the number is a measurement, and a test that
  // pinned it would fail on any improvement to either side.
  console.log(`# f2l: ${shorter} of ${compared} cases shorter than rung 1, ${saved} moves in total`);
});

test('the longest case is nine moves, and every length is a real distance', () => {
  // The distribution, pinned. It is a RESULT rather than a number checked against a source: no
  // published table of optimal F2L lengths was used, and the evidence that these are minimal is
  // the brute-force refutation pass (`f2l-cross-check`), not agreement with anyone.
  const { cases } = load();
  const histogram = {};
  for (const entry of cases) histogram[entry.length] = (histogram[entry.length] ?? 0) + 1;
  assert.deepEqual(histogram, { 0: 1, 3: 1, 4: 3, 6: 8, 7: 15, 8: 11, 9: 3 });
  // A three-move F2L case exists and a one- or two-move one does not: the pair has to be brought
  // together and put in, and neither half is free.
  assert.equal(histogram[1], undefined);
  assert.equal(histogram[2], undefined);
  assert.equal(histogram[5], undefined, 'a five-move case would be a gap in the distribution');
});
