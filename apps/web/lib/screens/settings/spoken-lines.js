// The scan's spoken lines, editable (2026-09-20; the owner asked for the list after finding the
// voice repetitive).
//
// A developer setting, drawn only in ADVANCED, for the same reason the sticker view is: these are
// the words a child hears, and getting them right is a thing you do by listening to a real scan and
// adjusting, not by reading a diff. The defaults and the rules live in lib/screens/scan/spoken.js —
// this file draws them and writes an edit back, and knows nothing about WHEN a line is said.
//
// AN EDIT IS VALIDATED BEFORE IT IS KEPT, and a refused one says why rather than silently reverting.
// `spokenLines()` drops anything it cannot use, so an edit that fails its rules would simply appear
// not to have happened — which is the silent failure this repository refuses everywhere else. The
// rules are asked of the same function that enforces them at speaking time (`accepts`), so this card
// and the voice cannot come to disagree about what a usable line is.

import { escHtml } from '../../app-state.js';
import { settings } from '../../app-settings.js';
import { t } from '../../i18n.js';
import { LINE_LIMIT, SPOKEN, spokenLines } from '../scan/spoken.js';
import { commitPref, unsavedNote } from './preferences.js';

/** What moment each line belongs to. Every key in SPOKEN needs one, or a row would be headed
 *  "undefined" — `spoken-lines.test.mjs` checks the two lists match. */
export const LINE_LABEL = Object.freeze({
  open: 'The camera opens',
  savedMany: 'A side saved, more to go',
  savedOne: 'A side saved, one left',
  lastSaved: 'The last side saved',
  again: 'A side shown that is already in',
  ask: 'A side asked for again',
  done: 'The cube checked out',
  help: 'A scan a grown-up has to rescue',
  camera: 'The camera is not working',
});

/** Why an edit was refused, or null when it is usable. The same rules `spokenLines()` applies, asked
 *  of it rather than restated: a line is accepted exactly when it survives that function. */
export function refuse(key, text) {
  const line = text.trim();
  if (!line) return 'A line cannot be empty. Use Reset to put the original back.';
  if (line.length > LINE_LIMIT) return 'Too long to be heard as a cue — %1 characters at most.';
  if (spokenLines({ [key]: line })[key] !== line) return 'Keep %2 in the line: it is where the number of sides goes.';
  return null;
}

/** The card, or '' where there is nothing to draw. Its own card so `commitPref` has an unsaved note
 *  to point at when the browser refuses to keep an edit. */
export function spokenLinesCard() {
  const lines = spokenLines();
  const rows = Object.keys(SPOKEN).map((key) => {
    const edited = lines[key] !== SPOKEN[key];
    return `<div style="padding:10px 0;border-bottom:1px solid var(--line-faint)">
      <label for="spoken-${key}" style="font-weight:600;display:block">${escHtml(t(LINE_LABEL[key]))}</label>
      <div class="wrap-row" style="gap:6px;margin-top:6px">
        <input class="pill" id="spoken-${key}" data-spoken="${key}" value="${escHtml(lines[key])}"
               maxlength="${LINE_LIMIT}" style="flex:1;min-width:0;text-align:left;font-family:inherit"
               aria-describedby="spokenWhy-${key}" />
        <button class="pill" id="spokenReset-${key}" data-spoken-reset="${key}"${edited ? '' : ' disabled'}>${escHtml(t('Reset'))}</button>
      </div>
      <div class="sub" id="spokenWhy-${key}" role="status" style="color:var(--err-ink);padding:4px 0 0" hidden></div>
    </div>`;
  }).join('');
  return `<div class="card"><div class="eyebrow">SPOKEN LINES</div>
    <div class="sub" style="color:var(--ink-4);margin-top:6px;line-height:1.5">${escHtml(t('What the scan says out loud, where this device has a voice. Edits apply to the next line spoken — no reload. Sounds must be set to Voice to hear them.'))}</div>
    ${rows}
    ${unsavedNote('spoken')}</div>`;
}

/** Wire the card: an edit is kept when it is usable, and refused out loud when it is not. */
export function mountSpokenLines(root) {
  const why = (key) => root.querySelector(`#spokenWhy-${key}`);
  const resetBtn = (key) => root.querySelector(`[data-spoken-reset="${key}"]`);
  const complain = (key, reason) => {
    const el = why(key);
    if (!el) return;
    el.textContent = reason ? t(reason, String(LINE_LIMIT), '%1') : '';
    el.hidden = !reason;
  };
  for (const input of root.querySelectorAll('[data-spoken]')) {
    const key = input.dataset.spoken;
    // `change`, not `input`: a preference written on every keystroke would save a dozen times per
    // sentence and refuse every half-typed one.
    input.onchange = () => {
      const reason = refuse(key, input.value);
      if (reason) { complain(key, reason); return; }
      complain(key, null);
      commitPref(input, () => {
        const line = input.value.trim();
        // The DEFAULT is stored as no edit at all, so a line restored by typing it back stops being
        // an override — otherwise the stored record would grow a copy of every default.
        if (line === SPOKEN[key]) delete settings.spokenLines[key];
        else settings.spokenLines[key] = line;
      }, () => {
        input.value = spokenLines()[key];
        const btn = resetBtn(key);
        if (btn) btn.disabled = !Object.hasOwn(settings.spokenLines, key);
      });
    };
  }
  for (const button of root.querySelectorAll('[data-spoken-reset]')) {
    const key = button.dataset.spokenReset;
    button.onclick = () => commitPref(button, () => { delete settings.spokenLines[key]; }, () => {
      const input = root.querySelector(`[data-spoken="${key}"]`);
      if (input) input.value = SPOKEN[key];
      complain(key, null);
      button.disabled = true;
    });
  }
}
