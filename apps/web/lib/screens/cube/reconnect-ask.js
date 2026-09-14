// The cube screen's reconnect question: the heading the state card wears while a reconnected
// cube's remembered arrangement is on show, the question itself, and putting it back into the
// sheet of a screen already standing when it opens, changes or closes.
//
// Lifted out of lib/screens/cube.js on 2026-09-14. Pinned by test/reconnect-flow.test.mjs, which
// meets the question the way a returning user does.

import { SOLVED, escHtml, state } from '../../app-state.js';
import { whenWords } from '../../cube-memory.js';
import { wireReconnectAnswers } from '../../reconnect-answer.js';

/**
 * The reconnect question of one cube screen.
 *
 * @param {object} deps `scrambling`, which end of the walk the screen is.
 * @returns {object} `rcNow()`, the open question or null; `stateHeading()`; `reconnectAsk()`, the
 *   question as markup, or '' while there is none; and `sync(root)`, which puts it — or its
 *   absence — into the sheet of the screen at `root`.
 */
export function createReconnectAsk({ scrambling }) {
  // The open reconnect question, on the solve side only — Scramble's subject is always the
  // generated walk. The unconfirmed DRESS (the twin's heading) is worn only while the subject IS
  // the candidate; the question itself stands as long as it is open, because it is about the
  // cube, not about whatever the screen happens to show.
  // Read through a FUNCTION, not captured: this screen retargets in place now (see `update` in
  // lib/screens/cube.js), so a question that opens or closes has to be able to change the heading
  // and the ask on a screen that is not being rebuilt. A const here would freeze both at first
  // render.
  const rcNow = () => (scrambling ? null : state.reconnect);
  const stateHeading = () => {
    const rc = rcNow();
    const rcDress = Boolean(rc?.candidate && state.cube.facelets === rc.candidate);
    if (scrambling) return 'Target State';
    if (!rcDress) return 'Initial State';
    if (rc.reading === 'turned') return 'Your cube — as it reports it';
    const when = whenWords(rc.seenAt).full;
    return `Your cube — as we last saw it${when ? `, ${when}` : ''}`;
  };
  // The question: at the top of the sheet, ABOVE the moves, not instead of them — a disconnect or
  // a reconnect must not wipe the guide (the floor never rises), so the walk of the candidate
  // stays walkable while the answer is open, and trust gates what it gates today: Follow.
  const reconnectAsk = () => {
    const rc = rcNow();
    if (!rc) return '';
    const when = whenWords(rc.seenAt);
    let ask = '';
    let sub = '';
    if (rc.reading === 'no-report') {
      ask = 'Your cube hasn’t said where it is.';
      sub = rc.candidate
        ? `It’s connected but hasn’t reported an arrangement — this is how we last saw it${when.full ? `, ${when.full}` : ''}.`
        : 'It’s connected but hasn’t reported an arrangement. The camera can read it as it is.';
    } else if (rc.reading === 'turned') {
      ask = `Your cube says it has been turned since${when.day ? ` ${when.day}` : ''} — is this it now?`;
    } else {
      ask = rc.candidate === SOLVED ? 'Is it solved right now?' : 'Is this your cube right now?';
      sub = `As we last saw it${when.full ? `, ${when.full}` : ''}.`;
    }
    // Yes needs a report to derive the correction from; a silent cube leaves the camera as the
    // only door. No reading grants trust — these two buttons are how the user does.
    const yes = rc.raw && rc.candidate
      ? '<button class="btn sm primary" data-reconnect="yes">Yes, that’s it</button>' : '';
    return `<div class="follow-note reconnect-ask" id="reconnectAsk" style="border-top:0">
      <b>${escHtml(ask)}</b>${sub ? `<span class="sub" style="color:var(--ink-4)">${escHtml(sub)}</span>` : ''}
      <div class="acts">${yes}<button class="btn sm outline" data-reconnect="scan">Check with the camera</button></div>
    </div>`;
  };
  /** Put the open question — or its absence — into the sheet of a screen already standing.
   *  A question opening or closing used to be a reason to rebuild the whole screen, which on
   *  a walking one threw away the walk to change a paragraph above it. Replaces the node in
   *  place rather than wrapping it, so no stylesheet rule learns a new box. */
  const sync = (root) => {
    const card = root.querySelector('.solution-card');
    if (!card) return;
    const showing = card.querySelector(':scope > .reconnect-ask');
    const html = reconnectAsk();
    if (!html) { showing?.remove(); return; }
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const asked = holder.firstElementChild;
    if (showing) showing.replaceWith(asked); else card.prepend(asked);
    wireReconnectAnswers(root);
  };
  return Object.freeze({ rcNow, stateHeading, reconnectAsk, sync });
}
