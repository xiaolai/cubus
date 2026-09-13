// The smart cube: connecting and disconnecting, the registry of known cubes, trust (granted, lapsed,
// repaired by a scan), the reconnect question, and every report the cube sends. It sits beneath the
// screens, so it reaches the shell only through `shell` and a mounted screen only through `hooks`.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { hostPlatform } from './host.js';
// The smart-cube strands, recovered from v0 (2026-08-27): the transport seam (Web Bluetooth in a
// browser, native BLE events under Tauri), one durable record per cube, and the trust model that
// keeps "connected" from standing in for "known".
import { connectCube, VERDICT } from './cube-session.js';
import { normaliseIdentity, normaliseMac } from './cube-registry.js';
import { applyOffset, isIdentity } from './cube-trust.js';
// What the host can actually reach a radio with. Imported rather than re-derived: the list of
// platforms whose native BLE is not yet proved on a device is one line in one file by design
// ("THE FLIP IS THIS LINE"), and a second copy here would let the app offer Pair on a platform
// that file had already refused.
import { NATIVE_BLE_UNSUPPORTED } from './ble-bridge.js';
// Reconnecting a known cube: the readings that choose the picture and the words on reconnect, and
// the two-adjacent-side camera check that supports the user's answer. Never the trust — only the
// user's answer grants that (dev-docs/smart-cube-ux-prd.md, "Reconnecting a known cube").
import { classifyReconnect } from './cube-reconnect.js';

import { $, state } from './app-state.js';
import { hooks, shell } from './screen-slots.js';
import { Cube, loadSolver } from './solver-service.js';
import { ingestFacelets, takeDerivation } from './cube-subject.js';
import { isTauri } from './window-chrome.js';
import {
  cubes, lastCubeMac, liveCubeLabel, rememberArrangement, rememberConnection, sessionIdentity,
} from './cube-memory.js';

// ---- smart cube: connection, registry, trust (recovered from v0) -----------------------------

// The live session (lib/cube-session.js), or null. It owns the transport, the protocol layer
// and the self-check; the app only ever holds this one handle, here.
export let conn = null;

/** The connected cube's remembered record at the moment it connected — what the reconnect
 *  reading compares the first report against. Cleared with the connection. */
let pendingLast = null;
/** True until the connection's FIRST report arrives; that report is the reconnect evidence. */
let awaitingReport = false;
/** A camera reading taken while this connection had reported NOTHING yet, held until its first
 *  report: `{facelets, turns}`. A repair is derived FROM what the cube claims — the camera says
 *  where the cube is, the report says where the cube thinks it is — so with no report there is
 *  nothing to derive against and the scan cannot put tracking back in step. Cleared with the
 *  connection: a scan is evidence about the cube that was in front of the camera, and the next
 *  connection may be another one.
 *
 *  `turns` is what makes the hold safe to use later. A held scan is reconcilable by the first
 *  report ONLY if nothing turned in between — see dropHeldScan. */
let scanAwaitingReport = null;
/** Why a held scan was thrown away. One string, said from the two places that can establish it —
 *  the turn itself, and the session's own count at the first report — because two wordings for
 *  one fact would read on screen as two different faults. */
const TURNED_SINCE_SCAN = 'it was turned after the camera saw it, and before it had reported anything';
/** The 16-bit serial that came with the latest report, or null when it carried none. Stored
 *  beside the memory as information for wording, never proof: the GAN16's counter is
 *  per-connection and says nothing across a break. */
let lastSerialSeen = null;

/** Is the live CHAIN trusted — trusted knowledge of the cube itself, not of a generated
 *  subject? 'generated' sets `trusted` too (a scramble is perfectly known), but that is
 *  knowledge of a scramble, and filing it as what the cube looked like is exactly the
 *  confidently-wrong record this distinction exists to prevent. One predicate, because its two
 *  call sites (the trusted-update write and the disconnect timestamp) must never drift. */
export const chainTrusted = () =>
  state.cube.trusted && (state.cube.source === 'cube' || state.cube.source === 'camera');

/** Remember the arrangement the app is sure of (lib/cube-memory.js) with this connection's serial,
 *  and repaint Settings when the write's health flipped — which the memory, beneath the screens,
 *  does not do itself. */
export function rememberLastSeen(how, { force = false } = {}) {
  if (rememberArrangement(how, { force, serial: lastSerialSeen ?? null })) repaintSettings();
}

/** Has the session PROVED this cube's own reports do not add up?
 *
 *  One predicate, because it now gates three different things — the report stream, the repair
 *  scan, and re-trusting after one — and three copies of a verdict comparison is how a refusal
 *  comes to mean different things per screen. A session that is not there refuses nothing:
 *  "no cube" and "a cube known to be wrong" are not the same state. */
export const cubeRefused = () => conn?.verdict === VERDICT.REFUSED;

/** Repair tracking from one camera reading, WITHOUT solving the cube.
 *
 *  This is the whole point of the trust design: the old repair was "solve it, then re-anchor",
 *  which for a beginner is not a recovery path at all — someone who could solve the cube would
 *  not need the app, and that is exactly where a new player gives up.
 *
 *  The correction is derived BY THE SESSION'S CHECKER (`cameraScan`), not here. Both used to
 *  derive one — this file with `deriveOffset`, the checker with its own copy — so the app and the
 *  session held two disconnected trust models: `VERDICT.TRUSTED` was unreachable because nothing
 *  ever told the checker a camera had looked, and the checker's constancy rule (a correction that
 *  moves between two scans with an intact stream between them is not a correction) guarded
 *  nothing (found by audit, 2026-09-04). One derivation now, with the checker's answer as the
 *  answer, so a scan advances the verdict and a refusal reaches this screen.
 *
 *  @returns {{ok: boolean, text: string}|null} what to tell the user, or null when the scan
 *  changed nothing about tracking (no cube, or it already agreed).
 */
