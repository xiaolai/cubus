// The walk's presenter on the cube screen: the transport head and the chips' marks, the step being
// taught pointed at on the cube, the play and step buttons, the renderer's step event, and the
// hand-off from a finished scramble to the solve.
//
// Its own unit because it is the walk's VIEW: it owns where the head is, whether the walk is
// playing and the chips on screen, and reads the walk itself through `walkNow()` when it paints.
// The session orchestrates loads and commits them; this is what they look like. Lifted out of
// lib/walk-session.js on 2026-09-13; what it keeps is pinned through the session in
// test/walk-session.test.mjs, and through the app in router-wiring.test.mjs and
// scramble-handoff.test.mjs.

import { t } from './i18n.js';
import { createHoldCube, holdAtMove, holdChangeAt } from './hold-presenter.js';
import { stepAtMove, whyText } from './method-lesson.js';

/**
 * The presenter of one mounted cube screen, its buttons wired.
 *
 * @param {object} deps `root`; the renderer `cube`; shared `state`; the screen's abort `signal`;
 *   `scrambling`; `stale()`; the move list `solList`; `icon`; `adoptCube` and `go`, for the
 *   hand-off; `walkNow()`, the walk on screen as
 *   `{ total, target, alg, lesson, walkHold, walkGen }`; `takeOver()`, the follow tracker's; and
 *   `onHead(from, to, walk)`, the rung offer's. The last two are called, never read at
 *   construction, because both are built after this.
 */
export function createWalkPresenter({
  root, cube, state, signal, scrambling, stale, solList, icon, adoptCube, go, walkNow, takeOver, onHead,
}) {
  const $ = (sel, from) => from.querySelector(sel);
  let chips = [];
  let at = 0;
  let playing = false;

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
    const { target } = walkNow();
    return state.cube.facelets === target ? 'Your cube is scrambled — solve it' : 'Solve your cube';
  };
  if (solveIt) {
    solveIt.onclick = () => {
      // The target is what this button HANDS OVER, so a press without one has nothing to do.
      // Guarded here as well as at the point the button is drawn: `hidden` is a property any
      // later paint could get wrong, and handing `null` to adoptCube stores a subject with no
      // facelets at all — Home then draws a cube nobody rolled.
      const { target, alg } = walkNow();
      if (!target) return;
      // `alg` is this scramble's own setup alg — the walk that just finished, from solved to
      // `target` — so Home needs no search to know how the cube it is handed was reached.
      if (!cubeTruth()) adoptCube(target, { physical: false, source: 'generated', setupAlg: alg });
      go('home');
    };
  }

  /** How move `k` of the walk on screen is held (ADR 0003) — a lesson's per move, any other
   *  walk's throughout. The rule and its tests are `lib/hold-presenter.js`. */
  const holdAt = (k) => {
    const { lesson, walkHold } = walkNow();
    return holdAtMove(lesson, walkHold, k);
  };

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
    const { lesson, walkHold } = walkNow();
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
    const { total, target, lesson, walkGen } = walkNow();
    const from = at;
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
    // Where the head went, for the rung offer: it counts the moves stepped through, one at a time
    // and forwards, and credits a lesson followed to its end once per walk (lib/walk-offer.js).
    onHead(from, i, { lesson, total, walkGen });
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

  $('#repeatBtn', root).onclick = () => {
    takeOver();
    // Not merely belt-and-braces with the disabled attribute: stepBack() self-guards at step 0
    // but step() does not, so without this a repeat at the start would go FORWARD one move.
    if (at === 0) return;
    setPlaying(false);
    cube.stepBack();
    cube.step();
  };

  return Object.freeze({
    holdAt, holdCube, pointAtStep, sync, setPlaying,
    /** A new subject: the previous walk's chips describe a cube that is no longer there. */
    clearChips: () => { chips = []; },
    /** The chips the walk just committed painted into the move list. */
    takeChips: () => { chips = [...solList.querySelectorAll('.chip-m')]; },
    /** A new walk starts at its first move, and not playing. */
    resetHead: () => { at = 0; playing = false; },
  });
}
