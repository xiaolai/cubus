// A layer-by-layer solver, written for explanation rather than for length.
//
// The two-phase solver (lib/two-phase.js) answers "give me a short way out of here" — a
// compact, bounded answer, not a provable minimum.
// This one answers a different question — "why is this move right" — and the two cannot be the
// same code. A 19-move two-phase solution has no explicable structure: there is no reason move
// seven is R2 beyond "the pruning table said so", and nothing about it transfers to the next
// solve. So this solver is deliberately longer and deliberately staged, because the stages ARE
// the explanation.
//
// WHAT THIS FILE IS, after the split of 2026-09-08 (dev-docs/method-solver-return-plan.md §1):
// the driver, and nothing else. It walks a method's stage list, checks each stage's contract,
// and guards the assembly. The search machinery is `methods/engine.js`; the stages themselves are
// the rung files under `methods/`.
//
// The removed version took a `level` and branched on it — `if (level === 'beginner') …` — which
// meant a third rung was a third arm of an `if` and another function alongside `f2lStage`. That
// is why `LEVELS` never grew past two. There is no `level` here, and there is no `rung` read
// anywhere in this file: a method is DATA, and the engine is invariant under it.
//
// Two kinds of step, because there are two kinds of "why":
//   'goal'  — an intuitive stage. The reason is what the move ACHIEVES: this brings the piece
//             to the top without disturbing the cross. Found by a shallow search.
//   'case'  — an algorithmic stage. The reason is which case this is and what the whole
//             algorithm does. Per-move reasons do not exist here and pretending otherwise
//             would be inventing them.

import { applyAlg, rotateAlg } from './cube-pieces.js';
import {
  MethodSolverError, algLength, fromRepertoire, repertoire, repertoiresBuilt, shortestTo,
  simplify, slotSafe, wholeCubeSolved,
} from './methods/engine.js';
import { crossTable, solveCrossWhole, warmCrossTable } from './methods/cross.js';
import { f2lCaseName } from './methods/pairs.js';
// `methodFor` alone: everything else from the ladder is re-exported below without being read here.
import { methodFor } from './methods/index.js';

export { MethodSolverError } from './methods/engine.js';

/**
 * Build the cross rung's distance table now, rather than during the first lesson that needs it.
 *
 * Exported so the app can pay 800 ms somewhere nobody is waiting. It is idempotent — the table is
 * built once and kept — so calling it early costs nothing and calling it twice costs nothing.
 *
 * **Asynchronous, and in slices.** The build explores 190,081 positions and measured 114 ms as one
 * task; `setTimeout` moved when that task ran and not that it was one task, so it still landed as
 * a single block of dropped frames. This yields between slices, so a warm-up is spread across the
 * event loop instead of wedged into one turn of it. Nothing waits on the result: a solve that
 * arrives first finishes the table synchronously and is no worse off than before.
 */
export const warmCross = () => warmCrossTable();

export {
  CASE_NAMES, DEFAULT_RUNGS, LADDER, STAGE_IDS, TOP_RUNG, allRungCombinations, methodFor, rungKey,
} from './methods/index.js';

/**
 * A cube, as this solver is willing to be handed one.
 *
 * `{ cp, co, ep, eo }` in cubejs's (Kociemba's) convention, the model `cube-pieces.js` defines:
 * `cp[i]` is the CUBIE sitting in corner slot `i` and `co[i]` its twist in thirds; `ep`/`eo` the
 * same for the twelve edges, flip measured against the F/B axis. The cross goes on D. Slot index
 * equals cubie index, so `EDGE.DF` is both "the DF slot" and "the cubie that belongs there".
 *
 * Checked rather than assumed, because this is the module's boundary. An unsolvable arrangement
 * is REFUSED by the search itself — that is `MethodSolverError`'s whole job, and it is a real
 * answer about a real cube. A malformed OBJECT is a different thing: a missing array or a twist of
 * 3 is not a cube at all, and left unchecked it surfaced as an incidental `TypeError` from
 * somewhere three modules down, or (worse) as a value silently normalised by the first move.
 */
