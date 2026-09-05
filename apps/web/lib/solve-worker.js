// The solver, off the main thread — one of possibly several.
//
// At the tightest tier a search runs for seconds (dev-docs/solver-move-count.md). On the main
// thread that is a frozen app, so the two-phase engine lives here and answers one message at a
// time.
//
// Deliberately thin: everything worth testing is in solver-engine.js and two-phase.js, which
// run on the main thread under `node --test`. This file is the postMessage plumbing, the view
// slice each request carries, and the one shared word that lets a search be called off.

import { ADOPT_TABLES, PREPARE_TABLES, handleSolveRequest, handleTableRequest, shouldStop, stopWord } from './solve-client.js';
import { createSolver } from './solver-engine.js';
import * as twoPhase from './two-phase.js';

const solve = createSolver(twoPhase);
const readStats = () => twoPhase.searchStats;

/**
 * The stop channel, and why it is a SharedArrayBuffer rather than a message.
 *
 * A search is SYNCHRONOUS. A worker in the middle of a search never returns to its event loop,
 * so a postMessage asking it to stop is not delivered until the search it was meant to stop has
 * already finished. One shared word is the only channel that reaches inside a running search.
 *
 * Word 0 is the shallowest phase-1 depth any sibling has already found an answer at — or
 * STOP_NOW, which is shallower than every depth and means "this solve was abandoned". This
 * worker gives up only when the published value is STRICTLY shallower than the depth it is
 * currently exploring: at the SAME depth a lower view index still wins, and stopping there
 * would change which answer comes back. That strictness is what keeps the pooled result
 * deterministic, and it lives in `shouldStop` — a pure function in solve-client.js — because it
 * runs only on a thread no test process has, and both ways it can be wrong are invisible from
 * outside (a search that stopped early still returns a valid answer, just not the same one).
 *
 * It is installed PER REQUEST and torn down after, because the app allows overlapping solves.
 * A worker-lifetime buffer let one cube's answer stop another cube's search — the two requests
 * publishing depths that mean nothing to each other into one word.
 */
let best = null;
twoPhase.setStopSignal((depth) => shouldStop(best, depth));

self.addEventListener('message', (event) => {
  const data = event.data ?? {};
  // The table handshake, which is not a search: one worker builds the eleven tables into a
  // SharedArrayBuffer and the rest take views of the same bytes (2026-09-05). It can only arrive
  // between searches — a search is synchronous, so this thread is never inside one when a message
  // is delivered, which is what makes re-pointing the engine's tables here safe with no locking.
  if (data.kind === PREPARE_TABLES || data.kind === ADOPT_TABLES) {
    self.postMessage(handleTableRequest(twoPhase, data));
    return;
  }
  // `shared` is this request's word, or null when the page cannot make one. Cleared in the
  // finally so a request that arrives without one cannot inherit its predecessor's.
  best = stopWord(data.shared);
  try {
    self.postMessage(handleSolveRequest(solve, data, readStats));
  } finally {
    best = null;
  }
});
