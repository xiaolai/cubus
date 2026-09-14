// The cube the screens are about — the subject: ingesting a reading, classifying it, solving and
// deriving its walk, adopting an answer only once it checks out, and the lesson built for it.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { GODS_NUMBER, describe, refine, tierByName } from './solve-target.js';
import { provenAnswer } from './optimal-challenges.js';
// The explaining solver, returned 2026-09-08 (dev-docs/method-solver-return-plan.md). It answers
// a different question from the two-phase solver — "why is this move right" rather than "how
// short can this be" — so the two are two OBJECTS on this screen, never one standing where the
// other was. That rule is what the first attempt broke; §3 of the plan is about it.
import { fromCube, movesOf } from './cube-pieces.js';
import { methodFor, solveByMethod } from './method-solver.js';
import { lessonCues, lessonSections, moveStepIndex, rungSummary } from './method-lesson.js';
import { acceptOffer } from './method-ladder.js';
import { isCubeState } from './cube-trust.js';
// How the cube is held while it is solved, and the renamings between the scan frame, the method
// frame and the hold (ADR 0003). Every crossing between those frames in this file goes through it.
import { METHOD_TO_SCAN, renameAlg, renameSelectors, toMethodFrame } from './solving-hold.js';

import { SOLVED, state } from './app-state.js';
import { save, settings } from './app-settings.js';
import { Cube, challenges, invertAlg, solverWorker } from './solver-service.js';

// Record a scanned/known facelet state. Ingesting a state and DERIVING from it are separate
// costs, and they used to be one call.
//
// Storing facelets is free. Working out the setup alg is a full Kociemba search, and it ran on
// every arriving snapshot — the cube emits those at ~1Hz for as long as it is connected, on the
// UI thread, for a solution most of them never need. Screens that want the derived values ask for
// them; the live path just records what the cube says.
export function ingestFacelets(f) {
  const c = state.cube;
  c.facelets = f;
  c.solution = ''; c.moves = []; c.stepFacelets = []; c.solveResult = null; c.solvedFor = null;
  // The lesson is about the arrangement it was worked out for. Carried across a new one it would
  // caption a walk with another cube's steps — the exact failure that made the first attempt look
  // like a broken solver.
  c.lesson = null;
  c.setupAlg = ''; c.derived = false; c.unsolvable = false; c.crossChecked = false;
}

// `movesOf` is imported from `cube-pieces.js`: the move list, the lesson's move counts and the
// solver's own `algLength` all have to agree on what a move is, and they were three functions.

/**
 * The lesson for the current arrangement, at the rungs this learner is on.
 *
 * Synchronous, and on this thread on purpose: it needs no search worth moving off it, and it runs
 * inside the "working…" the two-phase solve is already showing. **Measured on this machine,
 * 2026-09-09** — the earlier "~13 ms" in this comment was the plan's 2026-08 figure for the
 * removed solver and was not true of this code on this hardware:
 *
 *   rung 0 everywhere      33 ms
 *   cross rung 1, warm     97 ms
 *   cross rung 1, first   804 ms  — the 331,776-entry cross distance table, built once
 *
 * The first-call figure is why `warmCrossTable` exists. Cached against the arrangement AND the
 * rung record, so raising a rung produces a new lesson rather than showing the old one under a
 * new name.
 *
 * Returns null rather than throwing on a cube the method cannot finish: the Solution is still
 * there, and a screen that lost both objects because one of them failed would be worse than one
 * that quietly offers the other. `MethodSolverError` carries the stage, so the reason is logged
 * rather than swallowed.
 */
