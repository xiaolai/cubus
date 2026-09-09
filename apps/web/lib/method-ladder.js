// How a learner moves up a rung — the §3 half of the return plan, as rules rather than as a
// setting.
//
// **A `teachLevel` dropdown is what was deleted, and it deserved deleting.** Four dropdowns would
// be worse than one: a configuration screen inside a children's app. The rung is a FACT ABOUT THE
// LEARNER, not a preference, so it is arrived at rather than chosen, and this module is the four
// rules that govern the arriving (dev-docs/method-solver-return-plan.md §3 — dev-docs/ is
// gitignored, so a checkout does not carry it; that is the repository's convention, not a
// dangling reference):
//
//   1. **The default path is the bottom rung everywhere.** A new learner chooses nothing and is
//      shown the beginner's method — the discipline `DEFAULT_HIDDEN` already applies to the nav.
//   2. **Raising a rung lives on the Lessons screen.** Each stage shows its whole ladder, and a
//      rung not yet reached is DESCRIBED rather than hidden: a ladder you can see is a goal, a
//      dropdown is a chore.
//   3. **Offer, never ask.** After a stage has been followed cleanly a few times, offer its next
//      rung, once, in one tap. Declining costs nothing and it re-offers later. Nothing is ever
//      silently raised.
//   4. **The cube screen names the rungs in play** — that one is `method-lesson.js`'s
//      `rungSummary`, because it is about the solve on screen rather than about progression.
//
// Pure: no DOM, no storage, no solver. What the app does with an offer is the app's business; what
// counts as an offer is here, where it can be tested.

import { LADDER, STAGE_IDS, TOP_RUNG } from './method-solver.js';
import { t } from './i18n.js';

/**
 * How many clean follows before a stage's next rung is offered.
 *
 * Three, and the number is a judgement rather than a measurement — nobody has run the study. What
 * it is chosen against: once is an accident, and three solves is enough to have met the stage
 * repeatedly rather than once. It is NOT a claim that every case has been seen — the module counts
 * solves, not cases, and a learner can meet the same easy case three times. If §10's "the rung
 * progression is never used" verdict arrives, this number is the first thing to look at before
 * concluding the rungs are a setting wearing a costume.
 */
export const FOLLOWS_TO_OFFER = 3;

/**
 * The step by which each decline pushes the next offer further out.
 *
 * Declining must cost NOTHING — that is the rule — so it does not disable the offer, it postpones
 * it. The nth decline of a stage waits `n x RE_OFFER_GAP` more follows, so a learner who keeps
 * saying no is asked less and less often, and one who was merely busy gets asked again soon.
 */
export const RE_OFFER_GAP = 3;

/**
 * The largest count worth storing, shared by the repair and by the increments.
 *
 * They have to be the same number. When only the repair had a limit, a counter could be incremented
 * past it and then reset to ZERO on the next load — every follow a learner had earned, thrown away
 * by the code written to protect them.
 */
const COUNT_LIMIT = 1e6;

/**
 * The ceiling for the postponement WATERMARK, and it has to be higher than the count's.
 *
 * Clamping both to the same number makes the postponement stop working exactly where it is most
 * degenerate: a learner whose follow count has stopped rising at the limit declines, `nextAt` is
 * clamped to that same limit, and the offer is eligible again on the spot — the one thing declining
 * is supposed to prevent. Above the count ceiling, a watermark the count can never reach means
 * "not again", which is the right answer for a record that has stopped counting.
 */
const NEXT_AT_LIMIT = COUNT_LIMIT * 2;

/** A fresh progress record: nothing followed yet, nothing declined, nothing postponed. */
export const NO_PROGRESS = Object.freeze({
  follows: Object.freeze({}),
  declined: Object.freeze({}),
  nextAt: Object.freeze({}),
});

/**
 * Repair a stored progress record. localStorage is untrusted input, and a count that is not a
 * count would either throw or, worse, compare as something.
 */
export function repairProgress(stored) {
  const clean = (from, limit) => {
    const out = {};
    for (const id of STAGE_IDS) {
      const n = from?.[id];
      out[id] = Number.isInteger(n) && n >= 0 && n <= limit ? n : 0;
    }
    return out;
  };
  return {
    follows: clean(stored?.follows, COUNT_LIMIT),
    declined: clean(stored?.declined, COUNT_LIMIT),
    // The follow count at which each stage's offer becomes eligible again. A WATERMARK rather
    // than a derived formula: see `declineOffer`. Its own, higher ceiling — see NEXT_AT_LIMIT.
    nextAt: clean(stored?.nextAt, NEXT_AT_LIMIT),
  };
}

/** The follow count at which `id`'s next rung may be offered. One formula, read by everything. */
function offerAt(progress, id) {
  return Math.max(FOLLOWS_TO_OFFER, progress.nextAt?.[id] ?? 0);
}

