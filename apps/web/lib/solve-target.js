// How short a solution to ask for, and how to keep asking for shorter.
//
// The learner-facing knob is a LENGTH, not an effort. "Twenty moves or fewer" is a thing a
// person can hold; "fifty million search nodes" is not. The engine has exactly that knob —
// `solLen`, which refuses any solution not shorter than it — and the full budget stops being
// spent the moment the target is met, which makes asking for a length far cheaper than
// reaching the same length by searching harder. Measured in dev-docs/solver-move-count.md.
//
// Two facts from that note shape everything here:
//
//   * **The first answer is shown, then improved — and it is never above God's number.** Every
//     search puts an answer on screen and then shortens it, rather than making a person wait
//     for the best one. The first ask used to be the engine's loose ceiling, which returned in
//     ~25 ms and was above 20 in roughly three solves out of four; it PRESENTED a count that
//     cannot be a minimum. It now asks for the floor instead (FIRST_BOUND), and if that runs
//     out of budget it retries with more before yielding anything, so the first frame can cost
//     more than one search. That is the trade, taken deliberately on 2026-08-30 — see
//     FIRST_BOUND for what is and is not known about its latency cost.
//   * **Twenty is a floor under EVERY tier, because it is a fact about the cube.** God's number
//     is 20, so a <= 20 solution always exists — for every position, whatever the person asked
//     for. This module keeps that rather than aiming at it: while the answer in hand is longer
//     than 20, running out of budget means the budget was too small (the engine is complete;
//     see GODS_NUMBER below), so it asks again with more. Tying this to the TIER instead of the
//     cube was a real bug — the 19, 18 and "shortest" rungs then had no floor, and each of them
//     could end at 21. Asking for something shorter must never yield something longer.
//   * **Below the floor the tiers are not the same kind of promise.** <= 18 is a different kind
//     of thing: roughly 3.5% of positions are optimally 19 or 20, and for those 18 moves is
//     impossible rather than expensive. A tier that cannot always be met must say so rather
//     than quietly hand back something longer, which is why `met` is part of every result and
//     never inferred from the move count alone.
//   * **A missed target is never an impossibility.** Two-phase cannot prove a minimum, so it
//     cannot prove one absent either (section 4 of solver-move-count.md). `met: false` says
//     this search did not get there — nothing about what exists. The distinction is the whole
//     reason `stopped` is reported beside `met` instead of being folded into it, and it is the
//     one thing the wording at the display boundary must not blur.
//   * **The target is a ceiling, not a stopping place.** A cube a few turns from solved has a
//     few-move solution, and handing it twenty moves because twenty was the promise is
//     indefensible — the day this was noticed, a 7-turn cube was answered with 20. So once the
//     target is met the search keeps asking for shorter, at a much smaller budget: an easy cube
//     descends to its real answer almost instantly, and a hard cube pays one ~40 ms failed ask
//     and stops. The full budget is only ever spent ABOVE the target.
//
// Pure: no DOM, no storage, no globals, no worker. The search itself is injected, so this is
// testable against a fake and the same code drives the real engine. The two protocol imports
// below are a move counter and the answer validator — the injected-solve seam stays.
//
// ---- what a caller may hand `refine`, beyond the cube ------------------------------------------
//
//   * **`signal`** — an AbortSignal, one per solve. Aborting it is how a SUPERSEDED search is
//     stopped: a die press or a reconnect answered while a hard search is still running would
//     otherwise queue behind it on every pool worker. Two things travel on it. This module stops
//     asking for more (it checks between asks, and treats a null that arrives alongside an abort
//     as cancelled rather than exhausted), and the signal rides ALONG WITH THE BOUNDS into the
//     injected `solve`, which is what lets lib/solve-client.js reach inside the running search:
//     it publishes the stop value into that solve's shared word, the engine's next poll sees it,
//     and the worker returns null without being terminated and without rebuilding its tables.
//     An abort before the first answer yields nothing at all; an abort after one keeps the answer
//     in hand and ends the progression with STOPPED.CANCELLED (or STOPPED.MET, if the promise
//     was already kept — see endReason).
//   * **`onProgress`** — `({ attempt, budget, spent })`, called before each attempt of the FIRST
//     search only, which is the only one that escalates and therefore the only one whose wait is
//     unbounded from a watcher's point of view. Up to 511x the base budget can be spent before
//     anything at all is yielded, and a screen that shows a spinner through it can say nothing
//     about how much of that has gone. Optional: nothing here depends on it, and the old call
//     shape keeps working.

