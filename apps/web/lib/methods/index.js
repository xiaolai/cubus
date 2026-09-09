// The ladder: four stages, each with its own rungs, and the method a set of rungs makes.
//
// This is the file dev-docs/method-solver-return-plan.md §2 is about. A learner is not uniformly
// a beginner — you learn to plan the cross long before you learn 57 OLLs — so progression is PER
// STAGE and not one `level`. Four independent dials, and a method is one reading of all four.
//
// Adding a rung is adding an entry to one of the four arrays imported below. Nothing in
// `method-solver.js` reads `rung`, so nothing there changes.
//
// @typedef {object} Stage
// @property {'cross'|'pairs'|'oll'|'pll'} id       which stage this is a rung of
// @property {number} rung                          which rung — REPORTING ONLY; never branched on
// @property {string} label                         the rung's name on the Lessons ladder
// @property {string} blurb                         one sentence describing it, for a rung not yet reached
// @property {{edges: number[], corners: number[]}} targets  the pieces this stage places
// @property {(state) => boolean} keep              what must already hold when the stage starts
// @property {(state) => boolean} contract          the state the stage must reach
// @property {string} why                           the stage's reason key, for the move list heading
// @property {(state, steps) => object} run         the stage itself

import { CROSS_ALGS, CROSS_RUNGS } from './cross.js';
import { LAST_LAYER_EXTRAS, OLL_ALGS, OLL_RUNGS, PLL_ALGS, PLL_RUNGS } from './last-layer.js';
import { PAIRS_ALGS, PAIRS_RUNGS } from './pairs.js';

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

/** The highest rung each stage currently has. The Lessons screen reads this to draw the ladder,
 *  and it grows by adding a rung file — never by editing a number here. */
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
 * The method a rung record names: one stage descriptor per stage, in walking order.
 *
 * A rung that does not exist is refused rather than clamped. Silently handing back rung 1 when
 * rung 2 was asked for would show a learner a method they did not choose and label it with the
 * one they did — and every count on the screen would then be about a different solve.
 */
export function methodFor(rungs = DEFAULT_RUNGS) {
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
    return stage;
  });
  return Object.freeze({ id: rungKey(chosen), rungs: Object.freeze(chosen), stages: Object.freeze(stages) });
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
  [...CROSS_ALGS, ...PAIRS_ALGS, ...OLL_ALGS, ...PLL_ALGS, ...LAST_LAYER_EXTRAS]
    .map((entry) => entry.name),
);