/**
 * One lesson followed to the end: every stage the solve actually contained gets a mark.
 *
 * `stages` is the set of dial ids the lesson had steps for — read off the solve rather than
 * assumed, because a cube whose cross was already solved taught nothing about the cross and must
 * not count as practice at it.
 */
export function recordCleanFollow(progress, stages) {
  const follows = { ...progress.follows };
  for (const id of STAGE_IDS) {
    // Clamped at the same limit the repair enforces. Past it the count stops rising rather than
    // becoming a number the next load throws away.
    if (stages.includes(id)) follows[id] = Math.min(COUNT_LIMIT, (follows[id] ?? 0) + 1);
  }
  return { ...progress, follows };
}

/**
 * The one offer to make now, or null.
 *
 * ONE, and the lowest stage that qualifies. Offering three rungs at once is a configuration screen
 * again, and the lowest first is the order the stages are met in — a learner who cannot yet plan
 * the cross has no use for full OLL.
 */
export function nextOffer(rungs, progress) {
  for (const id of STAGE_IDS) {
    const at = rungs?.[id] ?? 0;
    if (at >= TOP_RUNG[id]) continue; // nothing above this one yet
    if ((progress.follows?.[id] ?? 0) < offerAt(progress, id)) continue;
    const to = LADDER[id][at + 1];
    return { id, from: at, to: at + 1, label: to.label, blurb: to.blurb };
  }
  return null;
}

/** Accepting raises exactly one dial, and the practice count for it starts again from there. */
export function acceptOffer(rungs, progress, offer) {
  return {
    rungs: { ...rungs, [offer.id]: offer.to },
    progress: {
      follows: { ...progress.follows, [offer.id]: 0 },
      declined: { ...progress.declined, [offer.id]: 0 },
      nextAt: { ...progress.nextAt, [offer.id]: 0 },
    },
  };
}

/**
 * Declining changes nothing but when the offer returns — and it postpones from WHERE THE LEARNER
 * IS, not from the threshold.
 *
 * The difference is not academic. Counting declines and adding them to a fixed threshold means a
 * learner who has quietly built up nine follows and then declines is still over the new threshold
 * of six, so the same offer comes back on the very next solve. "Declining costs nothing" has to
 * mean the offer goes away for a while, and the only way to say that is to record the count it
 * goes away UNTIL.
 */
export function declineOffer(progress, offer) {
  const declined = (progress.declined?.[offer.id] ?? 0) + 1;
  const now = progress.follows?.[offer.id] ?? 0;
  return {
    follows: { ...progress.follows },
    declined: { ...progress.declined, [offer.id]: Math.min(COUNT_LIMIT, declined) },
    // Each decline waits longer than the last, measured from here.
    nextAt: { ...progress.nextAt, [offer.id]: Math.min(NEXT_AT_LIMIT, now + RE_OFFER_GAP * declined) },
  };
}

/** What a stage is called on the ladder — plain words, not CFOP jargon. */
const STAGE_NAME = Object.freeze({
  cross: () => t('Cross'),
  pairs: () => t('First two layers'),
  oll: () => t('Top face'),
  pll: () => t('Last layer'),
});

/**
 * The whole ladder, as the Lessons screen draws it.
 *
 * Every rung of every stage, including the ones this learner has not reached — DESCRIBED, not
 * hidden. `reached` says which ones are behind them, `at` marks where they are, and `blurb` is
 * what the rung above is FOR, which is the whole reason a visible ladder beats a dropdown.
 */
export function ladderRows(rungs, progress = NO_PROGRESS) {
  return STAGE_IDS.map((id) => {
    const at = rungs?.[id] ?? 0;
    return {
      id,
      name: STAGE_NAME[id](),
      at,
      top: TOP_RUNG[id],
      follows: progress.follows?.[id] ?? 0,
      rungs: LADDER[id].map((stage) => ({
        rung: stage.rung,
        label: stage.label,
        blurb: stage.blurb,
        reached: stage.rung <= at,
        current: stage.rung === at,
      })),
    };
  });
}

/**
 * How far a stage is from its next offer, in follows — for the ladder's "not yet" line.
 *
 * Null when there is nothing above. Deliberately a COUNT and not a percentage: "two more solves"
 * is a thing a learner can hold, and a progress bar over a number this small is decoration.
 */
export function followsUntilOffer(rungs, progress, id) {
  const at = rungs?.[id] ?? 0;
  if (at >= TOP_RUNG[id]) return null;
  // `offerAt` and nothing else — when this had its own copy of the threshold formula, the
  // countdown on the Lessons screen could disagree with when the offer actually fired.
  return Math.max(0, offerAt(progress, id) - (progress.follows?.[id] ?? 0));
}
