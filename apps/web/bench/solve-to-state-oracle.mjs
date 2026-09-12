// The oracle for stage-target distances, and the generator of the frozen fixture it produces.
//
// `node bench/solve-to-state-oracle.mjs`          grade the current engine against the frozen fixture
// `node bench/solve-to-state-oracle.mjs --emit`   recompute every expected distance and rewrite it
//
// WHY AN ORACLE AT ALL. crates/optimal-solver/src/bin/f2l-cross-check.rs states it better than this
// comment could: a heuristic that is wrong high does not crash, it returns a length that is not the
// minimum, and every check that consults the same heuristic agrees with it. So nothing here consults
// the engine's heuristic, its search, its pruning or its bounds.
//
// TWO ORACLES, at two strengths, because they share different amounts with the thing they grade.
//
//   A. **Full-cube breadth-first search, depth <= 5. Shares NOTHING.** Walks real cubes through
//      `cube-pieces.js` and asks the app's own predicates in `methods/engine.js` — a second,
//      independently written definition of each target. No projection is involved at all, so a
//      wrong projection, a wrong goal set, a wrong packing and a wrong table are all visible here.
//
//   B. **Meet in the middle, exact to depth 10. Shares the PROJECTION and nothing else.** A ball of
//      radius 5 is breadth-first searched backwards from the projected goal set, and the query side
//      is a plain forward breadth-first search of radius 5 from the cube. If d <= 10 then writing
//      d = k + m with k, m <= 5 splits an optimal path, so the prefix lands on a state the ball
//      knows exactly, and min over k of (k + ball[s_k]) is the distance. Above 10 no split fits and
//      the answer is reported as "> 10", which is a statement about this oracle and not about the
//      cube.
//
//      That it shares the projection is unavoidable: the target set in the FULL cube is far too
//      large to search backwards from — every cube with a solved cross is about 2.3 x 10^14 states.
//      f2l.rs carries the same dependency and handles it the same way, by pinning the projection
//      against the full cubie model separately. `test/solve-to-state.test.mjs` does that pinning
//      here, and oracle A is the part that needs no pinning at all.
//
// The projections and the engine are `lib/stage-targets.js` and `lib/stage-distance.js` since
// Phase C. They were the Phase 0 spike, now deleted, while it was the only engine there was; the
// sharing is the same sharing and the pinning that pays for it is the same test.
//
// The fixture is FROZEN because a sample redrawn on every run cannot catch a regression. It records
// the scramble rather than the facelets so it is readable, the distance per target, and which oracle
// established each one.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOVE_NAMES, SOLVED, applyAlg, applyMove } from '../lib/cube-pieces.js';
import { TARGETS } from '../lib/stage-targets.js';
import { solveToState } from '../lib/stage-distance.js';
import { seededScrambles } from '../test/fixtures/seeded-scrambles.mjs';
import { INDEPENDENT_PREDICATE } from '../test/fixtures/independent-predicates.mjs';

// ---- the app's own predicates, as a second definition of every target --------------------------
//
// SHARED, not spelled again. This composition had been written twice — here and in
// `test/stage-targets.test.mjs` — and two spellings of "what the top cross is" is the drift this
// repository keeps consolidating out of its seeded generators. `test/fixtures/independent-predicates.mjs`
// holds it, and holds the reason it may never import `lib/stage-targets.js`.

export const PREDICATE = INDEPENDENT_PREDICATE;

// ---- oracle A: full cubes, the app's predicates, nothing shared --------------------------------

const cubeKey = (s) => `${s.cp.join('')}|${s.co.join('')}|${s.ep.join(',')}|${s.eo.join('')}`;

/** Exact distance to `pred`, or null beyond `cap`. Plain breadth-first over real cubes. */
export function fullCubeDistance(state, pred, cap = 5) {
  if (pred(state)) return 0;
  let frontier = [state];
  const seen = new Set([cubeKey(state)]);
  for (let d = 1; d <= cap; d++) {
    const next = [];
    for (const s of frontier) {
      for (const m of MOVE_NAMES) {
        const t = applyMove(s, m);
        const k = cubeKey(t);
        if (seen.has(k)) continue;
        if (pred(t)) return d;
        seen.add(k);
        next.push(t);
      }
    }
    frontier = next;
  }
  return null;
}

// ---- oracle B: meet in the middle over the target's projection ---------------------------------

/** A tuple of projection codes as a short string. Two 16-bit chars per code. */
function tupleKey(codes) {
  let s = '';
  for (const c of codes) s += String.fromCharCode(c & 0xffff, c >>> 16);
  return s;
}

