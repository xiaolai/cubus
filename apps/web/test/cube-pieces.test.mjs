// The piece model is written against cubejs's internal permutation/orientation fields, and the
// quarter-turn tables in cube-pieces.js were copied out of cubejs once. Both are the kind of
// coupling that fails silently: a drifted table still yields well-formed algs, they just do not
// solve. So this file re-derives the tables from the vendored cubejs on every run, and checks
// the composition against cubejs move-for-move rather than trusting the arithmetic.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CORNER, CORNERS, EDGE, EDGES, MOVES, MOVE_NAMES, SOLVED,
  applyAlg, applyMove, cornerSlot, cornerSolved, edgeSlot, edgeSolved, fromCube, invert,
  rotateAlg, rotateState,
} from '../lib/cube-pieces.js';
// The one seeded generator (test/fixtures/seeded-scrambles.mjs). `lcg` and `randomAlg` used to be
// retyped here; a copy of a draw is a copy of a sample, and two samples that agree by hand are the
// thing that fixture exists to stop.
import { lcg, randomAlg } from './fixtures/seeded-scrambles.mjs';

const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url))).default;

test('cubejs still stores the state we read, in the order we assume', () => {
  const c = new Cube();
  for (const field of ['cp', 'co', 'ep', 'eo']) {
    assert.ok(Array.isArray(c[field]), `cubejs no longer exposes .${field} as an array`);
  }
  assert.deepEqual(c.cp, SOLVED.cp, 'a solved cube must be the identity permutation');
  assert.deepEqual(c.co, SOLVED.co);
  assert.deepEqual(c.ep, SOLVED.ep);
  assert.deepEqual(c.eo, SOLVED.eo);
  assert.equal(CORNERS.length, 8);
  assert.equal(EDGES.length, 12);
});

test('every one of the 18 move tables matches cubejs, re-derived not remembered', () => {
  assert.equal(MOVE_NAMES.length, 18, 'six faces, three turns each');
  for (const name of MOVE_NAMES) {
    const c = new Cube();
    c.move(name);
    const m = MOVES[name];
    assert.deepEqual([...m.cp], c.cp, `${name}: corner permutation drifted from cubejs`);
    assert.deepEqual([...m.co], c.co, `${name}: corner orientation drifted from cubejs`);
    assert.deepEqual([...m.ep], c.ep, `${name}: edge permutation drifted from cubejs`);
    assert.deepEqual([...m.eo], c.eo, `${name}: edge orientation drifted from cubejs`);
  }
});

test('composing moves agrees with cubejs over long random algs', () => {
  // The orientation term is the part that is easy to get wrong and hard to notice: a sign or
  // frame error still permutes correctly and only shows up as pieces that will not orient.
  const rnd = lcg(20260828);
  for (let trial = 0; trial < 200; trial++) {
    const alg = randomAlg(rnd, 25);
    const mine = applyAlg(SOLVED, alg);
    const theirs = fromCube(new Cube().move(alg));
    assert.deepEqual(mine.cp, theirs.cp, `cp mismatch on: ${alg}`);
    assert.deepEqual(mine.co, theirs.co, `co mismatch on: ${alg}`);
    assert.deepEqual(mine.ep, theirs.ep, `ep mismatch on: ${alg}`);
    assert.deepEqual(mine.eo, theirs.eo, `eo mismatch on: ${alg}`);
  }
});

test('an alg followed by its inverse is the identity', () => {
  const rnd = lcg(7);
  for (let trial = 0; trial < 50; trial++) {
    const alg = randomAlg(rnd, 14);
    const back = applyAlg(applyAlg(SOLVED, alg), invert(alg));
    assert.deepEqual(back, { cp: SOLVED.cp, co: SOLVED.co, ep: SOLVED.ep, eo: SOLVED.eo });
  }
});

test('applyMove and applyAlg never mutate what they are given', () => {
  const start = applyAlg(SOLVED, "R U R' U'");
  const snapshot = JSON.parse(JSON.stringify(start));
  applyMove(start, 'F2');
  applyAlg(start, "L D2 B'");
  assert.deepEqual(start, snapshot, 'a solver stage must be able to branch without copying first');
});

