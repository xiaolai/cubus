// The scan screen's two-side reconnect check: when a smart cube reconnects with a remembered
// arrangement, the scan opens in confirm mode, and two adjacent sides that match what the camera
// should see now take the user's Yes without a full scan.
//
// Its own unit because it answers a question about the user's cube, not about the scan: it
// compares captured sides with a prediction, grants the Yes through the same door Home uses, and
// says what it found. The screen hands it each scan report, closes it when a finished scan answers
// the question outright, and asks whether the scan came in as a confirmation. When each side was
// read is the screen's capture record (lib/screens/scan/capture-record.js). Lifted out of
// lib/screens/scan.js on 2026-09-13; pinned by the scanner cases in test/reconnect-flow.test.mjs.

import { state } from '../../app-state.js';
import { applyOffset, deriveOffset } from '../../cube-trust.js';
import { confirmCheck } from '../../cube-reconnect.js';
import { reportIsCurrent } from '../../cube-reports.js';
import { t } from '../../i18n.js';
import { conn } from '../../live-session.js';
import { confirmReconnect } from '../../reconnect-answer.js';
import { isColour, positionOf } from '../../scheme.js';
import { Cube } from '../../solver-service.js';
import { reportOwnsCard } from './voice.js';

/**
 * The reconnect check of one mounted scan screen — in confirm mode from the start when a reconnect
 * question is open.
 *
 * @param {object} deps `speak`, the aside's door; `tileOf(slot)` and `tileSchemeNow()`, which
 *   translate a capture from its colour to the position it sits at; `go`, for a Yes taken;
 *   `captures`, the screen's record of when each side was read; and `rescan(slot)`, which hands a
 *   side back to the scanner to be read again.
 */
