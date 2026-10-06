// The way from the cube in your hand to a PICTURE — one exact cube, rather than a stage.
//
// A stage target is a conjunction of projection goals, so millions of cubes satisfy it and the exact
// engine can answer it from admissible tables. A state pattern is ONE cube. That makes it both
// easier and harder: no table can be built for it and no heuristic guides a search to it, but it
// needs neither, because reaching one exact cube from another is the ordinary whole-cube solve of a
// third.
//
// THE IDENTITY, which is the whole of this file:
//
//     applyAlg(a, m)  ===  compose(a, applyAlg(SOLVED, m))          (the app's own convention)
//     so, wanting  compose(c, M) = S,   M = compose(inverseOf(c), S)
//     and the maneuver that PRODUCES M is what SOLVES its inverse,  compose(inverseOf(S), c).
//
// So: hand `compose(inverseOf(S), c)` to the ordinary two-phase pool, and its solution is the route
// from `c` to `S`. No new engine, no new table, no new worker message.
//
// WHAT A CODEX REFUTE PASS FOUND, because the first version of this was going to be four lines and
// three of these would have shipped (2026-09-26):
//
//   1. **The verifier must not share a move model with the thing it checks.** Comparing
//      `toFacelets(applyAlg(c, alg))` against the picture uses `cube-pieces.MOVES` — which is what
//      `two-phase.js` searched with AND what `patterns.js` derived the picture with. All three agree
//      by construction, so a wrong move definition passes all three. The replay here goes through
//      **cubejs**, which this repository keeps precisely as an independent implementation, and which
//      is the same oracle `finishSolve` uses on a whole-cube solution.
//
//   2. **The fixtures conceal two classes of mistake.** All three shipped state patterns are
//      unchanged by the method-frame tumble AND are their own inverse, so a route that omitted
//      `inverseOf`, reversed the composition, or tumbled an input would still have landed on them.
//      `test/pattern-route.test.mjs` therefore carries an ASYMMETRIC destination that none of those
//      hold for, and each of those four mutations fails it.
//
//   3. **A raw pool call does not carry the <= 20 promise.** `solLen` is an EXCLUSIVE bound and the
//      engine's default is 23, so a bare call permits 22 moves. `solveWithinGodsNumber` is the one
//      place that promise lives — it asks at 21, escalates the node budget on a refusal, continues
//      rather than restarts, and validates what comes back — so this goes through it rather than
//      beside it.
//
//   4. **An identical cube is a zero-move answer, not a failure.** `c === S` solves to the empty
//      alg, and `''` is falsy: treating it as "no route" would refuse the one case a child is most
//      likely to reach by accident, having just made the shape.
//
// THIS FILE NEVER CLAIMS A MINIMUM. Two-phase cannot prove one, so `minimal` is explicitly false
// rather than absent — `routeSentence()` reads an absent field as false today, and a route record
// that says what it is cannot be misread if that ever changes.

import { SOLVED, applyAlg, compose, inverseOf, toFacelets } from './cube-pieces.js';
import { movesIn } from './solver-engine.js';

/** The cubie state a state pattern names. Derived from its algorithm, like the picture it draws. */
export const pictureState = (pattern) => applyAlg(SOLVED, pattern.alg);

/**
 * The cube whose SOLUTION is the way from `facelets` to `pattern` — the identity above, once.
 *
 * Kept separate and exported so the test can assert the transform without a solver, and so the
 * cubie and its facelet string never get confused: the first draft of this wrote
 * `toFacelets(toFacelets(d))`, which throws.
 */
export function relativeCube(pattern, facelets, parse) {
  const c = parse(facelets);
  if (c === null || c === undefined) return null;
  return toFacelets(compose(inverseOf(pictureState(pattern)), c));
}

/**
 * The route from `facelets` to `pattern`, or null.
 *
 * NULL MEANS THE SEARCH DID NOT ANSWER, and never that the picture cannot be reached: every legal
 * cube reaches every other in at most 20 moves, so a refusal here is a statement about this search.
 * The caller must not substitute a different destination on it — see `walk-resolver.js`, where
 * doing exactly that walked a child to `solved` under a Checkerboard heading.
 *
 * @param {object} deps `pattern`; `facelets`, the cube in hand, scan frame; `solve`, the pooled
 *   two-phase door; `parse`, facelets to cubie; `replay`, the INDEPENDENT verifier (cubejs), given
 *   `(facelets, alg)` and answering the facelets it lands on, or null when it cannot run; `signal`.
 */
export async function routeToPicture({ pattern, facelets, solve, parse, replay, signal = null }) {
  if (signal?.aborted) return null;
  const relative = relativeCube(pattern, facelets, parse);
  if (relative === null) return null;

  // Already there. `solveWithinGodsNumber` would answer `''` for this too, but asking the pool to
  // solve a solved cube is a message and a wait for an answer this thread already has.
  const alg = relative === toFacelets(SOLVED)
    ? ''
    : await solveFor(relative, solve, signal);
  if (alg === undefined || alg === null || signal?.aborted) return null;

  // THE REPLAY, through an implementation that shares nothing with the search. A route that does not
  // land exactly on the picture is refused rather than shown, and an oracle that could not run has
  // verified nothing — so that is a refusal too, not a pass. `crossChecked` elsewhere in this app
  // exists for the same reason.
  const landed = replay(facelets, alg);
  if (landed !== pattern.look) return null;

  return { alg, moves: movesIn(alg), minimal: false, overshoot: false, source: 'picture' };
}

/** The pooled solve, bounded by the app's one <= 20 promise. Errors are the caller's null. */
async function solveFor(relative, solve, signal) {
  try {
    return await solve(relative, { signal });
  } catch {
    // Every escalation spent, or the pool gone. Both are "the search did not answer".
    return null;
  }
}
