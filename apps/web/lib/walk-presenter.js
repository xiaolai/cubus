// The walk's presenter on the cube screen: the transport head and the chips' marks, the step being
// taught pointed at on the cube, the play and step buttons, the renderer's step event, and the
// hand-off from a finished scramble to the solve.
//
// IT DOES NOT DRIVE THE ELEMENT (plan item 6.5, 2026-09-17). Every press goes to the script player the
// session owns, which owns the stop driver, which owns what the element is told. This module pressed
// `cube.step()`, `cube.seek()` and `cube.play()` directly until then, and `lib/walk-follow.js` kept a
// second transport beside it — so "where the drawing is" had two owners that agreed by construction and
// nothing checked. `test/walk-transport-wiring.test.mjs` reads this file as text and fails on any
// transport call in it, because a behavioural test can show a press moves the cube and cannot show that
// no other line does.
//
// Its own unit because it is the walk's VIEW: it owns where the head is, whether the walk is
// playing and the chips on screen, and reads the walk itself through `walkNow()` when it paints.
// The session orchestrates loads and commits them; this is what they look like. Lifted out of
// lib/walk-session.js on 2026-09-13; what it keeps is pinned through the session in
// test/walk-session.test.mjs, and through the app in router-wiring.test.mjs and
// scramble-handoff.test.mjs.

import { t } from './i18n.js';
import { createHoldCube, holdAtMove, holdChangeAt, moveHold } from './hold-presenter.js';
import { stepAtMove, whyText } from './method-lesson.js';
import { SCAN_HOLD } from './solving-hold.js';

/**
 * The presenter of one mounted cube screen, its buttons wired.
 *
 * @param {object} deps `root`; the renderer `cube`; shared `state`; the screen's abort `signal`;
 *   `scrambling`; `stale()`; the move list `solList`; `icon`; `adoptCube` and `go`, for the
 *   hand-off; `walkNow()`, the walk on screen as
 *   `{ total, target, alg, lesson, walkHold, walkGen, walkLoaded }`; `takeOver()`, the follow
 *   tracker's; and `onHead(from, to, walk)`, the rung offer's. The last two are called, never read
 *   at construction, because both are built after this.
 */
