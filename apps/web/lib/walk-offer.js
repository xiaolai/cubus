// The rung offer on the cube screen: counting the moves a learner actually steps through, crediting a
// lesson followed to its end as one clean follow of every stage it contained, and the offer — never
// an ask — that a stage has been practised enough to go up a rung.
//
// Its own unit because it owns its own state: which walk was credited, which moves of this walk were
// followed, whether progress is reaching storage, and the offer on screen. The session tells it where
// the transport head went (`onHead`), that a new walk has started (`newWalk`), and that the walk the
// row was about is being replaced (`hide`). Lifted out of lib/walk-session.js on 2026-09-13; driven
// on its own by test/walk-offer.test.mjs.

import { t } from './i18n.js';
import { declineOffer, nextOffer, recordCleanFollow } from './method-ladder.js';

/**
 * The rung offer of one mounted cube screen, its answers wired.
 *
 * A lesson followed to its last move is one clean follow of every stage that lesson actually
 * contained — read off the solve, never assumed, because a cube whose cross was already solved
 * taught nothing about the cross. Counted once per walk: the head moves on every step and on every
 * seek, and a learner who scrubs back and forth would otherwise be credited with a dozen solves.
 *
 * @param {object} deps `root`, the screen holding `#rungOffer`; `settings`, whose `rungProgress`
 *   this writes; `save`; `raiseRung`, the one operation both the offer and the Lessons ladder go
 *   through; and `onRaised()`, what the screen does once a rung has gone up.
 */
export function createRungOffer({ root, settings, save, raiseRung, onRaised }) {
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
  // The LATEST write decides: one that lands saves the whole settings object, the progress an
  // earlier failure kept only in memory included, so a device that recovered is saving again.
  const noteWrite = (ok) => { progressUnsaved = !ok; };
  const offerRow = root.querySelector('#rungOffer');
  /** The offer currently ON SCREEN — answered as shown, not recomputed on the way out. */
  let shownOffer = null;
  const showOffer = () => {
    if (!offerRow) return;
    const msg = root.querySelector('#rungOfferMsg');
    if (progressUnsaved) {
      shownOffer = null;
      offerRow.hidden = false;
      msg.textContent = t('This device is not saving your progress, so rungs will not be offered.');
      root.querySelector('#rungYes').hidden = true;
      root.querySelector('#rungNot').hidden = true;
      return;
    }
    shownOffer = nextOffer(settings.rungs, settings.rungProgress);
    offerRow.hidden = !shownOffer;
    if (!shownOffer) return;
    root.querySelector('#rungYes').hidden = false;
    root.querySelector('#rungNot').hidden = false;
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
    // What a raised rung means for the walk on screen is the screen's to decide.
    if (yes) onRaised();
  };
  if (offerRow) {
    root.querySelector('#rungYes').onclick = () => answerOffer(true);
    root.querySelector('#rungNot').onclick = () => answerOffer(false);
  }

  /**
   * The transport head moved from `from` to `to` on walk number `walkGen`.
   *
   * One move forward is one move followed. Anything else — a seek, a scrub, a reload — moves the
   * head without the learner having watched what it passed over.
   *
   * The last move of a LESSON is one clean follow of every stage it contained — and once per walk,
   * not once per arrival at the end.
   *
   * **FOLLOWED, not merely arrived at.** Reaching the last chip was the whole test, and a chip press
   * seeks straight there: tapping the final chip credited every stage in the lesson as practised. So
   * did switching Solution → Lesson, which starts a new walk and reset the once-per-walk guard with
   * the head already at the end. A learner could earn a rung offer without watching a single move.
   *
   * What counts is a move STEPPED THROUGH: the head advancing by exactly one, forwards. Rewinding to
   * re-watch something is still following — the moves already stepped stay counted — but a jump
   * credits nothing, because nothing was shown. A jump of ONE is still a jump: pressing chips in
   * order moves the head one move at a time with no turn animated. So the presenter says which it
   * was, and a head move it did not say was shown (`jumped === false`) credits nothing.
   */
  function onHead(from, to, { lesson, total, walkGen, jumped }) {
    if (jumped === false && to === from + 1) followed.add(from);
    if (lesson && total > 0 && to >= total && followed.size >= total && creditedWalk !== walkGen) {
      creditedWalk = walkGen;
      settings.rungProgress = recordCleanFollow(
        settings.rungProgress,
        lesson.sections.map((sec) => sec.id),
      );
      noteWrite(save('cubusSettings', settings));
      showOffer();
    }
  }

  return Object.freeze({
    onHead,
    /** A new walk has been followed nowhere yet: without this, switching Solution → Lesson would
     *  inherit the moves the previous walk had stepped through and credit the new one on them. */
    newWalk: () => { followed.clear(); },
    /** The walk the row was about is being replaced. Its offer goes with it; the warning that this
     *  device is not saving stays, because it is about the device and a new walk does not change
     *  it. */
    hide: () => { if (offerRow && !progressUnsaved) offerRow.hidden = true; },
  });
}