import { movesIn, validateAnswer } from './solver-engine.js';

/** The rungs, in the order a learner climbs them. `target: null` means "no target — keep
 *  going". Each rung is frozen too: a mutated target would silently move every search's
 *  goalposts. */
export const TIERS = Object.freeze([
  Object.freeze({ name: 'twenty', target: 20 }),
  Object.freeze({ name: 'nineteen', target: 19 }),
  Object.freeze({ name: 'eighteen', target: 18 }),
  Object.freeze({ name: 'shortest', target: null }),
]);

/** God's number in the half-turn metric: every one of the 43,252,003,274,489,856,000 legal
 *  positions has a solution of 20 moves or fewer (Rokicki, Kociemba, Davidson and Dethridge,
 *  2010). A target at or above it is therefore a PROMISE about the CUBE that this app can always
 *  keep, and it is why a refusal at that target buys more budget instead of becoming a verdict.
 *
 *  What the ENGINE promises is narrower than this comment used to say, and the difference is
 *  worth having written down (corrected 2026-09-04, from an audit that read both sides):
 *
 *    * `solvePattern` deepens phase-1 to `solLen - 1`, and canonical pruning is proved to delete
 *      no optimal path (optimal-solver-plan.md §7). No length is out of reach for want of depth.
 *    * But phase 1 REJECTS a maneuver whose last move is a G1 move (two-phase.js's phase1DFS),
 *      and phase 2 is capped at MAX_PHASE2 = 12. A solution of length L therefore sits inside the
 *      enumeration at exactly ONE split — immediately before its maximal trailing run of G1
 *      moves — and only if that run is 12 moves or fewer.
 *
 *  So the honest statement is not "the engine is complete". It is: every <= 20 solution whose
 *  trailing G1 run is <= 12 is inside the enumeration, in each of six independent views, and a
 *  budget is the only thing that can stop it being found. Nothing has ever been observed to fail
 *  that; nothing proves it cannot. Which changes nothing about the rule below, because the rule
 *  never rested on completeness: a refusal is a statement about the SEARCH, never about the cube,
 *  so it escalates — and at the cap it raises LOUDLY rather than reporting an impossibility. */
export const GODS_NUMBER = 20;

/** The bound the FIRST attempt uses — the floor, not the engine's ceiling.
 *
 *  It was LOOSEST_BOUND, on the reasoning that a first answer should be nearly free so nobody
 *  is ever shown nothing. The first half of that still holds and is why this is bounded at all;
 *  the second half is what put counts above God's number on screen. Measured over three runs of
 *  40 random states, the loose first answer was above 20 in 28 to 34 of them — roughly three
 *  solves in four PRESENTED a number that cannot be a minimum.
 *
 *  Asking for the floor up front costs first-paint latency, and that is the whole trade
 *  (owner's call, 2026-08-30). Measured properly once the machine was quiet — 80 random states,
 *  both bounds run against EACH state and interleaved so drift hits them alike:
 *
 *      bound        median   p90    p95    worst   over 100ms
 *      <= 22 (old)   2.9ms   10ms   13ms    19ms   0 / 80
 *      <= 20 (now)   6.2ms   41ms  183ms   630ms   4 / 80
 *
 *  So the typical first number still arrives in single-digit milliseconds, but one solve in
 *  twenty now waits over a tenth of a second for it and the worst seen was 0.6 s. That is the
 *  price of never presenting a count that cannot be a minimum. Reverting is one line.
 *
 *  (An earlier draft of this comment said the cost was unknown, because every measurement had
 *  run on a box at load 40-66 from an unrelated build and the runs disagreed by 10x — one even
 *  reported the floor's worst case as BETTER, which a paired run contradicted. Worth keeping as
 *  a note: a latency number taken on a loaded machine is not a slow number, it is no number.)
 *
 *  What is NOT a timing claim, and holds regardless: across 160 solves (40 states x 4 tiers),
 *  no frame — first or final — showed a count above 20.
 *
 *  GODS_NUMBER + 1 rather than a literal 21: the bound is EXCLUSIVE, and the only reason it is
 *  21 is that the floor is 20. Declared after GODS_NUMBER on purpose — `node --check` passes on
 *  the other order and the module then throws "Cannot access 'GODS_NUMBER' before
 *  initialization" only on import, a temporal dead zone a syntax check cannot see. */
