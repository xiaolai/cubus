// The walk on the cube screen: loading it, stepping through it, and following a smart cube along it.
//
// A walk SESSION is everything one mounted cube screen owns about its walk, and it outlives every
// single walk shown on that screen: the walk itself (the moves, the state after each, the target, a
// lesson or a stage route), the transport that steps through it, following a physical cube along
// it, the live distance to a stage, the rung offer at its end, and the load that replaces the walk
// when the subject changes. The SCREEN keeps its composition — the markup, the renderer element,
// the two nets, the speed menu, the die, the reconnect question — and hands this module the parts of
// it a walk writes to.
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
// comes in here the way `runProof` receives `sayProved`. And the route race, `lastRoute`, which reads
// no screen state and sits with the cube screen (lib/screens/cube.js), beside the one budget the app
// may import from the stage engine.

import { t } from './i18n.js';
import { SCAN_HOLD, fromMethodFrame, holdSentence, renameAlg, showMove } from './solving-hold.js';
import { createHoldCube, holdAtMove, holdChangeAt, walkHoldFor } from './hold-presenter.js';
import { stepAtMove, whyText } from './method-lesson.js';
import { declineOffer, nextOffer, recordCleanFollow } from './method-ladder.js';
import { STAGE_COPY } from './stage-report.js';
import { TARGET_BY_ID } from './stage-targets.js';
import { targetPicture } from './stage-picture.js';
import { movesOf } from './cube-pieces.js';
import { cancel as optimalCancel, capability as optimalCapability } from './optimal.js';

