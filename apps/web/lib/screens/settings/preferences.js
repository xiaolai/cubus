// The Settings screen's preferences: the switch a setting is drawn with, and the one path a change
// takes — changed, kept, shown, and said when the browser would not keep it.
//
// Written on 2026-09-14 for two audit findings (2026-09-13): five handlers repeated that path and
// every one ignored a save the browser refused, so a control showed a value a reload would quietly
// take back; and the switch itself was written out six times over.

import { escHtml } from '../../app-state.js';
import { save, settings } from '../../app-settings.js';
import { t } from '../../i18n.js';

const UNSAVED = 'Changed for now, but this browser is refusing to store it — a reload will put it back.';

/** The card whose last preference change the browser would not keep, or null once one was kept.
 *  Module-level, because a change usually repaints the very screen that has to say so. */
let unsavedIn = null;

/** A setting's switch, on the row that names it. `id` is how focus finds the switch again after a
 *  repaint, so a row without one is refused; `attrs` says which setting the switch changes; every
 *  string arrives escaped. */
export const switchRow = ({ id, style, title, blurb, on, attrs, label }) => {
  if (!id) throw new Error(`switchRow: "${label}" has no id, so a repaint would drop focus off it`);
  return `<div style="display:flex;align-items:center;gap:16px;${style}">
          <div style="flex:1"><div style="font-weight:600">${title}</div><div class="sub" style="color:var(--ink-4)">${blurb}</div></div>
          <button class="toggle ${on ? 'on' : ''}" id="${id}" ${attrs} role="switch" aria-checked="${on}" aria-label="${label}"><i></i></button></div>`;
};

/** Where the card named `card` says its last change was not kept: hidden and empty otherwise. */
export const unsavedNote = (card) => {
  const mine = unsavedIn === card;
  return `<div class="sub" data-unsaved="${card}" role="status" style="color:var(--err-ink);padding:8px 0 0"${mine ? '' : ' hidden'}>${mine ? escHtml(t(UNSAVED)) : ''}</div>`;
};

/** Change a preference, keep it, then show it. When the browser would not keep it, the card the
 *  control sits in says so; once a change is kept, no card does. */
export function commitPref(control, change, show) {
  const card = control.closest('.card')?.querySelector('[data-unsaved]')?.dataset.unsaved;
  if (!card) throw new Error('commitPref: this control is in no card that can say a change was not kept');
  change();
  unsavedIn = save('cubusSettings', settings) ? null : card;
  show();
  for (const note of document.querySelectorAll('[data-unsaved]')) {
    const mine = note.dataset.unsaved === unsavedIn;
    note.hidden = !mine;
    note.textContent = mine ? t(UNSAVED) : '';
  }
}
