// The scan screen's aside: the card that says what the scanner needs, and every other title and
// sentence the screen puts there.
//
// Its own unit because it is the screen's VOICE, and the screen spoke in six places, each writing
// the title, the sentence and the tone by hand: the scanner's notices and hints, the colour
// sentence, confirm mode's opening words, the check that a reconnected cube is still yours, a
// repair's verdict, and a scanner that never loaded. The painters live here now, and everything
// else goes through `speak`, which takes words already translated — a call site's t() is where its
// sentence keeps its literal, and where scan-screen.test.mjs's guard reads it. Lifted out of
// lib/screens/scan.js on 2026-09-13; pinned by the aside cases in test/scan-screen.test.mjs and
// the reconnect words in test/reconnect-flow.test.mjs.

import { $ } from '../../app-state.js';
import { t } from '../../i18n.js';

// Shown when the scanner is not saying anything more specific. The scan's own messages replace
// it, so the aside is one voice rather than a caption competing with a status line.
const HOW = 'The camera opens with this screen and the YOLO scanner reads the stickers on device — no picture is kept, and none leaves it. Show the sides in any order; each is captured as soon as it holds still. Each tile is edged in the colours of its neighbours: hold a side that way up and the scan needs nothing more from you. Got a sticker wrong? Click it and pick the right colour.';
// What to call the aside while the scanner is speaking, so "How it works" never heads an error.
const SAY_TITLE = { error: 'Camera trouble', confirm: 'One more look', checking: 'Checking', done: 'Scanned' };

/**
 * The aside of one mounted scan screen.
 *
 * @param {object} deps `root`; the scanner `panel`, whose restart a notice's action runs; and
 *   `closePops()`, which closes the screen's open popovers before that action acts.
 */
export function createScanVoice({ root, panel, closePops }) {
  const say = $('#scanHow', root), sayTitle = $('#scanHowTitle', root), hint = $('#scanHint', root);
  /** Set when a scan MOVED the app's belief about this cube's colours, so the screen can say
   *  so once. Null the rest of the time — including when a scan merely confirms it. */
  let schemeNote = null;

  /**
   * A title and a sentence for the card, in a tone: '' (plain), 'ok' or 'err'. Both arrive
   * already translated: a call site's t() is where its sentence keeps its literal, and where
   * the guard in scan-screen.test.mjs reads it.
   */
  function speak(title, body, tone = '') {
    sayTitle.textContent = title;
    say.textContent = body;
    say.className = `sub scan-say${tone ? ` ${tone}` : ''}`;
  }
  /** The two voices of the scan, and the only thing this writes: a pinned notice (what the
   *  scanner needs and why — it stands until the situation changes) and the transient camera
   *  hint. Lifted out of the scan-progress handler (2026-09-05), which had grown to hold four
   *  unrelated jobs; this one is the words, and it touches nothing but the three elements
   *  that carry them.
   *
   *  The hint used to overwrite the explanation within one tick, which made every refusal
   *  look like a silent crash. The scanner's prose passes through t(): its sentences are
   *  exact English strings, so a catalog can translate them here without the scanner package
   *  knowing languages exist. Sentences with colour words baked in pass through untranslated
   *  until their call sites move to placeholder form — the seam dev-docs/i18n.md tracks. */
  const paintSay = (p) => {
    const n = p.notice;
    // The notice's one recommended action, as a button in the same card as the sentence. A
    // refusal that can name no sticker says "start the scan over"; pointing at the toolbar's
    // ↻ from a sentence in the aside was the confusion (2026-09-06), so the button is here.
    const action = $('#scanAction', root);
    if (action) {
      const a = n?.action;
      action.hidden = !a;
      if (a) {
        action.textContent = t(a.label);
        action.onclick = () => { closePops(); if (a.kind === 'restart') panel.restart?.(); };
      }
    }
    if (n) {
      sayTitle.textContent = t(n.title);
      // Translate FIRST, substitute after: a notice carrying a count or a side name keeps its
      // sentence whole in the catalog instead of arriving pre-assembled and untranslatable.
      say.textContent = t(n.body, ...(n.params ?? []));
      say.className = 'sub scan-say' + (n.tone === 'err' ? ' err' : n.tone === 'ok' ? ' ok' : '');
      // The hint is noise when it just restates the notice (the confirm ask opens the loop
      // with the same sentence the notice carries).
      const dup = !p.message || n.body.includes(p.message);
      hint.textContent = dup ? '' : t(p.message);
      hint.hidden = dup;
    } else if (p.complete) {
      // A finished scan answers "what do I do now?", and only this file can: the next action
      // is THIS screen's button. The scanner says the scan is complete; the words naming
      // "Solve this cube" belong to the screen the button lives on.
      sayTitle.textContent = t('Scanned');
      say.textContent = t('That’s the whole cube, checked and solvable — press "Solve this cube" when you’re ready. Spotted a wrong sticker? Click it and pick the right colour. Different cube? Start over with the ↻ button.');
      say.className = 'sub scan-say ok';
      // With the camera reopened over a finished scan, the camera's own line still matters
      // ("this cube is already scanned…"); with it off there is nothing to hint about.
      hint.textContent = p.device && p.message ? t(p.message) : '';
      hint.hidden = !hint.textContent;
    } else {
      say.textContent = t(p.message || HOW);
      sayTitle.textContent = (p.message && t(SAY_TITLE[p.phase] ?? '')) || t('How it works');
      say.className = 'sub scan-say' + (p.phase === 'error' ? ' err' : p.phase === 'checking' || p.phase === 'done' ? ' ok' : '');
      hint.textContent = '';
      hint.hidden = true;
    }
  };

  /**
   * The one sentence this screen owes when a scan has proved the cube's colours are not what
   * the app assumed. Said once, over the generic caption only — never over the scanner's own
   * pinned notice, which is about the scan and outranks a remark about colours.
   */
  const sayScheme = (p) => {
    if (!schemeNote || p.notice || p.phase === 'error') return;
    sayTitle.textContent = t(schemeNote === 'japanese' ? 'Blue under white' : 'Yellow under white');
    say.textContent = t(schemeNote === 'japanese'
      ? 'Your cube has blue under white — the Japanese colours, common on older cubes. Nothing to do: the colours on screen now match it, and they will next time too.'
      : 'Your cube has yellow under white — the usual colours. The colours on screen now match it, and they will next time too.');
    say.className = 'sub scan-say ok';
    schemeNote = null;
  };

  /** A scan MOVED the app's belief about the cube's colours: keep it, to say once the card is
   *  free. */
  const noteScheme = (scheme) => { schemeNote = scheme; };

  return Object.freeze({ speak, paintSay, sayScheme, noteScheme });
}
