// The scan screen's refusal: whether this screen refused the scan in front of it, what that takes
// away — the Solve button and the chip row — and the words that said why.
//
// Its own unit because three handlers wrote it out by hand — the scanner's refusal, a scan that
// contradicted a tracking cube, and every progress report — and a handler could move one part
// without the others. Two did (found by audit, 2026-09-13): an agreeing scan after a refused one
// was adopted with Solve left off, and the next report replaced "These do not match" with "press
// Solve this cube" over that disabled button. Lifted out of lib/screens/scan.js on 2026-09-14;
// pinned by the refusal cases in test/scan-screen.test.mjs.

/**
 * The refusal of one mounted scan screen.
 *
 * @param {object} deps `solveBtn`, the screen's "Solve this cube"; `dropStageChips()`, which takes
 *   the chip row away and stops an answer in flight painting over it.
 */
export function createRefusal({ solveBtn, dropStageChips }) {
  let refused = false;
  /** Says a refusal the APP made, again. The scanner's own arrives with its notice on every
   *  report, so there is nothing of it to keep. */
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
    // verdict — and by the next accepted scan-complete.
    if (!p.complete) { refused = false; words = null; }
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

  /** Say a refusal the app made over a report's generic caption, never over the scanner's notice,
   *  which is about what is happening now. True when it spoke: a colour sentence owed meanwhile
   *  then waits for the refusal to be lifted, rather than being said and spoken over at once. */
  const sayAgain = (p) => {
    if (!words || p.notice) return false;
    words();
    return true;
  };

  return Object.freeze({ refuse, accept, fromProgress, sayAgain, isRefused: () => refused });
}
