// The live distance on the cube screen: how far the cube in your hand is from the stage the walk is
// aiming at, refreshed on every turn and written to a line of its own (`#stageLive`).
//
// Its own unit because it owns its own state — its generation counter and the search it has out —
// and reads everything else through functions at the moment it asks: the target (`stageTargetNow`),
// trust (`chainTrusted`) and the follow model (`modelNow`). Lifted out of lib/walk-session.js on
// 2026-09-13; the session keeps the names `refreshLiveDistance` and `dropLiveDistance` for its two
// operations, so every call site there reads as it did. Driven on its own by
// test/walk-live-distance.test.mjs.

import { t } from './i18n.js';
import { STAGE_COPY, routeSentence } from './stage-report.js';

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
 *   `chainTrusted()`; `CHIP_NODE_BUDGET`; `stageTargetNow()`, the target or null; `modelNow()`,
 *   the session's follow model (a cubejs cube) or null; and `signal`, the screen's abort.
 */
export function createLiveDistance({
  root, stageAsk, chainTrusted, CHIP_NODE_BUDGET, stageTargetNow, modelNow, signal = null,
}) {
  let liveGen = 0;
  // The exact search the newest refresh asked for, called off the moment it stops being about the
  // cube in hand. The generation stops a stale answer LANDING; this stops the search RUNNING, where
  // the page can share a stop word with the worker (lib/solve-client.js) — the one worker every
  // stage question and a pooled solve's first slice share.
  let liveStop = null;
  /**
   * ONE QUESTION OUT AT A TIME: whether one is out, and whether the cube turned while it was.
   *
   * Every turn refreshes, and a refresh used to send its bound at once — twenty turns while one
   * reply was out left twenty questions queued on that one worker, each answered for nobody (found
   * by audit, 2026-09-13). A refresh while one is out calls it off and asks again once it lands,
   * about the cube as it is by then, which is the only cube the question is still about.
   */
  let asking = false;
  let askAgain = false;
  const liveSay = () => root.querySelector('#stageLive');
  /**
   * Stop believing anything still in flight, and take the last number off the screen.
   *
   * ONE HELPER, called from every place a live answer stops being about the cube in hand: the
   * early returns below, a lost move, trust lapsing, and the screen going. The early returns used
   * to clear the line WITHOUT moving the generation, so an answer already on its way repainted over
   * the clearing — and `onTrustLost` did neither. Both reproduced by an audit. And nothing waits
   * to be asked after it: a question dropped while it waited is dropped with the number.
   */
  function dropLiveDistance() {
    liveGen += 1;
    askAgain = false;
    liveStop?.abort();
    liveStop = null;
    const el = liveSay();
    if (el) el.textContent = '';
  }
  signal?.addEventListener('abort', dropLiveDistance, { once: true });
  async function refreshLiveDistance() {
    if (asking) {
      dropLiveDistance();
      askAgain = true;
      return;
    }
    asking = true;
    try {
      do {
        askAgain = false;
        await askLiveDistance();
      } while (askAgain);
    } finally {
      asking = false;
    }
  }
  /** One ask about the cube in hand as it is now: its bound, then its exact distance. */
  async function askLiveDistance() {
    const el = liveSay();
    if (!el) return;
    const aimingAt = stageTargetNow();
    // The follow model as it is NOW, read once and before anything is awaited: both questions below
    // are about this one arrangement, and the session's model moves on with the next turn.
    const liveModel = modelNow();
    if (!aimingAt || !liveModel || !chainTrusted()) { dropLiveDistance(); return; }
    const mine = ++liveGen;
    liveStop?.abort();
    const stop = new AbortController();
    liveStop = stop;
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
    // A POSITIVE bound only. A bound of zero is not a distance, and whether the cube has arrived is
    // the exact answer's to say, replayed against the target — not a table read's.
    const bound = bounds?.bounds?.[aimingAt.id];
    if (Number.isInteger(bound) && bound > 0) {
      el.textContent = t('your cube now: %1', STAGE_COPY.atLeast(bound));
    }
    const answer = await stageAsk({
      want: 'route', target: aimingAt.id, facelets, nodeBudget: CHIP_NODE_BUDGET, maxDepth: 12,
      signal: stop.signal,
    });
    if (mine !== liveGen || !root.isConnected || !chainTrusted()) return;
    if (!answer) return;
    // routeSentence decides what an answer SAYS, zero included: it is the one function that may
    // reach the stage claim, gated on the route calling itself minimal. An arrival is a sentence
    // about the cube already, so it is not prefixed with another.
    const said = routeSentence({ moves: answer.moves, minimal: answer.exact === true }, aimingAt);
    el.textContent = answer.moves === 0 ? said : t('your cube now: %1', said);
  }
  return Object.freeze({ refresh: refreshLiveDistance, drop: dropLiveDistance });
}