export function repairTracking(scanned, { reconciling = false } = {}) {
  if (!state.connected || !conn) return null;
  // A refused cube cannot be repaired by a camera, and this is the door that used to let one be.
  // The correction is derived FROM the cube's own report; if that report has been proved not to
  // add up, the correction built on it is arithmetic over a fiction — and adopting the scan
  // afterwards called the cube trusted again. A refusal is about the cube, and only a fresh
  // connection can revisit it.
  if (cubeRefused()) {
    return {
      ok: false,
      text: 'This cube’s own reports have stopped adding up, so a scan cannot put it back in step — what the camera saw would be measured against a reading that means nothing. Disconnect it and pair again; the camera still solves the cube either way.',
    };
  }
  // The RAW report, not state.live: live has already had the current offset applied, so deriving
  // against it yields the identity — overwriting a correction the cube still needs.
  const reported = state.reported;
  if (!reported) {
    // The cube is here and has said nothing yet, so there is nothing to derive a correction
    // AGAINST and this scan cannot put its tracking back in step. Held for the FIRST report,
    // which is the first moment the repair can run at all (onFacelets reconciles it there).
    // Without this the scan granted camera trust with the repair silently skipped, and that first
    // report then replaced the scanned arrangement while keeping the trust the scan had earned —
    // a trusted subject nobody had looked at (found by audit, 2026-09-05).
    //
    // The turn count travels with it, because the hold is only good while the cube holds still:
    // a turn between the scan and the first report leaves the camera describing the cube BEFORE
    // it and the report describing the cube AFTER, and a correction derived from that pair is an
    // invented one (found by the same audit's second pass, 2026-09-05). dropHeldScan is the
    // other half.
    scanAwaitingReport = { facelets: scanned, turns: turnsReported() };
    return null;
  }
  // On an UNBROKEN chain the scan and the cube must agree. If they do not, one of them is wrong —
  // a misread, or a camera pointed at a different cube — and deriving a correction from a
  // contradiction would bake the mistake in permanently. Which one is wrong is not knowable;
  // that there is a problem is. (Compared against state.live, NOT the raw report: once a
  // correction is active, comparing with the raw report made every later good scan look like a
  // contradiction — repairing a cube once made every later scan of it fail.)
  //
  // Never on a RECONCILIATION, which is this same repair run late — the deferred half of a scan
  // taken before the connection had reported anything. There the trust being read here is the
  // scan's OWN, granted moments ago, and `live` is null precisely because no report had arrived
  // to establish one: the pair being compared would be the scan against nothing.
  //
  // And the trust that gates it is the CHAIN's, not the subject's. `state.cube.trusted` is also
  // true of a generated scramble — the die, the Timer, the Scramble hand-off — which is perfect
  // knowledge of a cube nobody looked at, and says nothing whatever about whether this cube's
  // reports are in step. A camera repair on a stale cube was refused for the words "the cube was
  // tracking" purely because a scramble had been rolled, which is the one moment the repair
  // exists for (found by audit, 2026-09-05). chainTrusted() is the predicate that means what
  // this sentence claims: trusted knowledge of the cube ITSELF.
  if (chainTrusted() && !reconciling && scanned !== state.live) {
    return {
      ok: false,
      text: 'This is not what your cube is reporting, and the cube was tracking. One of the two is wrong, so nothing was changed — check that you scanned the cube that is connected.',
    };
  }
  const offset = conn.cameraScan(scanned, reported);
  // The checker may have REFUSED on this very scan — two scans implying two different corrections
  // with an unbroken stream between them is the self-consistent-but-wrong decoder it exists to
  // catch. Asked after the scan, because that is when the answer exists; `offset` still holds the
  // previous correction in that case, so applying it would silently keep a correction the checker
  // has just disowned.
  if (cubeRefused()) {
    return {
      ok: false,
      text: 'This scan and the last one imply two different corrections, with nothing lost in between — so what this cube reports cannot be corrected by any fixed amount. cubus has stopped trusting its reports; the camera still solves it.',
    };
  }
  if (!offset) return null;
  state.cube.offset = isIdentity(offset) ? null : offset;
  state.cube.offsetAt = state.cube.offset ? Date.now() : 0;
  state.cube.offsetFrom = state.cube.offset ? 'scan' : '';
  // Recomputed on the spot: live is the last report WITH the correction applied, and leaving it
  // describing the old correction until the next ~1s snapshot lands means everything reading it
  // in between sees a position that is no longer claimed.
  const corrected = applyOffset(state.cube.offset, reported, Cube);
  if (corrected !== null) state.live = corrected;
  return state.cube.offset
    ? { ok: true, text: 'Tracking repaired — your cube is back in step for as long as it stays connected, and you never had to solve it.' }
    : null;
}

/** The cube is gone — dropped, or deliberately let go. ONE body, used by the driver's event, the
 *  Disconnect button and the failure path in connectOnce. Idempotent. */
