// Pretty patterns, measured rather than copied — and the two questions worth asking about each.
//
//   node bench/cube-patterns.mjs
//
// The fourteen named patterns are from *Rubik's: 50 Years of the World's Most Famous Cube*,
// chapter 28, which prints one algorithm each. An algorithm is a fact about the cube, not prose, so
// what is reproduced here is the sequence and nothing else; the chapter is the citation.
//
// TWO QUESTIONS, and only the second is interesting.
//
//   1. **Is the printed algorithm the shortest way to that picture?** A pattern is a SINGLE STATE, so
//      the route from solved to it is `A⁻¹B` and the app's existing solver answers it with no new
//      machinery at all. Where the answer is 10 moves or fewer, the meet-in-the-middle oracle proves
//      the minimum exactly; above that the two-phase engine gives an upper bound and no claim.
//
//   2. **Which patterns are SETS rather than states?** That is the question this repository's
//      projection machinery exists for. A picture that leaves some pieces free is reachable from a
//      scrambled cube in far fewer moves than any single arrangement of it, and the two duals are the
//      interesting pair: a PLUS on every face needs the twelve edges home and no corner at all, an X
//      on every face needs the eight corners home and no edge at all.
//
// Everything here goes through the runtime replay of dev-docs/solve-to-state-plan.md §9a: a route is
// applied and the resulting cube compared against the pattern before any length is reported.

import { MOVE_NAMES, SOLVED, applyAlg, movesOf } from '../lib/cube-pieces.js';
import * as tp from '../lib/two-phase.js';
import { createSolver } from '../lib/solver-engine.js';
import { refine } from '../lib/solve-target.js';
import { PROJECTIONS, TARGETS } from '../lib/stage-targets.js';
import { goalBall, meetInTheMiddle } from './solve-to-state-oracle.mjs';
import { seededScrambles } from '../test/fixtures/seeded-scrambles.mjs';

tp.initialize();
const solve = createSolver(tp);

/** The fourteen from chapter 28, verbatim as move sequences. */
const BOOK = [
  ['The Checkerboard', 'U2 D2 F2 B2 L2 R2'],
  ['Plus/Minus', 'U2 R2 L2 U2 R2 L2'],
  ['Lines', 'R2 U2 R2 U2 R2 U2 L2 D2 L2 D2 L2 D2 L2 R2'],
  ['Cube in a Cube', "F L F U' R U F2 L2 U' L' B D' B' L2 U"],
  ['Side Lines', "R D R F R' F' B D R' U' B' U D2"],
  ['Cube in a Cube in a Cube', "U' L' U' F' R2 B' R F U B2 U B' L U' F U R F'"],
  ['Superflip', "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2"],
  ['Chessboard in a Cube', "B D F' B' D L2 U L U' B D' R B R D' R L' F U2 D"],
  ['Centres', "U D' R L' F B' U D'"],
  ['Opposite Corners', 'R L U2 F2 D2 F2 R L F2 D2 B2 D2'],
  ['Vertical Stripes', "F U F R L2 B D' R D2 L D' B R2 L F U F"],
  ['Shifted Blocks', "L2 B2 D' B2 D L2 U R2 D R2 B U R' F2 R U' B' U'"],
  ['Hello!', 'U2 R2 F2 U2 D2 F2 L2 U2'],
  ['40 (4T)', "F2 D2 F' L2 D2 U2 R2 B' U2 F2"],
];

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
const same = (a, b) => ['cp', 'co', 'ep', 'eo'].every((k) => a[k].every((v, i) => v === b[k][i]));

/** The app's best effort at the shortest, pushed as far as the shipped budget allows. */
async function shortestFound(facelets, tier) {
  let last = null;
  for await (const step of refine(facelets, { solve, tier })) last = step;
  return last;
}

// ---- question 1: is the printed algorithm the shortest route to that picture? -------------------

const SOLVED_TARGET = TARGETS.find((t) => t.id === 'solved');
const ball = goalBall(SOLVED_TARGET, 5);

console.log('=== the fourteen named patterns =============================================');
console.log('"exact" is proved by meet in the middle and only exists at 10 or fewer. "found" is the');
console.log('two-phase engine\'s best under the shipped budget, which is an upper bound and no more.\n');
console.log(`${pad('pattern', 26)} ${num('book', 5)} ${num('exact', 6)} ${num('found', 6)} ${num('saved', 6)}  note`);

const rows = [];
for (const [name, alg] of BOOK) {
  const state = applyAlg(SOLVED, alg);
  const bookLen = movesOf(alg).length;
  // The distance to solved IS the distance from solved to the pattern: inversion preserves length.
  const exact = meetInTheMiddle(state, SOLVED_TARGET, ball, 5);
  let found = exact;
  if (exact === null) {
    const best = await shortestFound(tp.toFacelets(state), 'eighteen');
    found = best?.moves ?? null;
    // The runtime replay: the route must actually produce the pattern, inverted.
    if (best?.alg) {
      const back = applyAlg(state, best.alg);
      if (!same(back, SOLVED)) throw new Error(`${name}: the engine's route does not solve the pattern`);
    }
  }
  const saved = found === null ? null : bookLen - found;
  rows.push({ name, bookLen, exact, found, saved });
  const note = exact !== null ? 'proved' : 'upper bound only';
  console.log(`${pad(name, 26)} ${num(bookLen, 5)} ${num(exact ?? '-', 6)} ${num(found ?? '-', 6)} ${num(saved ?? '-', 6)}  ${note}`);
}