export function lessonFor(c = state.cube) {
  const method = methodFor(settings.rungs);
  if (c.lesson && c.lesson.facelets === c.facelets && c.lesson.method === method.id) return c.lesson;
  let result;
  try {
    // IN THE METHOD FRAME, so the cross it builds is the WHITE one (ADR 0003). The solver puts the
    // cross on its own D; handed the scan frame, where D is yellow, it taught a yellow cross first.
    result = solveByMethod(fromCube(Cube.fromString(toMethodFrame(c.facelets))), method);
  } catch (err) {
    console.warn('method solver: no lesson for this cube', err);
    return null;
  }
  // …and the walk lives in the scan frame, like every other walk: the renderer, `follow` and the
  // smart cube all compare against scan-frame states. SO DOES EVERY STEP, converted once, here: its
  // moves renamed, and the pieces it points at worked out and renamed into `focus` and `highlight`,
  // so nothing downstream has a frame to remember. What stays the solver's is `why`, whose key and
  // wording are frame-free and whose piece indices have already become those two cues.
  const lessonAlg = renameAlg(result.alg, METHOD_TO_SCAN);
  const moves = movesOf(lessonAlg);
  const steps = Object.freeze(result.steps.map((step) => {
    const cues = lessonCues(step);
    return Object.freeze({
      ...step,
      alg: renameAlg(step.alg, METHOD_TO_SCAN),
      // The solver names pieces in the METHOD frame and the renderer draws the scan frame, so the
      // white-blue edge a step calls DF is UB on screen. Unrenamed, the pulse lands on the
      // yellow-green edge — a real piece, pointed at with total confidence.
      focus: renameSelectors(cues.focus, METHOD_TO_SCAN),
      highlight: renameSelectors(cues.highlight, METHOD_TO_SCAN),
    });
  }));
  c.lesson = {
    facelets: c.facelets,
    method: method.id,
    rungs: result.rungs,
    summary: rungSummary(method),
    steps,
    sections: lessonSections(steps),
    // Which step each move belongs to, so the walk can point at what the move you are on is for.
    moveStep: moveStepIndex(steps),
    alg: lessonAlg,
    moves,
    stepFacelets: stepStates(c.facelets, moves),
  };
  return c.lesson;
}

/**
 * What the stored facelets ARE, before anything searches: a walk to make, nothing to do, or an
 * arrangement no cube can be turned into. Idempotent; every reader of `solvable` or `unsolvable`
 * goes through here first.
 *
 * SYNCHRONOUS AND TABLE-FREE, which is the whole point. This used to run `cube.solve()` — a
 * Kociemba search on the UI thread — which is the only reason `Cube.initSolver()`'s ~1 s table
 * build was ever a boot cost. Neither is needed to answer what the screens actually ask:
 *
 *   * **A legal cube that is not solved HAS a walk.** God's number says every one of the
 *     43,252,003,274,489,856,000 legal positions has a solution of 20 moves or fewer, so "is
 *     there one" is a fact about the cube rather than something a search establishes. Which one
 *     it is, is the pool's job (deriveCube).
 *   * **A state that is not legal has none, and legality is arithmetic.** cubejs's parser plus
 *     the four classical conditions — `isCubeState` in lib/cube-trust.js, the same gate the cube
 *     registry and the reconnect readings go through, so a string one of them accepts and
 *     another refuses cannot drift apart. Microseconds, and no table anywhere.
 *
 * The old code could not tell the two apart at all: handed a twisted corner, cubejs's `solve()`
 * returns a well-formed 16-move alg that does not solve it (measured 2026-09-05), so the screen
 * went walking, the engine refused the state, and eight budget escalations later `failWalk` said
 * "could not work it out" — blaming a search for something parity had already settled.
 */
export function classifyCube() {
  const c = state.cube;
  if (c.derived) return c;
  // A solved cube has no walk, and needs no library to say so. Asked for one anyway, cubejs's
  // two-phase search answers the identity with a 14-move no-op ("R L U2 R L F2 R2 U2 R2 F2 R2 U2
  // F2 L2"), so "the solver returned moves" was never evidence of anything to follow — every
  // fresh launch put a transport under the solved cube reading 0 / 0, its done tick already lit.
  if (c.facelets === SOLVED) {
    c.setupAlg = ''; c.solvable = false; c.unsolvable = false; c.derived = true;
    return c;
  }
  if (!Cube) {
    // No parser yet, so legality is not knowable — and an unknown must never be reported as a
    // verdict ("Never invent data"). The best that can be said is "not the solved state".
    // Deliberately NOT marked derived, so the real classification still happens once cubejs
    // arrives. Gated on `Cube` rather than on `solverReady` because the parser is the thing this
    // needs, and there is no longer anything else to be ready.
    c.solvable = true; c.unsolvable = false;
    return c;
  }
  c.derived = true;
  c.unsolvable = !isCubeState(c.facelets, Cube);
  c.solvable = !c.unsolvable;
  return c;
}

