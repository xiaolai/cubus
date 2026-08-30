// The solver, off the main thread.
//
// At the tightest tier a search runs for seconds (dev-docs/solver-move-count.md). On the main
// thread that is a frozen app, so the two-phase engine lives here and answers one message at a
// time.
//
// Deliberately thin: everything worth testing is in solver-engine.js and two-phase.js, which
// run on the main thread under `node --test`. This file is the postMessage plumbing and nothing
// else.

import { handleSolveRequest } from './solve-client.js';
import { createSolver } from './solver-engine.js';
import * as twoPhase from './two-phase.js';

const solve = createSolver(twoPhase);

// One shared handler with the inline fallback (solve-client.js), so the two protocols cannot
// drift. A null alg is a real answer — "nothing that short within the budget" — and an error
// is sent as a tagged reply rather than thrown, so the caller's promise rejects instead of
// hanging forever on a worker that died silently.
self.addEventListener('message', (event) => {
  self.postMessage(handleSolveRequest(solve, event.data));
});
