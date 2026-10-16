// The ladder: four stages, each with its own rungs, and the method a set of rungs makes.
//
// This is the file dev-docs/method-solver-return-plan.md §2 is about. A learner is not uniformly
// a beginner — you learn to plan the cross long before you learn 57 OLLs — so progression is PER
// STAGE and not one `level`. Four independent dials, and a method is one reading of all four.
//
// Since ADR 0011 the dials are not a learner's: a METHOD the app offers is a fixed reading of them,
// declared as an entry in lib/methods/registry.js, and no learner raises one.
//
// Adding a rung is adding an entry to one of the four arrays imported below. Nothing in
// `method-solver.js` reads `rung`, so nothing there changes.
//
// @typedef {object} Stage
// @property {'cross'|'pairs'|'oll'|'pll'} id       which stage this is a rung of
// @property {number} rung                          which rung — REPORTING ONLY; never branched on
// @property {string} label                         the rung's name
// @property {string} blurb                         one sentence describing it
// @property {{edges: number[], corners: number[]}} targets  the pieces this stage places
// @property {(state) => boolean} keep              what must already hold when the stage starts
// @property {(state) => boolean} contract          the state the stage must reach
// @property {string} why                           the stage's reason key, for the move list heading
// @property {(state, steps) => object} run         the stage itself

import { HUMAN_F2L, HUMAN_OLL, HUMAN_PLL } from '../data/human-algs.js';
import { CROSS_ALGS, CROSS_RUNGS } from './cross.js';
import { COURSE_ALGS, COURSE_LAST_LAYER, LAST_LAYER_EXTRAS, OLL_ALGS, OLL_RUNGS, PLL_ALGS, PLL_RUNGS } from './last-layer.js';
import { PAIRS_ALGS, PAIRS_EXTRAS, PAIRS_RUNGS } from './pairs.js';

/** The stages, in the order a solve walks them. The order IS the method — everything else is
 *  which rung of each. */
export const STAGE_IDS = Object.freeze(['cross', 'pairs', 'oll', 'pll']);

/** Every rung of every stage. `LADDER.cross[1]` is the cross planned whole. */
export const LADDER = Object.freeze({
  cross: CROSS_RUNGS,
  pairs: PAIRS_RUNGS,
  oll: OLL_RUNGS,
  pll: PLL_RUNGS,
});

/** The bottom rung everywhere — what a new learner is shown, having chosen nothing (§3 rule 1). */
export const DEFAULT_RUNGS = Object.freeze({ cross: 0, pairs: 0, oll: 0, pll: 0 });

/** The highest rung each stage currently has. It grows by adding a rung file — never by editing a
 *  number here. */
export const TOP_RUNG = Object.freeze(
  Object.fromEntries(STAGE_IDS.map((id) => [id, LADDER[id].length - 1])),
);

/** Every rung record a learner can be shown, for the ladder and for the composition test. */
export function allRungCombinations() {
  let out = [{}];
  for (const id of STAGE_IDS) {
    out = out.flatMap((rungs) => LADDER[id].map((stage) => ({ ...rungs, [id]: stage.rung })));
  }
  return out;
}

/** `{cross:1, pairs:1, oll:0, pll:0}` -> `1,1,0,0`. The bench's row label, and a stable id. */
export const rungKey = (rungs) => STAGE_IDS.map((id) => rungs[id] ?? DEFAULT_RUNGS[id]).join(',');

/**
 * The two last-layer routes (ADR 0009). `app` is the ladder's own: orient the top, then permute it, at
 * whichever oll and pll rungs the learner is on. `course` is the beginner course's order — edges turned
 * up and put home, then corners put home and turned up — a PAIR that replaces both last-layer stages and
 * ignores their dials, because neither half of it composes with a rung of the other route.
 */
export const LAST_LAYER_ROUTES = Object.freeze(['app', 'course']);

/**
 * The dials a route actually reads. The course's pair stands in for the last two stages and ignores their
 * rungs, so on that route they are not dials at all: practising its last layer is not practice at an
 * oll or pll rung, and raising one would change nothing a learner could see.
 */
export function dialsOf(lastLayer) {
  if (!LAST_LAYER_ROUTES.includes(lastLayer)) throw new Error(`unknown last-layer route: "${lastLayer}"`);
  return Object.freeze(STAGE_IDS.filter((id) => lastLayer !== 'course' || !Object.hasOwn(COURSE_LAST_LAYER, id)));
}