/**
 * The walk for the stored facelets, worked out THROUGH THE POOL — never on this thread.
 *
 * The setup alg (solved -> this arrangement, the path the 3D twin animates from) used to be its
 * own Kociemba search here, over the same state, for the same answer the pool is asked for
 * anyway. It is the inverse of that answer: `finishSolve` takes it, checked (takeSetupAlg), for
 * every path a solution can arrive by. So this is classification plus the one ask.
 *
 * Throws for a subject with no walk. That cannot happen down the ordinary route — the screen's
 * composition is chosen from `classifyCube()` and a cube with nothing to walk draws no solution
 * card — but a live snapshot can replace the subject inside the await this stands in front of,
 * and an empty chip grid under a count reading "0" would be the screen quietly lying about a
 * cube it cannot walk.
 */
export async function deriveCube(opts = {}) {
  const c = classifyCube();
  if (!c.solvable) throw new Error('nothing to walk on this cube');
  await solve(opts);
  return c;
}

/** Ingest AND classify — for callers that are about to read `solvable` immediately. */
export function setFacelets(f) {
  ingestFacelets(f);
  classifyCube();
}

/**
 * The setup alg, taken from the solution the pool already found — CHECKED, never trusted.
 *
 * A solution takes this arrangement to solved, so its inverse takes solved to this arrangement:
 * one search yields both halves. That is the rule the scramble side has followed since
 * 2026-08-29 ("inverting the setup alg already IS one search"), applied to the other direction —
 * `invertAlg` is an involution, so there is one rule and not two. It replaces the Kociemba search
 * `deriveCube` used to run on the UI thread for exactly this, and with it the cubejs tables that
 * search needed.
 *
 * `reaches()` is what makes it a fact rather than an assumption: applying the alg to a solved
 * cube must reproduce the facelets — a couple of dozen move applications, microseconds against
 * the search it replaces, and the same check `takeDerivation` puts a carried alg through. A
 * disagreement leaves the setup alg EMPTY rather than wrong, and says so: `newCube` then draws
 * the arrangement instead of animating a walk that does not lead to it.
 */
function takeSetupAlg(c, solution) {
  // Already carried in with the cube and already checked (takeDerivation), or already taken from
  // an earlier solve of this same arrangement.
  if (c.setupAlg) return;
  const setupAlg = invertAlg(solution);
  if (!reaches(c.facelets, setupAlg)) {
    console.error('the inverse of the solution does not reach the cube it solves — no setup alg to animate from', { solution });
    return;
  }
  c.setupAlg = setupAlg;
}

/**
 * Whatever produced the solution, this is what makes it usable — and what checks it.
 *
 * Both solvers end here on purpose. The oracle cross-check, the per-step facelets and the setup
 * alg are not properties of one search or the other, and having two copies is how one of them
 * would quietly stop being verified.
 */
function finishSolve(c, alg) {
  const solution = alg;
  const moves = movesOf(solution);
  // Oracle cross-check: only a definite refutation (parses AND does not solve) blocks.
  let verified = null;
  try { verified = Cube.fromString(c.facelets).move(solution).isSolved(); } catch (err) {
    // Deliberately non-blocking: an oracle that cannot PARSE the alg has refuted nothing, and
    // failing closed here would take solving down whenever the solver emits notation cubejs
    // does not read. But it must not be silent — a cross-check that quietly stops running looks
    // exactly like one that keeps passing.
    console.warn('cubejs cross-check could not run; solution accepted unverified', err);
  }
  if (verified === false) throw new Error('solver cross-check failed — re-scan');
  c.solution = solution; c.moves = moves;
  // Per-step facelets so the 2D net + move list can co-move with the 3D animation.
  c.stepFacelets = stepStates(c.facelets, moves);
  // True only when the oracle actually SAID yes. An oracle that could not run refuted
  // nothing — but it verified nothing either, and marking that "checked" would let an
  // unverified solution be reused forever. Left false, the next solve() retries the check.
  c.crossChecked = verified === true;
  // And the other half of the same answer. After the refutation gate, not before it: a solution
  // the oracle rejects must not leave a setup alg behind for the next screen to animate from.
  takeSetupAlg(c, solution);
  return solution;
}