function checkedCopy(state) {
  const bad = (why) => { throw new Error(`solveByMethod: ${why}`); };
  const arr = (name, want, limit) => {
    const a = state?.[name];
    if (!Array.isArray(a) || a.length !== want) bad(`${name} must be an array of ${want}`);
    for (const v of a) {
      if (!Number.isInteger(v) || v < 0 || v >= limit) bad(`${name} holds ${v}, which is not 0..${limit - 1}`);
    }
    return [...a];
  };
  const cp = arr('cp', 8, 8);
  const co = arr('co', 8, 3);
  const ep = arr('ep', 12, 12);
  const eo = arr('eo', 12, 2);
  // Permutations, not merely arrays of legal values: a duplicated cubie is a cube with two of one
  // piece, which every predicate downstream would answer questions about as if it existed.
  if (new Set(cp).size !== 8) bad('cp is not a permutation of the eight corners');
  if (new Set(ep).size !== 12) bad('ep is not a permutation of the twelve edges');
  return { cp, co, ep, eo };
}

/**
 * Solve `state` by a layer-by-layer method.
 *
 * `state` is a cube in the `{ cp, co, ep, eo }` model above. `method` is a stage list — see
 * `methods/index.js` and `methodFor(rungs)`. The default is the bottom rung of every stage, which
 * is what a learner who has chosen nothing is shown.
 *
 * Returns `{ steps, alg, moveCount, method, rungs }`:
 *
 * - `steps` — the lesson. Each is `{ stage, kind, target, alg, caseName?, parts?, why }`, where
 *   `kind` is `'goal'` (an intuitive step, whose reason is what it achieves) or `'case'` (a named
 *   algorithm), and `why` is `{ key, … }` — a reason key plus the pieces it names, which is the
 *   focus/highlight payload `method-lesson.js` turns into cues.
 * - `alg` — the concatenation of the steps, and exactly that, so the move list and the animation
 *   cannot disagree.
 * - `moveCount` — HTM face turns. Every step's alg is `[URFDLB]['2]?` only: the renderer, the 2D
 *   net and the move list speak nothing else.
 *
 * Throws `MethodSolverError` rather than returning a partial solution: a stage that cannot be
 * reached means the repertoire is wrong, and half a solution is worse than none for someone
 * following along.
 */
export function solveByMethod(state, method = methodFor()) {
  if (!method || !Array.isArray(method.stages)) {
    throw new Error('solveByMethod needs a method — build one with methodFor(rungs)');
  }
  const steps = [];
  const start = checkedCopy(state);
  let s = clone(start);

  for (const stage of method.stages) {
    // The composition claim, made mechanical. §2 says every stage ends at a state predicate that
    // the next stage's `keep` begins from — so the rungs compose. Asserting that in prose is what
    // a per-method test cannot see; checking it here means a rung that quietly narrowed its
    // contract fails at the seam it broke, naming the stage, rather than 40 moves later.
    // A FROZEN snapshot, not the live cube. A predicate is asked a question; one that answers by
    // editing the state the replay is about to start from can make "before" equal to the state it
    // wanted to claim, and the stage then emits nothing while every guard passes.
    if (!stage.keep(frozenCube(s))) throw new MethodSolverError(stage.id, 'keep', s);
    // **The verification's inputs are the stage's, copied.** Both of these were aliases until the
    // audit of 2026-09-09, and the consequence was not subtle: a stage that overwrote the arrays
    // it was handed could make the "before" the replay starts from equal to the state it wanted to
    // claim, and emit nothing at all. An `R` scramble came back with an empty solution and every
    // guard passed — because every guard was reading the object the stage had just edited.
    //
    // Same for the steps. A stage was handed the whole history and could rewrite an earlier
    // stage's algorithm after that stage had been verified; a lesson came back as `R R'` with the
    // cross contract false behind it. Each stage now appends to its own array.
    const before = clone(s);
    const mine = [];
    const returned = stage.run(clone(s), mine);
    // **The steps are ADOPTED: checked, deep-copied and frozen, before anything is replayed
    // through them.** Two reasons, and both were live.
    //
    // `steps.push(...mine)` shared the stage's own objects, so a stage holding on to an array it
    // filled could rewrite an earlier step after that stage had been verified — a lesson came back
    // as `R R'` with the cross contract false behind it. The history now holds copies nobody else
    // has a reference to.
    //
    // And a step was never checked for being one. A null entry, a missing `alg`, or a token the
    // renderer cannot animate surfaced as a `TypeError` from inside `applyAlg` — an incidental
    // error that throws away the stage name, the step index and the state the replay started
    // from, which are the three things anyone debugging it needs.
    const adopted = adopt(mine, stage, before);
    // **The contract is checked on the REPLAY, not on what the stage handed back.** Those are two
    // different claims, and only one of them is about the lesson: a stage could return a state its
    // own steps do not reach, and the assembly guard would not notice as long as a later stage's
    // moves happened to cancel the difference. Then the stage boundary the learner is shown — "the
    // cross is done here" — would be false while everything else passed. Replaying costs one pass
    // over the moves this stage just emitted.
    s = adopted.reduce((cube, step) => applyAlg(cube, step.alg), before);
    // Shape-checked before it is compared. A stage that forgets to return, or returns something
    // that is not a cube, is a defect in the stage — and reporting it as an incidental TypeError
    // from inside `sameCube` throws away the stage name and the replay this driver exists to give.
    if (!isCube(returned) || !sameCube(s, returned)) {
      throw new MethodSolverError(stage.id, 'replay', before);
    }
    if (!stage.contract(frozenCube(s))) throw new MethodSolverError(stage.id, 'contract', s);
    steps.push(...adopted);
  }

  // Per step, never across them: a step is a thing the learner performs as a unit, and merging
  // over a boundary would make the move list disagree with the lesson.
  //
  // A new array, returned. `steps` is this function's own — the stages append to it and nothing
  // outside holds it — so emptying it and spreading the result back in was copying twice to end
  // up where a plain assignment already was.
  const simplified = steps
    .map((step) => ({ ...step, alg: simplify(step.alg) }))
    .filter((step) => step.alg.length > 0);

  const alg = simplified.map((step) => step.alg).filter(Boolean).join(' ').trim();
  // The last guard: the concatenation must actually solve the cube we were given. Every stage
  // already checked its own goal, so this can only fail if a stage's invariant was too weak —
  // which is precisely the bug a per-stage check cannot see.
  if (!wholeCubeSolved(applyAlg(start, alg))) {
    throw new MethodSolverError('assembly', 'whole-cube', start);
  }

  return { steps: simplified, alg, moveCount: algLength(alg), method: method.id, rungs: method.rungs };
}

