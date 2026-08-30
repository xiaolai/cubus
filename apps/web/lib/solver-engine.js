// The solver engine, wrapped in the contract `solve-target.js` is written against.
//
// Three things happen here and nothing else:
//
//   1. **Every no-answer is null, and everything else is a real algorithm string.** The engine
//      (lib/two-phase.js) says null; anything that is not null and not a string is a broken
//      engine and fails loudly here, at the boundary, rather than as an opaque `.trim` crash
//      three layers up.
//   2. **The bound is checked, not assumed.** Asked for something shorter than N it must answer
//      with fewer than N moves. If it ever does not, that is a broken solver and it fails here
//      rather than where the symptom would be a move list that grows.
//   3. **The bounds are explicit on every call.** The engine's setBounds is a partial update
//      whose values persist, so an omitted budget would silently inherit whatever a previous
//      caller set — this wrapper always passes one, and validates everything first, because a
//      NaN budget would defeat the engine's termination check entirely.
//
// The module is injected rather than imported so this can be tested directly, and so the same
// code runs on the main thread in a test and inside a worker in the app.

/** The loosest useful bound: accept anything up to 22 moves. Two-phase always finds one. The
 *  single source for this number — solve-target's first bound and app.js's fallback import it. */
export const LOOSEST_BOUND = 23;

/** The budget used when a caller does not pass one: effectively "take the time you need" at
 *  ~20 ns a node, while still terminating. One named number, never inherited from a previous
 *  call. */
export const DEFAULT_NODE_BUDGET = 100_000_000;

/** Moves in an algorithm string — '' is zero moves, the solved cube's answer. The one shared
 *  counter for the solver pipeline; solve-target imports it rather than growing its own. */
export const movesIn = (alg) => {
  const trimmed = alg.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
};

/** The face-turn grammar: U R F D L B, optionally primed or doubled. Anything else in an
 *  answer is not a move the app can show or apply. */
const MOVE_TOKEN = /^[URFDLB]['2]?$/;

/**
 * Every solver answer through one gate, shared with solve-target's refinement loop: a string,
 * every token a real face turn, strictly shorter than what was asked. Whether the moves SOLVE
 * the cube is deliberately not checked here — that is the cubejs oracle's job at the display
 * boundary (app.js finishSolve) and in the tests; this wrapper runs inside a worker that must
 * not carry a second cube implementation.
 */
export function validateAnswer(answer, requestedBound) {
  if (typeof answer !== 'string') {
    throw new TypeError(`solver returned ${typeof answer}, not an algorithm string`);
  }
  const alg = answer.trim();
  const tokens = alg ? alg.split(/\s+/) : [];
  for (const token of tokens) {
    if (!MOVE_TOKEN.test(token)) {
      throw new Error(`solver returned "${token}", which is not a face turn`);
    }
  }
  if (tokens.length >= requestedBound) {
    throw new Error(
      `solver returned ${tokens.length} moves when asked for fewer than ${requestedBound}`,
    );
  }
  return alg;
}

/**
 * Wrap an engine module into `solve(facelets, { solLen, probeMax })`.
 *
 * The module must expose `initialize`, `solvePattern` and `setBounds` — the shape
 * lib/two-phase.js exports. Anything else is an engine with no way to bound it, which is worth
 * failing on immediately: the app would otherwise keep solving while every solution-length
 * target was silently ignored.
 */
export function createSolver(engine) {
  // Only what this wrapper actually drives: solvePattern self-initializes its tables, so
  // requiring an initialize() here would demand a method nothing in this file calls.
  for (const fn of ['solvePattern', 'setBounds']) {
    if (typeof engine?.[fn] !== 'function') {
      throw new TypeError(
        `solver-engine: the engine module has no ${fn}(), ` +
          'so solution-length targets would be ignored.',
      );
    }
  }

  return function solve(facelets, { solLen = LOOSEST_BOUND, probeMax = DEFAULT_NODE_BUDGET } = {}) {
    if (typeof facelets !== 'string' || facelets.length !== 54) {
      throw new TypeError('solver-engine: expected a 54-character facelet string');
    }
    // solLen 1 is legal: it asks for a zero-move solution, which a solved cube has — and which
    // the shortest tier reaches when a state is one move from solved.
    if (!Number.isInteger(solLen) || solLen < 1 || solLen > LOOSEST_BOUND) {
      throw new RangeError(`solver-engine: solLen ${solLen} is outside 1..${LOOSEST_BOUND}`);
    }
    if (!Number.isSafeInteger(probeMax) || probeMax < 1) {
      throw new RangeError(`solver-engine: probeMax ${probeMax} is not a positive integer`);
    }
    engine.setBounds({ solLen, probeMax });

    // solvePattern initializes its own tables on first use — one owner for that lifecycle,
    // not a second ready-flag here that can disagree with it.
    const answer = engine.solvePattern(facelets);
    // No answer within the budget, or not a solvable state.
    if (answer === null) return null;
    return validateAnswer(answer, solLen);
  };
}