/** Commit an answer and what it is. The oracle runs first (finishSolve); only an answer it did not
 *  refute gets its verdict and its tier, so a refuted one leaves no "target met" over an empty
 *  solution and no proof label over a cube nobody proved. */
function commitAnswer(c, alg, verdict, solvedFor) {
  const solution = finishSolve(c, alg);
  c.solveResult = verdict;
  c.solvedFor = solvedFor;
  return solution;
}

/** Tiers an answer can answer beyond its own: a proven minimum answers every one, and a carried
 *  answer kept only the God's-number promise (rollScramble asks for nothing more). */
const ANY_TIER = '*';
const GODS_NUMBER_ONLY = 'gods-number';
const answersTier = (solvedFor, tier) => solvedFor === ANY_TIER || solvedFor === tier
  || (solvedFor === GODS_NUMBER_ONLY && tierByName(tier).target === GODS_NUMBER);

/**
 * Work out the solution, as short as this learner's tier asks for, and cross-check it.
 *
 * The tier is a solution LENGTH, not an effort — "twenty moves or fewer" is a thing a person can
 * hold. Under 20 is reached on every cube and costs ~6 ms, so the default rung is invisible; the
 * tighter ones take seconds, which is why the search runs in a worker and reports each
 * improvement as it finds one rather than making anyone wait for the last.
 *
 * `onImprovement` is called with every strictly shorter answer, so a screen can show 21 becoming
 * 20 becoming 19 instead of a spinner. The promise resolves with the final one.
 *
 * `signal` stops a search whose subject has been replaced. A cancelled search is SUPERSEDED, not
 * failed: it throws an AbortError, which callers recognise and say nothing about — the walk that
 * replaced it is the one on screen, and an error message about the cube it abandoned would be
 * about a cube nobody is looking at. `onProgress` is the engine's "still going", forwarded.
 */
