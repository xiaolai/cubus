// The route race on the cube screen: the best route into a stage target, from the three sources of
// dev-docs/solve-to-state-plan.md §4, raced through lib/stage-route.js.
//
// Lifted out of lib/screens/cube.js on 2026-09-14, word for word but for its inputs: the services
// it named at module scope arrive as arguments, so the race runs against fakes in
// test/route-race.test.mjs. The screen still builds it, beside the one budget the app may import
// from the stage engine.

import { fromCube } from '../../cube-pieces.js';
import { METHOD_FRAME, METHOD_TO_SCAN, renameAlg, toMethodFrame } from '../../solving-hold.js';
import { routeToTarget } from '../../stage-route.js';

/**
 * The route race, built from the services it reaches for.
 *
 * REFUSED HERE when one is missing, never at the first press. The race absorbs every source's
 * throw — that is what lets a worker die without taking the pool's answer with it — so a service
 * that is not a function would not fail at all: its source would answer nothing, every time, and
 * nothing would say why.
 *
 * @param {object} deps `state`, whose whole-cube solution the pool source reads; `cubejs()`, the
 *   cubejs class, a function because `loadSolver` assigns it long after the screen module loads;
 *   `stageAsk`, the pool's door for stage questions; `solveByMethod`; and `STAGE_NODE_BUDGET`,
 *   the exact search's budget.
 * @returns {Function} `lastRoute(target, facelets, signal, wholeDone)`.
 */
export function createRouteRace({ state, cubejs, stageAsk, solveByMethod, STAGE_NODE_BUDGET }) {
  for (const [name, fn] of Object.entries({ cubejs, stageAsk, solveByMethod })) {
    if (typeof fn !== 'function') throw new TypeError(`route race: \`${name}\` must be a function`);
  }
  if (state === null || typeof state !== 'object') {
    throw new TypeError('route race: `state` must be the app state');
  }
  if (!Number.isInteger(STAGE_NODE_BUDGET) || STAGE_NODE_BUDGET < 1) {
    throw new TypeError('route race: `STAGE_NODE_BUDGET` must be a positive node count');
  }

  /**
   * The best route into `target`, from the three sources of §4.
   *
   * Every source is injected rather than reached for, which is what lets the race be tested
   * without a worker: `lib/stage-route.js` knows nothing about this app. What it does know is
   * that a route is replayed before it is yielded, so nothing that fails the target's own
   * predicate can come back from here.
   *
   * Only the LAST route the race yields comes back — `routeToTarget` keeps it, and nothing else.
   * A screen that painted each in turn would show a fallback for a few hundred milliseconds
   * and then replace it, which is the "working…" flicker the repository already removed once;
   * the chips on Restore are where a bound-then-answer sequence belongs, because there the
   * first number arrives instantly and the second is an upgrade rather than a correction.
   */
  async function lastRoute(target, facelets, signal, wholeDone) {
    // THE RACE RUNS IN THE METHOD FRAME, and only its answer leaves it (ADR 0003). All three
    // sources and the replay must agree about which cross is "the cross": the replay checks the
    // target's predicate on THIS cubie, so a source answering in the scan frame would be judged
    // against the white cross while having aimed at the yellow one.
    const cubie = fromCube(cubejs().fromString(toMethodFrame(facelets)));
    const deps = {
      exact: async () => {
        if (signal?.aborted) return null;
        // The walk's signal goes WITH the question. Where the page can share memory it becomes the
        // stop word the worker's search polls (lib/solve-client.js), so a superseded walk's search
        // hands its worker back instead of running out its budget there.
        const reply = await stageAsk({
          want: 'route', target: target.id, facelets, nodeBudget: STAGE_NODE_BUDGET, maxDepth: 12,
          signal,
        });
        return reply?.moves === null || !reply ? null : { alg: reply.alg, moves: reply.moves };
      },
      // AWAITED, not read. The whole-cube search is running beside this one rather than in
      // front of it, so the pool source is "whatever that search produces, when it produces
      // it" — which is exactly a third racer. Reading `state.cube.solution` synchronously made
      // this source empty whenever it was asked first, which after the reordering is always.
      pool: async () => {
        await wholeDone;
        // The whole-cube solution is a scan-frame walk; the prefix scan runs on the method
        // frame's cubie, so it is renamed first. A throw here is absorbed by the race.
        return state.cube.solution ? renameAlg(state.cube.solution, METHOD_FRAME) : null;
      },
      /**
       * The method route — SCHEDULED, not called inline, and the yield is the point.
       *
       * `solveByMethod` is synchronous and unbounded: 0.45 to 24 ms measured, median 6.6.
       * Called straight from the race it runs before anything awaits, so it blocked this
       * thread between the exact request being built and it being sent — the one source that
       * leaves the machine, delayed by the one that cannot. A macrotask first puts it behind
       * the worker message and the pool's already-known answer, which costs it a tick and
       * costs the other two nothing.
       *
       * §4 keeps it in the race even so, and the measurement is why it is worth saying: over
       * the 156 corpus states where the fallback actually fires it was shorter in ZERO of
       * them. It is not here to win; it is here because the pool source is
       * `state.cube.solution`, and when that search failed there is nothing else.
       */
      method: async () => {
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        // AND THE WALK IS ASKED ABOUT AGAIN AFTER IT. The tick is exactly where a superseded walk's
        // abort lands, and `solveByMethod` takes no signal: run then, it solves a cube nobody is
        // waiting for, on the thread that draws.
        if (signal?.aborted) return null;
        return solveByMethod(cubie).alg;
      },
    };
    const last = await routeToTarget(target, cubie, deps);
    // Back to the scan frame, where the walk, the renderer and `follow` live. Same moves, same
    // count, same claim — only the names change, so `minimal` and `overshoot` carry over as-is.
    if (!last || last.alg === null) return last;
    return Object.freeze({ ...last, alg: renameAlg(last.alg, METHOD_TO_SCAN) });
  }
  return lastRoute;
}
