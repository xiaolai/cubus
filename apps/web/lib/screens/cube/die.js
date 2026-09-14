// The cube screen's die: the press that loads a new cube, what the press holds while it rolls, and
// where a roll that produced nothing is said.
//
// Lifted out of lib/screens/cube.js on 2026-09-14, word for word but for its inputs. The services
// it named at module scope arrive as the app's half of its arguments — `WALK_APP`, the object the
// walk session is built from — so a press runs against fakes in test/cube-die.test.mjs, where each
// case decides when a roll and a solve answer. The screen's half is its root, which end of the
// walk it is, its abort and generation, and how it takes a new subject.

import { $ } from '../../app-state.js';
import { t } from '../../i18n.js';

/**
 * The die of one mounted cube screen, its press wired. A screen that draws no die gets nothing.
 *
 * REFUSED HERE when a service is missing, never at the first press: the press catches what a roll
 * throws, so a service that is not a function would read as a roll that failed, every time.
 *
 * @param {object} screen `root`; `scrambling`, which end of the walk the screen is; its abort
 *   `signal`; `stale()`, its generation check; and `takeNewSubject()`, which puts the adopted
 *   subject on the screen and hands back the load it started, or null when the screen is rebuilt.
 * @param {object} app `WALK_FAILURES`, `solverReady()`, `randomScramble`, `deriveCube`,
 *   `adoptCube`, `putInPlay` and `parkRoll`.
 */
export function createDie(screen, app) {
  const { root, scrambling, signal, stale, takeNewSubject } = screen;
  const { WALK_FAILURES, solverReady, randomScramble, deriveCube, adoptCube, putInPlay, parkRoll } = app;
  const services = { stale, takeNewSubject, solverReady, randomScramble, deriveCube, adoptCube, putInPlay, parkRoll };
  for (const [name, fn] of Object.entries(services)) {
    if (typeof fn !== 'function') throw new TypeError(`die: \`${name}\` must be a function`);
  }

  // A new cube is a new SUBJECT, not a new screen. This used to re-enter the screen, because
  // the solution, the move list and the step count were all built at mount and there was no
  // other way to replace them — which destroyed every node, listener and animation on the
  // screen to change one fact about it. loadWalk() is that other way now; refreshScreen()
  // asks for it and falls back to a rebuild only when the composition itself has to change.
  // Absent on the solve side unless the Advanced dev toggle shows it.
  //
  // The ANSWER IS STILL FOUND BEFORE ANYTHING ON SCREEN CHANGES. Adopting a cube and then
  // retargeting would put an empty chip grid and a count reading "working…" on the screen
  // until the solver answered — one whole presented frame, measured, and the blink this
  // button was reported for. Solving first spends the same milliseconds with the screen still
  // complete, and every await in loadWalk then resolves as a microtask.
  /** A roll produced nothing — said WHERE THE PRESS WAS, always.
   *
   *  The count beside the solution heading is this screen's status line while there is a
   *  walk: it is where failWalk reports the identical failure on the Scramble side, so the
   *  same press gets the same words wherever it is made. A screen with no walk has no such
   *  line — a solved cube draws no solution card — and there this reported to the console
   *  alone, which for the person pressing the button is indistinguishable from a button that
   *  does nothing (found by audit, 2026-09-05). `#rollSay` is the die's own line, drawn
   *  wherever the die is, so there is no composition in which the press can fail in silence.
   *  The die stays enabled either way, so the answer is the one it prints: try again.
   *  Silence was what both branches did before: an empty roll returned, and a rejected one
   *  escaped this handler entirely as an unhandled promise. */
  const sayRollFailed = (err) => {
    console.error('a random cube could not be rolled', err ?? 'the roller produced no cube');
    const status = $('#moveCount', root) ?? $('#rollSay', root);
    if (status) status.textContent = t(WALK_FAILURES['no scramble']);
  };
  /** Which press of the die owns the screen. Neither of the two generations already here can
   *  answer that: `stale()` counts SCREENS and this one is not being replaced, and `walkGen`
   *  counts walks, which a press has not started yet while it is still rolling. Rolling is a
   *  real Kociemba search — seconds, in the pool, alongside whatever else is queued — so two
   *  presses can be in flight at once and land in either order, and the OLDER one adopting
   *  its cube afterwards replaces the newer one on a screen already showing it (found by
   *  audit, 2026-09-05). */
  let rollGen = 0;
  const die = $('#randCube', root);
  if (die) die.onclick = async () => {
    if (!solverReady() || die.disabled) return;
    const mine = ++rollGen;
    // Held from BEFORE the first await, not from after the roll: the press used to stay live
    // for the length of the search it started, so a second press could roll a second cube
    // over the first. Released in the `finally` at the end, because a roll that fails must
    // leave behind the button that retries it.
    die.disabled = true;
    try {
      // Scramble rolls its own inside loadWalk — the walk IS the scramble there, so there is
      // no subject to adopt first.
      if (!scrambling) {
        // Known by construction, and NOT the cube in your hand. Marking this 'camera' was the
        // bug behind a solved physical cube instantly completing a random solve: the guide
        // accepted the real cube's snapshots as progress through an arrangement it had never
        // been in.
        let rolled;
        try {
          rolled = await randomScramble({ signal });
        } catch (err) {
          // Rolling IS a solve (2026-08-31), so it fails the way a solve fails — eight budget
          // escalations, or a pool that could not spawn a worker. The press must not end in
          // silence and an unhandled rejection.
          if (!stale() && mine === rollGen) sayRollFailed(err);
          return;
        }
        // Superseded, by the screen or by a later press. Either way this cube is nobody's
        // subject — and rolling is a real search, so it is parked rather than wasted.
        if (stale() || mine !== rollGen) { parkRoll(rolled); return; }
        if (!rolled.facelets) { sayRollFailed(null); return; }
        putInPlay(rolled);
        adoptCube(rolled.facelets, { physical: false, source: 'generated', setupAlg: rolled.alg });
      }
      // A failure is not swallowed into silence — it leaves `solution` empty, and the screen
      // says "could not work it out" the way it does for any walk it cannot build.
      try { if (!scrambling) await deriveCube({ signal }); }
      catch (err) {
        // A search the screen's own teardown called off is not a failure worth a line: the
        // subject is gone and nobody is waiting on it.
        if (err?.name !== 'AbortError') console.warn('random cube could not be solved', err);
      }
      if (stale() || mine !== rollGen) return; // navigated away, or overtaken, while solving
      // Held until the walk is on screen: taking the new subject only starts the load, and on
      // Scramble that load is the roll (found by audit, 2026-09-13).
      await takeNewSubject();
    } finally { die.disabled = false; }
  };
}
