// Frozen cubes for the solver's release gates.
//
// THE RULE, and it is the whole reason this file exists: a test that asserts `met`, or a
// not-null answer, under a FINITE budget must not draw its state. `probeMax` is a budget in
// search NODES, so a search is deterministic per cube and identical on every machine — which
// means a fixed budget against a random cube asserts a probabilistic property as if it were a
// deterministic one. That is a lottery, and a gate that is a lottery is not a gate: it fails
// releases for reasons unrelated to the release, and the failure it reports cannot be reproduced
// because the state is gone. It has happened twice — a contract fixture on 2026-09-03 that
// exhausted eight escalations and failed the v0.2.3 release, and a WebKit tier check on a cube
// the developer's machine never drew. Both times the fix was the same, and three more draws were
// left behind in other files; those are gone as of 2026-09-04.
//
// What a fixed set does NOT cover, said plainly rather than left to be assumed: the engine's
// TAIL. A state needing more than 12.8e9 nodes demonstrably exists — CI met one — and a fixed
// set will never meet it again. Establishing how rare it is, and whether it is a pathological
// state or an engine defect, is soak work for a machine nobody is waiting on; 190 random states
// were run by hand while investigating and none exceeded 13 s. It is rarer than 1 in 190, and
// that is the whole of what is known. It is NOT known to be harmless.
//
// PROVENANCE. Every state below was drawn once from lib/random-state.js — the app's own uniform
// draw over all 43,252,003,274,489,856,000 legal positions, from a cryptographic source — then
// measured and frozen. Its recorded cost is in NODES, not milliseconds: nodes are the unit the
// budget is spent in and are the same number on every machine, where a millisecond on a loaded
// laptop is no measurement at all. Measurements are `refine` at the twenty tier with a 200M base
// budget and the shipped BONUS_BUDGET, unless the entry says otherwise.
//
// Every assertion that uses one of these must NAME it in its message. When the 2026-09-03 gate
// failed, the report said only that the budget had run out — not on which of 43 quintillion
// cubes — so there was nothing to re-run and nothing to bisect.

/** solver-engine.test.mjs's contract fixtures: the tiered progression over the real engine. */
export const CONTRACT_CUBES = Object.freeze([
  // 20 moves, 2.0M nodes
  'RFBDULDFURBLURUBDFLUFDFBRBRDDDBDLLUUUFFFLRBRFURBRBLLLD',
  // 19 moves, 3.4M nodes
  'UUBFUFLRBDUULRBBRUBDRDFUFDDRBLUDBFRLRDULLLLRDRBFLBFFFD',
  // 19 moves, 3.9M nodes
  'DFBBUFUUFLULFRDDBRRBULFDLULFRBFDRRLFRDFULBBLDURBRBLDDU',
  // 20 moves, 2.0M nodes
  'RUDRULLFFDBLDRBUDUBLLDFLDULFLFDDBBUFBUURLFURRBFDRBFRBR',
]);

/** two-phase.test.mjs's copy of the same contract, driven through the engine module directly.
 *  Deliberately DIFFERENT states from CONTRACT_CUBES: the two tests are close enough in shape
 *  that sharing fixtures would make the pair cover four cubes rather than seven. */
export const ENGINE_CONTRACT_CUBES = Object.freeze([
  // 19 moves, 2.2M nodes
  'DUDDUBUDDBURFRRRRLRLLUFDDRBRFUFDDLLULBFFLLFLBFRFBBUBBU',
  // 19 moves, 4.2M nodes
  'FRRBUFLBURDFLRFUFLBDFFFUFLRLDBBDLDUBDRURLRBLUDDLUBUDBR',
  // 19 moves, 2.1M nodes
  'LRLFUBRDLUUBDRLFRUURFBFFDLDLBRBDFDLFBLBULDBRFDUUDBFRUR',
]);

/** solve-worker-browser.test.mjs's three, one per test that used to draw its own.
 *
 *  They cross into WebKit as an argument to page.evaluate, which is why they are plain strings
 *  and why the browser file imports this module rather than the other way round. */
export const WORKER_CUBES = Object.freeze({
  /** The tiered solve over a real module worker. 19 moves, 2.0M nodes. */
  tiered: 'LUBFUUULLBBRDRDFLFBUUFFBDFRFUUFDBLLLUDRBLRBLRDRFRBRDDD',
  /** The one that proves solLen reaches the engine INSIDE the worker. Chosen for having real
   *  search in it — 10.8M nodes at solLen 21 on one worker — rather than answering at once. */
  tighter: 'RFDRULBRFUULFRUFBDDBRUFDFBDLDRUDLULFUDRLLRBFUBRBBBFLDL',
  /** The pool-versus-lone comparison. 108k nodes on one worker at solLen 21 and the shipped
   *  50M budget, and the three-way split answers identically — measured here before it was
   *  frozen, because that equality is what the test asserts and it is not true at every budget
   *  (parallel-divergence.test.mjs pins where it stops holding). */
  pooled: 'LFUUUDDULDRBLRUFBDFBBDFFRRRBFUUDDBBFURRRLLUFDLDFLBBLLR',
});
