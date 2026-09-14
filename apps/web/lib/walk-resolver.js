// The walk's search on the cube screen: what one load asks for, and how the answers to it race — a
// scramble rolled, or the whole-cube solve raced against a stage repair, and the lesson built from
// that answer when one is asked for.
//
// Its own unit because it keeps nothing between loads and writes nothing but the count beside the
// walk: it works a walk out into a record and hands it back, and the session commits it only once
// it knows the load is still the current one. Lifted out of lib/walk-session.js on 2026-09-13; the
// orderings it keeps are pinned through the session, in test/walk-session.test.mjs.

import { movesOf } from './cube-pieces.js';
import { t } from './i18n.js';

/**
 * The search of one mounted cube screen.
 *
 * @param {object} services `state`; `SOLVED`; `solverReady()` and `loadSolver()`;
 *   `randomScramble({ signal })`; `deriveCube(opts)`;
 *   `lastRoute(target, from, signal, wholeDone)`; `lessonFor(cube)`; `stepStates(from, moves)`;
 *   `setStatus(words)`, the count beside the walk; and `fallBackToSolution()`, what the screen does
 *   when a lesson cannot be built.
 */
export function createWalkResolver({
  state, SOLVED, solverReady, loadSolver, randomScramble, deriveCube, lastRoute, lessonFor, stepStates,
  setStatus, fallBackToSolution,
}) {
  /** The record a load commits. Whatever this walk did not produce is left empty. */
  const walkRecord = (fields) => Object.freeze({
    setup: '', alg: '', moves: [], steps: [], target: null, roll: null, lesson: null, route: null,
    ...fields,
  });

  /**
   * `alg` walked from `from`: its moves, and the state after each.
   *
   * The SAME tokenizer and the SAME replay for a scramble and a repair (movesOf, stepStates), not a
   * copy of each. The scramble once had its own copies, and they had drifted the way two copies of
   * one rule do: one threw where stepStates warns (found by audit, 2026-09-05). And ONE RULE for a
   * replay that comes up short, which is refused in the caller's words: a walk with a state missing
   * is not a walk, and the repair used to take the last state it did get as its target — a one-move
   * walk whose target was the cube it started at (found by audit, 2026-09-13).
   */
  function replay(from, alg, why) {
    const moves = movesOf(alg);
    const steps = stepStates(from, moves);
    if (steps.length !== moves.length + 1) throw new Error(why);
    return { moves, steps };
  }

  /**
   * A scramble, rolled. `randomScramble()` returns the state it lands on together with the alg that
   * gets there from solved. That alg is what we walk, so `setup` stays empty and the cube starts
   * solved. The target outlives the walk: "Solve this scramble" hands it to Home at the end.
   */
  async function rollWalk({ signal }) {
    const rolled = await randomScramble({ signal });
    if (!rolled.facelets || !rolled.alg) throw new Error('no scramble');
    const { moves, steps } = replay(SOLVED, rolled.alg, 'no scramble');
    return walkRecord({ alg: rolled.alg, moves, steps, target: rolled.facelets, roll: rolled });
  }

  /**
   * The whole-cube search: STARTED, NOT AWAITED, with its own cancellation chained to the walk's.
   *
   * Started rather than awaited because a repair's own source is a worker message and owes nothing
   * to this search — awaiting it made every repair wait out a whole-cube solve first, including one
   * whose target the cube was already at. The pool source awaits `done` instead, which is what §4's
   * "race" means: three sources, each arriving when it arrives. Its own cancellation because it is
   * not always the thing being waited for: a repair that answers makes it pointless, and letting it
   * run on holds a worker. Only the solve side starts one — the die's cancellation test in
   * app-hardening.test.mjs requires every controller a scramble walk builds but the current one to
   * have been called off, and a controller nothing used once broke it.
   *
   * A WHOLE-CUBE FAILURE MUST NOT TAKE THE REPAIR WITH IT, so a failure is kept, not thrown — an
   * unrelated failure once produced "could not work it out" over a cube whose cross repair was one
   * move (reproduced by an audit). `result()` hands it on only to a caller with no repair.
   */
  function startWholeSearch({ fresh, signal }) {
    const abort = new AbortController();
    // Aborted at once when the walk already is: a load overtaken while the solver was loading would
    // otherwise hand the search a live signal whose abort had already been and gone.
    if (signal.aborted) abort.abort();
    else signal.addEventListener('abort', () => abort.abort(), { once: true });
    // Its reports belong on the count only while it is still wanted. An abandoned search once
    // turned "your cube is already at the two bottom layers" into "7" (found by the browser
    // suite), and one left running past a repair that failed wrote over the failure (found by
    // audit, 2026-09-13).
    const heard = () => fresh() && !abort.signal.aborted;
    let answer = null;
    let failure = null;
    const done = (async () => {
      try {
        await deriveCube({
          signal: abort.signal,
          // Each improvement lands on the count as it is found, so a tight tier shows 21 becoming
          // 20 becoming 19 rather than nothing at all.
          onImprovement: (step) => { if (heard()) setStatus(String(step.moves)); },
          // An escalation is the search doubling its budget, which from outside is a count that has
          // stopped moving for seconds — so it says, in the smallest words available, that it is
          // still going. `attempt` is 0-BASED (solve-target's contract): nothing is said for the
          // ordinary attempt 0, and from the first ESCALATION on it is shown one-based, because
          // "attempt 2" is what a person would call it. Never a percentage or a time — nothing here
          // knows either.
          onProgress: ({ attempt }) => {
            if (heard() && attempt >= 1) setStatus(t('still searching (attempt %1)', attempt + 1));
          },
        });
        // READ THE MOMENT IT LANDS, never after the repair's race. A physical cube's snapshot
        // re-ingests the subject and empties its derived walk without making a new load, so a read
        // after the race committed an empty walk as a success (reproduced by an audit, 2026-09-13).
        // Copied, too: the next live update clears `stepFacelets`, and following a physical cube
        // needs the states to compare against to outlive the next turn.
        const c = state.cube;
        answer = walkRecord({
          setup: c.setupAlg, alg: c.solution, moves: c.moves.slice(), steps: c.stepFacelets.slice(),
        });
      } catch (err) {
        // A search THIS screen called off is not a failure to absorb: the subject it was about is
        // gone, and the session's catch knows what to do with it. Nor is one called off because it
        // stopped being wanted — that is a saving, not a failure.
        if (signal.aborted) throw err;
        if (!abort.signal.aborted) failure = err;
      }
    })();
    // NOBODY MAY BE LEFT TO AWAIT IT. A repair that answers — or a target the cube is already at,
    // which returns before the pool source is ever reached — leaves `done` with no awaiter, and its
    // abort path rethrows. Reproduced as an unhandled `solve: superseded` by choosing the cross on
    // `SOLVED·U` and leaving at once. Every `await` of it still sees the rejection.
    done.catch(() => {});
    return Object.freeze({
      done,
      /** Call it off. */
      stop: () => abort.abort(),
      /** Its answer, read after `done`; throws what failed when it had none. */
      result() {
        if (failure !== null) throw failure;
        return answer;
      },
    });
  }

  /**
   * A repair that answered, walked from the cube it was worked out for.
   *
   * EVERY ROUTE WAS REPLAYED against the target's independent predicate before it was yielded,
   * inside `routesToTarget` (§9a) — so a prefix scan off by one, a corrupted table and a wrong
   * worker reply all become "no route was worked out" rather than a wrong route in a child's hands.
   * This replay is a second one, in the scan frame, and the walk's target is read off it. No
   * verified path from SOLVED to the route's start exists — the walk begins where the cube is — so
   * `setup` stays empty and the arrangement is drawn: `scramble=""` would draw a solved cube under
   * a scrambled walk, and this is the branch the solve side takes when `takeSetupAlg` refuses.
   */
  function repairWalk(route, from) {
    const { moves, steps } = replay(from, route.alg, 'stage route: its replay came up short');
    return walkRecord({ alg: route.alg, moves, steps, target: steps.at(-1), route });
  }

  /**
   * The Lesson in the Solution's place, when it is the object asked for.
   *
   * Built from the arrangement the search just answered, and with its setup alg, so the two walks
   * start from the same cube and nothing is searched twice. Built ONLY when it is asked for — a
   * Solution never pays for a lesson — and `lessonFor` caches it on the subject, keyed on the
   * arrangement and the rungs. A cube the method cannot finish DEGRADES to the solution rather than
   * failing the screen: losing both objects because one could not be built would be the worst
   * outcome, and the switch goes back to Solution so the screen and the switch agree.
   */
  function lessonWalk(solution) {
    const lesson = lessonFor(state.cube);
    if (!lesson) {
      fallBackToSolution();
      return solution;
    }
    return walkRecord({
      setup: solution.setup, alg: lesson.alg, moves: lesson.moves.slice(),
      steps: lesson.stepFacelets.slice(), lesson,
    });
  }

  /**
   * The whole cube solved — raced against a repair when the target is a stage.
   *
   * Three sources race (§4). The pool's whole-cube answer is one of them, already paid for: the
   * fallback, truncated at the first prefix that reaches the target, and what "solve the whole cube
   * instead" offers when nothing shorter exists. The exact search, on the worker, is the second;
   * the method route is the third, and its throw is absorbed.
   *
   * EVERY EXIT CALLS THE WHOLE-CUBE SEARCH OFF: a repair that answered, an overtaken load, a throw.
   * A repair that threw once left it running with its reports still reaching the count, so a late
   * improvement replaced the failure with "7" (reproduced by an audit, 2026-09-13).
   */
  async function solveWalk({ stageTarget, walkKind, fresh, signal }) {
    // The cube this load is about, captured once: the session commits the walk well after the
    // search, and a live snapshot can change the subject between them without a new load — which is
    // deliberate, since a snapshot is not a new question — so the renderer is handed the walk's own
    // start, never whatever the subject has become. An audit reproduced the alternative: the walk
    // described `R` while the 3D cube was handed `R F`.
    const startedFrom = state.cube.facelets;
    const whole = startWholeSearch({ fresh, signal });
    try {
      // The repair first, because it is the one that can answer while the whole-cube search runs.
      const route = stageTarget
        ? await lastRoute(stageTarget, startedFrom, signal, whole.done)
        : null;
      if (!fresh()) return null;
      // A REPAIR THAT ANSWERED DOES NOT WAIT FOR THE SOLVE AT ALL: the pool source has been raced
      // already, and holding the repair at "working…" behind a search it does not need made asking
      // for it first buy nothing (reproduced by a verify pass).
      if (route && route.alg !== null) return repairWalk(route, startedFrom);
      // No repair: the whole-cube answer IS the walk, and its failure is the screen's.
      await whole.done;
      if (!fresh()) return null;
      const solution = walkRecord({ ...whole.result(), route });
      // A STAGE ROUTE HAS NO LESSON, and that is §9.4's finding rather than an omission: the app
      // orients the top corners before permuting them, so it cannot resume a lesson at "corners
      // home". The session hides the switch to match.
      return !stageTarget && walkKind === 'lesson' ? lessonWalk(solution) : solution;
    } finally {
      whole.stop();
    }
  }

  /**
   * Work out the walk a load asked for, into the record the session commits.
   *
   * `scrambling`; `stageTarget`, the target or null; `walkKind`; `fresh()`, whether this load is
   * still the current one; and `signal`, the walk's own abort.
   *
   * Resolves to null when the load was overtaken while it searched, having committed nothing, and
   * throws what failed — a search this screen called off included, which the session tells apart
   * by its signal.
   */
  async function resolveWalk({ scrambling, stageTarget, walkKind, fresh, signal }) {
    // ONE READINESS RULE for both sides, before either rolls or searches anything. It was written
    // out once per side, and two copies of one rule are how one of them stops being checked.
    if (!solverReady() && !(await loadSolver())) throw new Error('solver unavailable');
    return scrambling ? rollWalk({ signal }) : solveWalk({ stageTarget, walkKind, fresh, signal });
  }
  return Object.freeze({ resolveWalk });
}