/** Destructuring through this refuses, AT CONSTRUCTION, any name `from` does not provide — so a
 *  service missing from `WALK_APP` fails the mount, not the one rare press that would first call it.
 *  The names are written once, in the destructuring itself, so there is no second list to drift. */
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
 *   `scrambling`, `walking`, `unsolvable` and `label`, as the screen was composed; `stateHeading()`;
 *   `stale()`, its generation check; `signal`, its abort; `paintNet` and `paintAim`;
 *   `syncReconnectAsk()`; and `applyTempo()`, the speed menu's.
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
    lastRoute, sayWalkLength,
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

  // Who drives the guide: 'slow' = the transport buttons, 'cube' = the physical cube.
  // Read by the screen's speed menu through `following()`, because tempo DEPENDS on the driver:
  // the walk speeds are for the app demonstrating a move, but while following, the drawing is a
  // mirror of moves the user already made — a mirror slower than the hand must fall behind, so
  // follow runs at the renderer's 190ms base whatever speed is chosen for demonstrations.
  let mode = 'slow';

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
  let chips = [];
  let at = 0;
  let playing = false;
  // Where the PHYSICAL cube is, in solution indices. The model beneath it tracks in EVERY
  // mode — only drawing and notes are gated on `mode` — so resuming follow needs no special
  // case: the position is simply already right.
  let cubePos = 0;
  let liveModel = null; // cubejs cube in truth frame; seeded below, resynced by every snapshot
  /**
   * Has `liveModel` advanced past the snapshot it was seeded from?
   *
   * TWO DEFECTS TURN ON THIS, and neither is visible without it. Adopting whenever the model
   * merely DIFFERS from the subject overwrote a reconnect answer with the previous screen's
   * model — the answer had just established the truth, and the model belonged to the cube
   * before it. And the walk reset reseeds from `state.live`, so turns arriving DURING a search
   * were discarded, which then defeated the adoption on the next load. Both reproduced by an
   * audit. "Advanced by moves we tracked" is the fact both of them actually need; "differs" is
   * not it.
   */
  let liveMoved = false;
  let drawn = 0;        // index the renderer's QUEUE will end at; meaningful only while following
  let lastSerial = null;
  // For each half-turn step i, the two states one quarter turn in: the cube passes through
  // one of them mid-R2 in either direction (undoing is steps[i]·R2·R = steps[i]·R'). Owner-
  // indexed, because a midpoint only counts BESIDE its own half turn — landing on a distant
  // one is a wrong move, not silent progress.
  const midpoints = new Map();
  // Which load is current. `screenGen` cannot answer this any more: it counts SCREENS, and a
  // retarget deliberately does not make a new one — so two presses in quick succession would
  // both believe they were still valid, and the slower solve would paint its move list over
  // the cube the faster one left on screen.
  let walkGen = 0;

  // ---- Follow cube -----------------------------------------------------------------------
  //
  // The physical cube drives the guide through ONE local model matched by STATE, never by
  // move token: the driver emits quarter turns only, while the plan is full of half turns —
  // tokens can never pair those up, states always can. Position, drawing and the note are
  // three views of that model. Full design, and the adversarial review that shaped it, in
  // dev-docs/follow-mode-redesign.md.
  //
  // One pacing control, and only when there is a cube to pace against: with nothing connected,
  // walking by hand is the only behaviour there is, so a button naming it would be a switch
  // with one position. Connected, following is what you want by default — a single toggle
  // that starts on, provided the preconditions hold.
  const followBtn = root.querySelector('[data-mode="cube"]');
  const note = $('#followNote', root), noteMsg = $('#followMsg', root);
  const showNote = (msg) => {
    if (note) { note.hidden = false; note.classList.remove('info'); noteMsg.textContent = msg; }
  };
  // Neutral, not a warning, and without the rescue buttons: pausing is a choice, not a fault.
  const pauseNote = () => {
    if (note) { note.hidden = false; note.classList.add('info'); noteMsg.textContent = 'Paused — you are driving. Switch Cube leads back on and your cube sets the pace.'; }
  };
  const clearNote = () => {
    if (note) { note.hidden = true; note.classList.remove('info'); }
  };

  // ---- Scramble → Solve hand-off ---------------------------------------------------------
  // The loop a beginner actually wants: scramble it by following the guide, then solve THAT.
  // Offered at completion and only on a press — never automatic. Reaching 22/22 by clicking
  // says nothing about the cube in someone's hand, so without a trusted cube the target is
  // adopted as a GENERATED subject (exactly what the dev die does) and Home says so. With a
  // trusted physical cube the subject already IS the cube (its snapshots are ingested), so
  // nothing is adopted: Home solves whatever the cube really is, and the label only claims
  // "scrambled" when the cube's own state says so.
  const solveIt = $('#solveItBtn', root);
  const cubeTruth = () => state.connected && state.cube.trusted && state.cube.isPhysical;
  const solveItLabel = () => {
    if (!cubeTruth()) return 'Solve this scramble';
    return state.cube.facelets === target ? 'Your cube is scrambled — solve it' : 'Solve your cube';
  };
  if (solveIt) {
    solveIt.onclick = () => {
      // The target is what this button HANDS OVER, so a press without one has nothing to do.
      // Guarded here as well as at the point the button is drawn: `hidden` is a property any
      // later paint could get wrong, and handing `null` to adoptCube stores a subject with no
      // facelets at all — Home then draws a cube nobody rolled.
      if (!target) return;
      // `alg` is this scramble's own setup alg — the walk that just finished, from solved to
      // `target` — so Home needs no search to know how the cube it is handed was reached.
      if (!cubeTruth()) adoptCube(target, { physical: false, source: 'generated', setupAlg: alg });
      go('home');
    };
  }

  /** How move `k` of the walk on screen is held (ADR 0003) — a lesson's per move, any other
   *  walk's throughout. The rule and its tests are `lib/hold-presenter.js`. */
  const holdAt = (k) => holdAtMove(lesson, walkHold, k);

  /** Turns this screen's cube to a hold — the object, never the camera — waiting for the renderer
   *  when the tag is not one yet, and turning nothing once this screen has been replaced. */
  const holdCube = createHoldCube({ cube, isStale: stale });

  /**
   * Point the cube at what the step under the transport head is about — plan §5.2.
   *
   * `focus` drains the hue from every piece the step does not name; `highlight` pulses the
   * ones it does. The sentence stays, translated and short, but it is no longer the
   * load-bearing channel: the first attempt had ONLY the sentence, and "join the corner to
   * its edge" cannot say WHICH corner.
   *
   * **The cue is about the move ABOUT TO HAPPEN, and the chips are about the one just made.**
   * They are two different questions asked of the same index and they used to share an answer:
   * `cubus-step` fires when move `i` has finished, so reading the step of move `i - 1` meant
   * the first move of every teaching step animated under the PREVIOUS step's sentence and
   * highlight. On a lesson whose steps are three or four moves long that is a quarter of the
   * walk pointing at the wrong pieces — and the sentence and the pulse are the whole of what
   * makes a step a lesson rather than a move list.
   *
   * At 0 the step about to happen is the one described — that is the step you are looking at
   * before you turn anything — and at the end the last step stays, because there is no move
   * after it to describe. Silent entirely on the Solution, because a two-phase answer has no
   * steps and inventing cues for it is exactly what this app does not do.
   */
  function pointAtStep(i) {
    const whyLine = $('#whyLine', root);
    if (!lesson || scrambling) {
      cube.removeAttribute('focus');
      cube.removeAttribute('highlight');
      if (whyLine) { whyLine.hidden = true; whyLine.textContent = ''; }
      return;
    }
    const step = lesson.steps[stepAtMove(lesson.moveStep, i)];
    // The step's cues were worked out and renamed into the scan frame when the lesson was built
    // (`lessonFor`). Whole-or-nothing at the renderer: an empty spec removes the channel rather
    // than setting it to a selector that names nothing.
    if (step?.focus) cube.setAttribute('focus', step.focus); else cube.removeAttribute('focus');
    if (step?.highlight) cube.setAttribute('highlight', step.highlight); else cube.removeAttribute('highlight');
    // The cube turns over as the head crosses a hold, in either direction — a scrub goes back.
    const { held, say } = holdChangeAt(lesson, walkHold, i);
    holdCube(held);
    if (!whyLine) return;
    const reason = whyText(step);
    const text = say ? (reason ? t('%1 %2', say, reason) : say) : reason;
    whyLine.hidden = !text;
    whyLine.textContent = text
      ? t('Step %1 of %2 — %3', lesson.steps.indexOf(step) + 1, lesson.steps.length, text)
      : '';
  }

  function sync(i) {
    // One move forward is one move followed. Anything else — a seek, a scrub, a reload — moves
    // the head without the learner having watched what it passed over.
    if (i === at + 1) followed.add(at);
    at = i;
    // The filled chip is the move just shown — the one you are on. At 0 / 22 nothing has been
    // shown, so nothing is filled. It used to mark the NEXT move, and a black first chip before
    // anything had happened read as a step already taken.
    chips.forEach((ch, k) => { ch.classList.toggle('played', k < i); ch.classList.toggle('cur', k === i - 1); });
    pointAtStep(i);
    $('#stepLbl', root).textContent = `${i} / ${total}`;
    $('#progBar', root).style.width = total ? `${(i / total) * 100}%` : '0%';
    // A button that cannot do anything says so, rather than swallowing the press.
    $('#prevBtn', root).disabled = i === 0;
    $('#repeatBtn', root).disabled = i === 0;
    $('#nextBtn', root).disabled = i >= total;
    $('#playBtn', root).disabled = i >= total;
    // A tick beside the count once the last move lands. It used to be a 46px badge over the
    // cube, saying "done" where the count beside it already read 22 / 22.
    $('#doneMark', root).hidden = i < total;
    // The last move of a LESSON is one clean follow of every stage it contained — and once
    // per walk, not once per arrival at the end.
    //
    // **FOLLOWED, not merely arrived at.** Reaching the last chip was the whole test, and a
    // chip press seeks straight there: tapping the final chip credited every stage in the
    // lesson as practised. So did switching Solution → Lesson, which starts a new walk and
    // reset the once-per-walk guard with the head already at the end. A learner could earn a
    // rung offer without watching a single move.
    //
    // What counts is a move STEPPED THROUGH: the head advancing by exactly one, forwards.
    // Rewinding to re-watch something is still following — the moves already stepped stay
    // counted — but a jump credits nothing, because nothing was shown.
    if (lesson && total > 0 && i >= total && followed.size >= total && creditedWalk !== walkGen) {
      creditedWalk = walkGen;
      settings.rungProgress = recordCleanFollow(
        settings.rungProgress,
        lesson.sections.map((sec) => sec.id),
      );
      noteWrite(save('cubusSettings', settings));
      showOffer();
    }
    // And, on Scramble, the way onward — labelled for what is actually known at that moment.
    // Gated on the TARGET, not on the count: between beginWalk() and the roll landing, and
    // after a roll that failed, `total` is 0 and `i >= total` is trivially true — so the
    // button offered to hand Home a scramble while `target` was still null, and the press
    // stored a subject with no facelets (found by audit, 2026-09-05). There is nothing to
    // walk onward from until there is something to hand over.
    if (solveIt) {
      solveIt.hidden = !target || i < total;
      if (target && i >= total) solveIt.textContent = solveItLabel();
    }
  }
  // Signalled, because `cube` is parked and re-used between screens now: an unscoped
  // listener here would arrive at the next screen still calling this screen's sync().
  cube.addEventListener('cubus-step', (e) => sync(e.detail.index), { signal });

  const setPlaying = (on) => {
    playing = on;
    const play = $('#playBtn', root);
    play.innerHTML = icon(on ? 'pause' : 'play', 18);
    // The name follows the action: a button drawn as Pause while announcing "Play from here
    // to the end" claims the wrong deed.
    play.title = on ? 'Pause' : 'Play from here to the end';
    play.setAttribute('aria-label', play.title);
    // Guarded like drawTo below: if the renderer bundle failed to upgrade the element, the
    // transport still works as position bookkeeping even though nothing animates.
    if (typeof cube.play !== 'function' || typeof cube.pause !== 'function') return;
    if (on) cube.play(); else cube.pause();
  };

  // Touching the transport hands control back to you. Following and the buttons were two
  // drivers for one guide, and while both were live the step counter tracked the ANIMATION
  // rather than the cube. One rule removes the ambiguity — the toggle is right there to
  // resume. Hoisted, because the handlers below call it while `followBtn` and the note
  // helpers are declared further down.
  function takeOver() {
    if (mode !== 'cube') return;
    setFollow(false);
    pauseNote();
  }

  $('#playBtn', root).onclick = () => { takeOver(); setPlaying(!playing); };
  $('#nextBtn', root).onclick = () => { takeOver(); setPlaying(false); cube.step(); };
  // Back and repeat are both animated, at the one walking speed, and differ only in where they
  // leave you. Back undoes the last move and stops there. Repeat answers "show me that again":
  // it undoes the move and then makes it again, so you end up where you started having watched
  // it twice. Neither jumps: a cut to a new state teaches nothing about the turn that got there.
  // The renderer's queue is FIFO and pulls the next move only when the current one finishes,
  // so pushing both halves of a repeat here plays them in order.
  $('#prevBtn', root).onclick = () => { takeOver(); setPlaying(false); cube.stepBack(); };
  // A move in the list is a place in the solution, so clicking one goes there. seek() is instant
  // on purpose: jumping twelve moves is not something to sit through, which is exactly the case
  // step()/stepBack() do not cover. It seeks to just AFTER the clicked move: the cube shows that
  // move made and the clicked chip is the filled one, so the highlight lands where you clicked.
  solList.onclick = (ev) => {
    const chip = ev.target.closest('.chip-m');
    if (!chip) return;
    takeOver(); // jumping to a move is taking over just as much as pressing Next is
    setPlaying(false);
    cube.seek(Number(chip.dataset.i) + 1);
  };
  // ---- offer, never ask ------------------------------------------------------------------
  //
  // A lesson followed to its last move is one clean follow of every stage that lesson actually
  // contained — read off the solve, never assumed, because a cube whose cross was already
  // solved taught nothing about the cross. Counted once per walk: `sync` fires on every step
  // and on every seek, and a learner who scrubs back and forth would otherwise be credited
  // with a dozen solves.
  let creditedWalk = -1;
  /** The moves this walk has been stepped through, one at a time and forwards. */
  const followed = new Set();
  /**
   * Whether this learner's progress is actually reaching storage.
   *
   * A write can fail — a full quota, a private window with storage off — and `save` warns to
   * the console, which nobody is reading. Progress that is not persisted means the follows
   * never accumulate and the offer never comes, and the screen would look exactly like a
   * learner who had not practised enough. So it is said, in the row that would otherwise be
   * carrying the offer.
   */
  let progressUnsaved = false;
  const noteWrite = (ok) => { if (!ok) progressUnsaved = true; };
  const offerRow = $('#rungOffer', root);
  /** The offer currently ON SCREEN — answered as shown, not recomputed on the way out. */
  let shownOffer = null;
  const showOffer = () => {
    if (!offerRow) return;
    const msg = $('#rungOfferMsg', root);
    if (progressUnsaved) {
      shownOffer = null;
      offerRow.hidden = false;
      msg.textContent = t('This device is not saving your progress, so rungs will not be offered.');
      $('#rungYes', root).hidden = true;
      $('#rungNot', root).hidden = true;
      return;
    }
    shownOffer = nextOffer(settings.rungs, settings.rungProgress);
    offerRow.hidden = !shownOffer;
    if (!shownOffer) return;
    $('#rungYes', root).hidden = false;
    $('#rungNot', root).hidden = false;
    msg.textContent =
      t('You have followed this a few times. Ready for %1? %2', t(shownOffer.label), t(shownOffer.blurb));
  };
  const answerOffer = (yes) => {
    // The offer the learner was LOOKING AT. Recomputing it here answered whatever `nextOffer`
    // says now, which is not necessarily what the row said when they pressed the button.
    const offer = shownOffer;
    if (!offer) { if (offerRow) offerRow.hidden = true; return; }
    if (yes) {
      noteWrite(raiseRung(offer));
    } else {
      settings.rungProgress = declineOffer(settings.rungProgress, offer);
      noteWrite(save('cubusSettings', settings));
    }
    shownOffer = null;
    if (offerRow) offerRow.hidden = true;
    if (progressUnsaved) showOffer();
    // **Not when there is nothing left to solve.** The offer arrives at the END of a walk, and
    // a learner following on a physical cube has by then actually solved it — so `state.cube`
    // is the solved arrangement. Reloading asked the solver for a walk from solved to solved,
    // got nothing, and replaced the lesson the learner had just finished with "could not work
    // it out" — blaming the cube for a question nobody should have asked. The finished walk
    // stays on screen; the raised rung applies to the next cube, which is the one it is for.
    // `state.cube.lesson` is cleared above either way, so that next lesson is built at the new
    // rungs rather than served from a cache made at the old ones.
    if (yes && walkKind === 'lesson' && state.cube.facelets !== SOLVED) void loadWalk();
  };
  if (offerRow) {
    $('#rungYes', root).onclick = () => answerOffer(true);
    $('#rungNot', root).onclick = () => answerOffer(false);
  }

  /** The selected walk, said in both channels — the class for the eye, `aria-pressed` for the
   *  screen reader that cannot see it. */
  const setWalkPill = (pill, kind) => {
    const on = pill.dataset.walk === kind;
    pill.classList.toggle('on', on);
    pill.setAttribute('aria-pressed', String(on));
  };

  // The two objects, and the switch between them (§3). Wired once per MOUNT, like every other
  // control here: a retarget replaces the walk beneath these, not the buttons.
  //
  // Pressing the one already showing does nothing — re-solving to arrive at the same walk
  // would throw away the transport position for no change on screen.
  for (const pill of root.querySelectorAll('[data-walk]')) {
    pill.onclick = () => {
      const want = pill.dataset.walk;
      if (want === walkKind) return;
      walkKind = want;
      for (const p of root.querySelectorAll('[data-walk]')) setWalkPill(p, walkKind);
      void loadWalk();
    };
  }

  // WHERE THIS WALK IS GOING, and it is a walk REPLACEMENT rather than a screen change — which
  // is exactly what `retarget()` exists for (§6). Nothing here rebuilds: the composition does
  // not depend on the target, only the walk inside it does.
  for (const pill of root.querySelectorAll('[data-stage]')) {
    pill.onclick = () => {
      const want = pill.dataset.stage;
      if (want === state.stageTarget) return; // re-solving to the same target throws away the
      state.stageTarget = want;               // transport position for no change on screen
      for (const p of root.querySelectorAll('[data-stage]')) {
        const on = p.dataset.stage === want;
        p.classList.toggle('on', on);
        p.setAttribute('aria-pressed', String(on));
      }
      void loadWalk();
    };
  }

  $('#repeatBtn', root).onclick = () => {
    takeOver();
    // Not merely belt-and-braces with the disabled attribute: stepBack() self-guards at step 0
    // but step() does not, so without this a repeat at the start would go FORWARD one move.
    if (at === 0) return;
    setPlaying(false);
    cube.stepBack();
    cube.step();
  };

  const locate = (f) => {
    for (let d = 0; d <= 2; d++) {
      for (const idx of d === 0 ? [cubePos] : [cubePos - d, cubePos + d]) {
        if (idx >= 0 && idx < steps.length && steps[idx] === f) return { kind: 'step', idx };
      }
    }
    if (midpoints.get(f)?.some((i) => i === cubePos || i === cubePos - 1)) return { kind: 'mid' };
    const idx = steps.indexOf(f);
    return idx >= 0 ? { kind: 'step', idx } : { kind: 'off' };
  };

  /** Move the drawing toward where the cube is. Deltas are against `drawn` — the end of the
   *  renderer's QUEUE — never against the animation's progress: reading the completion index
   *  dropped any turn made inside the 0.19–3.8s animation window, permanently.
   *
   *  The renderer guard is not belt-and-braces: if the vendored bundle failed to upgrade the
   *  element — which this repo has shipped more than once — the guide still tracks turns
   *  rather than throwing on every one. */
  const drawTo = (idx) => {
    if (typeof cube.step !== 'function' || typeof cube.seek !== 'function') return;
    if (idx === drawn) return;
    if (idx > drawn && idx - drawn <= 2) { for (let i = drawn; i < idx; i++) cube.step(); }
    else if (idx === drawn - 1) cube.stepBack(); // an undo is a turn worth watching too
    else cube.seek(idx); // a jump: animating a dozen moves to catch up helps nobody
    drawn = idx;
  };

  /** ONE reaction to every accepted reading, move or snapshot. */
  const act = (loc, offMsg) => {
    if (loc.kind === 'step') {
      cubePos = loc.idx;
      if (mode === 'cube') { clearNote(); drawTo(cubePos); }
    } else if (loc.kind === 'mid') {
      if (mode === 'cube') clearNote(); // half a half-turn: legal, silent, position held
    } else if (mode === 'cube') {
      showNote(offMsg);
    }
  };

  /** The FIFO tripwire. Moves and snapshots ride one ordered channel and share one counter;
   *  a regression means that assumption broke, which deserves a loud word — placed AFTER
   *  act() by every caller, so the warning is not painted over by the event it arrived on. */
  const tripwire = (serial) => {
    if (!Number.isInteger(serial)) return;
    // Repeats are normal — a resting cube re-sends snapshots under one counter, and a
    // FACELETS packet shares its move's serial. Only a REGRESSION is a breach, and a breach
    // is a trust matter, not just a note: the stream this model is built on is unreliable,
    // so trust lapses (which stands follow down through the hook) and the screen says why.
    if (lastSerial !== null && (serial - lastSerial + 256) % 256 > 127) {
      console.warn('cube events arrived out of order', { lastSerial, serial });
      showNote('The cube’s reports arrived out of order — read it again before following.');
      markStale('its reports arrived out of order');
    }
    lastSerial = serial;
  };

  /** ONE owner for the driver switch: tempo, button paint and the atomic hand-over all live
   *  here, so no exit path can leak follow's tempo into a demonstration or leave the queue
   *  running under the wrong driver. BOTH directions seek: taking over collapses follow's
   *  queue debt and its in-flight animation; resuming re-bases `drawn` on wherever the cube
   *  is now — which is what makes `drawn` trustworthy within a follow session. */
  function setFollow(on) {
    const want = on ? 'cube' : 'slow';
    if (mode === want) return;
    mode = want;
    if (typeof cube.seek === 'function') cube.seek(cubePos);
    drawn = cubePos;
    applyTempo();
    followBtn?.classList.toggle('on', on);
    followBtn?.setAttribute('aria-pressed', String(on));
    if (followBtn) {
      followBtn.title = on
        ? 'Turn your smart cube and the guide keeps up'
        : 'You took over — click to let the cube drive again';
    }
    if (on) {
      setPlaying(false);
      // Say at once whether the cube is still on the plan, rather than waiting up to a
      // second for its next report to say it.
      if (liveModel) act(locate(liveModel.asString()), 'This cube is not on the plan any more.');
      else clearNote();
    }
  }

  const refuseFollow = (why) => {
    if (!followBtn) return;
    followBtn.disabled = true;
    followBtn.classList.remove('on');
    followBtn.title = why;
  };
  if (followBtn) {
    followBtn.onclick = () => {
      if (followBtn.disabled) return;
      setFollow(mode !== 'cube');
    };
  }

  /**
   * How far the cube in your hand is from the target, refreshed on every turn.
   *
   * FIVE THINGS THE PLAN CORRECTS ABOUT THIS PATH, and each one is a line here (§5):
   *
   *   1. It reads `liveModel`, not `state.cube.facelets`. `liveMove` advances the local model
   *      while the global subject lags until `adoptCube`, so the global would build an answer
   *      for a cube that no longer exists — the trap `#resolveBtn` already documents.
   *   2. It is the OFFSET-CORRECTED state by construction, because `liveModel` is seeded from
   *      `state.live` — the corrected report stream — and never from the raw one. A repair
   *      computed on the raw report would be labelled for the wrong faces, and would look
   *      perfectly plausible.
   *   3. It does NOT go through `refreshScreen()`. That path reaches `loadWalk` → `beginWalk`,
   *      which clears `moves`, `steps`, `chips`, `total`, `target` and `lesson` and points
   *      back at step 0 — it would destroy the walk the child is halfway through following.
   *   4. It has its OWN generation counter. `walkGen` deliberately does not move on a per-turn
   *      update, so without a second counter a result about cube A lands on cube B.
   *   5. It writes its own line, never `#moveCount`. That count belongs to the route and
   *      reports progress against the route's total.
   *
   * And the gate is `chainTrusted()`, not `cubeRefused()`: trust is lost in ways that never
   * set a verdict — `onMovesLost` calls `markStale`, which clears trust with no verdict at all
   * — and naming the wrong predicate would let a stale cube drive advice.
   */
  let liveGen = 0;
  const liveSay = () => $('#stageLive', root);
  /**
   * Stop believing anything still in flight, and take the last number off the screen.
   *
   * ONE HELPER, called from every place a live answer stops being about the cube in hand: the
   * early returns below, a lost move, and trust lapsing. The early returns used to clear the
   * line WITHOUT moving the generation, so an answer already on its way repainted over the
   * clearing — and `onTrustLost` did neither. Both reproduced by an audit.
   */
  function dropLiveDistance() {
    liveGen += 1;
    const el = liveSay();
    if (el) el.textContent = '';
  }
  async function refreshLiveDistance() {
    const el = liveSay();
    if (!el) return;
    const aimingAt = stageTargetNow();
    if (!aimingAt || !liveModel || !chainTrusted()) { dropLiveDistance(); return; }
    const mine = ++liveGen;
    const facelets = liveModel.asString();
    // AND THE OLD NUMBER GOES NOW, not when the new one arrives. If both requests come back
    // unavailable neither branch below writes anything, and cube A's "exact 3" stood over cube
    // B indefinitely — reproduced. A blank line is honest; a stale one is not.
    el.textContent = '';
    // The BOUND first, because it is a table read and arrives in one message — §3's split runs
    // all the way out to here. Then the exact search, for the SELECTED target only: four
    // searches a turn is not what a per-turn update should cost.
    const bounds = await stageAsk({ want: 'bounds', facelets });
    if (mine !== liveGen || !root.isConnected || !chainTrusted()) return;
    if (bounds?.bounds) {
      el.textContent = t('your cube now: %1', STAGE_COPY.atLeast(bounds.bounds[aimingAt.id] ?? 0));
    }
    const answer = await stageAsk({
      want: 'route', target: aimingAt.id, facelets, nodeBudget: CHIP_NODE_BUDGET, maxDepth: 12,
    });
    if (mine !== liveGen || !root.isConnected || !chainTrusted()) return;
    if (!answer) return;
    el.textContent = answer.moves === null
      ? t('your cube now: %1', STAGE_COPY.unknown())
      : t('your cube now: %1', STAGE_COPY.shortest(answer.moves));
  }

  const liveMove = (m) => {
    if (!liveModel) return; // nothing to track against until a first reading seeds the model
    liveModel.move(m.notation);
    liveMoved = true;
    // Both moves named for the hold the walk is in: the cube reports in its own colour frame,
    // which is the scan frame, and the child is holding it the way the chips say.
    const heldNow = holdAt(cubePos);
    act(locate(liveModel.asString()),
      `That was ${showMove(m.notation, heldNow)} — the next move is ${cubePos < moves.length ? showMove(moves[cubePos], heldNow) : '—'}.`);
    tripwire(m.serial);
    void refreshLiveDistance();
  };

  // Snapshots are authoritative: they share the moves' FIFO channel, so every one delivered
  // is current, and the model resyncs from it unconditionally — that IS the drift correction,
  // including after a lost move packet. The 2D net is never repainted here: its card says
  // INITIAL STATE (or TARGET STATE), and a label naming a fixed reference must not sit over a
  // moving picture — what the cube does live is the 3D cube's and the transport's story.
  const liveUpdate = (f, serial) => {
    liveModel = cubejs().fromString(f);
    liveMoved = false; // a snapshot IS the truth, so the model is no longer ahead of anything
    act(locate(f), 'This cube is not on the plan any more.');
    tripwire(serial);
    void refreshLiveDistance();
  };

  // Trust has already lapsed by the time this runs — onGap() owns that, with or without a
  // screen mounted to hear it — and the trust hook below has stood follow down. What is left
  // is this screen's own account of what happened.
  const liveGap = () => {
    // The shutdown itself is NOT repeated here: onMovesLost marks trust stale first, and the
    // trust hook below owns standing follow down. What this adds is the account of what
    // happened. Disabled, not merely un-highlighted: following matches your turns against an
    // arrangement we have just said we cannot vouch for.
    refuseFollow('Your cube missed a turn — read it again before following');
    // AND THE LIVE DISTANCE GOES WITH IT (§5.4). A lost packet means the local model and the
    // cube have stopped agreeing, so every number derived from the model is about a cube that
    // is not in anyone's hand. Bumping the generation is what stops an answer already in
    // flight arriving to contradict this; clearing the line is what stops the last one
    // standing. A lost move is reported, never absorbed.
    dropLiveDistance();
    // AND THE MODEL IS NO LONGER AHEAD OF ANYTHING KNOWN. A lost packet means the model and the
    // cube have stopped agreeing, so the turns it holds are not turns anybody can vouch for —
    // carrying them across a walk reset, or adopting them as the subject, would be adopting a
    // guess. `onTrustLost` clears this too; both are here because a lost move is the case where
    // the screen has something of its own to say.
    liveMoved = false;
    // No count. Reconciliation proves a turn was lost; it cannot say how many, and the old
    // "Missed 2 turns" came from a serial the app no longer has. Silence here would look
    // exactly like a wrong turn; it is neither, and the next snapshot will resync.
    showNote('A turn went unrecorded — checking the cube…');
  };

  // Any loss of trust while walking — a gap, a disconnect, a report that failed validation —
  // stands follow down the moment it happens, not at the next mount.
  const onTrustLost = () => {
    setFollow(false);
    refuseFollow(`Read the cube first — ${state.cube.staleWhy || 'its position is unverified'}`);
    // AND THE MODEL STOPS BEING AHEAD OF ANYTHING. `liveMoved` says "this model has turns in it
    // that no snapshot has confirmed", which is a claim about the CURRENT connection — and it
    // survived a disconnect. Reproduced: scan `R`, report `U`, disconnect, reconnect, confirm
    // `R`, and the adoption overwrote the confirmed truth with `R U` AND marked it trusted.
    // That is §9a's severe failure — a route for a cube other than the one in their hands,
    // passing every internal check. Trust lapsing is the one event that covers all of them:
    // a disconnect, a refused report and a lost move all go through `markStale` to get here.
    liveMoved = false;
    // AND THE LIVE NUMBER. Trust is the gate `refreshLiveDistance` reads, so a number computed
    // while it held is about a cube nobody can vouch for the moment it lapses — and an answer
    // already in flight would repaint over the clearing without this. `onTrustLost` did neither
    // until an audit reproduced both.
    dropLiveDistance();
  };

  $('#resolveBtn', root).onclick = () => {
    // Re-solve starts from the cube as it IS. The model can be ahead of the last adopted
    // snapshot by whatever was turned in the past second — remounting from the stale global
    // would build a walk for a cube that no longer exists.
    if (liveModel && state.cube.trusted) {
      const f = liveModel.asString();
      if (f !== state.cube.facelets) adoptCube(f, { physical: true, source: 'cube' });
      // `live` too, or the next mount's "starts where the cube is" precondition compares the
      // fresh walk against a snapshot from before those turns and refuses to follow — for
      // the whole visit, since the precondition runs once. The model IS the corrected
      // report stream carried forward, so this stays true to what `live` means; `reported`
      // (the raw stream) is deliberately untouched.
      state.live = f;
    }
    // Scramble ignores the subject — it always walks from solved — so "Re-solve this cube"
    // must go where the cube in hand is actually solved from: the solve walk on Home.
    go(scrambling ? 'home' : state.screen);
  };
  $('#turnBackBtn', root).onclick = () => {
    // Acknowledging is not the same as the cube being back: hiding the warning here would
    // silently accept an off-plan cube if no further report arrived. The note stays, saying
    // what is being waited for — only act() clears it, on an actually on-plan reading.
    if (note && !note.hidden) noteMsg.textContent = 'Watching for it — turn it back and the guide picks up.';
  };

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
  /** Work out the walk for whatever the subject is NOW, and put it on the screen already
   *  standing. Called once by mount, and again by `update` every time the subject changes.
   *  Returns false when it was overtaken and wrote nothing. */
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
    moves = []; steps = []; chips = []; total = 0; target = null;
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
    if (offerRow) offerRow.hidden = true;
    const rungLine = $('#rungLine', root);
    if (rungLine) { rungLine.hidden = true; rungLine.textContent = ''; }
    midpoints.clear();
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
    setFollow(false);
    clearNote();
    // The subject, drawn without a walk: no scramble to animate from, just the arrangement.
    // Scramble is left alone — it always starts from solved, and what it walks TO is not
    // known until it has been rolled.
    if (!scrambling) {
      cube.removeAttribute('scramble'); cube.removeAttribute('alg');
      cube.setAttribute('facelets', state.cube.facelets);
      paintNet(state.cube.facelets);
    }
    sync(0);
    setStatus('working…');
  }

  function failWalk(err) {
    const key = String(err?.message ?? err ?? '');
    refuseFollow('Needs a solve worked out on this screen');
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

  async function loadWalk() {
    const mine = ++walkGen;
    // A new walk has been followed nowhere yet. Without this, switching Solution → Lesson
    // would inherit the moves the previous walk had stepped through and credit the new one on
    // the strength of them.
    followed.clear();
    // Two ways to become obsolete: the screen was replaced (screenGen), or another press
    // started a newer walk on this same screen (walkGen). Both must stop this one writing.
    const fresh = () => !stale() && mine === walkGen;
    // The previous walk's search is about a cube this one is replacing. Aborted BEFORE the
    // new one starts, so the pool is free rather than working through a dead search first.
    walkAbort?.abort();
    const abort = walkAbort = new AbortController();
    // THE CUBE IN HAND, BEFORE ANYTHING IS DRAWN OR SEARCHED — and the placement is the whole
    // of it. `liveMove` advances the local model on every reported turn while
    // `state.cube.facelets` waits for a snapshot or an `adoptCube`, so a target chosen after a
    // few turns was answered for a cube that no longer exists: scan `R`, turn `U`, ask for the
    // first layer, and the app offered `R'`. Reproduced by an audit.
    //
    // ADOPTED HERE rather than inside the search, and the first fix put it inside. That left
    // two things describing the older cube: `beginWalk` had already painted the net, and the
    // whole-cube locals had already been read off `state.cube` — so a repair that then found
    // nothing committed the PREVIOUS cube's algorithm over the new subject. Both reproduced by
    // the verify pass on that very fix, which is the argument for adopting before the screen
    // and the search rather than between them.
    //
    // ON EVERY RELOAD, and gating it on the selector was wrong. The reset at the end of this
    // function clears `liveModel` and reseeds it from `state.live`, which is the last SNAPSHOT
    // — so any walk reload that did not adopt first silently rewound the model past the turns
    // since that snapshot, and a later target press then had nothing to notice. Reproduced by
    // a verify pass: scan `R`, turn `U`, switch Solution → Lesson, choose the first layer, and
    // the app is back to offering `R'`. Adopting here CAPTURES those turns instead of losing
    // them, which is better than the behaviour it replaces rather than merely different.
    //
    // `isPhysical` is what keeps it honest. A generated subject — the die's cube — is not the
    // cube in anybody's hand, and adopting a connected cube's position over it would throw the
    // rolled cube away. `chainTrusted()` alone does not say that: it is about the connection.
    if (!scrambling && liveMoved && liveModel && chainTrusted() && state.cube.isPhysical) {
      const now = liveModel.asString();
      if (now !== state.cube.facelets) {
        adoptCube(now, { physical: true, source: 'cube' });
        // `live` too, or the follow precondition compares the fresh walk against a snapshot
        // from before those turns and refuses for the rest of the visit — the same sentence
        // `#resolveBtn` carries, for the same reason.
        state.live = now;
      }
    }
    // THE CUBE MAY BE SOMETHING ELSE ENTIRELY, whether or not THIS load is what changed it.
    // Turning `R'` after a scanned `R` leaves a solved cube, which has no walk at all — so the
    // composition this screen was built for is gone and `deriveCube` would throw "nothing to
    // walk", reaching the child as "could not work it out" about a cube that is finished.
    //
    // UNCONDITIONAL, and nesting it inside the adoption was the bug: a snapshot that had
    // already ingested the solved cube made the adoption a no-op, so the check never ran and
    // the defect came back by another path. Reproduced by an audit, twice, which is what a
    // guard placed inside a branch earns.
    if (!scrambling) {
      const after = classifyCube();
      if (after.solvable !== walking || after.unsolvable !== unsolvable) {
        // DEFERRED past any refresh that is already running. `refreshScreen` guards itself with
        // `refreshing`, so calling it from a load that `refreshScreen` ITSELF started is
        // swallowed — and `update()` has already reported success by then, so no rebuild
        // happens at all. A microtask runs after that guard has been released.
        queueMicrotask(() => { if (!stale()) refreshScreen(); });
        return false;
      }
    }
    beginWalk();
    // A retarget replaces the SUBJECT, and a native proof about the old subject must not
    // outlive it — same rule as renderScreen's teardown, for the path that never renders.
    if (optimalCapability()) optimalCancel().catch((err) => console.warn('optimal cancel failed', err));
    // WORKED OUT INTO LOCALS, COMMITTED AFTER THE FRESHNESS CHECK — not before it. Two loads
    // can be in flight at once (a reconnect answered while the die's is still solving), and
    // the slower one finishes last. Assigning the shared `moves` / `steps` / `target` inside
    // the search and only THEN noticing it had been overtaken left the screen showing one
    // cube while every closure that reads those — follow's `locate`, the midpoint table,
    // "Solve this scramble" — had been handed the other one. Nothing crosses out of here
    // until this load is known to still be the current one, so there is no window in which
    // that disagreement exists at all.
    let gotSetup = '', gotAlg = '', gotMoves = [], gotSteps = [], gotTarget = null, gotRoll = null;
    let gotLesson = null;
    // The repair, when one was asked for. Null on the Scramble side and whenever the target is
    // the whole cube, which is what every read of it below is guarded on.
    let gotRoute = null;
    const stageTarget = scrambling ? null : stageTargetNow();
    /** The whole-cube search's failure, or null. See where it is rethrown. */
    let wholeFailed = null;
    /**
     * The cube a repair was computed FOR.
     *
     * Declared out here because the walk is committed a long way below the search, and the two
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
    if (wholeAbort) abort.signal.addEventListener('abort', () => wholeAbort.abort(), { once: true });
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
        if (abort.signal.aborted) throw err;
        if (!wholeAbort?.signal.aborted) wholeFailed = err;
      }
    };
    try {
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
          gotRoute = await lastRoute(stageTarget, startedFrom, abort.signal, wholeDone);
          if (!fresh()) return false;
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
          if (!fresh()) return false;
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
            walkKind = 'solution';
            for (const p of root.querySelectorAll('[data-walk]')) setWalkPill(p, 'solution');
          }
        }
      }
    } catch (err) {
      // A search this screen itself called off is not a failure to report: the subject it was
      // about is gone, and the walk that replaced it owns the screen now. Superseded, silent.
      if (abort.signal.aborted) return false;
      if (fresh()) failWalk(err);
      return false;
    }
    if (!fresh()) { parkRoll(gotRoll); return false; } // navigated away, or a newer load took over

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
    // WHAT THE CHILD IS AIMING AT, with everything the target leaves free drawn as an empty
    // well. Repainted per walk, because a retarget changes the target and a stale picture
    // would be pointing at a stage nobody is walking to. Hidden for the whole cube, where the
    // picture is a solved cube and says nothing a person did not already know.
    const aim = $('#stageAim', root);
    if (aim) {
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
      if (aimingAt) {
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
    }
    // WHICH WAY UP (ADR 0003): the CUBE turns, never the camera. This used to set `camera-up`,
    // which moves the eye — the lamp rolled with it, and every move stayed named for white up
    // while the face turning on screen was the one at the bottom. The renderer turns the object,
    // and the chips below are named for the same hold, so the drawing and the words agree.
    holdCube(holdAt(0));
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
    // claim has three sanctioned sources, and two of them are found by name in lib/prove-affordance.js.
    sayWalkLength({ root, setStatus, scrambling, route, stageTargetNow, lesson, total, steps, fresh });
    // ONE GRID for a Solution, SECTIONS for a Lesson — and the difference is not decoration.
    //
    // The solve side used to cut its list at fixed 16 / 62 / 82% and head the pieces CROSS /
    // F2L / OLL / PLL: proportional slices of a two-phase solution wearing the names of stages
    // it does not have. That was removed for being invented structure on the screen a beginner
    // trusts most, and one flat grid is the honest rendering of an object with no stages.
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
      // white face is meant — which, held that way, is called D.
      .map((m, k) => `<button class="chip-m" data-i="${from + k}" title="${escHtml(t('Jump to this move'))}">${escHtml(renameAlg(m, holdAt(from + k)))}</button>`)
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
    chips = [...solList.querySelectorAll('.chip-m')];

    // Nothing may survive from the previous walk. Each of these is a position ON a plan, and
    // the plan has just been replaced: carried over, they describe a cube that is no longer
    // on screen.
    at = 0;
    playing = false;
    cubePos = 0;
    // THE MODEL SURVIVES IF IT IS AHEAD OF THE SNAPSHOT. Clearing it unconditionally and
    // reseeding from `state.live` below discarded every turn reported DURING the search — and
    // since the adoption at the top of the next load reads this model, the rewind then defeated
    // that too. Reproduced by an audit: start at `R`, turn `U` while the reply is in flight,
    // and the model comes back as `R`. `liveMoved` is the precise condition, and it is why that
    // flag exists rather than a comparison against the subject.
    if (!liveMoved) liveModel = null;
    drawn = 0;
    lastSerial = null;
    setPlaying(false);
    clearNote();
    // Following is judged per walk, so a session that was following must be stood down before
    // the new walk is judged — otherwise setFollow(true) below sees `mode` already 'cube',
    // returns early, and never re-bases the drawing on the new plan.
    setFollow(false);
    midpoints.clear();
    // Built only from a COMPLETE step array: with steps short (the case refuseFollow answers
    // below), steps[i] is undefined for the tail and fromString(undefined) throws — which
    // turned "follow is refused" into "the whole screen fails to mount".
    if (steps.length === total + 1) {
      for (let i = 0; i < moves.length; i++) {
        if (!moves[i].endsWith('2')) continue;
        for (const q of [moves[i][0], `${moves[i][0]}'`]) {
          const c = cubejs().fromString(steps[i]); c.move(q);
          const s = c.asString();
          if (!midpoints.has(s)) midpoints.set(s, []);
          midpoints.get(s).push(i);
        }
      }
    }

    /** Where is this state on the plan? Locality first: the near window resolves a repeated
     *  state toward where the cube actually is, and is also the cheap path. */
    if (followBtn) {
      followBtn.disabled = false; // a previous walk may have refused it; this one is re-judged
      // Following compares the real cube against the state each move produces, so it needs one
      // state per step, a TRUSTED cube (the move stream is in the CUBE's frame — following an
      // unverified one advances the guide on turns that may not be the ones being made), and a
      // walk that STARTS from where the cube in your hand actually is. The last rule is what
      // makes a random cube unfollowable while a scramble from a solved cube is perfectly
      // followable — and why a solved cube used to complete a random solve instantly.
      if (steps.length !== total + 1) {
        refuseFollow('Needs a solve worked out on this screen');
      } else if (!state.cube.trusted) {
        refuseFollow(`Read the cube first — ${state.cube.staleWhy || 'its position is unverified'}`);
      } else if (steps[0] !== state.live) {
        refuseFollow(state.live
          ? 'This is not the cube in your hand — read your cube to follow along'
          : 'Waiting to hear from your cube…');
      } else {
        // …and only seed a NEW model where the carried one is not already ahead. Reseeding over
        // a model with untracked turns in it is the rewind this walk just avoided.
        if (!liveMoved) liveModel = cubejs().fromString(state.live);
        setFollow(true);
      }
    }
    sync(0);
    // THE LIVE NUMBER, AFTER THE MODEL IT READS. Asked from the aim block above, it ran before
    // `liveModel` was reset to null and re-seeded thirty lines down — so a fresh mount produced
    // no number at all and a retarget asked the PREVIOUS model about the NEW target. Both are
    // the same mistake: a question asked before its subject exists. Found by an audit.
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
    following: () => mode === 'cube',
    /** The live hooks. The screen installs them into the app's slots, which a module cannot write. */
    liveMove, liveUpdate, liveGap, onTrustLost,
  });
}
