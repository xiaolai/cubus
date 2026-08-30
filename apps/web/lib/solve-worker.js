// The solver, off the main thread — one of possibly several.
//
// At the tightest tier a search runs for seconds (dev-docs/solver-move-count.md). On the main
// thread that is a frozen app, so the two-phase engine lives here and answers one message at a
// time.
//
// Deliberately thin: everything worth testing is in solver-engine.js and two-phase.js, which
// run on the main thread under `node --test`. This file is the postMessage plumbing, the view
// slice each request carries, and the one shared word that lets a search be called off.

import { handleSolveRequest, stopWord } from './solve-client.js';
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
 * Word 0 is the shallowest phase-1 depth any sibling has already found an answer at. This
 * worker gives up only when that is STRICTLY shallower than the depth it is currently
 * exploring: at the SAME depth a lower view index still wins, and stopping there would change
 * which answer comes back. That strictness is what keeps the pooled result deterministic.
 *
 * It is installed PER REQUEST and torn down after, because the app allows overlapping solves.
 * A worker-lifetime buffer let one cube's answer stop another cube's search — the two requests
 * publishing depths that mean nothing to each other into one word.
 */
let best = null;
twoPhase.setStopSignal((depth) => best !== null && depth >= 0 && Atomics.load(best, 0) < depth);

self.addEventListener('message', (event) => {
  const data = event.data ?? {};
  // `shared` is this request's word, or null when the page cannot make one. Cleared in the
  // finally so a request that arrives without one cannot inherit its predecessor's.
  best = stopWord(data.shared);
  try {
    self.postMessage(handleSolveRequest(solve, data, readStats));
  } finally {
    best = null;
  }
});
