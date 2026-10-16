// The method solver, off the main thread (lib/lesson-client.js says why, and what crosses).
//
// Deliberately thin: everything worth testing is `handleMethodSolve` in lesson-client.js, which node
// runs. The repertoires and the cross table the method engine builds on first use live here, for the
// page's lifetime, so the second lesson of a session is warm.

import { handleMethodSolve } from './lesson-client.js';
import { solveByMethod } from './method-solver.js';
import { methodById } from './methods/registry.js';
import { methodOf } from './methods/method-of.js';

const engine = { solveByMethod, methodById, methodOf };

self.addEventListener('message', (event) => {
  self.postMessage(handleMethodSolve(engine, event.data));
});