export function onDisconnect() {
  conn = null;
  // The memory's timestamp is the last moment the app was SURE — which is now, if the chain was
  // trusted when it broke. The content is already stored; this is the one write that keeps
  // "as we last saw it, Tuesday 21:40" naming the break rather than the last turn.
  if (chainTrusted()) {
    rememberLastSeen(state.cube.source, { force: true });
  }
  // A question about a cube that is no longer here has no answer worth taking: the Yes would
  // grant trust to a chain that just ended. The candidate picture stays as the (stale, flagged)
  // subject; the question itself closes.
  const hadQuestion = Boolean(state.reconnect);
  state.reconnect = null;
  pendingLast = null;
  awaitingReport = false;
  // A scan waiting for a report it will never get. It stays the SUBJECT — the camera did see that
  // cube — but the chain it was to be reconciled with has ended, and markStale below says so.
  scanAwaitingReport = null;
  lastSerialSeen = null;
  // Order matters: mark stale BEFORE setConnected, so the indicator repaints once, already
  // knowing the truth, rather than flashing "connected and fine" on its way out.
  markStale('it disconnected, and may have been turned since');
  // Across a disconnect the cube may sleep, reset its own counters, or be turned. The offset
  // corrected a specific chain to reality at a moment; that chain is gone.
  clearOffset();
  setConnected(false);
  // setConnected repaints Settings; the question block on Home is this screen's own furniture.
  if (hadQuestion && state.screen === 'home') shell.refreshScreen();
}

/** Throw the correction away. NOT called on `gap`: a serial skip means moves were missed, not
 *  that the reference moved — what was lost is the moves in between, not the relationship. */
export function clearOffset() {
  state.cube.offset = null;
  state.cube.offsetAt = 0;
  state.cube.offsetFrom = '';
}

/**
 * A turn reached the cube but not us.
 *
 * Trust lapses HERE rather than in a screen's handler, so a loss arriving while you are in
 * Settings is not dropped; the screen still gets told so it can stand down.
 *
 * It used to be reached by a SERIAL skip, which only cubes that number their moves can report —
 * three brands the app now speaks to report a usable clock and number nothing. It is reached by
 * PROOF now: the self-check replays the moves it saw onto the last reported state, and the next
 * report does not match. That works on every brand, and it establishes the loss against the cube
 * rather than inferring it from a counter.
 *
 * What it costs is the COUNT. A serial says two turns went missing; reconciliation says at least
 * one did. So nothing here names a number any more — an invented one would be the more
 * comfortable sentence and the less true one.
 */
function onMovesLost() {
  markStale('a turn went unrecorded');
  if (hooks.liveGap) hooks.liveGap();
}

/** How many turns this connection has reported, as the SESSION counts them. The self-check is
 *  shown every MOVE event before any listener of ours is, so this is the cube's own record rather
 *  than a tally of what happened to reach this file — which is exactly what makes it worth asking
 *  a second time at the report. Zero with no session, and zero for a session that counts nothing:
 *  a count that cannot move can only ever say "nothing turned", which is what a cube reporting no
 *  moves at all is in fact saying. */
const turnsReported = () => conn?.evidence?.moveReports ?? 0;

/**
 * Throw away a scan held for a first report, and say where trust is shown why.
 *
 * A held scan is reconcilable by the first report ONLY if nothing turned in between. Once the
 * cube has moved, the camera describes it before the turn and the report describes it after: the
 * correction derived from that pair relates two different arrangements, so it is an offset nobody
 * observed, and adopting it kept the camera's trust over an arrangement the cube had already
 * left (found by audit, 2026-09-05, in the fix that introduced the hold).
 *
 * At the TURN rather than at the report, because a first report that never arrives would
 * otherwise leave that trust standing for the life of the connection. Trust lapses through
 * markStale like every other lapse, so the indicator, its live region and Settings all say it;
 * the report itself then takes the ordinary path — which, with something remembered, is the
 * reconnect question, the one question a beginner can answer.
 */
function dropHeldScan() {
  if (!scanAwaitingReport) return;
  scanAwaitingReport = null;
  markStale(TURNED_SINCE_SCAN);
}

/**
 * A turn the cube reported.
 *
 * ONE body for the driver and the test seam, and deliberately NOT the same thing as the follow
 * hook. `liveMove` is cleared on every screen render, so on the scan screen — the screen a
 * beginner is on when this matters — a turn used to reach nothing at all; and a refused cube's
 * turns must not drive a walk, but a refused cube is still a cube that was turned. The one thing
 * every turn does, whoever is watching, is invalidate a scan being held for a first report.
 */
function onCubeMove(m) {
  dropHeldScan();
  // The self-check GATES following, and only following: a refused cube has been proved to
  // contradict itself, so letting it drive the walk would animate a cube nobody can vouch for,
  // while everything short of a refusal still follows — mirroring a turn is not a claim about
  // where the cube is. A session that is not there refuses nothing, exactly as cubeRefused()
  // reads it: "no cube" and "a cube known to be wrong" are not the same state.
  if (conn?.mayFollow?.() === false) return;
  hooks.liveMove?.(m);
}

/** Record a live connection. The registry write and the connected flag are ONE step on purpose:
 *  as two, the test seam and the real path each had a copy, and a regression passed every test. */
