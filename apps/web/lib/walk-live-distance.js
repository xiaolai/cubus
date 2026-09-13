// The live distance on the cube screen: how far the cube in your hand is from the stage the walk is
// aiming at, refreshed on every turn and written to a line of its own (`#stageLive`).
//
// Its own unit because it owns its own state — one generation counter — and reads everything else
// through functions at the moment it asks: the target (`stageTargetNow`), trust (`chainTrusted`) and
// the follow model (`modelNow`). Lifted out of lib/walk-session.js on 2026-09-13; the session keeps
// the names `refreshLiveDistance` and `dropLiveDistance` for its two operations, so every call site
// there reads as it did. Driven on its own by test/walk-live-distance.test.mjs.

import { t } from './i18n.js';
import { STAGE_COPY } from './stage-report.js';

/**
 * How far the cube in your hand is from the target, refreshed on every turn.
 *
 * FIVE THINGS THE PLAN CORRECTS ABOUT THIS PATH, and each one is a line here (§5):
 *
 *   1. It reads the follow model, not `state.cube.facelets`. `liveMove` advances the local model
 *      while the global subject lags until `adoptCube`, so the global would build an answer
 *      for a cube that no longer exists — the trap `#resolveBtn` already documents.
 *   2. It is the OFFSET-CORRECTED state by construction, because the model is seeded from
 *      `state.live` — the corrected report stream — and never from the raw one. A repair
 *      computed on the raw report would be labelled for the wrong faces, and would look
 *      perfectly plausible.
 *   3. It does NOT go through `refreshScreen()`. That path reaches `loadWalk` → `beginWalk`,
 *      which clears `moves`, `steps`, `chips`, `total`, `target` and `lesson` and points
 *      back at step 0 — it would destroy the walk the child is halfway through following.
 *   4. It has its OWN generation counter. `walkGen` deliberately does not move on a per-turn
 *      update, so without a second counter a result about cube A lands on cube B.
 *   5. It writes its own line, never `#moveCount`. That count belongs to the route and
 *      reports progress against the route's total.
 *
 * And the gate is `chainTrusted()`, not `cubeRefused()`: trust is lost in ways that never
 * set a verdict — `onMovesLost` calls `markStale`, which clears trust with no verdict at all
 * — and naming the wrong predicate would let a stale cube drive advice.
 *
 * @param {object} deps `root`, the screen the line is in; `stageAsk`, the pool's stage questions;
 *   `chainTrusted()`; `CHIP_NODE_BUDGET`; `stageTargetNow()`, the target or null; and `modelNow()`,
 *   the session's follow model (a cubejs cube) or null.
 */
export function createLiveDistance({ root, stageAsk, chainTrusted, CHIP_NODE_BUDGET, stageTargetNow, modelNow }) {
  let liveGen = 0;
  const liveSay = () => root.querySelector('#stageLive');
  /**
   * Stop believing anything still in flight, and take the last number off the screen.
   *
   * ONE HELPER, called from every place a live answer stops being about the cube in hand: the
   * early returns below, a lost move, and trust lapsing. The early returns used to clear the
   * line WITHOUT moving the generation, so an answer already on its way repainted over the
   * clearing — and `onTrustLost` did neither. Both reproduced by an audit.
   */
  function dropLiveDistance() {
    liveGen += 1;
    const el = liveSay();
    if (el) el.textContent = '';
  }
  async function refreshLiveDistance() {
    const el = liveSay();
    if (!el) return;
    const aimingAt = stageTargetNow();
    // The follow model as it is NOW, read once and before anything is awaited: both questions below
    // are about this one arrangement, and the session's model moves on with the next turn.
    const liveModel = modelNow();
    if (!aimingAt || !liveModel || !chainTrusted()) { dropLiveDistance(); return; }
    const mine = ++liveGen;
    const facelets = liveModel.asString();
    // AND THE OLD NUMBER GOES NOW, not when the new one arrives. If both requests come back
    // unavailable neither branch below writes anything, and cube A's "exact 3" stood over cube
    // B indefinitely — reproduced. A blank line is honest; a stale one is not.
    el.textContent = '';
    // The BOUND first, because it is a table read and arrives in one message — §3's split runs
    // all the way out to here. Then the exact search, for the SELECTED target only: four
    // searches a turn is not what a per-turn update should cost.
    const bounds = await stageAsk({ want: 'bounds', facelets });
    if (mine !== liveGen || !root.isConnected || !chainTrusted()) return;
    if (bounds?.bounds) {
      el.textContent = t('your cube now: %1', STAGE_COPY.atLeast(bounds.bounds[aimingAt.id] ?? 0));
    }
    const answer = await stageAsk({
      want: 'route', target: aimingAt.id, facelets, nodeBudget: CHIP_NODE_BUDGET, maxDepth: 12,
    });
    if (mine !== liveGen || !root.isConnected || !chainTrusted()) return;
    if (!answer) return;
    el.textContent = answer.moves === null
      ? t('your cube now: %1', STAGE_COPY.unknown())
      : t('your cube now: %1', STAGE_COPY.shortest(answer.moves));
  }
  return Object.freeze({ refresh: refreshLiveDistance, drop: dropLiveDistance });
}
