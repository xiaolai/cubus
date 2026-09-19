// The scan screen's sounds: a chime for each side saved, and a different one when the cube checks out
// (2026-09-19, dev-docs/scan-guidance-plan.md 3.2).
//
// Each is tied to the moment it names and to nothing it could be confused with. A side saved is the
// scanner's `scan-capture` event, dispatched once per accepted capture — never a read settling (which
// can still be refused) and never a count going up (which a re-read does not do). The cube checking
// out is the SCREEN accepting the scan (`accepted`) — never six tiles filling, and not the scanner's
// `complete` either, because the screen can still refuse a finished scan.
// Leaving the screen silences whatever is still sounding, so no chime outlives the scan it was for, and
// so does the scan being reopened: a correction after the cube checked out ends what that sound said.
// The one exception is that sound itself: an accepted scan can leave the screen at once (auto-solve, or a
// scan made to answer a reconnect question), and the cube it announces goes with it, so it finishes.

import { play, stopAll } from '../../sound.js';
import { sidesIn } from './report-sides.js';

/**
 * @param {object} deps `panel`, the scanner element whose events are heard; `signal`, the screen's
 *   abort signal, which removes the listeners and silences what is still sounding.
 */
export function createScanChime({ panel: scanner, signal }) {
  // Sides held at the last report — ALL of them (`sides`), since the named list shrinks when two
  // sides claim one centre. Fewer now is a scan thrown away — the toolbar's button or a notice's
  // "Start over", both of which restart the scanner — and nothing of it may still sound.
  let held = 0;
  // Whether the "checked out" sound stands: from the screen's acceptance until a report reopens the
  // scan (a sticker corrected, a side read again), which ends it mid-sound (round-3 audit).
  let accepted = false;
  scanner.addEventListener('scan-capture', () => { play('capture'); }, { signal });
  scanner.addEventListener('scan-progress', (e) => {
    const sides = sidesIn(e.detail);
    const reopened = accepted && !e.detail.complete;
    if (sides < held || reopened) stopAll();
    if (reopened) accepted = false;
    held = sides;
  }, { signal });
  // Left after the cube checked out, the checked-out sound plays on: what it says is still true on the
  // screen the app went to, and cutting it at the jump meant a child on auto-solve never heard it
  // (round-3 audit). The scan had nothing else left to sound.
  signal?.addEventListener('abort', () => { if (!accepted) stopAll(); }, { once: true });
  /** The screen accepted a finished scan: the second sound. Not the scanner's `complete` — the screen
   *  can still refuse a finished scan, and a "checked out" sound over a disabled Solve button is
   *  false (audit, 2026-09-19). */
  return Object.freeze({ accepted: () => { accepted = true; play('done'); } });
}
