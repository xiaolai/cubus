// The way from a lesson to practice: a step that names an algorithm the ledger holds offers "practise this",
// and the press opens the Practice screen on that row (dev-docs/algorithm-drill-v2-plan.md §4).
//
// A service beneath the screens: it reaches the shell through `shell` and the app's state through `state`,
// never a screen. The cube screen's presenter calls `offerPractice` as it describes each step.
//
// ONLY FOR IDS THE LEDGER HAS, and asked of the ledger. A step's `caseName` is the solver's identifier for the
// algorithm it makes — the very id the ledger keys its row by — but not every named step is an algorithm
// (`align` and `turn` are named steps with no moves, which the ledger files as "not an algorithm"), and a
// generated case (`oll:1a2b…`) has no name a learner would know. So the offer waits for the ledger's own ids
// (`library.ids()`, answered on its worker) rather than trusting a list typed here.

import { state } from './app-state.js';
import { t } from './i18n.js';
import { NAMEABLE_IDS, caseNameOf } from './method-lesson.js';
import { shell } from './screen-slots.js';
import { library } from './drill/library-client.js';

/** The button's words, as English source (looked up through `t()` where they are shown): one table, read by the offer
 *  below and by `practiseLabels`, which the band over the cube card in portrait is sized by (E12.8). */
export const PRACTISE_SAYS = Object.freeze({
  offer: 'Practise %1',
  unchecked: 'Practice could not be checked — try again',
});

/**
 * EVERY label the button can carry: the offer with every name a step can show, and the label for a ledger that could not
 * be asked. All of them, never the widest: the band is sized by the TALLEST as it is laid out at its own width and font
 * (lib/foot-band.js), and a wider label is not always a taller one — words wrap where they break, so in the Split View
 * column with the band narrowed "Practise OLL 5 · Right back wide antisune (RBWAS)" took 175 px against the widest
 * label's 160 (geometry's "every candidate", 2026-10-20). Known AT ONCE, never asked of the ledger: a step offers only an
 * id the ledger holds AND `caseNameOf` names, so the names `caseNameOf` can give (`NAMEABLE_IDS`) bound every offer.
 * Asked of the ledger, the list came when the library worker answered, and the band sized by it grew its reserve after
 * the walk was drawn — the cube shrank under the child's eyes (test/browser/geometry.test.mjs, "the band's room is sized
 * before the ledger answers").
 *
 * @returns {string[]}
 */
export function practiseLabels() {
  return [...new Set(NAMEABLE_IDS.map((id) => t(PRACTISE_SAYS.offer, caseNameOf(id)))), t(PRACTISE_SAYS.unchecked)];
}

/** The id of the algorithm a lesson step makes, or null for a step that names none (a search, a step made of
 *  parts, an unnamed generated case). */
export function practiceIdOf(step) {
  if (!step || step.kind !== 'case' || typeof step.caseName !== 'string' || step.parts) return null;
  return caseNameOf(step.caseName) === null ? null : step.caseName;
}

/** Open the Practice screen on ledger row `id`. */
export function openPractice(id) {
  state.practiceMix = null;
  state.practiceAlg = id;
  shell.go('practice');
}

/**
 * Open the Practice page MIXING over a library stage's rows (dev-docs/practice-redesign-plan.md D2, WI-8): on the first
 * of `order` — the round the record ordered, weakest first (`mixOrder` in lib/drill/mix.js) — with every later round
 * ordered over `ids` again. The page takes the request once, as it opens.
 *
 * @param {ReadonlyArray<string>} ids  the stage's rows
 * @param {ReadonlyArray<string>} order  the first round: every one of `ids`, once
 */
export function openMixed(ids, order) {
  if (!order.length || order.length !== ids.length || order.some((id) => !ids.includes(id))) {
    throw new Error('practice-link: a mixed round is every row of its stage, once');
  }
  state.practiceMix = Object.freeze({ ids: Object.freeze([...ids]), order: Object.freeze([...order]) });
  state.practiceAlg = order[0];
  shell.renderScreen();
}

/** Back from a Practice page to its library (dev-docs/practice-redesign-plan.md E11.1): the way in and the way out
 *  are written here, in one place. */
export function openLibrary() {
  state.practiceMix = null;
  state.practiceAlg = null;
  shell.renderScreen();
}

/**
 * Show `button` for `step` when the step names an algorithm the ledger holds, and hide it otherwise.
 *
 * Shown only once the ledger has answered, and only if the button is still about the same step by then: a
 * walk moves on while the worker answers, and an offer that landed on the next step would open practice for
 * an algorithm the screen no longer names. `ids` is injected for tests; the app's is the library worker's.
 *
 * A LEDGER THAT CANNOT BE ASKED IS SAID, where the offer would have been: the button says practice could not be
 * checked, carries the reason in its name, and a press asks again. Left hidden, the failure looked exactly like a
 * step with nothing to practise, and only the console knew otherwise.
 */
export function offerPractice(button, step, { ids = () => library.ids() } = {}) {
  if (!button) return;
  const id = practiceIdOf(step);
  button.dataset.practice = id ?? '';
  button.hidden = true;
  button.removeAttribute('aria-label');
  if (!id) return;
  ids().then((held) => {
    if (button.dataset.practice !== id || !held.has(id)) return;
    button.textContent = t(PRACTISE_SAYS.offer, caseNameOf(id));
    button.onclick = () => openPractice(id);
    button.hidden = false;
  }, (err) => {
    if (button.dataset.practice !== id) return;
    console.error('the algorithm ledger could not be asked which steps can be practised', err);
    const why = err?.message ?? String(err);
    button.textContent = t(PRACTISE_SAYS.unchecked);
    button.setAttribute('aria-label', t('Practice could not be checked (%1). Press to try again.', why));
    button.onclick = () => offerPractice(button, step, { ids });
    button.hidden = false;
  });
}