function adoptConnection(mac, name) {
  rememberConnection(mac, name);
  // A new connection starts knowing nothing about this cube. Trust and the last report belong to
  // the chain that just ended: inheriting them let a freshly paired cube be treated as verified
  // on the strength of a camera scan of some *other* cube.
  state.live = null;
  state.reported = null;
  lastSerialSeen = null;
  // Including a scan that was waiting to be reconciled: it is evidence about the cube that was in
  // front of the camera, and this may be another one.
  scanAwaitingReport = null;
  clearOffset();
  // The reconnect reading. Until the first report arrives the evidence is "no report" — with a
  // remembered arrangement that is already a picture worth showing (dimmed, unconfirmed), and if
  // the cube never answers, the words are already the true ones. The first report re-reads the
  // evidence; with nothing remembered there is no question to ask and today's flow stands.
  pendingLast = cubes[normaliseIdentity(mac)]?.last ?? null;
  awaitingReport = true;
  const opening = classifyReconnect({ report: null, last: pendingLast }, Cube);
  state.reconnect = opening.candidate
    ? { reading: opening.reading, candidate: opening.candidate, raw: null, seenAt: pendingLast?.at ?? 0 }
    : null;
  if (state.reconnect) {
    // Home shows the candidate AT ONCE — the remembered arrangement, in an unconfirmed dress.
    // Ingested, not adopted: adoptCube would mark it trusted, and no reading grants trust.
    ingestFacelets(state.reconnect.candidate);
    state.cube.isPhysical = true;
  }
  markStale('it has just connected, and has not been checked yet');
  setConnected(true, name, mac);
  if (state.reconnect && state.screen === 'home') shell.refreshScreen();
}

/** The cube answered nothing — getState timed out or rejected. This used to be swallowed with an
 *  empty catch, and the screen showed a connected cube that had said nothing; now it is said. The
 *  reading is already 'no-report' when something is remembered (set at adoptConnection); with
 *  nothing remembered this is the moment the silence becomes a question worth drawing at all. */
function reportSilence() {
  if (!state.connected || !awaitingReport) return;
  if (!state.reconnect) {
    state.reconnect = { reading: 'no-report', candidate: null, raw: null, seenAt: 0 };
  }
  // Settings goes through the deferral, like every other async repaint of it.
  if (state.screen === 'home') shell.refreshScreen();
  else repaintSettings();
}

/** The user's answer: yes, the candidate is the cube in their hand, right now. The ONE thing that
 *  grants trust on a reconnect — no reading does. The working offset is derived from the
 *  confirmed picture and the cube's report at classification, exactly the derivation a camera
 *  repair makes with the picture standing in for the scan; it is constant under any turns made
 *  while the question was open, so the LATEST report is then corrected by it. State only — the
 *  caller owns navigation and re-rendering, because Home, Settings and the scan screen each need
 *  a different one. */
export function confirmReconnect() {
  const rc = state.reconnect;
  if (!rc || !rc.candidate || !rc.raw) return false;
  // A refused cube's Yes cannot be taken either, for the reason a refused cube's repair scan
  // cannot: the correction would be derived against a report already proved not to add up.
  if (cubeRefused()) {
    markStale('its reports stopped adding up');
    state.reconnect = { ...rc, raw: null };
    return false;
  }
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
    markStale('its confirmation could not be checked');
    state.reconnect = { ...rc, raw: null };
    return false;
  }
  // The answer itself can be what refuses the cube: the checker holds every correction it has
  // been shown, and one that MOVED with an unbroken stream between the two is not a correction.
  // `offset` is the previous one in that case, so taking it would keep a correction the checker
  // has just disowned — and call the cube trusted on the strength of it.
  if (cubeRefused()) {
    markStale('its reports stopped adding up');
    state.reconnect = { ...rc, raw: null };
    return false;
  }
  state.cube.offset = isIdentity(offset) ? null : offset;
  state.cube.offsetAt = state.cube.offset ? Date.now() : 0;
  state.cube.offsetFrom = state.cube.offset ? 'confirmed' : '';
  // The LATEST report, corrected — turns made while the question was open are covered, because
  // the offset is constant under them. A latest report that fails validation (recorded raw, on
  // purpose) falls back to the one the reading validated.
  const corrected = applyOffset(state.cube.offset, state.reported ?? rc.raw, Cube)
    ?? applyOffset(state.cube.offset, rc.raw, Cube);
  if (corrected === null) {
    console.error('reconnect confirmation could not correct the latest report');
    clearOffset();
    markStale('its confirmation could not be checked');
    state.reconnect = { ...rc, raw: null };
    return false;
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
      if (b.dataset.reconnect === 'yes') { confirmReconnect(); shell.refreshScreen(); }
      else shell.go('scan');
    };
  }
}

/**
 * Can this host reach a radio at all, and by which route?
 *
 * The SAME ladder `installBleBridge` walks, asked without building a bridge: a bridge registers
 * native event listeners, and one constructed at render time beside a live session would sit
 * there warning about every packet it could not place. The one line that can drift — which
 * native platforms are refused until somebody has run the app on a real device — is imported
 * rather than copied, because that list is deliberately kept in one place ("THE FLIP IS THIS
 * LINE", ble-bridge.js).
 *
 * Answered at RENDER time, never memoised: `?platform=` pins the answer for design review, and a
 * value cached before boot published `<html data-platform>` would be the wrong one forever.
 *
 * @returns {'native'|'browser'|'refused-host'|'none'}
 */
