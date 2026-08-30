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
//   * **A first answer is nearly free.** Loosely bounded, the engine returns in ~25 ms. So there
//     is never a reason to show a person nothing. Every search starts by putting an answer on
//     screen and then improving it, which also dissolves the tail — at the <= 20 tier the
//     median descent is ~30 ms but the worst of 40 was 0.65 s, and nobody should watch a
//     spinner for that when a 21-move answer was available immediately.
//   * **The tiers are not all the same kind of promise.** God's number is 20, so a <= 20
//     solution always exists. <= 18 does not: roughly 3.5% of positions are optimally 19 or 20,
//     and for those 18 moves is impossible rather than expensive. A tier that cannot always be
//     met must say so rather than quietly hand back something longer, which is why `met` is
//     part of every result and never inferred from the move count alone.
//   * **The target is a ceiling, not a stopping place.** A cube a few turns from solved has a
//     few-move solution, and handing it twenty moves because twenty was the promise is
//     indefensible — the day this was noticed, a 7-turn cube was answered with 20. So once the
//     target is met the search keeps asking for shorter, at a much smaller budget: an easy cube
//     descends to its real answer almost instantly, and a hard cube pays one ~40 ms failed ask
//     and stops. The full budget is only ever spent ABOVE the target.
//
// Pure: no DOM, no storage, no globals, no worker. The search itself is injected, so this is
// testable against a fake and the same code drives the real engine. The two protocol imports
// below are constants and a counter, not behavior — the injected-solve seam stays.

import { LOOSEST_BOUND, movesIn, validateAnswer } from './solver-engine.js';

/** The rungs, in the order a learner climbs them. `target: null` means "no target — keep
 *  going". Each rung is frozen too: a mutated target would silently move every search's
 *  goalposts. */
export const TIERS = Object.freeze([
  Object.freeze({ name: 'twenty', target: 20 }),
  Object.freeze({ name: 'nineteen', target: 19 }),
  Object.freeze({ name: 'eighteen', target: 18 }),
  Object.freeze({ name: 'shortest', target: null }),
]);

/** The loose bound the first attempt uses: the engine's own ceiling, imported so the two
 *  halves of the protocol cannot drift. Accepts anything up to 22 moves; ~25 ms, always
 *  succeeds. */
const FIRST_BOUND = LOOSEST_BOUND;

/** Search nodes per attempt. A budget in the engine's own deterministic unit rather than in
 *  milliseconds, so a slow phone and a fast laptop do the same amount of work and only the
 *  waiting differs. ~20 ns each on a laptop, so ~1 s per attempt at worst — and only a FAILING
 *  attempt at a tight tier ever spends it all; every met target stops early. Chosen by the
 *  ladder in dev-docs/solver-move-count.md §7: at n=40 a 4x budget moved no tier's success
 *  rate and only stretched the worst wait, so the smaller budget with the better tail ships. */
export const DEFAULT_PROBE_BUDGET = 50_000_000;

/** The free-improvement budget: once the target is met, further asks spend only this. Small
 *  enough that a hard cube's one failed ask costs ~40 ms; large enough that an easy cube — for
 *  which every rung down to its real answer is cheap by definition — descends all the way. */
export const BONUS_BUDGET = 2_000_000;

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
 * Progressively shorten a solution, yielding every improvement.
 *
 * `solve(facelets, { solLen, probeMax })` must return an algorithm shorter than `solLen`, or
 * null when it cannot find one within `probeMax`. That is the engine's contract, enforced at
 * the boundary by lib/solver-engine.js.
 *
 * Yields `{ alg, moves, target, met, stopped }` — `stopped` is null while still improving.
 * The first yield happens after one loose search, so there is always something to show.
 *
 * @throws if the very first, loosest search fails — the state is unsolvable, the solver is
 *         broken, or the budget was too small even for the loose search. Either way there is
 *         nothing to show, which is what makes it an error and not a result.
 */
export async function* refine(facelets, {
  solve,
  tier = 'twenty',
  probeBudget = DEFAULT_PROBE_BUDGET,
  bonusBudget = BONUS_BUDGET,
  signal = null,
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

  const first = await solve(facelets, { solLen: FIRST_BOUND, probeMax: probeBudget });
  if (first === null) {
    throw new Error(
      'solver found no solution at all — the state is unsolvable, the solver is broken, or ' +
        'the budget was too small even for the loose first search',
    );
  }

  let alg = validateAnswer(first, FIRST_BOUND);
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

  while (true) {
    if (signal?.aborted) {
      yield snapshot(endReason(STOPPED.CANCELLED));
      return;
    }
    // Ask for strictly shorter than what we have. One move at a time: each answer is a real
    // improvement worth showing, and skipping ahead would throw away the cheap rungs.
    const shorter = await solve(facelets, { solLen: moves, probeMax: met() ? bonusBudget : probeBudget });
    if (shorter === null) {
      // Out of budget, or out of two-phase solutions. Either way the answer we have stands,
      // and if it does not meet the target we say so rather than presenting it as if it did.
      yield snapshot(endReason(STOPPED.EXHAUSTED));
      return;
    }
    const nextAlg = validateAnswer(shorter, moves);
    const nextMoves = movesIn(nextAlg);
    if (nextMoves >= moves) {
      // The solver broke its own contract. Refusing here rather than yielding it keeps the one
      // guarantee this module makes — that every yield is shorter than the last.
      throw new Error(`solver returned ${nextMoves} moves when asked for fewer than ${moves}`);
    }
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
