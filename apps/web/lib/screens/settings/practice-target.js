// The Settings row for "in the fingers": how many clean reps in a row an algorithm needs before the Practice
// screen calls it learnt (owner, 2026-10-17; dev-docs/algorithm-drill-v2-plan.md WI-12).
//
// WHERE IT IS DRAWN follows where Practice is. With the Practice tab shown, the row is an ordinary preference
// in a card of its own; with the tab hidden (the default — Practice earns its tab, ADR 0010) the screen is a
// developer's reach, so the row sits in Advanced beside the switch that shows the tab. One row, one place at a
// time: a setting about a screen nobody can see would be a question with no context.
//
// A STEPPER, not a free field: the target is a small whole number with hard bounds (`FINGERS`), and two
// buttons that stop at the bounds cannot produce a value the repair would then have to change behind the
// person's back. Every press takes the one path a preference takes (`commitPref`).

import { escHtml } from '../../app-state.js';
import { FINGERS, fingersTarget, settings } from '../../app-settings.js';
import { t } from '../../i18n.js';
import { commitPref } from './preferences.js';

/** The row, for the card it is drawn in. */
export function practiceTargetRow({ style = '' } = {}) {
  const n = fingersTarget(settings.fingersN);
  return `<div class="wrap-row" style="justify-content:space-between;${style}">
    <div><div style="font-weight:600">${escHtml(t('In the fingers'))}</div>
      <div class="sub" style="color:var(--ink-4)" id="fingersBlurb">${escHtml(t('An algorithm counts as learnt after %1 clean reps in a row (%2 to %3)', n, FINGERS.min, FINGERS.max))}</div></div>
    <div class="wrap-row" style="gap:6px">
      <button class="pill" id="setFingers-less" type="button" aria-label="${escHtml(t('Fewer clean reps'))}"${n <= FINGERS.min ? ' disabled' : ''}>−</button>
      <span class="num" id="fingersN" role="status" aria-live="polite" style="min-width:2ch;text-align:center">${n}</span>
      <button class="pill" id="setFingers-more" type="button" aria-label="${escHtml(t('More clean reps'))}"${n >= FINGERS.max ? ' disabled' : ''}>+</button>
    </div></div>`;
}

/** Wire the stepper, wherever it was drawn; `show` repaints afterwards. */
export function mountPracticeTarget(root, show) {
  for (const [id, step] of [['#setFingers-less', -1], ['#setFingers-more', 1]]) {
    const b = root.querySelector(id);
    if (!b) continue;
    b.onclick = () => commitPref(b, () => { settings.fingersN = fingersTarget(fingersTarget(settings.fingersN) + step); }, show);
  }
}
