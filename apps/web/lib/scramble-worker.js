// Rolling a random cube, off the UI thread.
//
// A random cube is a random STATE, and turning a state into an alg you can show someone is a
// Kociemba two-phase search. cubejs runs that synchronously, and it is not fast in any bounded
// sense: measured across presses in WebKit it ranged 2-196ms for the same call. On the main
// thread that is a freeze of up to twelve frames, and it was the last thing making the Random
// die hitch after the redundant work around it had been removed.
//
// So this thread does exactly one thing: pick a random cube and solve it. Nothing else moves
// here. The main thread keeps its own cubejs — it is the app's synchronous oracle (validity,
// isSolved, per-step states, the registry's reachability round-trip) and every one of those is
// move application, not search, so none of them belongs on a worker.
//
// WHAT COMES BACK IS UNTRUSTED. It is a message from another thread, and the main thread checks
// it the same way it checks anything crossing a boundary: the alg must reproduce the facelets on
// a solved cube (app.js, `reaches`). A worker that answered nonsense would be refused and
// rolled again on the main thread, never drawn.
//
// The SOLUTION is what is posted, not the scramble. Inverting is one rule and it lives in
// app.js (`invertAlg`), because the same rule turns a solution into a setup alg and a setup alg
// back into a solution — two copies of it could drift, and the drift would be a cube whose
// picture and whose move list disagreed.

import Cube from '../vendor/cubejs.js';
import { randomCube } from './random-state.js';

// Built once, eagerly, so the first roll does not pay for it. Seconds of table building, on a
// thread where seconds cost nobody anything.
Cube.initSolver();
self.postMessage({ ready: true });

self.onmessage = () => {
  try {
    // Crypto random-state, never Cube.random(): the uniform draw from a cryptographic source
    // is the project's scramble rule (AGENTS.md), and Math.random is exactly the quiet
    // weakening it forbids — on this thread no less than on the main one.
    const cube = randomCube(Cube);
    self.postMessage({ facelets: cube.asString(), solution: cube.solve() });
  } catch (err) {
    // Loud, not silent: the main thread falls back to rolling on itself, and a worker that has
    // quietly stopped answering looks exactly like one that is merely slow.
    self.postMessage({ error: String(err && err.message ? err.message : err) });
  }
};
