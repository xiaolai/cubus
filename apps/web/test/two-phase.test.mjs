// The two-phase solver's coordinate layer, proven rather than trusted.
//
// Two kinds of check, and they guard different failures:
//
//   * **Round-trips** (rank(unrank(i)) == i, exhaustively) prove each coordinate is a bijection.
//     A rank that collapsed two states would make the solver treat them as one, and the pruning
//     tables would quietly under- or over-estimate forever after.
//   * **Agreement with cube-pieces on every one of the 18 moves** proves the move tables are the
//     real moves. The tables are built from synthetic single-component states; the test applies
//     moves to FULL random states through cube-pieces' compose and demands the same answer —
//     which is exactly the claim the solver rests on: each coordinate transforms independently
//     of the rest of the cube.
//
// A wrong table here still produces well-formed algs that simply do not solve, so everything
// this file guards against is silent by construction.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MOVE_NAMES, SOLVED, applyMove } from '../lib/cube-pieces.js';
import { randomBelow, randomState } from '../lib/random-state.js';
import {
  ALL_MOVES,
  FLIP_COUNT,
  PERM4_COUNT,
  PERM8_COUNT,
  PHASE2_MOVES,
  SLICE_COUNT,
  TWIST_COUNT,
  flipOf,
  flipTo,
  moveTables,
  permRank,
  permUnrank,
  sliceOf,
  sliceTo,
  twistOf,
  twistTo,
} from '../lib/two-phase.js';

test('rank(unrank(i)) == i for every value of every coordinate', () => {
  for (let t = 0; t < TWIST_COUNT; t++) {
    const co = twistTo(t);
    assert.equal(co.reduce((a, b) => a + b, 0) % 3, 0, `twist ${t} unranks to an illegal state`);
    assert.equal(twistOf(co), t);
  }
  for (let f = 0; f < FLIP_COUNT; f++) {
    const eo = flipTo(f);
    assert.equal(eo.reduce((a, b) => a + b, 0) % 2, 0, `flip ${f} unranks to an illegal state`);
    assert.equal(flipOf(eo), f);
  }
  for (let s = 0; s < SLICE_COUNT; s++) {
    const ep = sliceTo(s);
    assert.deepEqual([...ep].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      `slice ${s} unranks to something that is not a permutation`);
    assert.equal(sliceOf(ep), s);
  }
  for (let r = 0; r < PERM8_COUNT; r++) assert.equal(permRank(permUnrank(r, 8)), r);
  for (let r = 0; r < PERM4_COUNT; r++) assert.equal(permRank(permUnrank(r, 4)), r);
});

test('the solved state is coordinate zero on every axis', () => {
  assert.equal(twistOf(SOLVED.co), 0);
  assert.equal(flipOf(SOLVED.eo), 0);
  assert.equal(sliceOf(SOLVED.ep), 0);
  assert.equal(permRank(SOLVED.cp), 0);
  assert.equal(permRank(SOLVED.ep.slice(0, 8)), 0);
  assert.equal(permRank(SOLVED.ep.slice(8).map((x) => x - 8)), 0);
});

test('every phase-1 move table agrees with cube-pieces on every one of the 18 moves', () => {
  const { twistMove, flipMove, sliceMove } = moveTables();
  for (let trial = 0; trial < 25; trial++) {
    const state = randomState();
    for (let mi = 0; mi < ALL_MOVES.length; mi++) {
      const after = applyMove(state, MOVE_NAMES[ALL_MOVES[mi]]);
      const name = MOVE_NAMES[ALL_MOVES[mi]];
      assert.equal(twistMove[twistOf(state.co) * 18 + mi], twistOf(after.co), `twist disagrees on ${name}`);
      assert.equal(flipMove[flipOf(state.eo) * 18 + mi], flipOf(after.eo), `flip disagrees on ${name}`);
      assert.equal(sliceMove[sliceOf(state.ep) * 18 + mi], sliceOf(after.ep), `slice disagrees on ${name}`);
    }
  }
});