test('solved means the slot holds its own cubie, the right way round', () => {
  const solved = applyAlg(SOLVED, '');
  for (let i = 0; i < 12; i++) assert.equal(edgeSolved(solved, i), true);
  for (let i = 0; i < 8; i++) assert.equal(cornerSolved(solved, i), true);

  // F2 sends the DF edge to UF and back-to-front: permuted away, so not solved.
  const f2 = applyAlg(SOLVED, 'F2');
  assert.equal(edgeSolved(f2, EDGE.DF), false);
  assert.equal(edgeSlot(f2, EDGE.DF), EDGE.UF, 'F2 puts the DF edge in the UF slot');
  assert.equal(edgeSolved(f2, EDGE.DB), true, 'and leaves the back untouched');

  // A corner twisted in place is NOT solved — the case a permutation-only check would miss.
  const sexy = applyAlg(SOLVED, "R U R' U' R U R' U' R U R' U' R U R' U' R U R' U' R U R' U'");
  assert.deepEqual(sexy.cp, SOLVED.cp, 'six sexy moves permute nothing');
  assert.deepEqual(sexy.co, SOLVED.co, 'and untwist everything');
  const twisted = applyAlg(SOLVED, "R U R' U' R U R' U'");
  assert.notDeepEqual(twisted.co, SOLVED.co, 'two sexy moves leave corners twisted');
  assert.equal(cornerSolved(twisted, CORNER.URF), false);
});

test('slot lookups are inverses of the permutation, and refuse to guess', () => {
  const s = applyAlg(SOLVED, "R U2 F' L D");
  for (let cubie = 0; cubie < 12; cubie++) assert.equal(s.ep[edgeSlot(s, cubie)], cubie);
  for (let cubie = 0; cubie < 8; cubie++) assert.equal(s.cp[cornerSlot(s, cubie)], cubie);
  assert.throws(() => edgeSlot(s, 99), /not on the cube/);
  assert.throws(() => cornerSlot(s, 99), /not on the cube/);
  assert.throws(() => applyMove(s, 'Rw'), /unknown move/);
});

test('rotating a state and rotating an algorithm are the same rotation', () => {
  // The two halves of a whole-cube turn, and they must agree or a case named in one frame gets
  // an algorithm found in another. They did NOT agree for a while: edge orientation is measured
  // against the F/B axis, so turning the cube changes which edges read as flipped, and a version
  // of the F2L naming that relabelled slots without rotating the state gave one case up to four
  // different algorithms depending on the slot it appeared in.
  const rnd = lcg(31337);
  for (let trial = 0; trial < 40; trial++) {
    const alg = randomAlg(rnd, 12);
    for (let k = 0; k < 4; k++) {
      assert.deepEqual(
        rotateState(applyAlg(SOLVED, alg), k),
        applyAlg(SOLVED, rotateAlg(alg, k)),
        `rotating the state disagrees with rotating the alg: "${alg}" by y^${k}`,
      );
    }
  }
});

test('four quarter turns of the cube change nothing', () => {
  const state = applyAlg(SOLVED, "R U2 F' L D B");
  assert.deepEqual(rotateState(state, 4), state);
  assert.deepEqual(rotateState(state, 0), state);
  assert.deepEqual(rotateState(rotateState(state, 1), 3), state, 'y then y-cubed is the identity');
});

test('the rotation flips the U and D edges, and not the middle ones', () => {
  // The fact the naming bug turned on, pinned so it cannot quietly stop being true. `F` flips
  // edges and `R` does not, so a turn that sends F to R has to move the flips with it.
  const solvedThenY = rotateState(SOLVED, 1);
  assert.deepEqual(solvedThenY.eo, SOLVED.eo, 'a solved cube stays solved under a whole-cube turn');
  const flipped = applyAlg(SOLVED, 'F');
  const rotated = rotateState(flipped, 1);
  assert.deepEqual(rotated, applyAlg(SOLVED, 'R'), 'F seen after a y turn is R');
});

test('the identity is frozen all the way down, because it is handed out by reference', () => {
  // `Object.freeze` is shallow, and this constant IS what a script's position 0 and a dozen callers hold:
  // one of them writing to `SOLVED.cp` rewrote what solved means for every later question in the process
  // (Codex audit, 2026-09-16). `methods/engine.js` froze its own copy for this reason in 2026-09-10; this
  // is the constant that copy was made from, and a second instance of one mechanism is the class.
  for (const key of ['cp', 'co', 'ep', 'eo']) {
    assert.throws(() => { SOLVED[key][0] = 4; }, TypeError, `SOLVED.${key} was handed out writable`);
  }
  assert.deepEqual(SOLVED.cp, [0, 1, 2, 3, 4, 5, 6, 7], 'freezing changed what the identity is');
  // And what is derived from it is still ordinary, writable state: freezing a constant is not a change
  // to the model's arithmetic.
  const moved = applyAlg(SOLVED, 'R');
  moved.cp[0] = 4;
  assert.equal(moved.cp[0], 4);
  assert.equal(SOLVED.cp[0], 0);
});
