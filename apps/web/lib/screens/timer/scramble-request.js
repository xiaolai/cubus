// The Timer's scramble requests: a press asks for a scramble, and the newest press is the one the
// screen shows.
//
// Lifted out of lib/screens/timer.js on 2026-09-14. A roll is a real Kociemba search in the solver
// pool, so two presses overlap and answer in either order, and the screen can go while one is out.
// Inline in the mount, that order could be driven only through the real solver, which chooses it,
// and the roll was handed no way to be called off: a superseded or abandoned search ran to its end
// on the pool (verification, 2026-09-14). Pinned by test/timer-scramble-request.test.mjs, over
// fakes that decide when every press answers.

/**
 * The scramble requests of one mounted Timer.
 *
 * @param {object} deps `roll({ signal })`, which rolls one; `park(rolled)`, which keeps a roll
 *   nobody can use for the next press; `ready()`, whether the solver has loaded, and `load()`,
 *   which loads it and answers whether it did; `live()`, whether the screen that asked is still the
 *   one on show; `busy()`, whether a solve is being timed; and what the screen says —
 *   `onWaiting()`, `onLoadFailed()`, `onRolled(rolled)`, and `onFailed(err)`, with `err` null for
 *   a roll that came back empty.
 * @returns {object} `request()`, a press; `dispose()`, which calls off the roll that is out.
 */
export function createScrambleRequests({
  roll, park, ready, load, live, busy, onWaiting, onLoadFailed, onRolled, onFailed,
}) {
  /** Which press the screen is still waiting for. */
  let seq = 0;
  /** The roll that is out, to call it off by. */
  let stop = null;
  const callOff = () => { stop?.abort(); stop = null; };

  async function request() {
    // The scramble on screen is the one a RUNNING solve is recorded against: rolling a new one
    // mid-solve would file the time under a scramble the solver never saw.
    if (busy()) return;
    const mine = ++seq;
    // A newer press calls the older search off, rather than leave the pool working for nobody.
    callOff();
    if (!ready()) {
      onWaiting();
      // Asked again once the solver lands — or, when it never does, said about the APP.
      void load().then((ok) => {
        if (!live()) return;
        if (ok) { void request(); return; }
        onLoadFailed();
      });
      return;
    }
    const controller = new AbortController();
    stop = controller;
    let rolled;
    try {
      rolled = await roll({ signal: controller.signal });
    } catch (err) {
      if (mine !== seq || !live()) return;
      onFailed(err);
      return;
    } finally {
      if (stop === controller) stop = null;
    }
    // Re-checked after the await: seconds can pass inside a roll, long enough for a newer press, a
    // screen left or a solve started. A cube rolled anyway is parked for the next press.
    if (mine !== seq || !live() || busy()) { park(rolled); return; }
    // An EMPTY roll says what a roll that threw says, and changes nothing: nothing is put in play
    // that the screen would not show.
    if (!rolled?.alg) { onFailed(null); return; }
    onRolled(rolled);
  }

  return Object.freeze({ request, dispose: () => { seq += 1; callOff(); } });
}
