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

/** How many views the engine searches: three axes x normal/inverse.
 *
 *  Declared here rather than imported from two-phase.js because this module is the protocol
 *  boundary — it takes the engine INJECTED and imports nothing from it, which is what lets it be
 *  tested against a fake. app.js and solve-client.js need the number to size a pool and slice
 *  it, and neither should pull the whole engine into the main bundle to read one integer.
 *
 *  It is therefore a second copy, and a second copy is only safe if it cannot drift: the range
 *  check inside `createSolver` uses the INJECTED engine's own count, and a test asserts the two
 *  agree. Without that test this would be exactly the duplication it looks like. */
export const VIEW_COUNT = 6;

/** The budget used when a caller does not pass one: effectively "take the time you need" at
 *  ~20 ns a node, while still terminating. One named number, never inherited from a previous
 *  call. */
export const DEFAULT_NODE_BUDGET = 100_000_000;

/** An algorithm string as its move tokens — `''` and `'   '` are zero moves, the solved cube's
 *  answer, and NOT one empty token.
 *
 *  The one tokenizer for the solver pipeline. It was written out three times (here, optimal.js's
 *  `htmMoves`, app.js's `movesOf`) with the same `trim().split(/\s+/)` and the same
 *  empty-string special case — three chances for a count and a move list to disagree about the
 *  same alg, which is the one thing a screen showing "N moves" beside N chips cannot survive. */
export const moveTokens = (alg) => {
  const trimmed = alg.trim();
  return trimmed ? trimmed.split(/\s+/) : [];
};

/** Moves in an algorithm string. solve-target imports it rather than growing its own. */
export const movesIn = (alg) => moveTokens(alg).length;

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
  const tokens = moveTokens(alg);
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
 * Wrap an engine module into `solve(facelets, { solLen, probeMax, views })`.
 *
 * `views` is null for every caller but the parallel client: a non-empty array of distinct view
 * indices in 0..VIEW_COUNT-1, restricting the search to that slice of the engine's views. Null
 * searches all of them, which is what a single worker always does.
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

  return function solve(facelets, { solLen = LOOSEST_BOUND, probeMax = DEFAULT_NODE_BUDGET, views = null } = {}) {
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
    // BEFORE setBounds, like every other check here. setBounds mutates persistent engine state,
    // so a filter validated after it would leave the bounds moved behind a thrown filter — the
    // exact failure this wrapper's validate-first-commit-together rule exists to prevent, and
    // the one setBounds itself documents.
    if (views !== null) {
      if (!Array.isArray(views) || views.length === 0) {
        throw new RangeError('solver-engine: views must be null or a non-empty array of view indices');
      }
      // The upper bound comes from the ENGINE, not from a constant here: this module is written
      // against an injected engine and imports nothing from two-phase.js, which is what lets it
      // be tested against a fake. An engine that does not say how many views it has still gets
      // the shape checked; the range check is simply the part only it can supply.
      const count = Number.isInteger(engine.VIEW_COUNT) ? engine.VIEW_COUNT : null;
      const seen = new Set();
      for (const v of views) {
        if (!Number.isInteger(v) || v < 0 || (count !== null && v >= count)) {
          throw new RangeError(`solver-engine: view ${v} is not a view index${count === null ? '' : ` (0..${count - 1})`}`);
        }
        if (seen.has(v)) throw new RangeError(`solver-engine: view ${v} appears twice`);
        seen.add(v);
      }
    }
    engine.setBounds({ solLen, probeMax });

    // solvePattern initializes its own tables on first use — one owner for that lifecycle,
    // not a second ready-flag here that can disagree with it.
    // `views` is null for every caller but the parallel client: a slice of the engine's six
    // search views, so several workers can divide them and still be comparing like with like.
    const answer = engine.solvePattern(facelets, views);
    // No answer within the budget, or not a solvable state.
    if (answer === null) return null;
    return validateAnswer(answer, solLen);
  };
}