export function createWalkPresenter({
  root, cube, player, afterTurn, turnLanded, state, signal, scrambling, stale, solList, icon, adoptCube,
  go, walkNow, takeOver, onHead,
}) {
  const $ = (sel, from) => from.querySelector(sel);
  let chips = [];
  let at = 0;
  let playing = false;
  /** True while the head moves without a move being shown: a seek, or bookkeeping with no
    *  renderer. */
  let jumping = false;

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
    if (!cubeTruth()) return t('Solve this scramble');
    const { target } = walkNow();
    return state.cube.facelets === target ? t('Your cube is scrambled — solve it') : t('Solve your cube');
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

  /** The hold move `k` is MADE in — a lesson's regrips included — which is what a chip is named for.
   *  The renderer is never turned to it: the drawing turns with the regrip itself. */
  const moveHoldAt = (k) => {
    const { lesson, walkHold } = walkNow();
    return moveHold(lesson, walkHold, k);
  };

  /** Turns this screen's cube to a hold — the object, never the camera — waiting for the renderer
   *  when the tag is not one yet, and turning nothing once this screen has been replaced. */
  const holdCube = createHoldCube({ cube, isStale: stale });
  /** The hold the drawing was last turned to: the scan's, until a walk turns it. */
  let drawnHold = SCAN_HOLD;
  /** Every turn of this screen's cube goes through here, so `drawnHold` cannot fall behind it. */
  const turnTo = (h) => { drawnHold = h; holdCube(h); };
  /** The hold the lesson line last spoke for; while no lesson is showing, the drawing's. */
  let toldHold = SCAN_HOLD;
  /** The line last written, and the walk and head it was written for. A PAINT IS NOT A MOVE: the same
   *  head can be painted twice — the renderer reports its reset while a lesson loads, and the session
   *  syncs again before the frame — and the second paint found the hold already told and dropped "Hold it
   *  with white underneath…", leaving a child looking at a cube turned over with nothing saying why
   *  (found by a Codex audit, 2026-09-16). */
  let said = { gen: -1, at: -1, line: '' };

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
    const { lesson, walkHold, walkGen } = walkNow();
    const whyLine = $('#whyLine', root);
    if (!lesson || scrambling) {
      cube.removeAttribute('focus');
      cube.removeAttribute('highlight');
      if (whyLine) { whyLine.hidden = true; whyLine.textContent = ''; }
      // No lesson line, so nothing was said: the next lesson speaks for the drawing as it stands.
      toldHold = drawnHold;
      return;
    }
    const step = lesson.steps[stepAtMove(lesson.moveStep, i)];
    // The step's cues were worked out and renamed into the scan frame when the lesson was built
    // (`lessonFor`). Whole-or-nothing at the renderer: an empty spec removes the channel rather
    // than setting it to a selector that names nothing.
    if (step?.focus) cube.setAttribute('focus', step.focus); else cube.removeAttribute('focus');
    if (step?.highlight) cube.setAttribute('highlight', step.highlight); else cube.removeAttribute('highlight');
    // The cube turns over as the head crosses a hold, in either direction — a scrub goes back.
    const { held, say } = holdChangeAt(lesson, walkHold, i, toldHold);
    toldHold = held;
    turnTo(held);
    if (!whyLine) return;
    const reason = whyText(step);
    const fresh = say ? (reason ? t('%1 %2', say, reason) : say) : reason;
    // The same walk, the same head: whatever was said there stands. Recomputing it would drop the hold
    // sentence, because the hold it asks about has by then been told.
    const text = said.gen === walkGen && said.at === i ? said.line : fresh;
    said = { gen: walkGen, at: i, line: text };
    whyLine.hidden = !text;
    whyLine.textContent = text
      ? t('Step %1 of %2 — %3', lesson.steps.indexOf(step) + 1, lesson.steps.length, text)
      : '';
  }

  function sync(i) {
    const { total, target, lesson, walkGen, walkLoaded } = walkNow();
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
    // Played to its end, a walk has stopped playing: the renderer stops itself after the last move
    // and says nothing but this step, so without this the button stood as Pause over a finished
    // walk.
    if (playing && i >= total) setPlaying(false);
    // A tick beside the count once the last move lands. It used to be a 46px badge over the
    // cube, saying "done" where the count beside it already read 22 / 22. Only on a walk that
    // exists: while one is searched for, and after one failed, `total` is 0 and so is `i`.
    $('#doneMark', root).hidden = !walkLoaded || i < total;
    // Where the head went, for the rung offer: it counts the moves stepped through, one at a time
    // and forwards, and credits a lesson followed to its end once per walk (lib/walk-offer.js). A
    // jump is never a step, however short: pressing chips in order moves the head one at a time.
    onHead(from, i, { lesson, total, walkGen, jumped: jumping });
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
  /**
   * THE HEAD IS WHAT HAS BEEN SHOWN, so it still comes from the element's own report.
   *
   * The player MOVES the walk now (plan item 6.5), but it is not what the head should be read from:
   * the driver sets its position when a stop is ASKED for, and the element takes up to 3.8 seconds to
   * turn — so reading the player would fill the chip and advance the count at the press, before the
   * move it describes had happened. The two are the same number once the turn lands, which is what
   * `test/walk-script.test.mjs` pins: this screen's script gives every token a position.
   */
  // Signalled, because `cube` is parked and re-used between screens now: an unscoped
  // listener here would arrive at the next screen still calling this screen's sync().
  //
  // THE SCREEN'S ONE STEP LISTENER, and the walk clock is told from inside it rather than taking its
  // own: `screen-swap.test.mjs` asserts that a step reaches exactly one handler, which is how a
  // listener left behind by an earlier visit is caught at all. Painted first, then the clock — the
  // clock's tick asks for the next stop, and the head being repainted after the walk had already
  // moved on would show the move that is starting rather than the one that just landed.
  cube.addEventListener('cubus-step', (e) => { sync(e.detail.index); turnLanded(); }, { signal });

  /** Whether the element can SHOW a walk — the vendored bundle may not have upgraded the tag, which
   *  this repo has shipped more than once. The player still keeps the route and the position then, so
   *  every press is bookkeeping and none of them throws; what there is no point doing is playing. */
  const shows = () => typeof cube.stepStop === 'function';

  /** Repaint after a press the element will not report: with no renderer nothing ever lands, so the
   *  head is bookkeeping and this is the only thing that moves it. Declared AFTER `shows` on purpose —
   *  a `const` arrow read before its initialiser is a TDZ throw, not a hoisted function. */
  const syncNow = () => { if (!shows()) sync(player.position ?? at); };

  const setPlaying = (on) => {
    // A button reading Pause over a still cube claims a deed. So a walk plays only where it can be
    // watched: with no renderer, and with no route loaded — a walk still being searched for — the
    // press turns into a pause, and `playing` comes back from the player rather than from the ask.
    if (on && shows()) player.play(); else player.pause();
    playing = player.playing;
    const play = $('#playBtn', root);
    play.innerHTML = icon(playing ? 'pause' : 'play', 18);
    // The name follows the action: a button drawn as Pause while announcing "Play from here
    // to the end" claims the wrong deed.
    play.title = playing ? t('Pause') : t('Play from here to the end');
    play.setAttribute('aria-label', play.title);
  };

  /** Move the head to `k` without showing the moves between. Marked as a jump, because nothing was
   *  watched — which is what the rung offer counts, and it counts only steps. */
  const jumpTo = (k) => {
    jumping = true;
    try {
      player.seek(Math.max(0, Math.min(k, walkNow().total)));
      syncNow();
    } finally { jumping = false; }
  };
  /** Every transport press starts the same way — the cube stops leading, playback stops — and then
   *  makes its own move. */
  const press = (move) => {
    takeOver();
    setPlaying(false);
    move();
  };

  $('#playBtn', root).onclick = () => { takeOver(); setPlaying(!playing); };
  $('#nextBtn', root).onclick = () => press(() => { player.next(); syncNow(); });
  // Back and repeat are both animated, at the one walking speed, and differ only in where they
  // leave you. Back undoes the last move and stops there. Repeat answers "show me that again":
  // it undoes the move and then makes it again, so you end up where you started having watched
  // it twice. Neither jumps: a cut to a new state teaches nothing about the turn that got there.
  // Repeat's two halves are ORDERED BY THE ELEMENT'S OWN COMPLETION, not by a queue: since the walk
  // is driven by stop commands (plan item 6.5) and a stop command settles the group in flight,
  // pushing both at once would snap the undo. See the press itself, below.
  $('#prevBtn', root).onclick = () => press(() => { player.back(); syncNow(); });
  // A move in the list is a place in the solution, so clicking one goes there. seek() is instant
  // on purpose: jumping twelve moves is not something to sit through, which is exactly the case
  // step()/stepBack() do not cover. It seeks to just AFTER the clicked move: the cube shows that
  // move made and the clicked chip is the filled one, so the highlight lands where you clicked.
  solList.onclick = (ev) => {
    const chip = ev.target.closest('.chip-m');
    if (!chip) return;
    // Jumping to a move is taking over just as much as pressing Next is.
    press(() => jumpTo(Number(chip.dataset.i) + 1));
  };

  // Through press() like every other step, so one press takes over once: it used to take over
  // here and again inside press() (found by audit, 2026-09-13).
  $('#repeatBtn', root).onclick = () => press(() => {
    // Not merely belt-and-braces with the disabled attribute: back() self-guards at position 0 but
    // next() does not, so without this a repeat at the start would go FORWARD one move.
    if (at === 0) return;
    player.back();
    syncNow();
    // The forward half waits for the undo to LAND. Both halves are stop commands, and a stop command
    // settles whatever group is in flight — so asking for both in one breath snaps the undo and animates
    // only the redo, which is the one thing this button exists not to do.
    afterTurn(() => { player.next(); syncNow(); });
  });

  return Object.freeze({
    holdAt, moveHoldAt, holdCube: turnTo, pointAtStep, sync, setPlaying,
    /** A new subject: the previous walk's chips describe a cube that is no longer there. */
    clearChips: () => { chips = []; },
    /** The chips the walk just committed painted into the move list. */
    takeChips: () => { chips = [...solList.querySelectorAll('.chip-m')]; },
    /** A new walk starts at its first move, and not playing. */
    resetHead: () => { at = 0; playing = false; },
  });
}
