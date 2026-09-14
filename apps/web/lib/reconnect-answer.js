// The user's answer to "Is this your cube right now?": the Yes that grants trust on a reconnect, and
// the answer pair every screen that asks the question wires the same way.
//
// It sits ABOVE the connection — it asks the session whether the cube is refused, confirms through
// it, adopts the corrected report and remembers the confirmed moment — and beneath the screens that
// call it. The connection never calls back into it; the question itself is opened there, when a
// remembered cube connects.
//
// Lifted out of lib/cube-connection.js on 2026-09-13 (the connection design's third unit).
import { state } from './app-state.js';
import { adoptCube } from './cube-connection.js';
import { rememberLastSeen } from './cube-reports.js';
import { conn, cubeRefused } from './live-session.js';
import { installOffset, markStale, withRepaintsHeld } from './cube-trust-state.js';
import { shell } from './screen-slots.js';
import { Cube } from './solver-service.js';

/** Withdraw the Yes and say why: the question stands, with the camera as its door. The Yes goes
 *  BEFORE the stale mark, because the mark repaints Settings, and that repaint must not draw a Yes
 *  that has just been refused. */
function refuseAnswer(rc, why) {
  state.reconnect = { ...rc, raw: null };
  markStale(why);
  return false;
}

/** The user's answer: yes, the candidate is the cube in their hand, right now. The ONE thing that
 *  grants trust on a reconnect — no reading does. The working offset is derived from the
 *  confirmed picture and the cube's report at classification, exactly the derivation a camera
 *  repair makes with the picture standing in for the scan; it is constant under any turns made
 *  while the question was open, so the LATEST report is then corrected by it. Not state alone: the
 *  trust it grants is said where trust always is, as it changes — the title-bar dot at once, and
 *  Settings unless the caller holds that repaint (withRepaintsHeld) because it redraws the screen
 *  itself. The caller owns navigation and the screen it is on, because Home, Settings and the scan
 *  screen each need a different one. */
export function confirmReconnect() {
  const rc = state.reconnect;
  if (!rc || !rc.candidate || !rc.raw) return false;
  // A refused cube's Yes cannot be taken either, for the reason a refused cube's repair scan
  // cannot: the correction would be derived against a report already proved not to add up.
  if (cubeRefused()) return refuseAnswer(rc, 'its reports stopped adding up');
  // Through the SESSION, exactly as a camera repair goes: the user is answering a question about
  // the physical cube ("is this it, right now?"), which is the same KIND of evidence a scan is —
  // an outside observation of the cube, paired with what the cube claimed at that moment. The
  // checker therefore counts it, its constancy rule covers it, and the app's trust and the
  // session's verdict stay one model instead of two. With no session there is nothing to confirm
  // AGAINST, so this refuses rather than deriving privately.
  const offset = conn ? conn.cameraScan(rc.candidate, rc.raw) : null;
  if (offset === null) {
    // Should be unreachable — both strings were validated by the reading — but a confirmation
    // that cannot do its job must refuse loudly ON SCREEN, never grant trust over a failed
    // derivation and never leave the Yes button looking dead: markStale repaints the indicator
    // and Settings with the reason.
    console.error('reconnect confirmation could not derive a correction', rc);
    // The refusal reaches the question itself, not only the indicator: dropping `raw` takes the
    // Yes away (it cannot do its job), leaving the camera as the door — and the caller's
    // re-render is what repaints the block either way.
    return refuseAnswer(rc, 'its confirmation could not be checked');
  }
  // The answer itself can be what refuses the cube: the checker holds every correction it has
  // been shown, and one that MOVED with an unbroken stream between the two is not a correction.
  // `offset` is the previous one in that case, so taking it would keep a correction the checker
  // has just disowned — and call the cube trusted on the strength of it.
  if (cubeRefused()) return refuseAnswer(rc, 'its reports stopped adding up');
  // The LATEST report, corrected — turns made while the question was open are covered, because
  // the offset is constant under them. A latest report that fails validation (recorded raw, on
  // purpose) falls back to the one the reading validated.
  const corrected = installOffset(offset, 'confirmed', [state.reported ?? rc.raw, rc.raw], Cube);
  if (corrected === null) {
    console.error('reconnect confirmation could not correct the latest report');
    return refuseAnswer(rc, 'its confirmation could not be checked');
  }
  state.reconnect = null;
  state.live = corrected;
  adoptCube(corrected, { physical: true, source: 'cube' });
  rememberLastSeen('confirmed', { force: true });
  return true;
}

/** Wire a screen's Yes / camera answer pair. One body for Home and Settings, so the answer
 *  cannot behave differently by screen — and the re-render covers BOTH outcomes: a taken Yes
 *  shows the normal screen, a refused one repaints the question with the Yes gone. */
export function wireReconnectAnswers(root) {
  for (const b of root.querySelectorAll('[data-reconnect]')) {
    b.onclick = () => {
      if (b.dataset.reconnect === 'yes') { withRepaintsHeld(confirmReconnect); shell.refreshScreen(); }
      else shell.go('scan');
    };
  }
}
