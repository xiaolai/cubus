// The solver, off the main thread.
//
// At the tightest tier a search runs for seconds — 5.1 s median and 31.6 s worst for <= 18
// (dev-docs/solver-move-count.md). On the main thread that is a frozen app, so min2phase lives
// here and answers one message at a time.
//
// Deliberately thin: everything worth testing is in min2phase-engine.js, which runs on the main
// thread under `node --test`. This file is the postMessage plumbing and nothing else.

import { createSolver } from './min2phase-engine.js';
import * as min2phase from '../vendor/min2phase.js';

const solve = createSolver(min2phase);

self.addEventListener('message', (event) => {
  const { id, facelets, solLen, probeMax } = event.data ?? {};
  try {
    // null is a real answer here — "nothing that short within the budget" — and is passed
    // through as null rather than turned into an error, because the caller distinguishes them.
    self.postMessage({ id, alg: solve(facelets, { solLen, probeMax }) });
  } catch (err) {
    // A broken vendoring or a malformed request. Sent rather than thrown so the caller's
    // promise rejects instead of hanging forever on a worker that died silently.
    self.postMessage({ id, error: err?.message ?? String(err) });
  }
});
