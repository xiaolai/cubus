// §4's prefix race, re-run where the fallback actually fires.
//
//   node bench/solve-to-state-prefix.mjs
//
// WHAT THIS OWES, in the plan's own words: "every one of these states is inside the exact search's
// likely radius, so it says nothing about the fallback's value where the fallback actually fires.
// The comparison has to be re-run on states that genuinely exhaust the budget." §4 measured eight
// mistake algorithms applied to SOLVED — all of them a handful of turns out, all of them answered
// exactly — and then drew a conclusion about the source that only runs when the exact search gives
// up. This is that re-run.
//
// THE TWO SOURCES, and neither dominates:
//
//   the method prefix     `solveByMethod` at the default rungs, truncated at the first point the
//                         target holds. Truncating on the PREDICATE needs no stage boundary, which
//                         is what made §4's first draft reject this source for the wrong reason.
//   the full-solve prefix the app's own <= 20 answer through `refine` at the twenty tier, truncated
//                         the same way. An upper bound by construction, never a distance.
//
// AND A THIRD COLUMN THE PLAN DOES NOT ASK FOR BUT §9.4 NEEDS. A method route truncated mid-step
// hands a child half an algorithm. Truncating at the nearest STEP BOUNDARY instead costs moves and
// buys a route the lesson can actually resume at, so both are reported and the difference between
// them is the price of resumability.

import { SOLVED, applyAlg, movesOf } from '../lib/cube-pieces.js';
import * as tp from '../lib/two-phase.js';
import { createSolver } from '../lib/solver-engine.js';
import { refine } from '../lib/solve-target.js';
import { solveByMethod } from '../lib/method-solver.js';
import { INDEPENDENT_PREDICATE } from '../test/fixtures/independent-predicates.mjs';
import { buildCorpus, CORPUS_TARGETS } from './solve-to-state-corpus.mjs';
import { TARGETS } from '../lib/stage-targets.js';
import { solveToState } from '../lib/stage-distance.js';

const NODE_BUDGET = 4_000_000;
const MAX_DEPTH = 14;

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

const byId = Object.fromEntries(TARGETS.map((t) => [t.id, t]));

/** The first move-prefix of `alg` after which `pred` holds, or null if none does. */
function movePrefix(state, alg, pred) {
  if (pred(state)) return { moves: 0, alg: '' };
  const moves = movesOf(alg);
  let s = state;
  for (let i = 0; i < moves.length; i++) {
    s = applyAlg(s, moves[i]);
    if (pred(s)) return { moves: i + 1, alg: moves.slice(0, i + 1).join(' ') };
  }
  return null;
}

/** The same, but only allowed to stop where a step does — what the lesson can resume at. */
function stepPrefix(state, steps, pred) {
  if (pred(state)) return { moves: 0, steps: 0 };
  let s = state;
  let moves = 0;
  for (let i = 0; i < steps.length; i++) {
    s = applyAlg(s, steps[i].alg);
    moves += movesOf(steps[i].alg).length;
    if (pred(s)) return { moves, steps: i + 1 };
  }
  return null;
}

tp.initialize();
const solve = createSolver(tp);

/** The app's answer, exactly as a child would be shown it: `refine` at the shipped tier. */
async function appAnswer(state) {
  let last = null;
  for await (const step of refine(tp.toFacelets(state), { solve, tier: 'twenty' })) last = step;
  return last?.alg ?? null;
}

// ---- find the states where the fallback actually fires ---------------------------------------------

console.log('=== finding the states that exhaust the exact search ==============================');
const corpus = buildCorpus();
const exhausted = [];
for (const c of corpus) {
  const got = solveToState(byId[c.target], c.state, { maxDepth: MAX_DEPTH, nodeBudget: NODE_BUDGET });
  if (got.moves === null) exhausted.push({ ...c, why: got.why });
}
console.log(`${exhausted.length} of ${corpus.length} corpus cases exhaust a ${NODE_BUDGET.toLocaleString()}-node budget at depth ${MAX_DEPTH}.`);
for (const target of CORPUS_TARGETS) {
  const mine = exhausted.filter((e) => e.target === target);
  const kinds = [...new Set(mine.map((e) => e.kind))].join(', ');
  console.log(`  ${pad(target, 14)}${num(mine.length, 4)}   ${kinds || '—'}`);
}
if (exhausted.length === 0) {
  console.log('\nNothing exhausts the budget, so there is no population to measure and §4 stands');
  console.log('unmeasured where it matters. That is a finding, not a pass.');
  process.exitCode = 1;
}

