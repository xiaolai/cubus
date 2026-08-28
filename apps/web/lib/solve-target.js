// How short a solution to ask for, and how to keep asking for shorter.
//
// The learner-facing knob is a LENGTH, not an effort. "Twenty moves or fewer" is a thing a
// person can hold; "two hundred thousand phase-two probes" is not. min2phase has exactly that
// knob — `solLen`, which refuses any solution not shorter than it — and it stops the moment the
// target is met, which makes asking for a length about two orders of magnitude cheaper than
// reaching the same length by searching harder. Measured in dev-docs/solver-move-count.md.
//
// Two facts from that note shape everything here:
//
//   * **A first answer is nearly free.** Loosely bounded, min2phase returns in ~3 ms. So there
//     is never a reason to show a person nothing. Every search starts by putting an answer on
//     screen and then improving it, which also dissolves the tail — at the <= 20 tier the
//     median is 6 ms but the worst of 200 was 1.1 s, and nobody should watch a spinner for that
//     when a 21-move answer was available immediately.
//   * **The tiers are not all the same kind of promise.** God's number is 20, so a <= 20
//     solution always exists. <= 18 does not: roughly 3.5% of positions are optimally 19 or 20,
//     and for those 18 moves is impossible rather than expensive. A tier that cannot always be
//     met must say so rather than quietly hand back something longer, which is why `met` is
//     part of every result and never inferred from the move count alone.
//
// Pure: no DOM, no storage, no globals, no worker. The search itself is injected, so this is
// testable against a fake and the same code drives the real min2phase.

/** The rungs, in the order a learner climbs them. `target: null` means "no target — keep going". */
export const TIERS = Object.freeze([
  { name: 'twenty', target: 20 },
  { name: 'nineteen', target: 19 },
  { name: 'eighteen', target: 18 },
  { name: 'shortest', target: null },
]);

/** The loose bound the first attempt uses. min2phase's own default; ~3 ms, always succeeds. */
const FIRST_BOUND = 23;

/** Probes per attempt. A budget in probes rather than milliseconds, so a slow phone and a fast
 *  laptop do the same amount of work and only the waiting differs. */
export const DEFAULT_PROBE_BUDGET = 2_000_000;

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

const movesIn = (alg) => (alg.trim() ? alg.trim().split(/\s+/).length : 0);

/**
 * Progressively shorten a solution, yielding every improvement.
 *
 * `solve(facelets, { solLen, probeMax })` must return an algorithm shorter than `solLen`, or
 * null when it cannot find one within `probeMax`. That is min2phase's contract; the adapter
 * around it turns its `Error N` strings into null.
 *
 * Yields `{ alg, moves, target, met, stopped }` — `stopped` is null while still improving.
 * The first yield happens after one loose search, so there is always something to show.
 *
 * @throws if the very first, loosest search fails. That is not a budget problem: it means the
 *         state is unsolvable or the solver is broken, and either way there is nothing to show.
 */
export async function* refine(facelets, {
  solve,
  tier = 'twenty',
  probeBudget = DEFAULT_PROBE_BUDGET,
  signal = null,
} = {}) {
  const { target } = typeof tier === 'string' ? tierByName(tier) : tier;
  if (typeof solve !== 'function') throw new TypeError('refine needs a solve function');

  const first = await solve(facelets, { solLen: FIRST_BOUND, probeMax: probeBudget });
  if (!first) {
    throw new Error('solver found no solution at all — the state is unsolvable or the solver is broken');
  }

  let alg = first.trim();
  let moves = movesIn(alg);
  const met = () => target !== null && moves <= target;

  // The target may already be satisfied by the free answer, which at the <= 20 tier is most of
  // the time. Nothing further is searched in that case.
  if (met()) {
    yield { alg, moves, target, met: true, stopped: STOPPED.MET };
    return;
  }
  yield { alg, moves, target, met: false, stopped: null };

  while (true) {
    if (signal?.aborted) {
      yield { alg, moves, target, met: met(), stopped: STOPPED.CANCELLED };
      return;
    }
    // Ask for strictly shorter than what we have. One move at a time: each answer is a real
    // improvement worth showing, and skipping ahead would throw away the cheap rungs.
    const shorter = await solve(facelets, { solLen: moves, probeMax: probeBudget });
    if (!shorter) {
      // Out of budget, or out of two-phase solutions. Either way the answer we have stands,
      // and if it does not meet the target we say so rather than presenting it as if it did.
      yield { alg, moves, target, met: met(), stopped: STOPPED.EXHAUSTED };
      return;
    }
    const nextAlg = shorter.trim();
    const nextMoves = movesIn(nextAlg);
    if (nextMoves >= moves) {
      // The solver broke its own contract. Refusing here rather than yielding it keeps the one
      // guarantee this module makes — that every yield is shorter than the last.
      throw new Error(`solver returned ${nextMoves} moves when asked for fewer than ${moves}`);
    }
    alg = nextAlg;
    moves = nextMoves;
    if (met()) {
      yield { alg, moves, target, met: true, stopped: STOPPED.MET };
      return;
    }
    yield { alg, moves, target, met: false, stopped: null };
  }
}

/**
 * The last result of `refine` — for callers that only want the answer, not the improvements.
 * Still runs the whole progression, so it is the slow path by design.
 */
export async function solveToTier(facelets, options) {
  let last = null;
  for await (const step of refine(facelets, options)) last = step;
  return last;
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
  if (target === null) return { key: 'solve.shortestFound', moves, final: stopped !== null };
  if (met) return { key: 'solve.targetMet', moves, target };
  return { key: 'solve.targetMissed', moves, target };
}