const FIRST_BOUND = GODS_NUMBER + 1;

/** Search nodes per attempt. A budget in the engine's own deterministic unit rather than in
 *  milliseconds, so a slow phone and a fast laptop do the same amount of work and only the
 *  waiting differs. ~20 ns each on a laptop, so ~1 s for one attempt that spends it all — and
 *  only a FAILING attempt at a tight tier does; every met target stops early. Chosen by the
 *  ladder in dev-docs/solver-move-count.md §7: at n=40 a 4x budget moved no tier's success
 *  rate and only stretched the worst wait, so the smaller budget with the better tail ships.
 *
 *  This is the BASE attempt. The first search escalates on refusal (see FIRST_BOUND), so its
 *  last attempt may spend 256x this and the whole first search up to 511x cumulatively — about
 *  8.5 minutes of nodes if every rung were spent in full (511 x ~1 s; an earlier draft of this
 *  comment said four, which is simply wrong). Nothing observed comes close, but the number is
 *  written down because "~1 s at worst" is no longer the ceiling it once was. */
export const DEFAULT_PROBE_BUDGET = 50_000_000;

/** The free-improvement budget: once the target is met, further asks spend only this. Small
 *  enough that a hard cube's one failed ask costs ~40 ms; large enough that an easy cube — for
 *  which every rung down to its real answer is cheap by definition — descends all the way. */
export const BONUS_BUDGET = 2_000_000;


/** How many times a promised target may double its budget before the engine is declared broken.
 *  Eight doublings is 256x the shipped budget, against a measured worst of 447 ms and 0 misses
 *  in 30 random states at the <= 20 tier — reaching even the second is already extraordinary.
 *  The cap exists so a broken engine fails LOUDLY instead of looping forever; there is
 *  deliberately no "give up and report it impossible" branch behind it, because that is the
 *  false claim this whole mechanism exists to make unreachable. */
export const MAX_PROMISE_ESCALATIONS = 8;

export function tierByName(name) {
  const tier = TIERS.find((t) => t.name === name);
  if (!tier) throw new Error(`unknown tier: ${name}`);
  return tier;
}

/** Why a search stopped. Kept separate from `met` because "as short as I could get" and "as
 *  short as you asked for" are different things to tell someone. */
export const STOPPED = Object.freeze({
  MET: 'met',              // the tier's target was reached
  EXHAUSTED: 'exhausted',  // no shorter solution found within the probe budget
  CANCELLED: 'cancelled',  // the person stopped it
});

/**
 * One solution of GOD'S NUMBER moves or fewer, whatever it costs.
 *
 * The app's central promise, in one place because it now has two callers: the tiered solve
 * descends FROM this, and a scramble IS this, inverted. Two copies of an escalation loop would
 * be two places for the promise to quietly stop being kept.
 *
 * @param {string} facelets
 * @param {object} opts
 * @param {(f: string, bounds: object) => Promise<string|null>} opts.solve  the engine, injected
 * @param {number} [opts.probeBudget]  the first attempt's budget; doubled on every refusal
 * @param {AbortSignal|null} [opts.signal]
 * @param {((p: {attempt: number, budget: number, spent: number}) => void)|null} [opts.onProgress]
 *        called BEFORE each attempt: which attempt it is (0-based), the budget about to be
 *        spent, and the budget the attempts before it were given — an upper bound on what they
 *        walked, since a continuation does not re-walk the depths its predecessor finished. The
 *        only window a caller has into a wait that can reach 511x the base budget with nothing
 *        on screen.
 * @returns {Promise<string|undefined>} the validated algorithm, or undefined if aborted
 * @throws if every sanctioned escalation is spent. The message names the unsolvable case first
 *         because this module never establishes legality — see the comment inside.
 */