export function bleReach() {
  if (isTauri && NATIVE_BLE_UNSUPPORTED.includes(hostPlatform())) return 'refused-host';
  if (isTauri) return 'native';
  if (globalThis.navigator?.bluetooth) return 'browser';
  return 'none';
}

/** Whether the Pair button is drawn at all. A control that can never work on this platform is
 *  furniture: it invites a press, fails, and explains afterwards in words written for a
 *  different host. The row still says what the platform can do — the capability is named
 *  everywhere, it is only OFFERED where it exists. */
export const canPair = () => bleReach() === 'native' || bleReach() === 'browser';

/** Why, in the user's terms. Host-specific, because "this cannot work here" is useless without
 *  "and here is what does". Every branch keeps the camera in view: it is the path that works on
 *  every platform, and a beginner reading a Bluetooth refusal needs to know the app still does
 *  its job. */
export function bleReachNote() {
  switch (bleReach()) {
    case 'native':
      return 'Pairing scans for a nearby cube — turn it first so its radio is awake.';
    case 'browser':
      return 'Pairing opens your browser’s device chooser — turn the cube first so it appears in the list.';
    case 'refused-host':
      // Named for the platform, and true: the Rust and Kotlin BLE paths compile and have never
      // spoken to a radio, so the app refuses rather than offering a connect that would fail in
      // a way nobody could read (ble-bridge.js says what a device run must show first).
      return hostPlatform() === 'ios'
        ? 'Smart cubes are off on iPhone and iPad for now — cubus has not been tried against a real cube on this hardware, and offering it before that would mean guessing. The camera reads your cube here exactly as it does everywhere else.'
        : 'Smart cubes are off on Android for now — cubus has not been tried against a real cube on an Android phone, and offering it before that would mean guessing. The camera reads your cube here exactly as it does everywhere else.';
    default:
      return 'This browser cannot use Bluetooth. Chrome, Edge or the desktop app can — and the camera works either way.';
  }
}

/** Is someone mid-typing in a cube-settings input? Async repaints of Settings defer rather than
 *  discard what is being typed. ONE predicate on purpose — it had two copies, and two copies of
 *  a focus check is how one repaint path eats input while the other politely waits. */
const editingCubeSettings = () => {
  const el = document.activeElement;
  return Boolean(el && (el.id === 'macIn' || el.dataset?.renameCube));
};
/** A Settings repaint that arrived mid-typing. DEFERRED is not DROPPED: without the flush on
 *  focusout (wired in the Settings mount), a battery or trust change landing while a nickname
 *  was being typed stayed stale on screen indefinitely. */
export let settingsRepaintPending = false;
export const repaintSettings = () => {
  if (state.screen !== 'settings') return;
  if (editingCubeSettings()) { settingsRepaintPending = true; return; }
  settingsRepaintPending = false;
  shell.renderScreen();
};

/** Read the cube's battery and publish it. The cube answers on request only. */
export async function refreshBattery() {
  if (!conn) return;
  // Scoped to the connection that asked: a slow reply from a cube you have since disconnected
  // must not land as the current cube's battery level.
  const asked = conn;
  try {
    // `null` means the cube would not say, and it must stay unknown. `Number(null)` is 0, which
    // is finite — so the old line drew a flat battery for a cube that simply had not answered,
    // which is the "never invent data" rule broken in the most alarming direction available.
    const answer = await conn.requestBattery();
    if (conn !== asked) return;
    const level = answer === null || answer === undefined ? Number.NaN : Number(answer);
    if (Number.isFinite(level)) {
      state.battery = Math.max(0, Math.min(100, Math.round(level)));
      // A reply can land while someone is typing a nickname or an address into this very card,
      // and rebuilding the card discards what they typed — so the redraw is deferred, not faked.
      repaintSettings();
    }
  } catch {
    if (conn !== asked) return;
    // A cube that will not answer its battery is still a usable cube. Leave the level unknown
    // and let the UI say so, rather than drawing a fictional meter.
    state.battery = null;
  }
}

/** Everything on screen that is derived from trust, repainted together. Trust is the one claim
 *  this model exists to make honestly; every place that repeats it changes at the same moment. */
function trustChanged() {
  const live = $('#cubeLive');
  if (live) paintTrust(live);
  // The read-from-cube button this used to relabel is gone: its job — naming whether the screen's
  // subject is the cube in your hand — is done by the reconnect question's Yes / camera pair,
  // which renders with the screen rather than being repainted here.
  // Settings derives its setup checklist from trust; deferred while an input there has focus,
  // for the same reason the battery redraw is.
  repaintSettings();
}

/** We now know what the cube looks like, and by what means. */
export function markTrusted(source) {
  // A refusal is about the CUBE, and only a fresh connection can revisit it. Trust sourced from
  // 'cube' means "its own reports say so", which is exactly the claim the checker has disproved —
  // so an anchor or a confirmation must not be able to buy it back. 'camera' and 'generated' are
  // knowledge from elsewhere and are unaffected; the guard is at this choke point rather than at
  // each caller for the same reason every other trust change passes through here.
  if (source === 'cube' && cubeRefused()) return;
  if (state.cube.trusted && state.cube.source === source) return;
  state.cube.trusted = true;
  state.cube.source = source;
  state.cube.staleWhy = '';
  trustChanged();
}