async function solve({ onImprovement, onProgress, signal } = {}) {
  /** The one shape a superseded search reports with. `AbortError` rather than a sentinel value
   *  because every caller already has a catch, and a sentinel returned through one is a value
   *  that gets committed by whoever forgets to check it. */
  const aborted = () => Object.assign(new Error('solve: superseded'), { name: 'AbortError' });
  if (signal?.aborted) throw aborted();
  const c = state.cube;
  // There used to be a "the setup alg is stale — recompute now" line here, which called back into
  // deriveCube for a second Kociemba search on this thread. The setup alg is now the INVERSE of
  // the answer this function is about to produce (takeSetupAlg, from finishSolve), so a stale one
  // is repaired by the search that was going to run anyway rather than by one of its own.
  // Reused only under a tier it answers: a carried answer under <= 18 is searched again, not shown
  // as though it met a tier nobody asked it about (found by audit, 2026-09-13).
  const tier = settings.solveTier;
  const held = Boolean(c.solution) && answersTier(c.solvedFor, tier);
  if (held && c.crossChecked) return c.solution;
  if (held) {
    // A solution that arrived WITHOUT a search — the inverse of a setup alg the worker already
    // found (the scramble hand-off). There is nothing to search for, but the oracle discipline
    // is unchanged: finishSolve applies it through cubejs — move application, ~µs, no search —
    // and a definite refutation blocks exactly as it does on the searched path.
    return finishSolve(c, c.solution);
  }

  // Already proved, offline, by crates/optimal-solver — so there is nothing to search for and
  // nothing to prove. This is the whole point of shipping the library as data: the minimum for
  // these states is a fact we carry, not a computation the device repeats. finishSolve still
  // applies it through the cubejs oracle, so a library entry gets exactly the same refutation
  // every searched answer gets; what it skips is the search, not the check.
  const proven = provenAnswer(challenges, c.facelets);
  if (proven) {
    const solution = commitAnswer(c, proven.alg, { key: 'solve.provenMinimum', moves: proven.moves }, ANY_TIER);
    onImprovement?.({ alg: proven.alg, moves: proven.moves, target: null, met: true, stopped: 'met' });
    return solution;
  }

  const client = solverWorker();
  // Captured: the search is about THIS arrangement. A live snapshot can re-ingest the cube
  // mid-await, and committing this search's answer onto the new subject would pair a solution
  // with a cube it does not solve. (The oracle in finishSolve would catch it loudly — this
  // makes it a clean refusal instead of a confusing one.)
  const searched = c.facelets;
  /** Replaced while this ran — by the caller's abort, or by a live report, which ingests without
   *  cancelling anybody. Asked at every yield, so nothing more is shown or searched for a cube that
   *  is no longer the subject: leaving the loop is what ends refine's searches. */
  const superseded = () => signal?.aborted || c.facelets !== searched;
  let result = null;
  try {
    for await (const step of refine(searched, {
      // Asked before every request, not only at a yield: a first search the engine keeps refusing
      // escalates without yielding, and went on asking for a cube that had gone (found by
      // verification, 2026-09-14). Thrown in the superseded shape, which refine does not catch.
      solve: (facelets, bounds) => {
        if (superseded()) throw aborted();
        return client.solve(facelets, bounds);
      },
      tier,
      signal,
      onProgress: onProgress && ((p) => { if (!superseded()) onProgress(p); }),
      // A carried answer this tier does not accept still bounds the search: it starts below it, so a
      // budget that stops longer cannot replace it (found by verification, 2026-09-14).
      start: c.solution || null,
    })) {
      result = step;
      if (superseded()) throw aborted();
      onImprovement?.(step);
    }
  } catch (err) {
    // No request follows the last attempt the first search is allowed, so the guard above never
    // saw a subject replaced while that one ran: the search ended in refine's own escalation
    // error, an ordinary Error about a cube nobody is looking at (found by verification,
    // 2026-09-14). Whatever ends a superseded search, it ends as supersession.
    if (superseded()) throw aborted();
    throw err;
  }
  // Two ways to come back with nothing: cancelled before the first answer (refine yields nothing
  // at all), or cancelled between yields. Both are superseded, and neither may reach
  // `finishSolve` — `result.alg` on null is a TypeError dressed as a solver failure.
  if (superseded() || result === null) throw aborted();
  // Never inferred from the move count: a tier the cube cannot reach (18 does not exist for
  // every position) must read as "the shortest I found", not as the target met.
  return commitAnswer(c, result.alg, describe(result), tier);
}

/**
 * Take a setup alg the caller already holds instead of searching for it again.
 *
 * A generated cube arrives WITH its alg (randomScramble does one search and returns both), and
 * deriving it again is the same Kociemba search over the same state for the same answer — the
 * biggest cost of pressing the die, paid on the click, between the old paint and the new one.
 *
 * CHECKED, never trusted: the alg must reproduce `facelets` when applied to a solved cube. That
 * is a couple of dozen move applications — microseconds against the search it replaces — so the
 * shortcut is free AND cannot install a walk that does not lead to the cube on screen. A
 * disagreement means the caller paired the two wrongly; it says so and leaves the state
 * underived, so the pool's answer supplies the alg after all rather than the app drawing a lie.
 */
/** Does applying `setupAlg` to a solved cube produce exactly `facelets`? Move application only —
 *  microseconds, and no search. The one check that makes a setup alg from anywhere usable. */
export function reaches(facelets, setupAlg) {
  if (!Cube) return false;
  try { return Cube.fromString(SOLVED).move(setupAlg).asString() === facelets; } catch { return false; }
}