/** The four arrays, copied — so nothing downstream can edit what a check is about to read. */
const clone = (s) => ({ cp: [...s.cp], co: [...s.co], ep: [...s.ep], eo: [...s.eo] });

/** A cube a predicate cannot write to. Copied first, so freezing is not imposed on the caller's. */
const frozenCube = (s) => Object.freeze({
  cp: Object.freeze([...s.cp]),
  co: Object.freeze([...s.co]),
  ep: Object.freeze([...s.ep]),
  eo: Object.freeze([...s.eo]),
});

/** A deep copy that nobody can edit — arrays and plain objects all the way down. */
const snapshot = (value) => {
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, snapshot(v)]),
    ));
  }
  return value;
};

/** The only tokens the renderer, the 2D net and the move list speak. */
const FACE_TURN = /^[URFDLB][2']?$/;

/**
 * Every step a stage emitted, checked and frozen — or a `MethodSolverError` naming which one.
 *
 * The check is not defensive padding: a step with a token nobody can animate is a lesson that
 * shows a learner a move the cube will not make, and `applyAlg` reports it as a bare `TypeError`
 * with none of the context this driver exists to attach.
 */
function adopt(steps, stage, before) {
  const refuse = (i, why) => {
    throw new MethodSolverError(stage.id, `step ${i}: ${why}`, before);
  };
  return steps.map((step, i) => {
    if (!step || typeof step !== 'object') refuse(i, `is ${step === null ? 'null' : typeof step}, not a step`);
    if (typeof step.alg !== 'string') refuse(i, 'carries no algorithm');
    if (typeof step.stage !== 'string' || !step.stage) refuse(i, 'names no stage');
    for (const move of step.alg.trim().split(/\s+/).filter(Boolean)) {
      if (!FACE_TURN.test(move)) refuse(i, `carries "${move}", which is not a face turn`);
    }
    return snapshot(step);
  });
}

/** Does this look like a cube at all? Shape only; `checkedCopy` is the boundary that checks
 *  values, and this is the cheap guard a stage's RETURN goes through. */
const isCube = (s) => Boolean(s)
  && Array.isArray(s.cp) && s.cp.length === 8 && Array.isArray(s.co) && s.co.length === 8
  && Array.isArray(s.ep) && s.ep.length === 12 && Array.isArray(s.eo) && s.eo.length === 12;

/** Two cubes are the same cube when all four arrays agree. */
const sameCube = (a, b) => ['cp', 'co', 'ep', 'eo'].every(
  (k) => a[k].every((v, i) => v === b[k][i]),
);

export const __testing = {
  rotateAlg, shortestTo, fromRepertoire, repertoire, simplify, solveCrossWhole, crossTable,
  f2lCaseName, slotSafe, repertoiresBuilt,
};
