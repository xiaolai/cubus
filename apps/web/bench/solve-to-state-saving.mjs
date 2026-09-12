// What reaching a STATE saves over solving the whole cube — measured against what the app actually
// does, which is the only comparison worth quoting.
//
// The spike's first run compared against `createSolver` at `solLen: 21` with no refinement pass, so
// the baseline answered a three-move cube with ten and the saving looked like three to five moves.
// That was an overstatement and is recorded as such in dev-docs/solve-to-state-plan.md §3a. The app
// ships `refine`, which keeps asking for shorter at a bonus budget once the tier is met, and that is
// the number a child would actually be shown.
//
// Deterministic: the corpus is the frozen fixture, so this bench and the tests talk about the same
// cubes.
//
//   node bench/solve-to-state-saving.mjs

import { MOVE_NAMES, SOLVED, applyAlg, movesOf, rotateAlg } from '../lib/cube-pieces.js';
import * as tp from '../lib/two-phase.js';
import { createSolver } from '../lib/solver-engine.js';
import { refine } from '../lib/solve-target.js';
import { solveByMethod } from '../lib/method-solver.js';
import { TARGETS } from '../lib/stage-targets.js';
import { solveToState } from '../lib/stage-distance.js';
import { PREDICATE } from './solve-to-state-oracle.mjs';
import { STAGE_TARGET_CASES } from '../test/fixtures/stage-targets.mjs';
import { lcg, seededScrambles } from '../test/fixtures/seeded-scrambles.mjs';

tp.initialize();
const solve = createSolver(tp);

/** The app's answer: `refine` at the shipped default tier, taking the last yield. */
async function appAnswer(facelets) {
  let last = null;
  for await (const step of refine(facelets, { solve, tier: 'twenty' })) last = step;
  return last;
}

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

const rows = STAGE_TARGET_CASES.map((r) => ({ ...r, state: applyAlg(SOLVED, r.scramble) }));

console.log('Baseline is `refine` at the twenty tier — what the app shows today. "set" is the proved');
console.log('shortest route into the target. A negative saving would mean the whole-cube answer was');
console.log('shorter than the route to a SUPERSET of it, which is impossible, so it is a bug check.\n');

const baseline = new Map();
for (const row of rows) {
  const got = await appAnswer(tp.toFacelets(row.state));
  baseline.set(row.scramble, got?.moves ?? null);
}

console.log(`${pad('target', 16)} ${num('n', 4)} ${num('mean set', 9)} ${num('mean app', 9)} ${num('mean saved', 11)} ${num('worst saved', 12)}`);
const summary = [];
for (const target of TARGETS) {
  const pairs = [];
  for (const row of rows) {
    const want = row.d[target.id];
    if (want === null) continue;                   // outside the exact radius; the fallback answers
    const app = baseline.get(row.scramble);
    if (app === null) continue;
    const got = solveToState(target, row.state);
    if (got.moves === null) continue;
    if (got.moves > app) {
      throw new Error(`${target.id} / ${row.scramble}: route to the target is ${got.moves}, longer than`
        + ` the whole-cube answer of ${app} — a superset cannot be further away`);
    }
    pairs.push({ set: got.moves, app, saved: app - got.moves });
  }
  const mean = (k) => (pairs.length ? (pairs.reduce((a, p) => a + p[k], 0) / pairs.length).toFixed(1) : '-');
  const worst = pairs.length ? Math.max(...pairs.map((p) => p.saved)) : '-';
  console.log(`${pad(target.name, 16)} ${num(pairs.length, 4)} ${num(mean('set'), 9)} ${num(mean('app'), 9)} ${num(mean('saved'), 11)} ${num(worst, 12)}`);
  summary.push({ id: target.id, n: pairs.length, saved: mean('saved'), worst });
}

console.log('\nRows where the exact search refused are excluded, so these means describe the cases the');
console.log('feature actually answers.');

// ---- the corpus that question actually needs ---------------------------------------------------
//
// The table above is measured on cubes a few turns from SOLVED, and on those the saving is near zero
// for every target but the cross — which is arithmetic, not a verdict. A cube six moves from solved
// is at most six moves from any SUPERSET of solved, so there is nothing to save. The corpus answers
// "how far is a nearly-solved cube from a stage", and the feature's question is the other one:
//
//   **a cube AT a stage, or a few turns from it, and a long way from solved.**
//
// That is what a child hands over. Generating it needs a state that satisfies the target and is not
// nearly solved, and for the five stage targets the method solver provides one without this engine
// taking any part: run it on a random scramble and stop at the first step after which the target's
// own predicate holds. For the six-sided cross the method route reaches it only at the very end, so
// that corpus is built instead from a corner-only commutator — `R' D' R U R' D R U'` leaves all
// twelve edges exactly where they were, verified, so repeating it under random whole-cube rotations
// scrambles corners alone and lands exactly on the target.

/** A state satisfying `target`, reached by the method solver, typically far from solved. */
function atTargetByMethod(scramble, target) {
  let state = applyAlg(SOLVED, scramble);
  if (PREDICATE[target.id](state)) return state;
  const lesson = solveByMethod(state);
  for (const step of lesson.steps) {
    state = applyAlg(state, step.alg);
    if (PREDICATE[target.id](state)) return state;
  }
  return state; // solved, which satisfies everything
}

/** A state with every edge home and the corners scrambled: the six-sided cross itself. */
function atSixCross(rnd) {
  const COMM = "R' D' R U R' D R U'";
  let state = SOLVED;
  for (let i = 0; i < 6; i++) state = applyAlg(state, rotateAlg(COMM, Math.floor(rnd() * 4)));
  return state;
}

console.log('\n\n=== the corpus the question needs: at the target, far from solved ==============\n');
console.log(`${pad('target', 16)} ${num('n', 4)} ${num('mean set', 9)} ${num('mean app', 9)} ${num('mean saved', 11)} ${num('worst saved', 12)}`);

const SEED = 0x5747;
const rnd = lcg(SEED);
const SEEDS = seededScrambles(8, SEED, 25);
const MISTAKES = [1, 2, 3, 4];

for (const target of TARGETS) {
  if (target.id === 'solved') continue;          // solved IS the whole cube; the saving is 0 by definition
  const pairs = [];
  for (const scramble of SEEDS) {
    const base = target.id === 'six-cross' ? atSixCross(rnd) : atTargetByMethod(scramble, target);
    if (!PREDICATE[target.id](base)) continue;   // the generator failed; say nothing rather than guess
    for (const k of MISTAKES) {
      const mistake = Array.from({ length: k }, () => MOVE_NAMES[Math.floor(rnd() * 18)]).join(' ');
      const state = applyAlg(base, mistake);
      const got = solveToState(target, state);
      if (got.moves === null) continue;          // outside the exact radius; the fallback answers
      const app = await appAnswer(tp.toFacelets(state));
      if (!app || app.moves === null) continue;
      pairs.push({ set: got.moves, app: app.moves, saved: app.moves - got.moves });
    }
  }
  const mean = (key) => (pairs.length ? (pairs.reduce((a, p) => a + p[key], 0) / pairs.length).toFixed(1) : '-');
  const worst = pairs.length ? Math.max(...pairs.map((p) => p.saved)) : '-';
  console.log(`${pad(target.name, 16)} ${num(pairs.length, 4)} ${num(mean('set'), 9)} ${num(mean('app'), 9)} ${num(mean('saved'), 11)} ${num(worst, 12)}`);
}

console.log('\nThis is the population the feature exists for. The table above it is not, and reading the');
console.log('two as one number is how a feature gets justified by the wrong measurement.');