// ---- the race ---------------------------------------------------------------------------------------

console.log('\n=== the race, on those states only =================================================');
console.log(`${pad('target', 14)}${pad('kind', 13)}${num('method', 8)}${num('steps', 8)}${num('solve', 8)}${num('shorter', 10)}`);

const rows = [];
for (const c of exhausted) {
  const pred = INDEPENDENT_PREDICATE[c.target];
  let lesson = null;
  try {
    lesson = solveByMethod(c.state);
  } catch {
    // §4: a method throw is absorbed, never allowed to delay or discard the pool's answer.
  }
  const method = lesson ? movePrefix(c.state, lesson.alg, pred) : null;
  const atStep = lesson ? stepPrefix(c.state, lesson.steps, pred) : null;
  const whole = await appAnswer(c.state);
  const full = whole === null ? null : movePrefix(c.state, whole, pred);
  const shorter = method === null && full === null ? 'neither'
    : method === null ? 'solve'
    : full === null ? 'method'
    : method.moves < full.moves ? 'method'
    : full.moves < method.moves ? 'solve' : 'equal';
  rows.push({ ...c, method, atStep, full, whole, shorter });
  console.log(`${pad(c.target, 14)}${pad(c.kind, 13)}${num(method?.moves ?? '—', 8)}${num(atStep?.moves ?? '—', 8)}`
    + `${num(full?.moves ?? '—', 8)}${num(shorter, 10)}`);
}

// ---- what it says -------------------------------------------------------------------------------------

console.log('\n=== the finding ====================================================================');
const tally = (v) => rows.filter((r) => r.shorter === v).length;
const both = rows.filter((r) => r.method && r.full);
const mean = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '—');
console.log(`cases                              ${rows.length}`);
console.log(`method prefix strictly shorter     ${tally('method')}`);
console.log(`full-solve prefix strictly shorter ${tally('solve')}`);
console.log(`equal                              ${tally('equal')}`);
console.log(`neither reached the target         ${tally('neither')}`);
console.log(`\nmean method prefix   ${mean(both.map((r) => r.method.moves))}`);
console.log(`mean solve prefix    ${mean(both.map((r) => r.full.moves))}`);
console.log(`worst gap toward method ${both.length ? Math.max(...both.map((r) => r.full.moves - r.method.moves)) : '—'}`);
console.log(`worst gap toward solve  ${both.length ? Math.max(...both.map((r) => r.method.moves - r.full.moves)) : '—'}`);

// The overshoot §6 names in words: no earlier prefix qualifies, so the answer takes the child all
// the way to a solved cube. It has to be SAID rather than presented as the target.
const overshoot = rows.filter((r) => r.full && r.whole && r.full.moves === movesOf(r.whole).length);
console.log(`\novershooting to a solved cube      ${overshoot.length} of ${rows.length}`);
console.log('   — those are the answers §6 requires to be worded "couldn\'t find a short way back to');
console.log('     the top cross; the whole cube in 18" rather than presented as reaching the target.');

// §9.4's price: a method route truncated at a step boundary is resumable; truncated mid-step it is
// half an algorithm. What resumability costs, in moves.
const resumable = rows.filter((r) => r.method && r.atStep);
console.log(`\nprice of resumability (step boundary vs mid-step)`);
console.log(`   mean extra moves  ${mean(resumable.map((r) => r.atStep.moves - r.method.moves))}`);
console.log(`   worst extra moves ${resumable.length ? Math.max(...resumable.map((r) => r.atStep.moves - r.method.moves)) : '—'}`);
console.log(`   already aligned   ${resumable.filter((r) => r.atStep.moves === r.method.moves).length} of ${resumable.length}`);