export function takeDerivation(facelets, setupAlg) {
  if (!Cube) return;
  const c = state.cube;
  if (!reaches(facelets, setupAlg)) {
    console.error('setup alg does not reach the cube it came with — deriving instead', { setupAlg });
    return;
  }
  // Whether there is a walk is a fact about the ARRANGEMENT, never about an alg having come with
  // it: `R R'` reaches the solved cube, which has nothing to walk.
  if (!classifyCube().solvable) return;
  // Written BEFORE the commit, so takeSetupAlg inside finishSolve takes its "already carried in
  // and already checked" branch instead of re-deriving and re-checking the alg handed in here.
  c.setupAlg = setupAlg;
  try {
    // ONE CHECKED-SOLUTION COMMIT PATH (2026-09-05). This function used to repeat all of
    // finishSolve — the oracle applying the solution, the assignment, the tokenizer, the
    // per-step states — and then set `crossChecked = false`, so the first use of the cube ran
    // every one of them a second time (`solve()` answers a carried solution by calling
    // finishSolve). Two copies of one rule is how one copy quietly stops being verified, and
    // this one had already drifted: the flag said "unverified" about a check cubejs had just
    // performed and passed.
    //
    // The oracle rule is unchanged, only spelled once: `crossChecked` is true because cubejs
    // ACTUALLY SAID YES — it applied this solution to these facelets and found them solved —
    // and false whenever it could not run. That is an independent check now in a way the old
    // comment here predates: the alg comes from the two-phase engine (rollScramble inverts the
    // pool's answer, 2026-08-31), so this is cubejs checking a different implementation's work,
    // where it used to be cubejs checking cubejs.
    //
    // Undoing the setup alg solves the cube by construction, which is why no search follows:
    // the app used to hand this state to a second Kociemba search and then discard an answer it
    // already held — the longest thing a press of the die waited on.
    commitAnswer(c, invertAlg(setupAlg), null, GODS_NUMBER_ONLY);
  } catch (err) {
    // A DEFINITE refutation is the only thing that reaches here — finishSolve throws on one and
    // commits nothing before it. The cube is left underived and with no setup alg, exactly as
    // this function left it before, so the pool's answer supplies both rather than the app
    // drawing a walk nobody checked. (An oracle that could not RUN is not this branch: it has
    // refuted nothing, so finishSolve commits with `crossChecked` false and the next solve
    // retries the check.)
    c.setupAlg = '';
    console.error('the inverse of the setup alg does not solve the cube — deriving instead', err);
    return;
  }
}

/** The state after each move of a walk, so the 2D net and the move list can co-move with the 3D
 *  animation. Move application only — no search. A short array is not fatal (the chips fall back
 *  to jumping) but it is never expected, so it says so rather than degrading quietly. */
export function stepStates(facelets, moves) {
  const sf = [];
  try {
    const b = Cube.fromString(facelets);
    sf.push(b.asString());
    for (const m of moves) { b.move(m); sf.push(b.asString()); }
  } catch (err) {
    console.warn('per-step facelets unavailable; the move list will jump rather than step', err);
  }
  return sf;
}

/**
 * Raise one dial, and everything that has to follow from it.
 *
 * Two screens raise a rung — the offer on the cube screen and the ladder on Lessons — and both
 * had their own copy of the same four steps: take the offer, write both halves back, throw the
 * cached lesson away, persist. Four steps in two places is four chances for one of them to be
 * forgotten, and the one most easily forgotten is the third: a lesson worked out at the OLD rungs
 * is no longer what this learner is being taught, and relabelling it would be worse than
 * rebuilding it.
 *
 * Returns whether the write stuck, because a rung that is not persisted is one the next launch
 * silently takes back.
 */
export function raiseRung(offer) {
  const next = acceptOffer(settings.rungs, settings.rungProgress, offer);
  settings.rungs = next.rungs;
  settings.rungProgress = next.progress;
  state.cube.lesson = null;
  return save('cubusSettings', settings);
}
