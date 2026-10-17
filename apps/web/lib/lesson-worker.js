// The method solver, off the main thread (lib/lesson-client.js says why, and what crosses).
//
// Deliberately thin: everything worth testing is `handleMethodSolve` in lesson-client.js, which node
// runs. The repertoires and the cross table the method engine builds on first use live here, for the
// page's lifetime, so the second lesson of a session is warm.

import { answerMethodSolve } from './lesson-client.js';
import { solveByMethod } from './method-solver.js';
import { isMethodId, methodById } from './methods/registry.js';
import { methodOf, prepareMethod } from './methods/method-of.js';

const engine = {
  solveByMethod, methodById, methodOf,
  // Roux's tables are fetched the first time Roux is asked for, and kept for the page's lifetime.
  prepare: (id) => (isMethodId(id) ? prepareMethod(methodById(id)) : undefined),
};

// Asynchronous only while a method's tables load; every request is answered, in whatever order they finish —
// the client matches a reply to its question by id.
self.addEventListener('message', async (event) => {
  self.postMessage(await answerMethodSolve(engine, event.data));
});