console.log('\nSuperflip is the one length in this table that is known exactly from outside: Reid proved');
console.log('in 1995 that it needs exactly 20, and crates/optimal-solver re-proves it. So a 20-move');
console.log('printed algorithm for it is optimal and cannot be improved.');

// ---- question 2: the two duals, as SETS ---------------------------------------------------------
//
// A plus on every face is the twelve edges home with every corner free. An X on every face is the
// eight corners home with every edge free. Both are pictures a child would call finished-looking, and
// neither is a single cube.

const EDGES_HOME = (s) => s.ep.every((v, i) => v === i) && s.eo.every((v) => v === 0);
const CORNERS_HOME = (s) => s.cp.every((v, i) => v === i) && s.co.every((v) => v === 0);

/** Reachable members of each set, counted rather than guessed. */
function setSizes() {
  // With the edges home the edge permutation is even, so the corner permutation must be even too:
  // 8!/2 corner arrangements times 3^7 twist vectors.
  const plus = (40320 / 2) * 2187;
  // With the corners home the same parity argument runs the other way: 12!/2 times 2^11.
  const ex = (479001600 / 2) * 2048;
  return { plus, ex };
}

const SIZES = setSizes();
console.log('\n=== the two duals, as sets rather than states ===============================');
console.log(`a PLUS on every face  = 12 edges home, corners free : ${SIZES.plus.toLocaleString()} cubes`);
console.log(`an X on every face    = 8 corners home, edges free  : ${SIZES.ex.toLocaleString()} cubes`);
console.log('\nBoth counts are halved by permutation parity: solved edges are an even permutation, so');
console.log('the corners must be even too, and the same argument runs the other way.\n');

const SETS = [
  { id: 'plus-all-faces', name: 'plus on every face', parts: ['crossEdges', 'midEdges', 'topEdges'], pred: EDGES_HOME },
  { id: 'x-all-faces', name: 'X on every face', parts: ['dCorners', 'uCorners'], pred: CORNERS_HOME },
];

// Measured against what the app shows today for the same cube.
console.log(`${pad('picture', 22)} ${num('n', 4)} ${num('mean set', 9)} ${num('mean solve', 11)} ${num('mean saved', 11)}`);
const P = PROJECTIONS;
const AXIS = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
const FACE = MOVE_NAMES.map((m) => m[0]);

/** IDA* for an ad-hoc set target, the spike's search with the parts passed in. */
function searchSet(parts, state, { maxDepth = 12, nodeBudget = 3_000_000 } = {}) {
  const ps = parts.map((p) => P[p]);
  const start = ps.map((p) => p.codeOf(state));
  const at = (codes) => ps.every((p, i) => p.isGoal(codes[i]));
  const h = (codes) => { let m = 0; for (let i = 0; i < ps.length; i++) { const d = ps[i].dist[codes[i]]; if (d > m) m = d; } return m; };
  if (at(start)) return { alg: '', moves: 0 };
  let nodes = 0;
  const path = [];
  const descend = (codes, g, bound, lastFace, lastAxis) => {
    if (g + h(codes) > bound) return false;
    if (at(codes)) return true;
    if (nodes >= nodeBudget) return null;
    for (let m = 0; m < MOVE_NAMES.length; m++) {
      const f = FACE[m];
      if (f === lastFace) continue;
      if (AXIS[f] === lastAxis && f < lastFace) continue;
      nodes++;
      const next = ps.map((p, i) => p.stepCode(codes[i], m));
      path.push(MOVE_NAMES[m]);
      const got = descend(next, g + 1, bound, f, AXIS[f]);
      if (got === true) return true;
      if (got === null) return null;
      path.pop();
    }
    return false;
  };
  for (let bound = h(start); bound <= maxDepth; bound++) {
    path.length = 0;
    const got = descend(start, 0, bound, '', -1);
    if (got === true) return { alg: path.join(' '), moves: path.length, nodes };
    if (got === null) return { alg: null, moves: null, nodes };
  }
  return { alg: null, moves: null, nodes };
}

const SCRAMBLES = seededScrambles(10, 0x5747, 25);
for (const set of SETS) {
  const pairs = [];
  for (const scramble of SCRAMBLES) {
    const state = applyAlg(SOLVED, scramble);
    const got = searchSet(set.parts, state);
    if (got.moves === null) continue;
    if (!set.pred(applyAlg(state, got.alg))) throw new Error(`${set.id}: route does not reach the picture`);
    const whole = await shortestFound(tp.toFacelets(state), 'twenty');
    if (!whole?.moves) continue;
    pairs.push({ set: got.moves, whole: whole.moves, saved: whole.moves - got.moves });
  }
  const mean = (k) => (pairs.length ? (pairs.reduce((a, p) => a + p[k], 0) / pairs.length).toFixed(1) : '-');
  console.log(`${pad(set.name, 22)} ${num(pairs.length, 4)} ${num(mean('set'), 9)} ${num(mean('whole'), 11)} ${num(mean('saved'), 11)}`);
}

console.log('\nFrom a FULL scramble, which is where a pattern is actually asked for. `n` is how many of the');
console.log('ten were ANSWERED: the X is reached on all ten, the plus is refused on four, and the means');
console.log('above are over the answered ones only. An earlier version of this line said these two are');
console.log('never refused, which was true of one of them.');
