// The method library's two plain constants, in a module that builds nothing.
//
// lib/methods/index.js builds every rung's repertoire when it loads — tens of milliseconds, and the
// tables a lesson needs — so the UI thread must never import it (lib/lesson-client.js). The registry
// needs only these names, so they live here and index.js re-exports them.

/** The stages, in the order a solve walks them. The order IS the method — everything else is
 *  which rung of each. */
export const STAGE_IDS = Object.freeze(['cross', 'pairs', 'oll', 'pll']);

/** The bottom rung everywhere — what a new learner is shown, having chosen nothing (§3 rule 1). */
export const DEFAULT_RUNGS = Object.freeze({ cross: 0, pairs: 0, oll: 0, pll: 0 });
