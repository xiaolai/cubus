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

// ---- the validators -----------------------------------------------------------------------------
//
// Three of them, named, because `solve` below is a validate-then-execute function and that shape is
// the point: EVERY check here runs before `setBounds`, which mutates persistent engine state, and a
// reader has to be able to see that at a glance rather than by tracing sixty lines for the one
// statement that commits (split out 2026-09-05). They take the engine where they need it — the
// module imports nothing from two-phase.js, so the engine's own numbers are the only ones there
// are.

/** The cube and the two bounds. */
function checkScalars(facelets, solLen, probeMax) {
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
}

/** A non-empty set of distinct view indices this engine actually has. */
function checkViews(views, engine) {
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

/**
 * Can this carrier actually TAKE a resume point back?
 *
 * Asked by writing, because nothing else answers it. Round 1's check read the OWN property
 * descriptor and fell back to `Object.isExtensible`, which passes two carriers that cannot take a
 * write — both reproduced by the 2026-09-05 audit, and each failing in its own way:
 *
 *   * an INHERITED read-only `state` (`Object.create(Object.freeze({state: null}))`) has no own
 *     descriptor at all, so the extensibility fallback said yes; the assignment then threw in
 *     strict mode AFTER `setBounds` had moved the bounds and after the search had run;
 *   * a DISCARDING SETTER (`{get state(){return null}, set state(_){}}`) has an own accessor, so
 *     the `typeof own.set === 'function'` branch said yes; the write then went nowhere and the
 *     next attempt silently re-walked the search this one asked to continue. That one is worse
 *     than the throw: nothing anywhere says it happened.
 *
 * Walking the prototype chain by hand would answer the first and not the second, so the probe is a
 * real write of a sentinel followed by a read-back, and the original value is put straight back —
 * the carrier is left exactly as it was found, which is what the old comment here was protecting
 * and the reason this is a probe rather than a one-way write. It costs two property accesses on a
 * path that runs once per attempt.
 */
function carrierTakesWrites(resume) {
  const before = resume.state;
  // Frozen, so no getter can hand this object back by coincidence and no setter can keep it.
  const probe = Object.freeze({ probe: 'solver-engine' });
  try {
    resume.state = probe;
    const took = resume.state === probe;
    resume.state = before;
    return took;
  } catch {
    // A frozen carrier, an own or inherited read-only `state`, or a setter that throws.
    return false;
  }
}

/**
 * A resume carrier this wrapper can both read and WRITE.
 *
 * Two ways it can fail, and until 2026-09-05 only the first was checked. The engine may not be able
 * to continue a search at all — that is `openSearch`. And the carrier may not be able to take the
 * resume point back: `resume: false`, `resume: 7` and a frozen `{state}` all read fine and then
 * throw on the write, which happens AFTER `setBounds` has moved the bounds and after the search has
 * run. That is precisely the "validate first, commit together" rule this file states, broken by the
 * check that states it; the audit reproduced all three.
 */
function checkCarrier(resume, engine) {
  if (typeof resume !== 'object') {
    throw new TypeError(`solver-engine: resume must be null or a { state } carrier, not ${typeof resume}`);
  }
  if (!carrierTakesWrites(resume)) {
    throw new TypeError(
      'solver-engine: this resume carrier cannot take a resume point back, so the next attempt ' +
        'would silently re-walk the search this one asked to continue.',
    );
  }
  // Refused rather than ignored — a caller that asked to continue a search and was quietly given
  // a fresh one has been told nothing, and would go on paying for the re-walk it asked to avoid.
  if (typeof engine.openSearch !== 'function') {
    throw new TypeError(
      'solver-engine: this engine has no openSearch(), so a search cannot be continued. ' +
        'Pass resume: null to search from the start.',
    );
  }
}

/**
 * Wrap an engine module into `solve(facelets, { solLen, probeMax, views, resume })`.
 *
 * `views` is null for every caller but the parallel client: a non-empty array of distinct view
 * indices in 0..VIEW_COUNT-1, restricting the search to that slice of the engine's views. Null
 * searches all of them, which is what a single worker always does.
 *
 * `resume` is null for every caller but an ESCALATING one (2026-09-05,
 * dev-docs/deferred-plans-2026-09-05.md §3). With one it is a mutable carrier, `{ state }`, which
 * this wrapper reads and writes: the state is the engine's resume point, and handing back the one
 * a previous call left is what makes the doubled attempt continue that search rather than walk it
 * again from d1 = 0. `probeMax` is then a FRONTIER — the same number a from-scratch search would
 * have been given, and the answer is bit-for-bit that search's answer.
 *
 * A carrier is a REQUEST, never a shortcut this wrapper takes on its own: with `resume: null` the
 * engine is driven exactly as it always was, through `solvePattern`, so nothing that never asked
 * for a continuation can be handed one.
 *
 * The module must expose `initialize`, `solvePattern` and `setBounds` — the shape
 * lib/two-phase.js exports. Anything else is an engine with no way to bound it, which is worth
 * failing on immediately: the app would otherwise keep solving while every solution-length
 * target was silently ignored. `openSearch` is checked only where it is USED, because an engine
 * without it is still a correct engine — every attempt simply starts over, which is what the app
 * did until this was added.
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

  return function solve(facelets, { solLen = LOOSEST_BOUND, probeMax = DEFAULT_NODE_BUDGET, views = null, resume = null } = {}) {
    // EVERYTHING is checked before setBounds, which mutates persistent engine state: a filter or a
    // carrier validated after it would leave the bounds moved behind a throw — the exact failure
    // this wrapper's validate-first-commit-together rule exists to prevent, and the one setBounds
    // itself documents.
    checkScalars(facelets, solLen, probeMax);
    if (views !== null) checkViews(views, engine);
    if (resume !== null) checkCarrier(resume, engine);
    engine.setBounds({ solLen, probeMax });

    // solvePattern initializes its own tables on first use — one owner for that lifecycle,
    // not a second ready-flag here that can disagree with it.
    // `views` is null for every caller but the parallel client: a slice of the engine's six
    // search views, so several workers can divide them and still be comparing like with like.
    let answer;
    if (resume === null) {
      answer = engine.solvePattern(facelets, views);
    } else {
      // The carried state is UNTRUSTED — it crossed a thread boundary as plain data — and the
      // engine's own key assertion is what checks it. A mismatch throws there, which is the whole
      // point: a continuation of the wrong search would skip depths and report a solution it never
      // looked for as a search that ran out.
      const search = engine.openSearch(facelets, { viewFilter: views, resume: resume.state ?? null });
      answer = search.continueTo();
      // Written back before the answer is validated: a broken answer is still a real resume point,
      // and dropping it would silently turn the next attempt into a full re-walk.
      resume.state = search.state;
    }
    // No answer within the budget, or not a solvable state.
    if (answer === null) return null;
    return validateAnswer(answer, solLen);
  };
}
