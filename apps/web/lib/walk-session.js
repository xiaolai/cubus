// The walk on the cube screen: loading it, stepping through it, following a smart cube along it.
//
// A walk SESSION is everything one mounted cube screen owns about its walk, and it outlives every
// single walk shown on that screen: the walk itself (the moves, the state after each, the target, a
// lesson or a stage route), the transport that steps through it, following a physical cube along
// it, the live distance to a stage, the rung offer at its end, and the load that replaces the walk
// when the subject changes. The SCREEN keeps its composition — the markup, the renderer element,
// the two nets, the speed menu, the die, the reconnect question — and hands this module the parts
// of it a walk writes to.
//
// These were the 1,400 walk lines of `cubeScreen`'s mount in app.js, a closure that read 63 of that
// file's module-level names and wrote four without naming any of them. `lib/hold-presenter.js` took
// the walk's hold out first (2026-09-13) and recorded the rest as a change of its own. The code
// moved line for line; what changed is that every input is a parameter, so a session can be driven
// with a fake renderer and fake searches (`test/walk-session.test.mjs`).
//
// Two things deliberately stay outside this module, and each arrives as a function. The WORDS that
// may claim a minimum: there are three sanctioned sources (AGENTS.md, fourth seam) and
// `optimal.test.mjs` finds the app's two by name, in lib/prove-affordance.js — so `sayWalkLength`
// comes in here the way `runProof` receives `sayProved`. And the route race, `lastRoute`, which
// reads no screen state: the cube screen builds it (lib/screens/cube/route-race.js) beside the one
// budget the app may import from the stage engine.

import { t } from './i18n.js';
import { SCAN_HOLD, fromMethodFrame, holdSentence, renameAlg } from './solving-hold.js';
import { walkHoldFor } from './hold-presenter.js';
import { TARGET_BY_ID } from './stage-targets.js';
import { targetPicture } from './stage-picture.js';
import { cancel as optimalCancel, capability as optimalCapability } from './optimal.js';
import { createLiveDistance } from './walk-live-distance.js';
import { createRungOffer } from './walk-offer.js';
import { createWalkResolver } from './walk-resolver.js';
import { createWalkPresenter } from './walk-presenter.js';
import { createFollowTracker } from './walk-follow.js';

/** Destructuring through this refuses, AT CONSTRUCTION, any name `from` does not provide — so a
 *  service missing from `WALK_APP` fails the mount, not the one rare press that would first call
 *  it. The names are written once, in the destructuring itself, so there is no second list to
 *  drift. */
const provided = (from, what) => new Proxy(from, {
  get(target, key) {
    if (!(key in target)) throw new TypeError(`walk session: the ${what} does not provide "${String(key)}"`);
    return target[key];
  },
});

/**
 * The walk session of one mounted cube screen: its controls wired, nothing loaded yet.
 *
 * Construction is synchronous and searches for nothing. The screen installs the four live hooks
 * this returns and then awaits `load()` — the order the closure kept, so a turn reported during the
 * first search already reaches this walk's follow model.
 *
 * @param {object} screen what the SCREEN owns and a walk writes to: `root`; the renderer `cube`;
 *   `scrambling`, `walking`, `unsolvable` and `label`, as the screen was composed;
 *   `stateHeading()`; `stale()`, its generation check; `signal`, its abort; `paintNet` and
 *   `paintAim`; `syncReconnectAsk()`; and `applyTempo()`, the speed menu's.
 * @param {object} app what the APP owns: shared `state` and `settings`, and every service a walk
 *   reaches for — listed once, as `WALK_APP` in lib/screens/cube.js. `cubejs()` and
 *   `solverReady()` are functions because `loadSolver` assigns both long after that object exists.
 */
