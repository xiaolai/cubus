// The walk's search on the cube screen: what one load asks for, and how the answers to it race — a
// scramble rolled, or the whole-cube solve raced against a stage repair, with the lesson worked out
// beside it.
//
// Its own unit because it keeps nothing between loads and writes nothing but the count beside the
// walk: it works a walk out into locals and hands them back as one record, and the session commits
// them only once it knows the load is still the current one. Lifted out of lib/walk-session.js on
// 2026-09-13; the orderings it keeps are pinned through the session, in test/walk-session.test.mjs.

import { movesOf } from './cube-pieces.js';
import { t } from './i18n.js';

/**
 * The search of one mounted cube screen.
 *
 * @param {object} services `state`; `SOLVED`; `solverReady()` and `loadSolver()`;
 *   `randomScramble()`; `deriveCube(opts)`; `lastRoute(target, from, signal, wholeDone)`;
 *   `lessonFor(cube)`; `stepStates(from, moves)`; `setStatus(words)`, the count beside the walk;
 *   and `fallBackToSolution()`, what the screen does when a lesson cannot be built.
 */
export function createWalkResolver({
  state, SOLVED, solverReady, loadSolver, randomScramble, deriveCube, lastRoute, lessonFor, stepStates,
  setStatus, fallBackToSolution,
}) {
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
    let gotSetup = '', gotAlg = '', gotMoves = [], gotSteps = [], gotTarget = null, gotRoll = null;
    let gotLesson = null;
    // The repair, when one was asked for. Null on the Scramble side and whenever the target is
    // the whole cube, which is what every read of it below is guarded on.
    let gotRoute = null;
    /** The whole-cube search's failure, or null. See where it is rethrown. */
    let wholeFailed = null;
    /**
     * The cube a repair was computed FOR.
     *
     * Captured once, because the session commits the walk well after the search, and the two
     * must agree about which cube they are describing. A live snapshot can change the subject
     * between them without touching `walkGen` — that is deliberate, since a snapshot is not a
     * new question — so the renderer is handed THIS string rather than whatever the subject
     * has since become. An audit reproduced the alternative: the walk described `R` while the
     * 3D cube was handed `R F`.
     */
    let startedFrom = null;
    /**
     * The whole-cube search's OWN cancellation, chained to the walk's.
     *
     * It needs one because it is no longer the thing being waited for: a repair that answers
     * makes it pointless, and letting it run on is not free — it holds a worker, and its
     * progress callbacks keep writing to a status line that now belongs to the repair.
     */
    //
    // NOT ON THE SCRAMBLE PATH, which never runs a whole-cube search — and the die's own
    // cancellation test is what said so: it spies on every `AbortController` a walk builds and
    // requires all but the current one to have been called off, which a second controller that
    // nothing ever uses quietly broke. One per thing that can actually be cancelled.
    const wholeAbort = scrambling ? null : new AbortController();
    if (wholeAbort) signal.addEventListener('abort', () => wholeAbort.abort(), { once: true });
    /** Set the moment a repair has an algorithm. Read by the callbacks below, which must stop
     *  talking once the line they write to is describing something else. */
    let stageAnswered = false;
    /** `deriveCube`, with its failure captured rather than thrown — the repair runs either way. */
    const deriveWhole = async (opts) => {
      try {
        await deriveCube(opts);
      } catch (err) {
        // A search THIS screen called off is not a failure to absorb: the subject it was about
        // is gone, and the outer catch already knows what to do with it. Nor is one WE called
        // off because a repair had already answered — that is a saving, not a failure.
        if (signal.aborted) throw err;
        if (!wholeAbort?.signal.aborted) wholeFailed = err;
      }
    };
    if (scrambling) {
      if (!solverReady() && !(await loadSolver())) throw new Error('solver unavailable');
      // randomScramble() returns the state it lands on together with the alg that gets there
      // from solved. That alg is what we walk, so `setup` stays empty and the cube starts
      // solved. The target outlives this block: it is what "Solve this scramble" hands to
      // Home at the end of the walk.
      const rolled = await randomScramble();
      gotRoll = rolled;
      gotTarget = rolled.facelets;
      if (!gotTarget || !rolled.alg) throw new Error('no scramble');
      // The SAME tokenizer and the SAME replay the solve path uses (movesOf, stepStates),
      // not a second copy of each. They were written out again here, and the copies had
      // already drifted in the way two copies of one rule always do: this one threw where
      // stepStates warns, so one walk called a failed replay "a scramble could not be
      // rolled" and the other quietly shipped a short step array (found by audit,
      // 2026-09-05). One path now, with the refusal kept where it belongs — a scramble
      // whose replay came up short IS a failed roll, and says so in those words.
      gotAlg = rolled.alg; gotMoves = movesOf(gotAlg);
      gotSteps = stepStates(SOLVED, gotMoves);
      if (gotSteps.length !== gotMoves.length + 1) throw new Error('no scramble');
    } else {
      if (!solverReady() && !(await loadSolver())) throw new Error('solver unavailable');
      // Each improvement lands on the heading as it is found, so a tight tier shows 21
      // becoming 20 becoming 19 rather than nothing at all — guarded by fresh(), because
      // a superseded load's improvements describe a cube no longer on screen.
      //
      // `signal` is what makes a superseded search stop rather than run to its budget on
      // every worker with the next one queued behind it. `onProgress` is the other half of
      // the same wait: an escalation is the search doubling its budget and starting again,
      // which from outside is a count that has stopped moving for seconds — so it says, in
      // the smallest words available, that it is still going.
      //
      // deriveCube, not solve: the walk and the setup alg the twin animates from are one
      // answer now, so there is one ask. `gotSetup` below reads the alg this produced.
      // STARTED, NOT AWAITED. The repair's own source is a worker message and owes nothing
      // to this search — but awaiting here made every repair wait out a whole-cube solve
      // first, including one whose answer was already known and one whose target the cube
      // was already at. The pool source below awaits this promise instead, which is what
      // §4's "race" actually means: three sources, each arriving when it arrives.
      const wholeDone = deriveWhole({
        signal: wholeAbort.signal,
        // `!stageAnswered`, and the browser suite is what found it: an abandoned whole-cube
        // search kept reporting improvements into the status line AFTER a repair had
        // committed, so "your cube is already at the two bottom layers" became "7". The
        // count belongs to whatever is on screen, and once a repair is there it is not this.
        onImprovement: (step) => { if (fresh() && !stageAnswered) setStatus(String(step.moves)); },
        onProgress: ({ attempt }) => {
          // `attempt` is 0-BASED (solve-target's contract), and only the first escalating
          // search reports at all. Nothing is said for attempt 0: that is the ordinary
          // case and needs no apology. From the first ESCALATION on, the count is shown
          // one-based, because "attempt 2" is what a person would call it. Never a
          // percentage or a time — nothing here knows either.
          if (fresh() && !stageAnswered && attempt >= 1) setStatus(t('still searching (attempt %1)', attempt + 1));
        },
      });
      // NOBODY MAY BE LEFT TO AWAIT IT. A repair that answers — or a target the cube is
      // already at, which returns before the pool source is ever reached — leaves this
      // promise with no awaiter, and its abort path rethrows. Reproduced as an unhandled
      // `solve: superseded` by choosing the cross on `SOLVED·U` and leaving at once. The
      // handler makes the rejection observed; every `await wholeDone` below still sees it.
      wholeDone.catch(() => {});
      // A WHOLE-CUBE FAILURE MUST NOT TAKE THE REPAIR WITH IT. The repair's own source is the
      // worker's exact search, which knows nothing about the two-phase pool; the pool's
      // answer is one of three sources and, where the exact search answers, the least
      // important of them. Letting `deriveCube` throw straight out of here meant an
      // unrelated failure produced "could not work it out" over a cube whose cross repair
      // was one move — reproduced by an audit.
      //
      // Rethrown at once when there is no repair to fall back on, because then the
      // whole-cube answer IS the walk and its failure is the screen's.
      // …and the repair, first, because it is the one that can answer while the whole-cube
      // search is still running.
      if (stageTarget) {
        startedFrom = state.cube.facelets;
        gotRoute = await lastRoute(stageTarget, startedFrom, signal, wholeDone);
        if (!fresh()) return null;
        stageAnswered = Boolean(gotRoute && gotRoute.alg !== null);
        // Nothing is waiting for the whole-cube answer any more: the pool source has already
        // been raced, and the locals below are read only when there is no repair. Calling it
        // off frees the worker for the next question rather than leaving a four-million-node
        // search running for nobody.
        if (stageAnswered) wholeAbort.abort();
      }
      // A REPAIR THAT ANSWERED DOES NOT WAIT FOR THE SOLVE AT ALL. Awaiting here made the
      // reordering above buy nothing: the repair was asked for first and then held at
      // "working…" until a whole-cube search it does not need had finished. The whole-cube
      // locals are only read when there is no repair to commit, so the wait goes with them.
      if (!stageAnswered) {
        await wholeDone;
        if (!fresh()) return null;
        // Nothing answered, and the whole-cube search failed too: there is no walk of any
        // kind, so the screen says what failed rather than standing over an empty one.
        if (wholeFailed !== null) throw wholeFailed;
        gotSetup = state.cube.setupAlg; gotAlg = state.cube.solution; gotMoves = state.cube.moves;
        // Snapshotted: setFacelets() clears stepFacelets on every live update, and following
        // a physical cube needs the states to compare against to outlive the next turn.
        gotSteps = state.cube.stepFacelets.slice();
      }
      // ---- the repair, when the target is a STAGE rather than the whole cube -------------
      //
      // Three sources race (§4) and the pool's answer above is one of them, already paid
      // for: it is the fallback, truncated at the first prefix that reaches the target, and
      // it is also what "solve the whole cube instead" offers when nothing shorter exists.
      // The exact search is the second, on the worker; the method route is the third, and
      // its throw is absorbed.
      //
      // EVERY ROUTE IS REPLAYED against the target's independent predicate before it is
      // yielded, inside `routesToTarget` — so a prefix scan off by one, a corrupted table
      // and a wrong worker reply all become "no route was worked out" rather than a wrong
      // route in a child's hands (§9a).
      if (gotRoute) {
        if (gotRoute.alg !== null) {
          gotAlg = gotRoute.alg;
          gotMoves = movesOf(gotAlg);
          gotSteps = stepStates(startedFrom, gotMoves);
          // No verified path from SOLVED to a stage route's start, and there cannot be one:
          // the walk begins where the cube is. `scramble=""` would draw a solved cube under
          // a scrambled walk, so the arrangement is drawn instead — the same branch the
          // solve side already takes when `takeSetupAlg` refuses.
          gotSetup = '';
          gotTarget = gotSteps.at(-1) ?? null;
          gotLesson = null;
        }
      }
      // The lesson is worked out AFTER the search and never instead of it, so both objects
      // exist for this cube and switching between them costs nothing (§3). It reuses the
      // setup alg the search produced: the two walks start from the same arrangement, and
      // deriving it twice would be two Kociemba searches for one answer.
      //
      // A cube the method cannot finish DEGRADES to the solution rather than failing the
      // screen. Losing both objects because one of them could not be built would be the
      // worst of the three outcomes, and the pill goes back to Solution so the screen and
      // the switch agree about what is showing.
      // A STAGE ROUTE HAS NO LESSON, and that is §9.4's finding rather than an omission: the
      // app orients the top corners before permuting them, so it cannot resume a lesson at
      // "corners home" — the screen offers the repair and then the solve, not the next
      // lesson step. The pair of pills is hidden below for the same reason, so the switch
      // and the screen agree about what is showing.
      if (!stageAnswered && !stageTarget && walkKind === 'lesson') {
        gotLesson = lessonFor(state.cube);
        if (gotLesson) {
          gotAlg = gotLesson.alg;
          gotMoves = gotLesson.moves.slice();
          gotSteps = gotLesson.stepFacelets.slice();
        } else {
          fallBackToSolution();
        }
      }
    }
    return {
      setup: gotSetup, alg: gotAlg, moves: gotMoves, steps: gotSteps, target: gotTarget,
      roll: gotRoll, lesson: gotLesson, route: gotRoute,
    };
  }
  return Object.freeze({ resolveWalk });
}