export async function solveWithinGodsNumber(
  facelets,
  { solve, probeBudget = DEFAULT_PROBE_BUDGET, signal = null, onProgress = null } = {},
) {
  if (typeof solve !== 'function') throw new TypeError('solveWithinGodsNumber needs a solve function');
  if (!Number.isSafeInteger(probeBudget) || probeBudget < 1) {
    throw new TypeError(`solveWithinGodsNumber: probeBudget ${probeBudget} is not a positive integer`);
  }
  if (onProgress !== null && typeof onProgress !== 'function') {
    // Refused rather than ignored: a caller that passed something else meant to watch this
    // search, and silently not calling it is the failure that looks exactly like a search that
    // never escalated.
    throw new TypeError('solveWithinGodsNumber: onProgress must be a function or null');
  }
  if (signal?.aborted) return undefined;
  // The first answer IS the floor, so this is where the floor is kept — and the only place it
  // can be missed now. For a LEGAL cube a refusal here is not evidence that no such solution
  // exists: God's number says one of 20 or fewer always does, and one is inside the enumeration
  // unless every <= 20 solution in all six views ends in a run of more than 12 G1 moves (see
  // GODS_NUMBER). So the ask repeats with twice as much.
  //
  // "For a legal cube" is the whole caveat, and this module cannot discharge it: `solve` answers
  // null both for "out of budget" and for "not a solvable state", with no way to ask which, and
  // nothing here parses the facelets. So escalation is what happens to BOTH — harmlessly, since
  // the engine rejects an unparseable state before searching and each retry returns at once —
  // and the error at the cap names the unsolvable case rather than asserting a guarantee that
  // holds only for the other one.
  //
  // Everything after this is a descent from a number already at or below 20, which is why the
  // loop below needs no floor of its own: it can only shorten.
  let budget = probeBudget;
  let escalations = 0;
  // What has actually been asked for, summed. The raise below used to report `budget` alone —
  // the LAST doubled figure — which reads as the size of the search rather than as its cost:
  // "12.8 billion nodes" for a run whose eight earlier attempts had already spent 12.75 billion
  // between them. Both numbers are stated now, and this is the one that answers "how long was
  // I waiting".
  //
  // Since 2026-09-05 it is an UPPER bound rather than the exact figure, and the wording that
  // reports it says "up to" for that reason: a doubled attempt CONTINUES the search below rather
  // than restarting it, so it spends its budget minus whatever depths the attempt before it
  // finished. Every attempt still spends at most the budget it was given, so the sum over the
  // continuations is still true — it is simply no longer tight (see `carry`).
  let spent = 0;
  // The resume point, carried across the escalations and owned here.
  //
  // This is the whole of §3 of dev-docs/deferred-plans-2026-09-05.md at this level: a refusal used
  // to throw away everything the attempt had walked, and the doubled ask began again at phase-1
  // depth 0. Over n attempts that is B(2ⁿ⁺¹ − 1) nodes to reach a frontier of 2ⁿB, about half of it
  // repetition. With the carrier, `probeMax` is the FRONTIER the search should reach rather than an
  // increment, and the answer at that frontier is bit-for-bit the answer a from-scratch search at
  // the same `probeMax` gives — which is what made the resume worth shipping at all
  // (escalation-resume.test.mjs). A `solve` that ignores the carrier — every fake in the tests —
  // simply searches from the start, exactly as before.
  const carry = { state: null };
  const attempt = async () => {
    onProgress?.({ attempt: escalations, budget, spent });
    const answer = await solve(facelets, { solLen: FIRST_BOUND, probeMax: budget, signal, resume: carry });
    spent += budget;
    return answer;
  };
  let first = await attempt();
  while (first === null) {
    // An abort here is a person leaving before the first answer — nothing to show, so nothing
    // is yielded, exactly as an abort before any search at all.
    if (signal?.aborted) return undefined;
    if (escalations >= MAX_PROMISE_ESCALATIONS) {
      // Says what happened, not what it means. The engine IS complete, so on the shipped budget
      // this can only be a bug — but a caller may pass any budget it likes, and `probeBudget: 1`
      // exhausting after 256 nodes accuses the engine of something the caller did.
      // Ordered so the claim never outruns what is known. God's number guarantees a <= 20
      // solution for every LEGAL cube, and this module never establishes legality — the engine
      // answers null both for "out of budget" and for "not a solvable state", and cannot be
      // asked which. So the unsolvable case is named first, and the guarantee is stated as the
      // conditional it actually is. (Escalating eight times on an unsolvable state costs
      // nothing measurable: the engine rejects the facelets before searching, so each attempt
      // returns immediately rather than spending its budget.)
      throw new Error(
        `solver found no solution of ${GODS_NUMBER} moves or fewer within ${escalations} ` +
          `escalations, spending up to ${spent} nodes in all (the last attempt asked for ` +
          `${budget}). Either this is not a solvable cube — for one that is, a solution this ` +
          'short always exists — or the budget was far too small, or the engine is broken',
      );
    }
    if (!Number.isSafeInteger(budget * 2)) {
      throw new Error(
        `solver found no solution of ${GODS_NUMBER} moves or fewer, and the budget cannot be ` +
          `doubled past ${budget} without leaving the safe-integer range`,
      );
    }
    escalations += 1;
    budget *= 2;
    first = await attempt();
  }

  return validateAnswer(first, FIRST_BOUND);
}

