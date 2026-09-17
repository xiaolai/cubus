// Waiting on the booted app for a CONDITION, not for a guessed number of milliseconds.
//
// Found by the 0.5.3 release gate, 2026-09-17, on a machine at load average 300+ from other work:
// `prove-controller.test.mjs` failed "no walk offered a proof" after a thirty-second wait. The suite had
// waited `settle(1500)` at boot for the solver to load and then pressed the die — and
// `lib/screens/cube/die.js` IGNORES a press made before `solverReady()`, silently, with the button still
// looking enabled. So the guess ran out before the load did, the press did nothing, and every condition
// the suite then waited on was one no press would ever produce. Five suites made the same guess; each
// now waits on the fact itself, and `test/app-waits.test.mjs` refuses a suite that presses the die
// without doing so.

/** Poll `ok()` until it holds, or throw naming `what`. A liveness bound, not a speed claim. */
export async function eventually(ok, what, { ms = 60_000, step = 20 } = {}) {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await new Promise((resolve) => { setTimeout(resolve, step); });
  }
}

/**
 * The app's solver has loaded — the condition a die press depends on.
 *
 * Imported when CALLED, not at the top of a suite: the service is the app's own module instance only
 * once the suite has put its window on `globalThis` and imported `lib/app.js`, and a static import would
 * load it first, in a Node with no window.
 */
export async function solverLoaded(opts) {
  const service = await import('../../lib/solver-service.js');
  // `solverReady` is a live `export let`, so reading it through the namespace sees the app's writes.
  await eventually(() => service.solverReady, 'the solver to load — a die press before it is ignored', opts);
}