export function createWalkSession(screen, app) {
  const {
    root, cube, scrambling, walking, unsolvable, label, stateHeading, stale, signal,
    paintNet, paintAim, syncReconnectAsk, applyTempo,
  } = provided(screen, 'screen');
  const {
    state, settings, SOLVED, CHIP_NODE_BUDGET, WALK_FAILURES, cubejs, solverReady, loadSolver,
    randomScramble, deriveCube, classifyCube, adoptCube, chainTrusted, markStale, lessonFor,
    stageAsk, stepStates, putInPlay, parkRoll, refreshScreen, go, save, raiseRung, escHtml, icon,
    lastRoute, sayWalkLength, describeCube,
  } = provided(app, 'app');
  const $ = (sel, from) => from.querySelector(sel);

  /** The search this screen is currently waiting on, so a superseded one can be stopped.
   *
   *  A press of the die, a reconnect answered, a tier change or leaving the screen all make
   *  the search in flight about a cube nobody is looking at any more — and without this it
   *  ran to its full budget anyway, on every worker in the pool, with the NEXT search queued
   *  behind it. The engine already polls a stop word per solve; an AbortSignal is how that
   *  reaches it, and it cancels without terminating workers or rebuilding their tables. */
  let walkAbort = null;

  const solList = $('#solList', root);
  const setStatus = (msg) => { $('#moveCount', root).textContent = msg; };

  // ---- the walk, and everything a retarget replaces ---------------------------------------
  //
  // These are `let`, not `const`, and that is the whole shape of this screen: pressing Random
  // does not navigate anywhere, it changes which cube the screen is ABOUT, and it used to say
  // so by re-entering the screen — destroying every node, listener and animation to change
  // one subject. Everything below is written once per MOUNT and reads these through the
  // closure, so loadWalk() can replace the walk underneath them without rebuilding anything.
  // A `const` here would put us straight back to needing a new screen for a new cube.
  let setup, alg, moves = [], steps = [], target = null, total = 0;
  /** How the walk on screen is held, where a lesson does not decide it per move (ADR 0003). */
  let walkHold = SCAN_HOLD;
  /**
   * The repair this walk came from, or null when the walk is a whole-cube solution.
   *
   * Carries the CLAIM as well as the route — whether the length may be called the shortest,
   * and whether the answer overshot to a solved cube — so the sentence beside the count is
   * derived from the same object the moves came from and the two cannot drift.
   */
  let route = null;
  // Which of the two objects this screen is showing. `let`, and deliberately NOT a setting:
  // it is a view of this screen, not a preference about every cube, so it lives as long as
  // the screen does and is never written to storage. A learner who wants the lesson wants it
  // for the next cube too, so it survives a retarget; it does not survive leaving.
  let walkKind = 'solution';
  /** The lesson on screen, or null while the Solution is showing. Read by sync(). */
  let lesson = null;
  // Which load is current. `screenGen` cannot answer this any more: it counts SCREENS, and a
  // retarget deliberately does not make a new one — so two presses in quick succession would
  // both believe they were still valid, and the slower solve would paint its move list over
  // the cube the faster one left on screen.
  let walkGen = 0;
  /** Whether a walk is committed on screen: false from beginWalk until a load commits one, so also
   *  after a load that failed. `total` cannot say it — a stage already reached is a walk of 0. */
  let walkLoaded = false;

  // The walk's view — the transport head, the chips' marks, the play and step buttons, the
  // renderer's step event and the scramble hand-off — is its own unit (lib/walk-presenter.js). It
  // reads the walk when it paints, and reaches the follow tracker and the rung offer only once both
  // exist.
  const {
    holdAt, moveHoldAt, holdCube, pointAtStep, sync, setPlaying, clearChips, takeChips, resetHead,
  } = createWalkPresenter({
    root, cube, state, signal, scrambling, stale, solList, icon, adoptCube, go,
    walkNow: () => ({ total, target, alg, lesson, walkHold, walkGen, walkLoaded }),
    takeOver: () => follow.takeOver(),
    onHead: (from, to, walk) => offer.onHead(from, to, walk),
  });
  // ---- the rung offer: its own unit (lib/walk-offer.js) ---------------------------------------
  const offer = createRungOffer({
    root, settings, save, raiseRung,
    onRaised: () => {
      // **Not when there is nothing left to solve.** The offer arrives at the END of a walk, and
      // a learner following on a physical cube has by then actually solved it — so `state.cube`
      // is the solved arrangement. Reloading asked the solver for a walk from solved to solved,
      // got nothing, and replaced the lesson the learner had just finished with "could not work
      // it out" — blaming the cube for a question nobody should have asked. The finished walk
      // stays on screen; the raised rung applies to the next cube, which is the one it is for.
      // `state.cube.lesson` is cleared by raising the rung either way, so that next lesson is
      // built at the new rungs rather than served from a cache made at the old ones.
      if (walkKind === 'lesson' && state.cube.facelets !== SOLVED) void loadWalk();
    },
  });

  /** A group of pills with one on, said in both channels — the class for the eye, `aria-pressed`
   *  for the screen reader that cannot see it. */
  const paintGroup = (key, chosen) => {
    for (const pill of root.querySelectorAll(`[data-${key}]`)) {
      const on = pill.dataset[key] === chosen;
      pill.classList.toggle('on', on);
      pill.setAttribute('aria-pressed', String(on));
    }
  };

  /**
   * Wire a group of pills, once per MOUNT like every other control here: a retarget replaces the
   * walk beneath these, not the buttons. A press is a walk REPLACEMENT, never a screen change —
   * the composition does not depend on which pill is on, only the walk inside it does (§6).
   *
   * Pressing the one already on does nothing: re-solving to arrive at the same walk would throw
   * away the transport position for no change on screen.
   */
  const wireGroup = (key, now, choose) => {
    for (const pill of root.querySelectorAll(`[data-${key}]`)) {
      pill.onclick = () => {
        const want = pill.dataset[key];
        if (want === now()) return;
        choose(want);
        paintGroup(key, want);
        void loadWalk();
      };
    }
  };
  // The two objects, and the switch between them (§3).
  wireGroup('walk', () => walkKind, (want) => { walkKind = want; });
  // WHERE THIS WALK IS GOING — which is exactly what `retarget()` exists for.
  wireGroup('stage', () => state.stageTarget, (want) => { state.stageTarget = want; });

  // How far the cube in your hand is from the target, refreshed on every turn — its own unit, with
  // its own generation counter (lib/walk-live-distance.js). It reads the follow model when it asks,
  // so it is handed a function for it rather than the model.
  const { refresh: refreshLiveDistance, drop: dropLiveDistance } = createLiveDistance({
    root, stageAsk, chainTrusted, CHIP_NODE_BUDGET, stageTargetNow, modelNow: () => follow.model(),
    signal,
  });

  // Following a smart cube along the walk — the model of where the cube is, the four live hooks,
  // the drawing that mirrors turns, and the button that lets the cube lead — is its own unit
  // (lib/walk-follow.js). It reads the walk when it acts.
  const follow = createFollowTracker({
    root, cube, state, cubejs, applyTempo, setPlaying, moveHoldAt, markStale, adoptCube, go, scrambling,
    refreshLiveDistance, dropLiveDistance, chainTrusted, walkNow: () => ({ moves, steps }),
  });

  /**
   * The target this screen is walking to, or null when it is the whole cube.
   *
   * Read through a FUNCTION rather than captured, because this screen retargets in place: the
   * selector changes `state.stageTarget` and calls the same `loadWalk` the mount did, and a
   * const here would freeze the first choice for the life of the screen.
   *
   * An unknown id is treated as the whole cube rather than throwing. It can only get there
   * from storage or a hand-edited URL, and a screen that fails to mount is a worse answer to
   * "I do not recognise this" than a screen that solves the cube.
   */
  function stageTargetNow() {
    // NEVER ON THE SCRAMBLE SCREEN. `state.stageTarget` outlives the screen it was chosen on and
    // both modes share this mount, so without this a target chosen on Home drew its aim over a
    // scramble walk — replacing that screen's own "Target State" net with a stage the scramble
    // has nothing to do with. One guard here, because every reader asks here: the walk, the
    // aim, the live line, the route's sentence.
    if (scrambling) return null;
    const id = state.stageTarget;
    if (!id || id === 'solved') return null;
    const target = TARGET_BY_ID[id];
    if (!target) {
      console.warn(`unknown stage target "${id}" — walking the whole cube instead`);
      state.stageTarget = 'solved';
      return null;
    }
    return target;
  }

  // ---- loading a walk into this screen ----------------------------------------------------
  /** Put the screen into "this cube, no walk yet" — the honest state to wait in.
   *
   *  Called BEFORE the solve, not after it. The moment the subject changes, everything the
   *  previous walk put on screen stops being true: those chips are moves through a cube that
   *  is no longer here, and leaving them under a new heading is the one thing this app
   *  refuses to do. Where the answer is already known — the die solves before it retargets —
   *  nothing between here and it yields, so no frame is ever painted in this state; where the
   *  answer has to be searched for, this is what the search is waited out in.
   */
  function beginWalk() {
    moves = []; steps = []; clearChips(); total = 0; target = null; walkLoaded = false;
    // The live number and the aim describe the walk being replaced. An answer already in flight
    // for the OLD target would otherwise repaint after a new one is chosen — and a reload that
    // then fails would leave the old aim standing beside no walk at all.
    route = null;
    dropLiveDistance();
    const oldAim = $('#stageAim', root);
    if (oldAim) oldAim.hidden = true;
    // …and the Initial State net comes back in its place, beside the heading written below:
    // the subject with no walk yet is exactly what that net and that heading describe.
    const oldNet = $('#viewNet', root);
    if (oldNet) oldNet.hidden = false;
    // The lesson describes the walk that is being replaced. Cleared here, with everything
    // else, so no cue survives into the gap: focus and highlight name PIECES, and pointing at
    // a piece on a cube that has just changed is worse than pointing at nothing.
    lesson = null;
    pointAtStep(0);
    offer.hide();
    const rungLine = $('#rungLine', root);
    if (rungLine) { rungLine.hidden = true; rungLine.textContent = ''; }
    solList.innerHTML = '';
    // The previous walk's prove button must not survive into the gap: its closure guards
    // itself with fresh(), but a click would still flip it to "preparing…" and disable it
    // BEFORE those guards run — and if the new walk fails, nothing ever puts it back.
    const oldProve = $('#proveBtn', root);
    if (oldProve) { oldProve.hidden = true; oldProve.disabled = true; oldProve.onclick = null; }
    // The heading and the open question describe the SUBJECT, not the walk, so they are
    // written here — synchronously, before any search — and not on the far side of one. A
    // reconnect answered on a screen whose solver is slow, or missing entirely, still has to
    // show the question it just became; waiting for a solution to redraw a paragraph is how
    // a screen ends up asking something the user has already answered.
    const heading = root.querySelector('.state-h');
    if (heading) heading.textContent = stateHeading();
    syncReconnectAsk();
    setPlaying(false);
    follow.standDown();
    // The subject, drawn without a walk: no scramble to animate from, just the arrangement.
    // Scramble is left alone — it always starts from solved, and what it walks TO is not
    // known until it has been rolled.
    if (!scrambling) {
      cube.removeAttribute('scramble'); cube.removeAttribute('alg');
      cube.setAttribute('facelets', state.cube.facelets);
      paintNet(state.cube.facelets);
      describeCube(cube, state.cube);
    }
    sync(0);
    setStatus('working…');
  }

  function failWalk(err) {
    const key = String(err?.message ?? err ?? '');
    follow.refuse(t('Needs a solve worked out on this screen'));
    // A cross-check refusal names itself in prose rather than in a code (finishSolve throws
    // 'solver cross-check failed — re-scan'), so it is matched rather than looked up.
    const why = WALK_FAILURES[key]
      ?? (/cross-check/i.test(key) ? WALK_FAILURES['cross-check'] : null)
      ?? 'could not work it out';
    setStatus(t(why));
    // NO WALK, SO NO HOLD. A load that failed after a turned-over walk left the cube drawn upside
    // down under the failure, about a subject with no hold of its own. Put back HERE rather than
    // in `beginWalk`, where a retarget between two tumbled stages would turn the cube up and back
    // down again while the search ran. `hold-wiring.test.mjs` fails without this.
    walkHold = SCAN_HOLD;
    holdCube(SCAN_HOLD);
  }

  /** A cube the method cannot teach falls back to its solution, and the switch says so. The walk
   *  kind and the pills are this screen's, so the resolver asks for the fallback, not makes it. */
  function fallBackToSolution() {
    walkKind = 'solution';
    paintGroup('walk', 'solution');
  }
  const { resolveWalk } = createWalkResolver({
    state, SOLVED, solverReady, loadSolver, randomScramble, deriveCube, lastRoute, lessonFor, stepStates,
    setStatus, fallBackToSolution,
  });

  /** The turns the cube in hand has made since its last snapshot, adopted where it is trusted to
   *  have made them — before anything is drawn or searched for. */
  function adoptTurnsAhead() {
    // THE CUBE IN HAND, BEFORE ANYTHING IS DRAWN OR SEARCHED — and the placement is the whole
    // of it. `liveMove` advances the local model on every reported turn while
    // `state.cube.facelets` waits for a snapshot or an `adoptCube`, so a target chosen after a
    // few turns was answered for a cube that no longer exists: scan `R`, turn `U`, ask for the
    // first layer, and the app offered `R'`. Reproduced by an audit.
    //
    // ADOPTED BEFORE the search rather than inside it, and the first fix put it inside. That left
    // two things describing the older cube: `beginWalk` had already painted the net, and the
    // whole-cube locals had already been read off `state.cube` — so a repair that then found
    // nothing committed the PREVIOUS cube's algorithm over the new subject. Both reproduced by
    // the verify pass on that very fix, which is the argument for adopting before the screen
    // and the search rather than between them.
    //
    // ON EVERY RELOAD, and gating it on the selector was wrong. The walk reset of the time cleared
    // the model and reseeded it from `state.live`, the last SNAPSHOT — so a reload that did not
    // adopt first rewound the model past the turns since that snapshot, and a later target press
    // had nothing left to notice. Reproduced by a verify pass: scan `R`, turn `U`, switch
    // Solution → Lesson, choose the first layer, and the app was back to offering `R'`. Adopting
    // here CAPTURES those turns instead of losing them.
    //
    // `isPhysical` is what keeps it honest. A generated subject — the die's cube — is not the
    // cube in anybody's hand, and adopting a connected cube's position over it would throw the
    // rolled cube away. `chainTrusted()` alone does not say that: it is about the connection.
    const ahead = follow.aheadOfSnapshot();
    if (!scrambling && ahead && chainTrusted() && state.cube.isPhysical) {
      const now = ahead;
      if (now !== state.cube.facelets) {
        adoptCube(now, { physical: true, source: 'cube' });
        // `live` too, or the follow precondition compares the fresh walk against a snapshot
        // from before those turns and refuses for the rest of the visit — the same sentence
        // `#resolveBtn` carries, for the same reason.
        state.live = now;
      }
    }
  }

  /** Whether the subject has stopped fitting the composition this screen was built for — in which
   *  case the rebuild has been asked for, and the load must stop. */
  function compositionGone() {
    // THE CUBE MAY BE SOMETHING ELSE ENTIRELY, whether or not THIS load is what changed it.
    // Turning `R'` after a scanned `R` leaves a solved cube, which has no walk at all — so the
    // composition this screen was built for is gone and `deriveCube` would throw "nothing to
    // walk", reaching the child as "could not work it out" about a cube that is finished.
    //
    // ITS OWN CALL, never inside the adoption: a snapshot that had already ingested the solved
    // cube made the adoption a no-op, so a check nested in it never ran and the defect came back
    // by another path. Reproduced by an audit, twice, which is what a guard placed inside a
    // branch earns.
    if (scrambling) return false;
    const after = classifyCube();
    if (after.solvable === walking && after.unsolvable === unsolvable) return false;
    // DEFERRED past any refresh that is already running. `refreshScreen` guards itself with
    // `refreshing`, so calling it from a load that `refreshScreen` ITSELF started is swallowed
    // — and `update()` has already reported success by then, so no rebuild happens at all. A
    // microtask runs after that guard has been released.
    queueMicrotask(() => { if (!stale()) refreshScreen(); });
    return true;
  }

  /** The walk a load resolved, in place of the last one — only ever after its freshness check. */
  function commitWalk(got, stageTarget) {
    const {
      setup: gotSetup, alg: gotAlg, moves: gotMoves, steps: gotSteps, target: gotTarget,
      roll: gotRoll, lesson: gotLesson, route: gotRoute,
    } = got;
    // The scramble in play is committed HERE, with everything else, and not inside the search:
    // a slower load finishing last would otherwise have left the solve history recording
    // against a scramble that is not the one on screen.
    putInPlay(gotRoll);
    setup = gotSetup; alg = gotAlg; moves = gotMoves; steps = gotSteps; target = gotTarget;
    lesson = gotLesson;
    route = gotRoute;
    // HOW THIS WALK IS HELD (ADR 0003), by the one tested rule. A route that answered is held the
    // way its target is built — including one that overshot to the whole cube, since the child is
    // holding the cube for the stage they aimed at. A route that found nothing, no target, and a
    // scramble keep the scan's hold. A lesson overrides it per move (`holdAt`).
    walkHold = walkHoldFor(gotRoute, stageTarget);
    total = moves.length;
    walkLoaded = true;
  }

  /** The walk on the renderer: where it starts, the moves it animates, and which way up. */
  function drawWalk() {
    if (scrambling) paintNet(target);
    // The Scramble side genuinely starts from solved, so an empty setup alg is its normal
    // case and `scramble=""` says exactly that. On the SOLVE side an empty one means
    // takeSetupAlg refused the inverse of the answer — the walk is still cross-checked and
    // still right, but there is no verified path from solved to this arrangement, and
    // `scramble=""` would draw a solved cube under a scrambled walk. So the arrangement is
    // drawn instead: `facelets` outranks `scramble` in the renderer and `alg` is independent
    // of both, so the walk still animates, just from where the cube actually is.
    if (scrambling || setup) {
      cube.setAttribute('scramble', setup ?? '');
      cube.removeAttribute('facelets');
    } else {
      cube.removeAttribute('scramble');
      // THE WALK'S OWN STARTING CUBE, not whatever the subject has become. `steps[0]` is the
      // state this walk begins at, by construction; `state.cube.facelets` can have moved under
      // it since the search started, and handing that to the renderer put a picture of one cube
      // over a move list for another.
      cube.setAttribute('facelets', steps[0] ?? state.cube.facelets);
    }
    cube.setAttribute('alg', alg);
    // WHICH WAY UP (ADR 0003): the CUBE turns, never the camera. This used to set `camera-up`,
    // which moves the eye — the lamp rolled with it, and every move stayed named for white up
    // while the face turning on screen was the one at the bottom. The renderer turns the object,
    // and the chips below are named for the same hold, so the drawing and the words agree.
    holdCube(holdAt(0));
  }

  /** WHAT THE CHILD IS AIMING AT, with everything the target leaves free drawn as an empty well. */
  function presentTarget() {
    // Repainted per walk, because a retarget changes the target and a stale picture would be
    // pointing at a stage nobody is walking to. Hidden for the whole cube, where the picture is a
    // solved cube and says nothing a person did not already know.
    const aim = $('#stageAim', root);
    if (!aim) return;
    const aimingAt = stageTargetNow();
    aim.hidden = !aimingAt;
    // ONE PICTURE, NOT TWO (the owner's call, 2026-09-13). The card held the Initial State net
    // AND the target, and on the small desktop windows and an iPad in landscape it grew past
    // its grid row and was drawn over the sheet — 603px of card in a 470px row on the 840×682
    // window, where a child could not press "first layer". So while a target is shown it
    // takes the net's place and the heading says what the picture is. The 3D cube still
    // shows where the walk starts, and `beginWalk` puts the Initial State back for the next.
    const net = $('#viewNet', root);
    if (net) net.hidden = Boolean(aimingAt);
    if (!aimingAt) return;
    const heading = root.querySelector('.state-h');
    if (heading) heading.textContent = t('Aiming at the %1', aimingAt.name);
    const say = $('#stageAimSay', root);
    // What grey means, and how to hold the cube for the walk under it — named by white,
    // green and position, which are the same on every cube (`holdSentence` says why).
    if (say) say.textContent = t('%1 %2', t('Grey doesn’t matter yet.'), holdSentence(walkHold));
    // The picture is the target in the METHOD frame; the renderer and the net draw the
    // scan frame, so it is turned before it is painted.
    paintAim(fromMethodFrame(targetPicture(aimingAt)));
  }

  /** Which object is on screen, and how long it is — said beside the move list. */
  function labelWalk(fresh) {
    // The pair of pills belongs to the whole-cube walk. A repair has no lesson to switch to
    // (§9.4), so the switch is taken away rather than left pointing at nothing.
    const kindRow = $('#walkKindRow', root);
    if (kindRow) kindRow.hidden = Boolean(route);
    // The heading and the count belong to the OBJECT on screen. A lesson under the heading
    // "Solution" with a bare "93" beside it is the failure of 2026-08-29: it read as a solver
    // that had broken, because it was standing exactly where a 20 used to be. So the label
    // says which object this is, and the count leads with MOVES — the number a learner can
    // compare — with the steps beside it, which is the number the ladder is actually measured
    // in. Two shapes, and they cannot be mistaken for each other.
    const solLabelEl = $('#solLabel', root);
    if (solLabelEl) solLabelEl.textContent = lesson ? t('Lesson') : label;
    const rungLine = $('#rungLine', root);
    // The rungs in play, named on the cube screen (§3 rule 4), so it is never a mystery why
    // today's solve has more steps than yesterday's.
    if (rungLine) {
      rungLine.hidden = !lesson;
      rungLine.textContent = lesson ? lesson.summary : '';
    }
    // The count beside the heading and the offer to prove it are the APP's to say: a minimality
    // claim has three sanctioned sources, and two of them are found by name in
    // lib/prove-affordance.js. `signal` is this walk's: it aborts when the walk is replaced or the
    // screen goes, and a proof pressed for it lets go of what it listens to then.
    sayWalkLength({ root, setStatus, scrambling, route, stageTargetNow, lesson, total, steps, fresh, signal: walkAbort?.signal });
  }

  /** The moves themselves: ONE GRID for a Solution, SECTIONS for a Lesson. */
  function renderMoveList() {
    // The difference is not decoration. The solve side used to cut its list at fixed 16 / 62 / 82%
    // and head the pieces CROSS / F2L / OLL / PLL: proportional slices of a two-phase solution
    // wearing the names of stages it does not have. That was removed for being invented structure
    // on the screen a beginner trusts most, and one flat grid is the honest rendering of an object
    // with no stages.
    //
    // A lesson IS an object with stages, so it gets them — read off its own steps, never
    // proportioned (§5.1). Each heading carries the step count for that stage, which is the
    // unit the ladder is measured in.
    //
    // escHtml on the move text. It comes from the solver or the validated library and
    // `reaches()` fails closed, so nothing hostile can be in it today — but it is a string
    // reaching innerHTML, and "this particular source is trusted" is exactly the reasoning
    // that stops being true when a source is added. Every other template here escapes.
    const chipsFor = (from, to) => moves.slice(from, to)
      // NAMED FOR THE HOLD the move is made in (ADR 0003): the walk is stored in the scan frame,
      // and a child holding the cube tumbled turns the face at the bottom when the cube's own
      // white face is meant — which, held that way, is called D. After a regrip, the face on the
      // child's right is another of the cube's faces again, so that hold is per move (plan item 6.1).
      .map((m, k) => `<button class="chip-m" data-i="${from + k}" title="${escHtml(t('Jump to this move'))}">${escHtml(renameAlg(m, moveHoldAt(from + k)))}</button>`)
      .join('');
    solList.innerHTML = route && route.moves === 0
      // AN EMPTY ROUTE MUST NEVER RENDER AS A WALK (§9a). With no moves the grid below draws
      // nothing at all, and a heading with an empty space under it reads as a list that failed
      // to load rather than as a cube that is already where it was asked to be.
      ? `<div style="padding:6px 18px 12px" class="sub">${escHtml(t('Nothing to do here — turn to another stage, or solve the whole cube.'))}</div>`
      : lesson
      ? lesson.sections.map((s) => `<div style="padding:6px 18px 10px">
              <div class="sub" style="color:var(--ink-4);font-weight:600;padding-bottom:4px">${escHtml(s.name)} <span style="font-weight:400">${escHtml(t('%1 steps · %2 moves', s.steps, s.moves))}</span></div>
              <div class="move-chips">${chipsFor(s.from, s.to)}</div></div>`).join('')
      : `<div style="padding:6px 18px 12px"><div class="move-chips">${chipsFor(0, moves.length)}</div></div>`;
    takeChips();
  }

  /** Work out the walk for whatever the subject is NOW, and put it on the screen already
   *  standing. Called once by mount, and again by `update` every time the subject changes.
   *  Returns false when it was overtaken and wrote nothing. */
  async function loadWalk() {
    const mine = ++walkGen;
    // A new walk has been followed nowhere yet. Without this, switching Solution → Lesson
    // would inherit the moves the previous walk had stepped through and credit the new one on
    // the strength of them.
    offer.newWalk();
    // Two ways to become obsolete: the screen was replaced (screenGen), or another press
    // started a newer walk on this same screen (walkGen). Both must stop this one writing.
    const fresh = () => !stale() && mine === walkGen;
    // The previous walk's search is about a cube this one is replacing. Aborted BEFORE the
    // new one starts, so the pool is free rather than working through a dead search first.
    walkAbort?.abort();
    const abort = walkAbort = new AbortController();
    // The cube in hand first, then whether this screen can still show it, then the empty screen to
    // wait in — three calls in this order, and none of them inside another.
    adoptTurnsAhead();
    if (compositionGone()) return false;
    beginWalk();
    // A retarget replaces the SUBJECT, and a native proof about the old subject must not
    // outlive it — same rule as renderScreen's teardown, for the path that never renders.
    if (optimalCapability()) optimalCancel().catch((err) => console.warn('optimal cancel failed', err));
    // WORKED OUT INTO A RECORD, COMMITTED AFTER THE FRESHNESS CHECK — not before it. Two loads
    // can be in flight at once (a reconnect answered while the die's is still solving), and
    // the slower one finishes last. Assigning the shared `moves` / `steps` / `target` inside
    // the search and only THEN noticing it had been overtaken left the screen showing one
    // cube while every closure that reads those — follow's `locate`, the midpoint table,
    // "Solve this scramble" — had been handed the other one. Nothing crosses out of here
    // until this load is known to still be the current one, so there is no window in which
    // that disagreement exists at all.
    const stageTarget = scrambling ? null : stageTargetNow();
    let got;
    try {
      // The search, and the race inside it, are the resolver's (lib/walk-resolver.js).
      got = await resolveWalk({ scrambling, stageTarget, walkKind, fresh, signal: abort.signal });
    } catch (err) {
      // A search this screen itself called off is not a failure to report: the subject it was
      // about is gone, and the walk that replaced it owns the screen now. Superseded, silent.
      if (abort.signal.aborted) return false;
      if (fresh()) failWalk(err);
      return false;
    }
    if (!got) return false; // overtaken while it searched: a newer load owns the screen
    if (!fresh()) { parkRoll(got.roll); return false; } // navigated away, or a newer load took over
    commitWalk(got, stageTarget);
    drawWalk();
    presentTarget();
    labelWalk(fresh);
    renderMoveList();
    // Nothing may survive from the previous walk. Each of these is a position ON a plan, and
    // the plan has just been replaced: carried over, they describe a cube that is no longer
    // on screen.
    resetHead();
    // Following is re-based on the walk just committed (lib/walk-follow.js): its positions reset,
    // the midpoints of this walk's half turns built, and whether the cube may lead judged again.
    follow.rebase({ moves, steps, total });
    sync(0);
    // THE LIVE NUMBER, AFTER THE MODEL IT READS. Asked from the aim block, it once ran before the
    // model was reset and re-seeded — so a fresh mount produced no number at all and a retarget
    // asked the PREVIOUS model about the NEW target. Both are the same mistake: a question asked
    // before its subject exists. Found by an audit.
    void refreshLiveDistance();
    return true;
  }

  return Object.freeze({
    /** Work out the walk for the subject as it is NOW and put it on the screen already standing:
     *  once from the mount, then from `update()` for every new subject. False when it was overtaken
     *  and wrote nothing. */
    load: loadWalk,
    /** Call off the search in flight — the screen's teardown. A search this screen started must not
     *  go on burning the pool for a cube nobody is looking at. */
    dispose() { walkAbort?.abort(); },
    /** Whether the physical cube is driving the guide. The speed menu's tempo reads it: a mirror of
     *  turns the hand has already made must never play slower than the hand. */
    following: () => follow.following(),
    /** The live hooks. The screen installs them into the app's slots, which a module cannot
     *  write. */
    liveMove: follow.liveMove, liveUpdate: follow.liveUpdate,
    liveGap: follow.liveGap, onTrustLost: follow.onTrustLost,
  });
}
