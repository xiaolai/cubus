// The scan screen's two-side reconnect check: when a smart cube reconnects with a remembered
// arrangement, the scan opens in confirm mode, and two adjacent sides that match what the camera
// should see now take the user's Yes without a full scan.
//
// Its own unit because it answers a question about the user's cube, not about the scan: it
// compares captured sides with a prediction, grants the Yes through the same door Home uses, and
// says what it found. The screen hands it each scan report, closes it when a finished scan answers
// the question outright, and asks whether the scan came in as a confirmation. Lifted out of
// lib/screens/scan.js on 2026-09-13; pinned by the scanner cases in test/reconnect-flow.test.mjs.

import { state } from '../../app-state.js';
import { applyOffset, deriveOffset } from '../../cube-trust.js';
import { confirmCheck } from '../../cube-reconnect.js';
import { t } from '../../i18n.js';
import { confirmReconnect } from '../../reconnect-answer.js';
import { isColour, positionOf } from '../../scheme.js';
import { Cube } from '../../solver-service.js';

/**
 * The reconnect check of one mounted scan screen — in confirm mode from the start when a reconnect
 * question is open.
 *
 * @param {object} deps `speak`, the aside's door; `tileOf(slot)` and `tileSchemeNow()`, which
 *   translate a capture from its colour to the position it sits at; and `go`, for a Yes taken.
 */
export function createReconnectCheck({ speak, tileOf, tileSchemeNow, go }) {
  // The reconnect confirmation runs INSIDE this screen's own flow, not beside it: the panel's
  // captures are private to it and die with it, so "the repair scan continues from the sides
  // already captured" is true only if the confirmation IS this screen in a confirm mode. Two
  // adjacent matching sides take the user's Yes; one mismatch and the same panel instance
  // simply keeps capturing into the full six-side repair, two sides in.
  let confirming = Boolean(state.reconnect?.candidate);
  const confirmEntry = confirming;
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
  const CONFIRM_HOW = 'We remember this cube. Show any two sides that meet along an edge — the front, then the top, works well. If both match what we remember, that’s your cube confirmed with no full scan; if either differs, keep going and the camera reads all six.';
  if (confirming) {
    speak(t('Checking your cube'), t(CONFIRM_HOW));
  }

  /** The two-side reconnect check, folded into a running scan. Its own job, lifted out of the
   *  scan-progress handler along with the words (2026-09-05): the handler was writing status
   *  messages, painting stickers, discovering cameras and answering a question about the
   *  user's cube, all in one body. Called LAST, for the reason its own comment gives. */
  const answerFromSides = (p) => {
    // ---- reconnect confirmation ----------------------------------------------------------
    // Each captured side is compared with the candidate — by its centre colour (the scanner
    // names a side by its centre, the one sticker a turn cannot move), up to rotation, and
    // EXACTLY: the scanner's own two-sticker tolerance is one short of a quarter turn's
    // three, so here a misread costs a full scan and never a false yes. Last, so its words
    // stand over the generic caption — but never over the scanner's own pinned notice.
    if (confirming && state.reconnect?.candidate && !p.notice && p.phase !== 'error') {
      // The remembered state is positional, so both halves of each side are translated out
      // of colour: which position this capture sits at, and which position each of its
      // sticker colours belongs to.
      const sides = p.captured.map((c) => ({
        face: tileOf(c.face),
        stickers: c.colors.map((ci) => (isColour(ci) ? positionOf(ci, tileSchemeNow()) : '?')).join(''),
      }));
      const check = confirmCheck(expectedNow(), sides, Cube);
      if (check.verdict === 'confirmed') {
        confirming = false;
        // The user's Yes, well founded and taken: same derivation, same trust, same words a
        // Yes on Home earns — and back to the screen the question was asked on.
        if (confirmReconnect()) {
          go('home');
          return;
        }
        // Refused — the derivation could not do its job. The scan is already running, so
        // the full read is the honest continuation, and this says so.
        speak(t('Keep going'), t('The match could not be taken as an answer, so the camera will read the whole cube instead — keep showing sides, the ones already read still count.'));
      } else if (check.verdict === 'mismatch') {
        confirming = false;
        speak(t('Not what we remembered'), t('That side is not what we remembered, so the camera will read the whole cube instead. Keep showing sides — the ones already read still count.'));
      } else if (check.matched.length) {
        speak(t('One more side'), t('That side matches. Now show one that touches it along an edge — two neighbouring sides are what the check needs.'), 'ok');
      } else if (!p.captured.length && !p.message) {
        speak(t('Checking your cube'), t(CONFIRM_HOW));
      }
    }
  };

  /** A finished scan answers the question outright: the check has nothing left to ask. */
  const close = () => { confirming = false; };
  /** Whether this scan came in as a reconnect confirmation, which goes back to the question once
   *  a scan is believed. */
  const cameAsConfirmation = () => confirmEntry;

  return Object.freeze({ answerFromSides, close, cameAsConfirmation });
}