/**
 * The method a rung record names: one stage descriptor per stage, in walking order.
 *
 * A rung that does not exist is refused rather than clamped. Silently handing back rung 1 when
 * rung 2 was asked for would show a learner a method they did not choose and label it with the
 * one they did — and every count on the screen would then be about a different solve.
 *
 * `lastLayer` picks the route. ITS DEFAULT HERE IS `app`, and that is not the app's default: the app's
 * is the course (decision I, 2026-10-14), which the Beginner entry of lib/methods/registry.js names
 * (ADR 0011) — the one app caller. A library default that moved with it would quietly change what every
 * bench and every method test measures; a caller that means the course says so.
 */
export function methodFor(rungs = DEFAULT_RUNGS, { lastLayer = 'app' } = {}) {
  if (!LAST_LAYER_ROUTES.includes(lastLayer)) {
    throw new Error(`unknown last-layer route: "${lastLayer}" — the routes are ${LAST_LAYER_ROUTES.join(', ')}`);
  }
  const chosen = {};
  const stages = STAGE_IDS.map((id) => {
    const want = rungs?.[id] ?? DEFAULT_RUNGS[id];
    const stage = LADDER[id].find((s) => s.rung === want);
    if (!stage) {
      throw new Error(
        `unknown rung: ${id} ${want} — ${id} has rungs 0..${TOP_RUNG[id]}`,
      );
    }
    chosen[id] = want;
    // The course's pair stands where the last two stages stand. The learner's oll and pll dials are
    // still checked above — a stored rung that does not exist is refused on either route — and kept in
    // the record, so switching back to the app's route finds them where they were.
    return lastLayer === 'course' && Object.hasOwn(COURSE_LAST_LAYER, id) ? COURSE_LAST_LAYER[id] : stage;
  });
  // The route is part of the id: a lesson cached against `0,0,0,0` must not be served for the course.
  const id = lastLayer === 'course' ? `${rungKey(chosen)},course` : rungKey(chosen);
  return Object.freeze({ id, lastLayer, rungs: Object.freeze(chosen), stages: Object.freeze(stages) });
}

/**
 * Every method the app can walk: each rung combination on the app's route, and each cross and pairs
 * rung on the course's (whose last layer ignores the oll and pll dials, so those stay at rung 0).
 *
 * A test that sweeps `allRungCombinations()` alone never sees the course's route, and the default
 * learner walks it.
 */
export function allMethods() {
  const app = allRungCombinations().map((rungs) => methodFor(rungs));
  const course = allRungCombinations()
    .filter((rungs) => rungs.oll === DEFAULT_RUNGS.oll && rungs.pll === DEFAULT_RUNGS.pll)
    .map((rungs) => methodFor(rungs, { lastLayer: 'course' }));
  return [...app, ...course];
}

/**
 * Every named algorithm in the repertoire.
 *
 * Exported so a test can prove each one earns its place: an entry no state ever needs is a
 * case we would claim to teach and never show. Four entries were removed this way — a second
 * Sune reaches those positions in fewer moves, so the table was larger than the method.
 */
export const CASE_NAMES = Object.freeze(
  // `LAST_LAYER_EXTRAS` is in the list because a step can be named after it, and a step naming
  // something outside this list is the defect the check exists to catch. It is NOT in `PLL_ALGS`,
  // because that is the set of algorithms a learner memorises and an alignment is not one.
  //
  // The one-look tables are here too, for the same reason and with one difference: they are the
  // algorithms speedcubers learn (`lib/data/human-algs.js`), named `oll-27`, `pll-T`, `f2l-1`, and their
  // display name is the community's — "OLL 27", "T perm" — carried by the table, not by `CASE_TEXT`.
  // The proved fewest-turn tables are NOT here: no rung emits them any more (owner's decision,
  // 2026-10-13), so a name from them on a step would be the defect this list exists to catch.
  [
    ...CROSS_ALGS, ...PAIRS_ALGS, ...PAIRS_EXTRAS, ...OLL_ALGS, ...PLL_ALGS, ...LAST_LAYER_EXTRAS,
    ...HUMAN_OLL, ...HUMAN_PLL, ...HUMAN_F2L, ...COURSE_ALGS,
  ].map((entry) => entry.name),
);