export function createReconnectCheck({ speak, tileOf, tileSchemeNow, go, captures, rescan }) {
  // The reconnect confirmation runs INSIDE this screen's own flow, not beside it: the panel's
  // captures are private to it and die with it, so "the repair scan continues from the sides
  // already captured" is true only if the confirmation IS this screen in a confirm mode. Two
  // adjacent matching sides take the user's Yes; one mismatch and the same panel instance
  // simply keeps capturing into the full six-side repair, two sides in.
  let confirming = Boolean(state.reconnect?.candidate);
  const confirmEntry = confirming;
  /** The connection the question belongs to, captured with it. `confirming` belongs to this screen,
   *  and a connection can end and another begin while the screen stands. */
  const askedOver = conn;
  /**
   * What the camera should see NOW if the remembered arrangement is right.
   *
   * NOT the frozen candidate, which is what this compared against and is wrong the moment
   * anybody turns the cube: the question is asked on reconnect, the check happens seconds
   * later with the cube in a hand, and a single quarter turn in between made every side
   * mismatch — a false "not what we remembered" that cost the user a full six-side scan
   * (found by audit, 2026-09-04).
   *
   * The candidate carried forward by whatever the cube has reported since. If the candidate
   * is right then `candidate · raw⁻¹` is the correction, it is constant under later turns
   * (cube-trust.js), and applying it to the LATEST report says where the cube is now. This is
   * a PREDICTION to compare a scan against, not a correction being adopted — which is why it
   * derives here instead of going through the session's checker, whose business is evidence.
   * With nothing to carry forward it is the candidate, exactly as before.
   */
  const expectedNow = () => {
    const rc = state.reconnect;
    if (!rc?.candidate) return null;
    if (!rc.raw || !state.reported || state.reported === rc.raw) return rc.candidate;
    const off = deriveOffset(rc.candidate, rc.raw, Cube);
    return (off && applyOffset(off, state.reported, Cube)) || rc.candidate;
  };
  const CONFIRM_HOW = 'We remember this cube. Show any two sides that meet along an edge — the front, then the top, for example. If both match what we remember, that’s your cube confirmed with no full scan; if either differs, keep going and the camera reads all six.';
  if (confirming) {
    speak(t('Checking your cube'), t(CONFIRM_HOW));
  }

  /** The captured sides this check may judge, as positions: all but those read before the report
   *  in force, and none whose IDENTITY was derived rather than measured.
   *
   *  WHY AN ASSIGNED SIDE CANNOT SPOT-CHECK A CUBE (`dev-docs/asking-which-side-plan.md` §4). This
   *  check grants the user's Yes on TWO adjacent sides matching a prediction — it never reaches
   *  whole-cube legality, so the only thing standing between it and the wrong cube is that each
   *  side it compares is the side it says it is. A capture filed by elimination, by a ring match or
   *  by a person answering which side it is has a centre DERIVED from the slot: it says "this is
   *  the R side" because something decided so, not because anything read its middle sticker.
   *  Measured on `D' F' B D2 L2 U2` with the shown L filed as R: `confirmed` when the assigned
   *  capture is judged, `mismatch` when its measured identity is kept, `pending` when it is left
   *  out — and `pending` is the honest one, because the evidence for it was never gathered. It is
   *  dropped rather than handed back to the camera: there is nothing stale about it, and the sides
   *  `readAgain` takes back are the ones the cube has spoken since.
   *
   *  The remembered state is positional, so both halves of each side are translated out of colour:
   *  which position the capture sits at, and which position each sticker colour belongs to. */
  const judgeable = (captured, readBefore) => captured
    .filter((c) => c.by !== 'assigned' && !readBefore.includes(c.face))
    .map((c) => ({
      face: tileOf(c.face),
      stickers: c.colors.map((ci) => (isColour(ci) ? positionOf(ci, tileSchemeNow()) : '?')).join(''),
    }));

  /** Hand sides back to the scanner to be read again. Words alone cannot ask for one: the scanner
   *  never reads a side it already holds, and answers a side shown again with "Already have". */
  const readAgain = (slots) => {
    for (const slot of slots) rescan(slot);
  };

  /** What the check says once the Yes has not been taken — the verdict, the sides it wants again,
   *  and the whole-cube scan it hands over to. Its own body because everything before it weighs
   *  evidence and this is only words: the split the audit asked for (row 59, 2026-09-13), and each
   *  branch is a title a case in test/reconnect-flow.test.mjs reads. */
  const sayWhereItStands = (check, readBefore, p) => {
    if (check.verdict === 'confirmed') {
      // Refused — the derivation could not do its job. The scan is already running, so the full
      // read is the honest continuation, and this says so.
      speak(t('Keep going'), t('The match could not be taken as an answer, so the camera will read the whole cube instead — keep showing sides, the ones already read still count unless the cube was turned after they were read.'));
    } else if (check.verdict === 'mismatch') {
      speak(t('Not what we remembered'), t('That side is not what we remembered, so the camera will read the whole cube instead. Keep showing sides — the ones already read still count, unless the cube was turned after they were read.'));
    } else if (check.matched.length) {
      speak(t('One more side'), t('That side matches. Now show one that touches it along an edge — two neighbouring sides are what the check needs.'), 'ok');
    } else if (readBefore.length) {
      // Not "the cube has been turned since", which the waiting branch says and this one cannot: a
      // side read while the report was a turn behind is read AFTER that turn, and the report
      // catching up is what leaves it behind the cube's latest word. The one thing true of every
      // side in this list is that it was read before that word.
      speak(t('Show that side again'), t('That side was read before your cube last reported where it is, so the check needs to see it again.'));
    } else if (!p.captured.length && !p.message) {
      speak(t('Checking your cube'), t(CONFIRM_HOW));
    }
  };

  /** The two-side reconnect check, folded into a running scan. Its own job, lifted out of the
   *  scan-progress handler along with the words (2026-09-05): the handler was writing status
   *  messages, painting stickers, discovering cameras and answering a question about the
   *  user's cube, all in one body. Called LAST, for the reason its own comment gives. */
  const answerFromSides = (p) => {
    // Nothing to answer: the check has ended, the question has closed — a disconnect closes it —
    // or the scanner's own notice or a camera error has the card. Last, so its words stand over
    // the generic caption, but never over the scanner's pinned notice — and "the report owns the
    // card" is the voice module's ONE rule, asked here rather than restated (2026-09-21; a third
    // copy of it was what let the two drift).
    if (!confirming || !state.reconnect?.candidate || reportOwnsCard(p)) return;
    // A DIFFERENT CONNECTION IS A DIFFERENT QUESTION. A reconnect opens a new one while this
    // screen and the sides the panel holds both stand — and sides read against the old cube's
    // memory took the new cube's Yes with no fresh look at all (found by audit, 2026-09-13). They
    // go back to the camera, so the scan that goes on is of the cube that reconnected.
    if (conn !== askedOver) {
      confirming = false;
      readAgain(captures.readBeforeConnection());
      speak(t('Keep going'), t('The cube reconnected, so the sides already read cannot answer for it — the camera will read the whole cube instead.'));
      return;
    }
    // ---- reconnect confirmation ----------------------------------------------------------
    // Each captured side is compared with the candidate — by its centre colour (the scanner
    // names a side by its centre, the one sticker a turn cannot move), up to rotation, and
    // EXACTLY: the scanner's own two-sticker tolerance is one short of a quarter turn's
    // three, so here a misread costs a full scan and never a false yes.
    //
    // Only a side read at the report in force is judged. Its stickers say where the cube was when
    // it was read, and `expectedNow()` moves with every report since, so a side read before a
    // tracked turn was judged against the cube after it — a mismatch that ended the check for good
    // and cost a six-side scan (found by audit, 2026-09-13).
    const readBefore = captures.readBeforeReport();
    // Nothing at all may be judged while the cube has counted a turn its reports have not caught up
    // with. `expectedNow()` is built on the report in force, so in that second it predicts the cube
    // BEFORE the turn: a side read after it — a good read of the cube as it is — was called "not
    // what we remembered", which ends the check for good and costs a six-side scan (found by
    // verification, 2026-09-14). The check waits for the cube to say where it landed; the sides
    // read before the turn still go back to the camera, being of the cube before it.
    if (!reportIsCurrent()) {
      readAgain(readBefore);
      if (readBefore.length) speak(t('Show that side again'), t('The cube has been turned since that side was read, so the check needs to see it again.'));
      else speak(t('Checking your cube'), t('The cube was turned just now, so the check is waiting for it to say where it landed.'));
      return;
    }
    const check = confirmCheck(expectedNow(), judgeable(p.captured, readBefore), Cube);
    // A verdict ends the check.
    if (check.verdict !== 'pending') confirming = false;
    // The user's Yes, well founded and taken: same derivation, same trust, same words a Yes on
    // Home earns — and back to the screen the question was asked on.
    if (check.verdict === 'confirmed' && confirmReconnect()) {
      go('home');
      return;
    }
    // Whatever follows — the check going on, or the whole-cube scan it hands over to — a side read
    // before the report in force goes back to the camera: kept past a verdict, it went into the
    // whole-cube scan (found by verification, 2026-09-14). Before the words, because the scanner
    // reports the side it dropped at once, and its words would otherwise stand over these.
    readAgain(readBefore);
    sayWhereItStands(check, readBefore, p);
  };

  /** A finished scan answers the question outright: the check has nothing left to ask. */
  const close = () => { confirming = false; };
  /** Whether this scan came in as a reconnect confirmation, which goes back to the question once
   *  a scan is believed. */
  const cameAsConfirmation = () => confirmEntry;

  return Object.freeze({ answerFromSides, close, cameAsConfirmation });
}