/** Backwards ball of radius `r` around a target's projected goal set. */
export function goalBall(target, r) {
  const parts = [...target.projections];
  // The goal tuples are the cross product of each part's goal codes. Every part here has either one
  // goal code or 81 of them, so the product stays small.
  let tuples = [[]];
  for (const part of parts) {
    const next = [];
    for (const prefix of tuples) for (const g of part.goals) next.push([...prefix, g]);
    tuples = next;
  }
  const ball = new Map();
  let frontier = [];
  for (const t of tuples) {
    const k = tupleKey(t);
    if (!ball.has(k)) { ball.set(k, 0); frontier.push(t); }
  }
  for (let d = 1; d <= r; d++) {
    const next = [];
    for (const t of frontier) {
      for (let m = 0; m < MOVE_NAMES.length; m++) {
        const u = t.map((c, i) => parts[i].stepCode(c, m));
        const k = tupleKey(u);
        if (ball.has(k)) continue;
        ball.set(k, d);
        next.push(u);
      }
    }
    frontier = next;
  }
  return { ball, parts, radius: r, targetId: target.id };
}

/**
 * Exact distance from `state` into `target`, or null beyond `back + forward`.
 *
 * The forward side is a breadth-first search with no heuristic and no pruning beyond not revisiting
 * a projected state. The backward side is the ball. Nothing about the engine takes part.
 */
export function meetInTheMiddle(state, target, prepared, forward = 5) {
  // The ball must be THIS target's. The argument was accepted and then ignored, so handing in another
  // target's ball silently answered that other question — for `SOLVED·U` it returned 0 for `solved`
  // when the answer is 1. Found by audit. Current callers all match, which is exactly why nothing
  // noticed and exactly why it needs saying out loud rather than relying on care.
  if (prepared.targetId !== target.id) {
    throw new Error(`meetInTheMiddle: asked about "${target.id}" with a ball built for "${prepared.targetId}"`);
  }
  const { ball, parts } = prepared;
  const start = parts.map((p) => p.codeOf(state));
  let best = Infinity;
  const hit = ball.get(tupleKey(start));
  if (hit !== undefined) best = hit;
  let frontier = [start];
  const seen = new Set([tupleKey(start)]);
  for (let k = 1; k <= forward && k < best; k++) {
    const next = [];
    for (const t of frontier) {
      for (let m = 0; m < MOVE_NAMES.length; m++) {
        const u = t.map((c, i) => parts[i].stepCode(c, m));
        const key = tupleKey(u);
        if (seen.has(key)) continue;
        seen.add(key);
        const d = ball.get(key);
        if (d !== undefined && k + d < best) best = k + d;
        next.push(u);
      }
    }
    frontier = next;
  }
  return Number.isFinite(best) ? best : null;
}

// ---- the frozen corpus -------------------------------------------------------------------------
//
// Deterministic, from `fixtures/seeded-scrambles.mjs`, which is the repository's one seeded
// generator. Shallow lengths are the population this feature is FOR: a child's mistake is a handful
// of turns from where the cube should have been. The 30-turn entries are the pathological case and
// are in the corpus to be refused honestly rather than to be answered.

export const CORPUS_SEED = 0x5747;

export function corpusCases() {
  // Weighted toward the lengths where the answers are interesting. A one-turn scramble has the same
  // distance to every target and there are only 18 of them, so four draws at that length are three
  // duplicates and no information; the first emitted fixture had "B2" twice for exactly that reason.
  const PER_LENGTH = { 1: 2, 2: 2, 3: 2, 4: 3, 5: 5, 6: 5, 7: 5, 8: 5, 9: 5, 10: 5, 30: 3 };
  const out = [];
  const seen = new Set();
  for (const [len, want] of Object.entries(PER_LENGTH)) {
    const length = Number(len);
    // Draw generously and keep the distinct ones, so a short length cannot silently yield fewer
    // cases than the table says — and so a duplicate never reaches the fixture.
    for (const scramble of seededScrambles(want * 6, CORPUS_SEED + length, length)) {
      if (seen.has(scramble)) continue;
      seen.add(scramble);
      out.push({ length, scramble });
      if (out.filter((c) => c.length === length).length >= want) break;
    }
  }
  return out;
}

const FIXTURE = fileURLToPath(new URL('../test/fixtures/stage-targets.mjs', import.meta.url));

