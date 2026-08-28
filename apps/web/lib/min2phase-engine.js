// min2phase, wrapped in the contract `solve-target.js` is written against.
//
// Three things happen here and nothing else:
//
//   1. **Its error strings become null.** min2phase answers a search it could not finish with
//      `"Error 7"` / `"Error 8"` rather than by throwing. A caller that forgot to check would
//      hand that string to a move list as if it were an algorithm, so the conversion happens
//      once, here, at the boundary.
//   2. **The bound is checked, not assumed.** Asked for something shorter than N it must answer
//      with fewer than N moves. If it ever does not, that is a broken solver and it fails here
//      rather than three layers up where the symptom would be a move list that grows.
//   3. **The tables are built once**, with `fullInit`, which costs ~260 ms one time and makes
//      every search 3-5x faster for identical answers (dev-docs/solver-move-count.md).
//
// The module is injected rather than imported so this can be tested directly, and so the same
// code runs on the main thread in a test and inside a worker in the app.

/** min2phase's own ceiling, and the loosest useful bound: accept anything up to 21 moves. */
export const LOOSEST_BOUND = 23;

const movesIn = (alg) => (alg.trim() ? alg.trim().split(/\s+/).length : 0);

/**
 * Wrap a vendored min2phase module into `solve(facelets, { solLen, probeMax })`.
 *
 * `min2phase` must expose `initialize`, `solvePattern` and `setBounds` — the shape
 * `vendor-min2phase.mjs` produces. Anything else is a vendoring that did not apply, which is worth
 * failing on immediately: the app would otherwise run with min2phase's stock bounds while
 * believing it had set them, and every length target would be silently ignored.
 */
export function createSolver(min2phase, { fullInit = true } = {}) {
  for (const fn of ['initialize', 'solvePattern', 'setBounds']) {
    if (typeof min2phase?.[fn] !== 'function') {
      throw new TypeError(
        `min2phase-engine: the vendored module has no ${fn}(). The bounds patch in ` +
          'vendor-min2phase.mjs did not apply, so solution-length targets would be ignored.',
      );
    }
  }

  let ready = false;
  const ensureTables = () => {
    if (ready) return;
    min2phase.setBounds({ fullInit });
    min2phase.initialize();
    ready = true;
  };

  return function solve(facelets, { solLen = LOOSEST_BOUND, probeMax } = {}) {
    if (typeof facelets !== 'string' || facelets.length !== 54) {
      throw new TypeError('min2phase-engine: expected a 54-character facelet string');
    }
    if (!Number.isInteger(solLen) || solLen < 2 || solLen > LOOSEST_BOUND) {
      throw new RangeError(`min2phase-engine: solLen ${solLen} is outside 2..${LOOSEST_BOUND}`);
    }
    ensureTables();
    min2phase.setBounds({ solLen, fullInit, ...(probeMax === undefined ? {} : { probeMax }) });

    const answer = min2phase.solvePattern(facelets);
    // "Error 7" and friends mean the search ran out of budget, or the state is not solvable.
    // Both are "no answer within what you gave me", which is what null says.
    if (/^Error/.test(answer)) return null;

    const alg = answer.trim();
    const moves = movesIn(alg);
    if (moves >= solLen) {
      throw new Error(
        `min2phase-engine: asked for fewer than ${solLen} moves and got ${moves}. ` +
          'The vendored bounds patch is not taking effect.',
      );
    }
    return alg;
  };
}
