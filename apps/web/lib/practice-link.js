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
import { caseNameOf } from './method-lesson.js';
import { shell } from './screen-slots.js';
import { library } from './drill/library-client.js';

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

/**
 * Show `button` for `step` when the step names an algorithm the ledger holds, and hide it otherwise.
 *
 * Shown only once the ledger has answered, and only if the button is still about the same step by then: a
 * walk moves on while the worker answers, and an offer that landed on the next step would open practice for
 * an algorithm the screen no longer names. `ids` is injected for tests; the app's is the library worker's.
 */
export function offerPractice(button, step, { ids = () => library.ids() } = {}) {
  if (!button) return;
  const id = practiceIdOf(step);
  button.dataset.practice = id ?? '';
  button.hidden = true;
  if (!id) return;
  ids().then((held) => {
    if (button.dataset.practice !== id || !held.has(id)) return;
    button.textContent = t('Practise %1', caseNameOf(id));
    button.onclick = () => openPractice(id);
    button.hidden = false;
  }, (err) => {
    // Said, never swallowed: the offer simply does not appear, and the console says why.
    console.warn('the algorithm ledger could not be asked which steps can be practised', err);
  });
}