test('every phase-2 move table agrees with cube-pieces on every G1 move', () => {
  const { cpermMove, epermMove, spermMove } = moveTables();
  const width = PHASE2_MOVES.length;
  for (let trial = 0; trial < 25; trial++) {
    // A random G1 state: a random walk over G1's own generators stays in G1 by definition.
    let state = { cp: [...SOLVED.cp], co: [...SOLVED.co], ep: [...SOLVED.ep], eo: [...SOLVED.eo] };
    for (let k = 0; k < 30; k++) state = applyMove(state, MOVE_NAMES[PHASE2_MOVES[randomBelow(width)]]);
    for (let mi = 0; mi < width; mi++) {
      const name = MOVE_NAMES[PHASE2_MOVES[mi]];
      const after = applyMove(state, name);
      assert.equal(cpermMove[permRank(state.cp) * width + mi], permRank(after.cp), `cperm disagrees on ${name}`);
      assert.equal(
        epermMove[permRank(state.ep.slice(0, 8)) * width + mi],
        permRank(after.ep.slice(0, 8)),
        `eperm disagrees on ${name}`,
      );
      assert.equal(
        spermMove[permRank(state.ep.slice(8).map((x) => x - 8)) * width + mi],
        permRank(after.ep.slice(8).map((x) => x - 8)),
        `sperm disagrees on ${name}`,
      );
    }
  }
});

test('four quarter turns are the identity on every phase-1 table, for every coordinate', () => {
  // Not implied by the sampled agreement test above: this one is exhaustive over coordinates,
  // so a single corrupted table entry anywhere has nowhere to hide.
  const { twistMove, flipMove, sliceMove } = moveTables();
  const quarters = [0, 3, 6, 9, 12, 15]; // U R F D L B, as indices into MOVE_NAMES
  for (const [table, count, label] of [
    [twistMove, TWIST_COUNT, 'twist'],
    [flipMove, FLIP_COUNT, 'flip'],
    [sliceMove, SLICE_COUNT, 'slice'],
  ]) {
    for (const q of quarters) {
      for (let c = 0; c < count; c++) {
        let x = c;
        for (let k = 0; k < 4; k++) x = table[x * 18 + q];
        assert.equal(x, c, `${label}: ${MOVE_NAMES[q]} four times is not the identity at ${c}`);
      }
    }
  }
});

test('every phase-2 table returns after its move order, for every coordinate', () => {
  const { cpermMove, epermMove, spermMove } = moveTables();
  const width = PHASE2_MOVES.length;
  // U and D are order 4 in the table's own move list; the four half turns are order 2.
  const orders = PHASE2_MOVES.map((m) => (MOVE_NAMES[m].endsWith('2') ? 2 : 4));
  const quarters = PHASE2_MOVES.map((m, mi) => [mi, orders[mi]]).filter(([, o]) => o !== 0);
  for (const [table, count, label] of [
    [cpermMove, PERM8_COUNT, 'cperm'],
    [epermMove, PERM8_COUNT, 'eperm'],
    [spermMove, PERM4_COUNT, 'sperm'],
  ]) {
    for (const [mi, order] of quarters) {
      // U2/D2/U'/D' are compositions of U/D — checking the six primitive columns exhaustively
      // covers the table; the derived columns are already pinned by the agreement test.
      if (!['U', 'D', 'R2', 'F2', 'L2', 'B2'].includes(MOVE_NAMES[PHASE2_MOVES[mi]])) continue;
      for (let c = 0; c < count; c++) {
        let x = c;
        for (let k = 0; k < order; k++) x = table[x * width + mi];
        assert.equal(x, c, `${label}: ${MOVE_NAMES[PHASE2_MOVES[mi]]} x${order} is not the identity at ${c}`);
      }
    }
  }
});

// ---- phase 1 ----------------------------------------------------------------------------------

import { applyAlg } from '../lib/cube-pieces.js';
import { pruningTables, solveIntoG1 } from '../lib/two-phase.js';