/** Something happened that we cannot see through. The state is NOT discarded — a loudly-flagged
 *  stale cube is more useful than an empty screen. */
export function markStale(why) {
  if (!state.cube.trusted && state.cube.staleWhy === why) return;
  const lapsed = state.cube.trusted;
  state.cube.trusted = false;
  state.cube.staleWhy = why;
  // Only an actual lapse notifies — a stale cube going stale for a new reason is a wording
  // change, not an event a screen needs to stand down for.
  if (lapsed && hooks.onTrustLost) { try { hooks.onTrustLost(); } catch {} }
  trustChanged();
}

/** One indicator, three states — absent, stale, trusted — because "connected" was never the
 *  question a user needs answered. */
function paintTrust(el) {
  const on = state.connected;
  const say = $('#cubeLiveSay');
  el.hidden = !on;
  if (!on) {
    // An absent cube announces nothing rather than announcing an absence: the region is emptied,
    // so leaving Settings after a disconnect does not read the last state out again.
    if (say) say.textContent = '';
    return;
  }
  const ok = state.cube.trusted;
  el.classList.toggle('stale', !ok);
  const who = liveCubeLabel();
  // The button's NAME says what it is and where it goes — it is a control, and its name has to
  // survive the state changing under it. The STATE is the status region's, beside it.
  el.setAttribute('aria-label', `${who} — smart cube settings`);
  const words = ok
    ? `${who}: tracking`
    : `${who}: position unverified — ${state.cube.staleWhy || 'read the cube again'}`;
  if (say && say.textContent !== words) say.textContent = words;
  el.title = ok
    ? `${who} connected${Number.isFinite(state.battery) ? ` · ${state.battery}% battery` : ''} · tracking`
    : `${who} connected, but ${state.cube.staleWhy || 'its position is unverified'} — read the cube again`;
}

function setConnected(on, name = '', mac = '') {
  // Compared so a call that changes nothing does not re-render: doConnect's failure path calls
  // setConnected(false) while already disconnected, and the resulting teardown discarded the DOM
  // the caller's catch was about to write its error into.
  const before = `${state.connected}|${state.cubeName}|${state.cubeMac}`;
  // normaliseIdentity, not normaliseMac: five of the ten protocols never expose an address, and
  // stripping their `name:` key here emptied state.cubeMac — which every registry write then
  // bailed on (`!state.cubeMac`), so those cubes were never remembered and never matched their
  // own row in Settings.
  state.connected = on; state.cubeName = name; state.cubeMac = on ? normaliseIdentity(mac) : '';
  state.battery = null;
  // The anchor belongs to a connection, not to the app.
  if (!on) state.anchored = false;
  const live = $('#cubeLive');
  if (live) paintTrust(live);
  if (state.screen === 'settings' && before !== `${state.connected}|${state.cubeName}|${state.cubeMac}`) {
    shell.renderScreen();
  }
}

let connecting = null;
export async function doConnect(macFromUi) {
  // Single-flight: two overlapping attempts raced through the shared transport/conn state, the
  // loser tearing down the winner's transport half-way through its own handshake.
  if (connecting) return connecting;
  connecting = (async () => {
    try { return await connectOnce(macFromUi); } finally { connecting = null; }
  })();
  return connecting;
}

async function connectOnce(macFromUi) {
  if (conn) { try { await conn.disconnect(); } catch {} conn = null; }
  try {
    // The self-check needs cubejs, and a cube paired before the solver finished loading would be
    // REFUSED for a reason that has nothing to do with the cube — an alarming verdict caused by
    // our own start-up ordering. Wait for it instead; it is already loading.
    if (!Cube) await loadSolver().catch(() => {});
    if (!Cube) throw new Error('still starting up — try again in a moment');
    // Validated before it is offered as an address. The field accepts whatever was typed and a
    // remembered key may be a `name:` id, and the protocol layer takes this as a MAC — so
    // anything that is not one is no answer at all, and letting it through asked the cube to be
    // found at an address that does not exist.
    const typed = normaliseMac(String(macFromUi ?? '').trim()) || lastCubeMac();
    // The typed address is a FALLBACK, not the source. Nearly every cube broadcasts its own and
    // the protocol layer reads it per brand; this only answers when the advertisement did not
    // carry one. It used to be mandatory in the browser, which asked a beginner for a hexadecimal
    // address before they could connect at all.
    //
    // It is an ANSWER TO THE PROTOCOL LAYER and never an identity: what it supplies here is
    // checked against the cube (the library verifies a provided MAC before the connection stands)
    // and comes back as `session.mac` if it holds. Feeding it to the registry directly is what
    // made an addressless cube inherit the last cube's record — see sessionIdentity.
    const session = await connectCube({
      Cube,
      macProvider: typed ? async () => typed : undefined,
    });

    // Every callback is scoped to ITS session: a slow packet or a late disconnect from a
    // connection since replaced must not mutate the new cube's state or tear it down.
    session.onFacelets((facelets, serial) => { if (conn === session) onFacelets(facelets, serial); });
    // Following runs on moves (immediate); snapshots (~1Hz) only correct drift — a turn sequence
    // completed inside one second has no intermediate snapshots.
    // Through onCubeMove, not straight to `liveMove`: the self-check's gate lives there so the
    // test seam passes through the same one the driver does, and so does the one piece of
    // bookkeeping that must happen on EVERY turn whether or not a screen is following.
    session.onMove((m) => { if (conn === session) onCubeMove(m); });
    session.onDisconnect(() => { if (conn === session) onDisconnect(); });
    // Trust lapses HERE rather than in a screen's handler, so a verdict changing while you are in
    // Settings is not dropped. This replaces the driver's `gap` event and is a better trigger: the
    // old one fired on a serial jump, this one fires when the cube's own moves and its own
    // reported state stop agreeing — which is what a lost turn actually IS, proved rather than
    // inferred, and available on every brand instead of only those that number their moves.
    session.onVerdict((verdict) => {
      if (conn !== session) return;
      if (verdict === VERDICT.REFUSED) markStale('its reports stopped adding up');
    });
    // A lost turn is its OWN signal, not a shade of the verdict (2026-09-04). The whole point of
    // tolerating a loss is that a trusted cube SURVIVES it — so on the cube this matters most for,
    // the verdict and the reason are identical before and after, and a screen watching the verdict
    // announces nothing. Standing follow down, refusing the timer's result and saying what
    // happened all live behind onMovesLost, and this is the door they arrive through.
    session.onMovesLost(() => { if (conn === session) onMovesLost(); });

    conn = session;
    adoptConnection(sessionIdentity(session), session.name || 'Smart cube');
    // The reply is NOT fed to onFacelets here. It arrives on the event stream too, and the
    // permanent listener above already handles it — passing it on as well delivered the
    // connection's first report twice, which runs the reconnect classification against a question
    // its own first answer had already closed.
    session.requestState().catch((e) => {
      // Said, not swallowed: this rejection used to vanish into an empty catch, and the screen
      // showed a connected cube that had said nothing. The passive stream may still deliver a
      // first report later; until it does, the reading is 'no report' and the screens say so.
      if (conn !== session) return;
      console.warn('the cube did not answer its state request', e);
      reportSilence();
    });
    // Ask the cube rather than inventing a number — a flat battery is what disconnects a cube
    // mid-solve, and a mid-solve disconnect is what silently desyncs its tracking from reality.
    void refreshBattery();
  } catch (err) {
    if (conn) { try { await conn.disconnect(); } catch {} }
    onDisconnect();
    throw err;
  }
}