/**
 * Progressively shorten a solution, yielding every improvement.
 *
 * `solve(facelets, { solLen, probeMax })` must return an algorithm shorter than `solLen`, or
 * null when it cannot find one within `probeMax`. That is the engine's contract, enforced at
 * the boundary by lib/solver-engine.js.
 *
 * Yields `{ alg, moves, target, met, stopped }` — `stopped` is null while still improving.
 * The first yield comes from a search bounded at the FLOOR (FIRST_BOUND), so there is always
 * something to show and it is never a count above God's number. That search escalates its
 * budget on refusal, so the first yield may cost more than one search.
 *
 * `signal` and `onProgress` are optional and documented at the top of this file: the first stops
 * a superseded search inside the engine rather than only between asks, the second is the only
 * window into the escalating first search's wait.
 *
 * @throws if the first search still fails after every sanctioned escalation — the state is not
 *         a solvable cube, the budget was far too small, or the engine is broken. Either way
 *         there is nothing to show, which is what makes it an error and not a result.
 */
export async function* refine(facelets, {
  solve,
  tier = 'twenty',
  probeBudget = DEFAULT_PROBE_BUDGET,
  bonusBudget = BONUS_BUDGET,
  signal = null,
  onProgress = null,
} = {}) {
  const { target } = typeof tier === 'string' ? tierByName(tier) : (tier ?? {});
  if (target !== null && (!Number.isInteger(target) || target < 1)) {
    // A malformed tier object would otherwise become target undefined and search for nothing
    // meaningful, quietly.
    throw new TypeError(`refine: tier target ${target} is neither null nor a positive integer`);
  }
  if (typeof solve !== 'function') throw new TypeError('refine needs a solve function');
  if (!Number.isSafeInteger(probeBudget) || probeBudget < 1) {
    // NaN or Infinity would pass straight through to the engine's termination check.
    throw new TypeError(`refine: probeBudget ${probeBudget} is not a positive integer`);
  }
  if (!Number.isSafeInteger(bonusBudget) || bonusBudget < 1) {
    throw new TypeError(`refine: bonusBudget ${bonusBudget} is not a positive integer`);
  }
  // Cancelled before anything was searched: there is nothing to show, so nothing is yielded.
  if (signal?.aborted) return;

  const first = await solveWithinGodsNumber(facelets, { solve, probeBudget, signal, onProgress });
  // undefined is an abort before the first answer: nothing to show, so nothing is yielded.
  if (first === undefined) return;

  let alg = first;
  let moves = movesIn(alg);
  /** One yield's worth of truth, derived in exactly one place. */
  const snapshot = (stopped) => ({
    alg,
    moves,
    target,
    met: target !== null && moves <= target,
    stopped,
  });

  // A zero-move answer is a solved cube: any numeric target is met, and "shortest" cannot
  // improve on nothing. Either way the search is over before it starts.
  if (moves === 0) {
    yield snapshot(target === null ? STOPPED.EXHAUSTED : STOPPED.MET);
    return;
  }

  // Whether the target is already satisfied — which at the <= 20 tier the free answer usually
  // is. A met target does not end the search any more: it only drops the budget to the bonus
  // rate, so an easy cube keeps descending to its real answer while a hard cube stops after
  // one cheap failed ask.
  const met = () => target !== null && moves <= target;
  // Why a terminal stop reads the way it does: a met target is reported MET whatever ended the
  // descent — the promise was kept, and an abort or an exhausted bonus ask only ended the free
  // extras. CANCELLED and EXHAUSTED are for searches stopped short of the promise.
  const endReason = (whileSearching) => (met() ? STOPPED.MET : whileSearching);

  if (signal?.aborted) {
    yield snapshot(endReason(STOPPED.CANCELLED));
    return;
  }
  yield snapshot(null);

  // No floor is needed here: the first answer is already at or below God's number and this
  // loop only ever shortens it. A refusal below the floor is an honest end — 18 genuinely does
  // not exist for roughly 3.5% of positions — so exhaustion here reports, never escalates.
  while (true) {
    if (signal?.aborted) {
      yield snapshot(endReason(STOPPED.CANCELLED));
      return;
    }
    // Ask for strictly shorter than what we have. One move at a time: each answer is a real
    // improvement worth showing, and skipping ahead would throw away the cheap rungs. The signal
    // rides with the bounds so the client can reach INSIDE this search rather than only between
    // two of them — a synchronous search that nobody can interrupt is exactly the wait an abort
    // is supposed to end.
    const shorter = await solve(facelets, { solLen: moves, probeMax: met() ? bonusBudget : probeBudget, signal });
    if (shorter === null) {
      // Out of budget, out of two-phase solutions, or STOPPED: a cancelled search returns null
      // too, because the stop word makes the engine give up rather than answer. Which of those
      // it was is not guessable from the null — so the signal is asked. Reporting a cancelled
      // search as EXHAUSTED would tell someone who pressed a button that the solver had run out,
      // which is the same class of wrong answer as calling a missed target an impossibility.
      yield snapshot(endReason(signal?.aborted ? STOPPED.CANCELLED : STOPPED.EXHAUSTED));
      return;
    }
    // The one guarantee this module makes — every yield is shorter than the last — is kept by
    // validateAnswer, whose bound here IS the current move count and is EXCLUSIVE. A separate
    // `nextMoves >= moves` re-check used to follow it; it could not fire, because the only way
    // past validateAnswer is with strictly fewer tokens than `moves`, counted by the same
    // tokenizer movesIn uses. Dead code in front of a real guarantee reads as the guarantee.
    const nextAlg = validateAnswer(shorter, moves);
    const nextMoves = movesIn(nextAlg);
    alg = nextAlg;
    moves = nextMoves;
    // An improvement that arrived alongside an abort is kept — it is real — but it ends the
    // progression rather than pretending the search is still going.
    if (signal?.aborted) {
      yield snapshot(endReason(STOPPED.CANCELLED));
      return;
    }
    yield snapshot(null);
  }
}



/**
 * What to tell someone about a finished search.
 *
 * Deliberately structured rather than prose: `i18n.js` owns the wording. The distinction that
 * must survive translation is between "this is what you asked for" and "this is the shortest I
 * found" — never "this is the minimum", which two-phase cannot know (solver-move-count.md §4).
 */
export function describe(result) {
  if (!result) return null;
  const { moves, target, met, stopped } = result;
  // `stopped` rides along so a caller can tell a cancelled search from an exhausted one —
  // "you stopped it" and "I ran out" are different things to say, even over the same alg.
  if (target === null) return { key: 'solve.shortestFound', moves, final: stopped !== null, stopped };
  if (met) return { key: 'solve.targetMet', moves, target, stopped };
  return { key: 'solve.targetMissed', moves, target, stopped };
}