const HEADER = `// Frozen stage-target distances. GENERATED — do not hand-edit.
//
//   regenerate: node apps/web/bench/solve-to-state-oracle.mjs --emit
//   re-verify:  node apps/web/bench/solve-to-state-oracle.mjs
//
// WHY THIS FILE IS FROZEN. A sample redrawn on every run measures; it cannot catch a regression,
// because the thing that changed and the thing being measured move together. These cases were drawn
// once from the repository's one seeded generator, had their distances established by an oracle that
// shares no search with the engine, and were written down. A disagreement is now a failure rather
// than a different sample.
//
// THE SCRAMBLE, not the facelets, because a scramble is readable and regenerates the state exactly
// through cube-pieces.js. \`length\` is how many turns from solved, which is an upper bound on every
// distance in the row and is why the shallow rows are the population this feature is for.
//
// HOW EACH NUMBER WAS ESTABLISHED, per row, in \`by\`:
//   'full'  oracle A — breadth-first over real cubes, the app's own predicates, nothing shared with
//           the engine at all. Exact to 5.
//   'mitm'  oracle B — meet in the middle: a radius-5 ball breadth-first searched backwards from the
//           projected goal, against a radius-5 forward breadth-first search. Exact to 10. Shares the
//           projection with the engine and nothing else; test/solve-to-state.test.mjs pins the
//           projection against the full cubie model separately, which is what that sharing costs.
//   null    beyond 10, which is a statement about the oracle and never about the cube.
//
// Where both oracles answered, they were required to agree, and did.
`;

// ---- run ---------------------------------------------------------------------------------------

// Run only when invoked directly. `test/solve-to-state.test.mjs` imports PREDICATE from here, and
// without this guard that import re-graded all 294 fixture rows on every test run — a module with a
// side effect on import, paying for the same work twice and printing into somebody else's output.
const RUN_DIRECTLY = Boolean(process.argv[1]?.endsWith('solve-to-state-oracle.mjs'));
const EMIT = process.argv.includes('--emit');
const BACK = 5;
const FORWARD = 5;

const cases = RUN_DIRECTLY ? corpusCases() : [];
const states = cases.map((c) => ({ ...c, state: applyAlg(SOLVED, c.scramble) }));

if (!RUN_DIRECTLY) {
  // imported for its predicates and its oracles; nothing runs
} else if (EMIT) {
  const rows = states.map((c) => ({ length: c.length, scramble: c.scramble, d: {}, by: {} }));
  let crossChecks = 0;
  for (const target of TARGETS) {
    const t0 = Date.now();
    const prepared = goalBall(target, BACK);
    const built = Date.now() - t0;
    let agreed = 0, checked = 0;
    for (let i = 0; i < states.length; i++) {
      const { state } = states[i];
      const mitm = meetInTheMiddle(state, target, prepared, FORWARD);
      const full = fullCubeDistance(state, PREDICATE[target.id], 5);
      // Where oracle A reached, the two must agree. That check is the whole reason A exists: it is
      // the only one that does not touch the projection.
      if (full !== null) {
        checked++;
        if (full !== mitm) {
          throw new Error(`${target.id} / ${c_label(states[i])}: oracle A says ${full}, oracle B says ${mitm}`);
        }
        agreed++;
      }
      rows[i].d[target.id] = mitm;
      rows[i].by[target.id] = full !== null ? 'full' : mitm !== null ? 'mitm' : null;
    }
    crossChecks += agreed;
    console.error(`${target.id.padEnd(14)} ball ${String(prepared.ball.size).padStart(8)} states in ${String(built).padStart(5)} ms   oracle A reached ${agreed}/${checked} and agreed on all`);
  }
  const body = rows.map((r) => `  { length: ${r.length}, scramble: ${JSON.stringify(r.scramble)},\n`
    + `    d: ${JSON.stringify(r.d)},\n`
    + `    by: ${JSON.stringify(r.by)} },`).join('\n');
  writeFileSync(FIXTURE,
    `${HEADER}\nexport const TARGET_IDS = ${JSON.stringify(TARGETS.map((t) => t.id))};\n\n`
    + `export const STAGE_TARGET_CASES = Object.freeze([\n${body}\n].map(Object.freeze));\n`);
  console.error(`\nwrote ${FIXTURE}\n${rows.length} cases x ${TARGETS.length} targets; oracle A agreed with oracle B on ${crossChecks} of them`);
} else {
  const { STAGE_TARGET_CASES } = await import('../test/fixtures/stage-targets.mjs');
  let pass = 0, fail = 0;
  for (const row of STAGE_TARGET_CASES) {
    const state = applyAlg(SOLVED, row.scramble);
    for (const target of TARGETS) {
      const want = row.d[target.id];
      const got = solveToState(target, state, { nodeBudget: 4_000_000, maxDepth: 14 });
      const ok = want === null ? got.moves === null || got.moves > 10 : got.moves === want;
      if (ok) pass++;
      else { fail++; console.log(`FAIL ${target.id} ${row.scramble}: frozen ${want}, engine ${got.moves}`); }
    }
  }
  console.log(`graded against the frozen fixture: ${pass} agree, ${fail} disagree`);
  if (fail) process.exitCode = 1;
}

function c_label(c) { return `${c.length}-turn ${c.scramble}`; }