/** Make `facelets` the arrangement the app is about.
 *  `physical` says whether it is the cube in the user's hand — a scan or a confirmed cube report
 *  is; a generated scramble is not, however well we know it.
 *  `setupAlg` is for a caller that ALREADY searched for it — see takeDerivation. */
export function adoptCube(facelets, { physical, source, setupAlg = '' } = { physical: false, source: 'generated' }) {
  ingestFacelets(facelets);
  if (setupAlg) takeDerivation(facelets, setupAlg);
  state.cube.isPhysical = physical;
  markTrusted(source);
}

/** A snapshot from the connected cube. Always records what the cube says; only changes the
 *  SUBJECT when the subject is that cube — otherwise pressing Random would have its arrangement
 *  quietly replaced by the real one a second later. */
function onFacelets(reported, serial) {
  if (!reported) return;
  // The self-check gates the STATE channel too, and this is the half that was missing: only moves
  // were gated, so a refused cube's reports went on becoming the app's subject — driving the net
  // and the 3D cube, being written into the registry as "as we last saw it", and standing as the
  // raw report a camera scan would derive a correction from. A refusal is a PROOF that this
  // cube's two channels disagree, which makes its state reports exactly as unusable as its moves
  // and rather more dangerous, because a state is a claim about where the cube IS.
  //
  // Here rather than in the session listener, so the test seam (window.cubusFeed) passes through
  // the same gate the driver does — a seam that skipped it would be a lookalike, and this
  // behaviour would have no test that could see it. The checker has already been shown this
  // report by the time either caller runs, so the report that CAUSED the refusal is dropped too,
  // which is the point.
  if (cubeRefused()) return;
  // What the cube literally said, before any correction. A repair derives the offset from the
  // RAW report — deriving it from a corrected one produces the identity.
  state.reported = reported;
  lastSerialSeen = Number.isInteger(serial) ? serial & 0xffff : null;
  // A camera reading taken before this connection had said anything is RECONCILED here, against
  // the report it was waiting for. Two things this is, in order:
  //
  //   * the repair that could not run at scan time. A correction is derived from what the cube
  //     CLAIMS, and the cube had claimed nothing — so the scan granted camera trust with the
  //     repair skipped, and this very report then replaced the scanned arrangement while keeping
  //     that trust. Reconciling first means the report AGREES with the scan (that is what the
  //     correction makes true) instead of overwriting it.
  //   * the answer to the reconnect question. Six sides establish what a two-sided memory
  //     comparison can only spot-check, so the question closes rather than being asked over a
  //     cube the camera has just read in full.
  //
  // Both of those rest on the cube having held still since the scan, so that is asked FIRST, and
  // asked of the session's own turn count rather than of this file having noticed. A turn that
  // arrives through onCubeMove drops the hold where it happens; this catches one the cube counted
  // and our door never delivered, and it is the same question either way — an offset between an
  // arrangement the camera saw and one the cube has since turned away from is invented.
  if (scanAwaitingReport && scanAwaitingReport.turns !== turnsReported()) dropHeldScan();
  if (scanAwaitingReport) {
    const scanned = scanAwaitingReport.facelets;
    scanAwaitingReport = null;
    awaitingReport = false;
    state.reconnect = null;
    const repaired = repairTracking(scanned, { reconciling: true });
    if (repaired && !repaired.ok) {
      // The camera and this cube cannot be related by any fixed correction. The scan was good
      // knowledge of the cube in the hand; it is not knowledge of what this stream means, and a
      // stream nothing could reconcile must not go on being read as the trusted subject.
      markStale('a scan and the cube’s first report could not be reconciled');
      return;
    }
  }
  // The connection's FIRST report is the reconnect evidence: raw against the remembered raw,
  // and the reading chooses the picture and the words — never the trust.
  if (awaitingReport) {
    awaitingReport = false;
    const r = classifyReconnect({ report: reported, last: pendingLast }, Cube);
    if (r.candidate && (r.reading === 'unchanged' || r.reading === 'turned')) {
      state.reconnect = { reading: r.reading, candidate: r.candidate, raw: reported, seenAt: pendingLast?.at ?? 0 };
      // The candidate becomes the subject — shown at once, in the unconfirmed dress. Ingested,
      // not adopted: no reading grants trust, only the user's answer does. Settings repaints
      // through the deferral, like every other async repaint of it — the first report lands
      // about a second after pairing, exactly when a nickname is likely mid-typing.
      ingestFacelets(r.candidate);
      state.cube.isPhysical = true;
      if (state.screen === 'home') shell.refreshScreen();
      else repaintSettings();
      return;
    }
    // Nothing remembered (or nothing derivable): no question to ask — today's flow, below. A
    // question opened over the memory alone ('no report') closes here: the report is the better
    // evidence, and it said the memory was not usable after all.
    const hadQuestion = Boolean(state.reconnect);
    state.reconnect = null;
    if (hadQuestion) {
      if (state.screen === 'home') shell.refreshScreen();
      else repaintSettings();
    }
  }
  // The candidate is FROZEN while the reconnect question is open: an untrusted report updating
  // the picture being confirmed would make it a picture nobody can confirm. The raw report is
  // still recorded above — the Yes derives against it and the repair scan reads it — but `live`
  // stays unclaimed (the cube's true arrangement is precisely what is being asked) and the
  // subject and the screens hold still until the answer.
  if (state.reconnect) return;
  // The ONE place a correction is applied to the stream.
  const f = applyOffset(state.cube.offset, reported, Cube);
  if (f === null) {
    // A report that could not be established as truth is not a fact about the cube; and `live`
    // is cleared rather than left behind, or a current position and a stale one become
    // indistinguishable downstream.
    state.live = null;
    markStale('its last report could not be checked');
    return;
  }
  state.live = f;
  // An UNCHANGED report still reaches the screen. After a lost move packet, the snapshot that
  // proves the cube is back where the app already thought it was IS the correction — an early
  // return here swallowed it, and the follow model on a walking screen stayed wrong forever.
  // Only the ingest and the home repaint are deduplicated.
  const changed = !(state.cube.isPhysical && f === state.cube.facelets);
  // ingest, not set: a snapshot from the cube must not cost a Kociemba search.
  if (state.cube.isPhysical && changed) ingestFacelets(f);
  // Every update that arrives on a trusted chain replaces the remembered arrangement — the
  // record a reconnect is later compared against.
  if (chainTrusted()) {
    rememberLastSeen('cube');
  }
  if (hooks.liveUpdate) hooks.liveUpdate(f, serial);
  else if (changed && state.screen === 'home') shell.refreshScreen();
}
/** Test seam for the cube stream. In production the driver is the only caller of these (see
 * doConnect); following cannot otherwise be exercised without a physical GAN cube in the room,
 * which is precisely why its worst bug survived so long. Same shape as cubusGo above. */
