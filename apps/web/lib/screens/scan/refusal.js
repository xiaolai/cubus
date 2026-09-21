// The scan screen's refusal: whether this screen refused the scan in front of it, what that takes
// away — the Solve button and the chip row — and the words that said why.
//
// Its own unit because three handlers wrote it out by hand — the scanner's refusal, a scan that
// contradicted a tracking cube, and every progress report — and a handler could move one part
// without the others. Two did (found by audit, 2026-09-13): an agreeing scan after a refused one
// was adopted with Solve left off, and the next report replaced "These do not match" with "press
// Solve this cube" over that disabled button. Lifted out of lib/screens/scan.js on 2026-09-14;
// pinned by the refusal cases in test/scan-screen.test.mjs.

import { reportOwnsCard } from './voice.js';

/**
 * The refusal of one mounted scan screen.
 *
 * @param {object} deps `solveBtn`, the screen's "Solve this cube"; `dropStageChips()`, which takes
 *   the chip row away and stops an answer in flight painting over it.
 */
export function createRefusal({ solveBtn, dropStageChips }) {
  let refused = false;
  /** Says a refusal the APP made, again. The scanner's own arrives with its notice on every
   *  report, so there is nothing of it to keep.
   *
   *  ITS LIFE IS NOT THE FLAG'S (2026-09-20). `refused` follows `complete`: it is about the scan
   *  standing complete under the button, and a reading that reopens takes it away. The words are
   *  about what the app SAID, and they stand until they are answered — by the next scan-complete,
   *  accepted or refused (`accept`, `refuse`), or by this screen throwing the scan away
   *  (`restart`). Cleared with the flag, "show those sides again" was said and then overwritten
   *  a tick later by the very reopen it caused — the camera opening on the sides handed back
   *  reports `complete: false` with no notice — so the person read the camera's line and never
   *  the reason (scanner audit 2026-09-20, §2.14). No REPORT clears them, not even one holding
   *  no side: every side handed back to the camera reports exactly as a restart does, and that
   *  is the case the words exist for. The scanner's own refusal arrives as `scan-invalid`, which
   *  refuses with no words and so replaces them. */
  let words = null;

  /** Refuse the scan in front of the screen. `say`, for a refusal the app made, speaks why — now,
   *  and again over every later report until the refusal is lifted. Safe to repeat: the scanner
   *  announces one refusal twice, checking and then counted. */
  const refuse = (say = null) => {
    refused = true;
    words = say;
    solveBtn.disabled = true;
    dropStageChips();
    say?.();
  };

  /** A delivered scan this screen believes: walkable, whatever was refused before it. */
  const accept = () => {
    refused = false;
    words = null;
    solveBtn.disabled = false;
  };

  /** This screen is throwing the scan away — the ↻ button, a notice's "start over" — so a refusal
   *  of it has nothing left to be about. The flag follows the report the restart brings. */
  const restart = () => { words = null; };

  /** A report from the scanner. */
  const fromProgress = (p) => {
    // A scan this screen REFUSED stays refused until there is a new one to judge. The panel
    // reports `complete` on every state change once it has a finished scan — and `complete`
    // deliberately SURVIVES a camera reopen, which is what stops a reopened camera
    // overwriting an accepted scan — so a refusal ("the camera and the cube disagree,
    // nothing was changed") was undone by the very next tick, handing back an enabled Solve
    // button over a cube the screen had just said it did not believe (found by audit,
    // 2026-09-04). The flag is this screen's own, because the panel is right not to carry it:
    // the panel judged the scan legal, and what was refused is what the APP made of it.
    // Cleared by a scan that is no longer complete — a restart, or a capture that reopens the
    // verdict — and by the next accepted scan-complete. The WORDS are not: see their declaration.
    if (!p.complete) refused = false;
    solveBtn.disabled = !p.complete || refused;
    // A scan that is no longer complete — or one this screen refused — has taken its cube back,
    // and numbers about it stop being about anything. Bumping the generation is what stops a
    // search already in flight painting over the row after it has gone.
    //
    // BOTH CONDITIONS, and the second was missing: a refusal arrives with `complete` still
    // standing from the previous accepted scan, so the card stayed on screen and its chips
    // stayed pressable over a cube the screen had just said it did not believe. That is the
    // same defect the Solve button's `refused` flag exists for, one card along, and an audit
    // reproduced it — Solve disabled, the repair card still offering routes.
    if (!p.complete || refused) dropStageChips();
  };

  /** Whether the refusal's words are to be said over `p`: never over a report whose own words own
   *  the card — the scanner's notice, which is about what is happening now, and a camera in
   *  trouble, which the words now outlive (2026-09-20) and which the colour sentence already waits
   *  out for the same reason. The rule is the voice's (`reportOwnsCard`), and this only asks it: it
   *  was written here a second time, and the order the screen spoke in was a third copy
   *  (audit-fix, 2026-09-21). */
  const willSay = (p) => Boolean(words) && !reportOwnsCard(p);

  /** Say a refusal the app made over a report — LAST of everything the screen says over one, so it
   *  stands over the generic caption and the reconnect check's line alike; the voice leaves the
   *  card to it (`paintSay`'s `standing`), so the card is written once per report. True when it
   *  spoke: a colour sentence owed meanwhile then waits for the refusal to be lifted, rather than
   *  being said and spoken over at once. */
  const sayAgain = (p) => {
    if (!willSay(p)) return false;
    words();
    return true;
  };

  return Object.freeze({ refuse, accept, restart, fromProgress, sayAgain, willSay, isRefused: () => refused });
}
