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
 * Every label the button can carry at its LONGEST: the offer with whichever name a step can show is widest by `widthOf`
 * (ties kept), and the label for a ledger that could not be asked. Known AT ONCE, never asked of the ledger: a step offers
 * only an id the ledger holds AND `caseNameOf` names, so the names `caseNameOf` can give (`NAMEABLE_IDS`) bound every offer.
 * Asked of the ledger, the list came when the library worker answered, and the band sized by it grew its reserve after
 * the walk was drawn — the cube shrank under the child's eyes (test/browser/geometry.test.mjs, "the band's room is sized
 * before the ledger answers").
 *
 * @param {{ widthOf?: (text: string) => number }} [o]
 * @returns {string[]}
 */
export function practiseLabels({ widthOf = (text) => text.length } = {}) {
  const offers = NAMEABLE_IDS.map((id) => t(PRACTISE_SAYS.offer, caseNameOf(id)));
  const most = Math.max(...offers.map(widthOf));
  return [...new Set(offers.filter((o) => widthOf(o) === most)), t(PRACTISE_SAYS.unchecked)];
}

/** The id of the algorithm a lesson step makes, or null for a step that names none (a search, a step made of
 *  parts, an unnamed generated case). */
export function practiceIdOf(step) {
  if (!step || step.kind !== 'case' || typeof step.caseName !== 'string' || step.parts) return null;
  return caseNameOf(step.caseName) === null ? null : step.caseName;
}

/** Open the Practice screen on ledger row `id`. */
export function openPractice(id) {
  state.practiceAlg = id;
  shell.go('practice');
}

/** Back from a Practice page to its library (dev-docs/practice-redesign-plan.md E11.1): the way in and the way out
 *  are written here, in one place. */
export function openLibrary() {
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