window.cubusFeed = {
  move: (m) => onCubeMove(m),
  facelets: (f, serial) => onFacelets(f, serial),
  /** A turn that reached the cube but not us. No argument: reconciliation proves the loss and
   *  cannot count it, so a seam that took a number would let a test assert something the app can
   *  never know. */
  movesLost: () => onMovesLost(),
  disconnect: () => onDisconnect(),
  /** The cube answered nothing — what connectOnce's getState rejection reports. Exposed because
   *  that path needs Web Bluetooth to exercise for real, and the silence handling is exactly the
   *  behaviour that was once an empty catch. */
  silence: () => reportSilence(),
  /** Stand in for a paired driver. Setting `state.connected` alone is deliberately not enough —
   *  a flag saying "connected" with nothing behind it must fall back to the camera, which is its
   *  own test. This is the SAME call doConnect makes, not a lookalike: the address is part of a
   *  connection, and identity is what the registry keys on — so the key is RESOLVED here the way
   *  connectOnce resolves it, from the session's own address and its name. `mac` stands in for
   *  the address a real protocol layer would have published on the session; a fake that carries
   *  its own `mac` (including the empty one five of the ten protocols report) overrides it, which
   *  is how an addressless cube can be driven through this seam at all. */
  useConnection: (fake, mac = 'AA:BB:CC:DD:EE:FF') => {
    conn = fake;
    if (fake) {
      const session = { mac: fake.mac ?? mac, name: fake.name ?? 'Test cube' };
      adoptConnection(sessionIdentity(session), session.name);
    } else onDisconnect();
    // doConnect reads the battery on connect; a stand-in that skipped it would leave every test
    // looking at the "unknown" state and quietly never exercise the meter at all.
    if (fake) void refreshBattery();
  },
};