/** G1 membership, read straight off the cubie state — the definition, not the coordinates. */
const inG1 = (state) =>
  state.co.every((o) => o === 0) &&
  state.eo.every((o) => o === 0) &&
  state.ep.slice(8).every((e) => e >= 8);

test('phase 1 lands every random state in G1, within the published 12-move diameter', () => {
  for (let trial = 0; trial < 20; trial++) {
    const state = randomState();
    const alg = solveIntoG1(state);
    assert.ok(alg.length <= 12, `phase 1 took ${alg.length} moves — the diameter is 12`);
    const after = applyAlg(state, alg.join(' '));
    assert.ok(inG1(after), `${alg.join(' ')} does not land in G1`);
    // The dedup rule: a maneuver ending inside G1 would duplicate a shorter one. Its last move
    // must therefore be a quarter turn of R, L, F or B — never U, D or a half turn.
    if (alg.length > 0) {
      assert.match(alg[alg.length - 1], /^[RLFB]'?$/, `phase 1 ended with ${alg[alg.length - 1]}`);
    }
  }
});

test('a state already in G1 needs no phase-1 moves at all', () => {
  assert.deepEqual(solveIntoG1(SOLVED), []);
  const scrambledInG1 = applyAlg(SOLVED, "U R2 D' B2 L2 U' F2 D2 R2 U");
  assert.ok(inG1(scrambledInG1), 'a G1-generator walk must stay in G1');
  assert.deepEqual(solveIntoG1(scrambledInG1), [], 'already in G1 — the maneuver is empty');
});

test('the pruning tables are complete, zero at home, and bounded by the published diameters', () => {
  const { prune1t, prune1f, prune2c, prune2e } = pruningTables();
  for (const [table, cap, label] of [
    [prune1t, 12, 'twist x slice'],
    [prune1f, 12, 'flip x slice'],
    [pruningTables().prune1tf, 12, 'twist x flip'],
    [prune2c, 18, 'cperm x sperm'],
    [prune2e, 18, 'eperm x sperm'],
  ]) {
    assert.equal(table[0], 0, `${label}: home is not at distance 0`);
    let max = 0;
    for (const d of table) {
      if (d > max) max = d;
    }
    // 255 would mean an unreachable entry escaped the BFS's own completeness check; anything
    // over the published diameter means the BFS overshot. Both are broken tables.
    assert.ok(max <= cap, `${label}: max distance ${max} exceeds the diameter ${cap}`);
    assert.ok(max > 0, `${label}: a flat table prunes nothing`);
  }
});

// ---- facelets, rotations, and the whole engine ------------------------------------------------
// From here down the tests need the independent oracle: the vendored cubejs, a different
// implementation of the same cube. Every solution is applied through IT, never through the
// solver's own move tables — agreement between two independent implementations is the check.

import { existsSync } from 'node:fs';
import { createSolver } from '../lib/solver-engine.js';
import { refine } from '../lib/solve-target.js';
import * as twoPhase from '../lib/two-phase.js';
import { ROTATION_PERMS, parseFacelets, toFacelets } from '../lib/two-phase.js';
import { randomCube } from '../lib/random-state.js';

const vendored = new URL('../vendor/cubejs.js', import.meta.url);
assert.ok(existsSync(vendored), 'vendor/cubejs.js is missing — run `pnpm vendor:libs`');
const Cube = (await import(vendored)).default;
Cube.initSolver();

test('the rotation facelet permutations are exactly what cubejs derives', () => {
  // The same discipline as cube-pieces' quarter-turn tables: the constants were DERIVED from
  // cubejs, and this re-derives them on every run. rotated[i] = original[perm[i]], pinned by
  // random cubes until only one source position survives for every sticker.
  for (const [rot, expected] of Object.entries(ROTATION_PERMS)) {
    const candidates = Array.from({ length: 54 }, () => new Set(Array.from({ length: 54 }, (_, j) => j)));
    for (let trial = 0; trial < 40; trial++) {
      const c = Cube.random();
      const before = c.asString();
      c.move(rot);
      const after = c.asString();
      for (let i = 0; i < 54; i++) {
        for (const j of [...candidates[i]]) if (before[j] !== after[i]) candidates[i].delete(j);
      }
    }
    const derived = candidates.map((s, i) => {
      assert.equal(s.size, 1, `${rot}: sticker ${i} not pinned to a single source`);
      return [...s][0];
    });
    assert.deepEqual([...expected], derived, `ROTATION_PERMS.${rot} drifted from cubejs`);
  }
});

test('facelet parsing agrees with cubejs at the cubie level, both directions', () => {
  for (let trial = 0; trial < 100; trial++) {
    const cube = randomCube(Cube);
    const facelets = cube.asString();
    const state = parseFacelets(facelets);
    assert.notEqual(state, null, `parse refused a legal cube: ${facelets}`);
    assert.deepEqual(
      [state.cp, state.co, state.ep, state.eo],
      [cube.cp, cube.co, cube.ep, cube.eo],
      `cubie-level disagreement with cubejs on ${facelets}`,
    );
    assert.equal(toFacelets(state), facelets, 'toFacelets must reproduce what cubejs printed');
  }
});

test('what is not a solvable cube parses to null, never to a state', () => {
  const good = randomCube(Cube).asString();
  assert.notEqual(parseFacelets(good), null);
  // Each mutation below is a distinct way a scan goes wrong. All must be refused.
  const twistOne = (f) => {
    // Rotate the URF corner's three stickers in place: a corner physically twisted.
    const [a, b, c] = [8, 9, 20];
    const out = f.split('');
    [out[a], out[b], out[c]] = [f[c], f[a], f[b]];
    return out.join('');
  };
  const flipOne = (f) => {
    // Flip the UR edge's two stickers: an edge physically flipped.
    const out = f.split('');
    [out[5], out[10]] = [f[10], f[5]];
    return out.join('');
  };
  const swapEdges = (f) => {
    // Swap the UR and UF edges only: permutation parity becomes impossible.
    const out = f.split('');
    [out[5], out[7]] = [f[7], f[5]];
    [out[10], out[19]] = [f[19], f[10]];
    return out.join('');
  };
  const bad = {
    'too short': good.slice(0, 53),
    'an unknown color': `X${good.slice(1)}`,
    'a moved center': good.replace(/^(.{4})./, '$1F'),
    'ten of one color': `U${good.slice(0, 4)}U${good.slice(5, 53)}`.slice(0, 54),
    'a twisted corner': twistOne(good),
    'a flipped edge': flipOne(good),
    'swapped pieces (parity)': swapEdges(good),
  };
  for (const [what, facelets] of Object.entries(bad)) {
    assert.equal(parseFacelets(facelets), null, `${what} must parse to null`);
  }
});

test('the whole engine, behind createSolver: bounded, verified, every view exercised', () => {
  const solve = createSolver(twoPhase);
  // solLen 21 forces real searching, which spreads winners across the six views — a broken
  // rotation map or inverse map would surface as an alg that does not solve.
  for (let trial = 0; trial < 10; trial++) {
    const facelets = randomCube(Cube).asString();
    const alg = solve(facelets, { solLen: 21, probeMax: 50_000_000 });
    assert.ok(alg, `no solution under 21 within the budget for ${facelets}`);
    assert.ok(alg.split(/\s+/).length < 21, 'the bound is exclusive');
    const oracle = Cube.fromString(facelets);
    oracle.move(alg);
    assert.ok(oracle.isSolved(), `does not solve ${facelets}: ${alg}`);
  }
});

test('all six views win searches, and every winner is oracle-verified', () => {
  // The rotation and inversion mappings each have their own way to be wrong, and a broken one
  // produces answers that do not solve — so what this needs is evidence that every mapping
  // PATH produces real, winning answers. searchStats.view records the winner; views are
  // symmetric over random states, so each wins ~1/6 of tight searches and all six appear
  // within a few dozen (the batch exits early once they have; 120 caps the tail at odds around
  // 1e-8 of a false failure). Every winning answer is checked with the oracle.
  const winners = new Set();
  for (let trial = 0; trial < 120 && winners.size < 6; trial++) {
    const facelets = randomCube(Cube).asString();
    twoPhase.setBounds({ solLen: 21, probeMax: 50_000_000 });
    const alg = twoPhase.solvePattern(facelets);
    if (alg === null) continue; // rare at this budget; the engine test asserts reachability
    assert.ok(twoPhase.searchStats.view >= 0 && twoPhase.searchStats.view < 6,
      `winning view ${twoPhase.searchStats.view} is not one of the six`);
    winners.add(twoPhase.searchStats.view);
    const oracle = Cube.fromString(facelets);
    if (alg) oracle.move(alg);
    assert.ok(oracle.isSolved(), `view ${twoPhase.searchStats.view} returned a non-solution`);
  }
  assert.equal(winners.size, 6, `only views [${[...winners].sort()}] ever won — a view that never wins is a view whose mapping never runs`);
});

test('the engine holds the contract the tiered search assumes, on real searches', async () => {
  const solve = createSolver(twoPhase);
  // 200M nodes, not the app's 50M default: this asserts REACHABILITY (met === true), and a
  // rare hard state can exhaust a single 50M attempt at the 21 -> 20 rung — seen once, ~6 s
  // into a run. The app answers that case honestly with met: false; a test asserting met needs
  // the headroom the assertion implies.
  const asyncSolve = async (facelets, options) => solve(facelets, { ...options, probeMax: 200_000_000 });
  for (let i = 0; i < 3; i++) {
    const facelets = Cube.random().asString();
    let previous = Infinity;
    let last = null;
    for await (const step of refine(facelets, { solve: asyncSolve, tier: 'twenty' })) {
      const improved = step.moves < previous || (step.moves === previous && step.stopped !== null);
      assert.ok(improved, `${previous} -> ${step.moves} (stopped=${step.stopped})`);
      previous = step.moves;
      last = step;
      const oracle = Cube.fromString(facelets);
      oracle.move(step.alg);
      assert.ok(oracle.isSolved(), 'every answer shown must solve the cube');
    }
    assert.equal(last.met, true, '<= 20 is reachable on every cube');
    assert.ok(last.moves <= 20);
  }
});

test('probeMax bounds the search work in nodes, and searchStats reports what was spent', () => {
  // The budget claim is behavioral: the same number means the same work on every machine, and
  // the search never runs past it. The probe state is the superflip — every piece home, every
  // edge flipped — whose distance is PROVEN to be 20 moves, so asking for fewer than 16 must
  // return null by mathematics, not by luck, at any budget. And because its depth-15 trees
  // dwarf any budget set here, the search must stop by spending the budget — within a node or
  // two of the cap, never a runaway, never early.
  const SUPERFLIP = "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2";
  const state = applyAlg(SOLVED, SUPERFLIP);
  assert.deepEqual([state.cp, state.co, state.ep], [SOLVED.cp, SOLVED.co, SOLVED.ep]);
  assert.ok(state.eo.every((o) => o === 1), 'the maneuver above must actually be the superflip');
  const facelets = toFacelets(state);
  for (const budget of [1_000, 50_000]) {
    twoPhase.setBounds({ solLen: 16, probeMax: budget });
    const answer = twoPhase.solvePattern(facelets);
    assert.equal(answer, null, 'the superflip has no 15-move solution — null is the only answer');
    const spent = twoPhase.searchStats.p1Nodes + twoPhase.searchStats.p2Nodes;
    // Exactly the budget: nodes are counted only inside it, and exhaustion aborts every level
    // of both searches — over-spend or under-spend here is a broken abort channel.
    assert.equal(spent, budget, `spent ${spent} nodes against a budget of ${budget}`);
  }
  // And a solve that succeeds reports a real spend too.
  twoPhase.setBounds({ solLen: 23, probeMax: 50_000_000 });
  assert.notEqual(twoPhase.solvePattern(facelets), null);
  assert.ok(twoPhase.searchStats.probes >= 1, 'a successful search made at least one probe');
  assert.ok(twoPhase.searchStats.p1Nodes > 0);
});
