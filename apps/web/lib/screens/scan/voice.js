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
// it, so the aside is one voice rather than a caption competing with a status line. Written for a
// child's parent (2026-09-18, `dev-docs/scan-guidance-plan.md` §1.2): no model name, and no promise
// that a hold settles the scan — the assembly never prefers the hold a side was shown in, so the
// tile edges are how a side is laid out, and the small cube is how an ask for one is answered.
/** How a misread sticker is fixed — said in the card before a scan and after it, so written once. */
const FIX_A_STICKER = 'Tap or click it and pick the right colour.';
const HOW = `The camera reads the stickers right here — no picture is kept, and none leaves this device. Show the sides in any order, holding each still while the camera reads it. If a side is asked for again, turn the whole cube the way the small cube shows. Got a sticker wrong? ${FIX_A_STICKER}`;
// What to call the aside while the scanner is speaking, so "How it works" never heads an error.
const SAY_TITLE = { error: 'Camera trouble', confirm: 'One more look', checking: 'Checking', done: 'Scanned' };
// What a finished scan says to do next. A constant because the colour sentence must be able to keep
// it: the panel stops the camera BEFORE it reports 'done', so nothing would say it a second time.
const DONE_BODY = `That’s the whole cube, checked and solvable — press "Solve this cube" when you’re ready. Spotted a wrong sticker? ${FIX_A_STICKER} Different cube? Start over with the ↻ button.`;
/** A notice's tone, and a phase's, as the card's class: one table each, so 'err' and 'ok' cannot
 *  come to mean different things in the four places that wrote them by hand (found by audit,
 *  2026-09-13). */
const NOTICE_TONE = Object.freeze({ err: 'err', ok: 'ok' });
const PHASE_TONE = Object.freeze({ error: 'err', checking: 'ok', done: 'ok' });

/** Whether a report's OWN words own the card — the one rule for what the screen may say over a
 *  report (audit-fix, 2026-09-21: it was written here and again in refusal.js, and the order the
 *  screen spoke in was a third copy). The scanner's pinned notice, which is about the scan and
 *  outranks everything the screen has to add, and a camera in trouble, which is about now. Under
 *  those, in order: a refusal the app made and is still saying (refusal.js), the colour sentence a
 *  scan earned, a finished scan's instruction, the generic caption. What a report outranks is KEPT,
 *  never dropped — the colour sentence waits for a card that is free. */
export const reportOwnsCard = (p) => Boolean(p.notice) || p.phase === 'error';

/**
 * The aside of one mounted scan screen.
 *
 * @param {object} deps `root`; `restart()`, the screen's own throwing-away of the scan, which a
 *   notice's action runs (the screen's rather than the scanner's, so a refusal the screen made is
 *   let go with the scan it was about — 2026-09-20); and `closePops()`, which closes the screen's
 *   open popovers before that action acts.
 */
export function createScanVoice({ root, restart, closePops }) {
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
    if (held) {
      held.words = [title, body, tone];
      return;
    }
    write(title, body, tone);
  }
  function write(title, body, tone) {
    sayTitle.textContent = title;
    say.textContent = body;
    say.className = `sub scan-say${tone ? ` ${tone}` : ''}`;
  }
  /**
   * The words spoken while a report is being handled, so the card is written ONCE per report
   * (audit-fix 2026-09-21, finding 25 on verification). Three things may speak to one report —
   * the caption (`paintSay`), the reconnect check's line, a refusal the app is still saying —
   * and each spoke straight into the live region, so a screen reader could hear a caption and then
   * its replacement. Precedence stays exactly the order the screen calls them in: while held, every
   * `speak` merely records, and the release writes the LAST words, once.
   */
  let held = null;
  function holdWords() {
    const mine = { words: null };
    held = mine;
    return () => {
      // Only the hold that took the door releases it — a stale release must not write over a
      // newer report's words.
      if (held !== mine) return;
      held = null;
      if (mine.words) write(...mine.words);
    };
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
   *  until their call sites move to placeholder form — the seam dev-docs/i18n.md tracks.
   *
   *  ONE write to the card per report (audit-fix, 2026-09-21). `standing` says the screen has a
   *  refusal to say over this report (refusal.js, `willSay`): the card is then left to it — it
   *  speaks LAST, after the reconnect check has had its line — where the generic caption used to
   *  be written first and overwritten a moment later, twice into a live region per report. Under
   *  the same rule, `reportOwnsCard`, the colour sentence a scan earned is said here in the
   *  caption's place, and kept while a notice, a camera in trouble or a refusal has the card. */
  const paintSay = (p, { standing = false } = {}) => {
    wireAction(p.notice);
    const n = p.notice;
    if (n) {
      // Translate FIRST, substitute after: a notice carrying a count or a side name keeps its
      // sentence whole in the catalog instead of arriving pre-assembled and untranslatable.
      speak(t(n.title), t(n.body, ...(n.params ?? [])), NOTICE_TONE[n.tone] ?? '');
      // The hint is noise when it just restates the notice (the confirm ask opens the loop
      // with the same sentence the notice carries).
      const dup = !p.message || n.body.includes(p.message);
      hint.textContent = dup ? '' : t(p.message);
      hint.hidden = dup;
      return;
    }
    // With the camera reopened over a finished scan, the camera's own line still matters
    // ("this cube is already scanned…"); otherwise there is nothing to hint about.
    const line = p.complete && p.device && p.message ? t(p.message) : '';
    hint.textContent = line;
    hint.hidden = !line;
    if (!reportOwnsCard(p)) {
      if (standing) return;
      if (schemeNote) {
        sayScheme(p);
        return;
      }
    }
    if (p.complete) {
      // A finished scan answers "what do I do now?", and only this file can: the next action
      // is THIS screen's button. The scanner says the scan is complete; the words naming
      // "Solve this cube" belong to the screen the button lives on.
      speak(t('Scanned'), t(DONE_BODY), 'ok');
      return;
    }
    speak((p.message && t(SAY_TITLE[p.phase] ?? '')) || t('How it works'), t(p.message || HOW), PHASE_TONE[p.phase] ?? '');
  };

  /** The notice's one recommended action, as a button in the same card as the sentence. A refusal
   *  that can name no sticker says "start the scan over"; pointing at the toolbar's ↻ from a
   *  sentence in the aside was the confusion (2026-09-06), so the button is here. */
  const wireAction = (n) => {
    const action = $('#scanAction', root);
    if (!action) return;
    const a = n?.action;
    action.hidden = !a;
    if (!a) return;
    action.textContent = t(a.label);
    action.onclick = () => { closePops(); if (a.kind === 'restart') restart(); };
  };

  /**
   * The one sentence this screen owes when a scan has proved the cube's colours are not what
   * the app assumed. Said once, in the generic caption's place — `paintSay` asks for it under the
   * one rule, so never over the scanner's own pinned notice, which is about the scan and outranks
   * a remark about colours, and never over a refusal the app is still saying.
   */
  const sayScheme = (p) => {
    const colours = t(schemeNote === 'japanese'
      ? 'Your cube has blue under white — the Japanese colours. Nothing to do: the colours on screen now match it, and they will next time too.'
      : 'Your cube has yellow under white — the Western colours. The colours on screen now match it, and they will next time too.');
    // A finished scan's instruction is not a caption to speak over. The panel stops the camera
    // BEFORE it reports 'done', so "press Solve this cube" was replaced by the colour sentence
    // with nothing left to say it again (found by audit, 2026-09-13): on a finished scan the two
    // are said together.
    if (p.complete) speak(t('Scanned'), `${colours} ${t(DONE_BODY)}`, 'ok');
    else speak(t(schemeNote === 'japanese' ? 'Blue under white' : 'Yellow under white'), colours, 'ok');
    schemeNote = null;
  };

  /** A scan MOVED the app's belief about the cube's colours: keep it, to say once the card is
   *  free. */
  const noteScheme = (scheme) => { schemeNote = scheme; };

  return Object.freeze({ speak, paintSay, noteScheme, holdWords });
}
