// Every report the connected cube sends, and what the app does with it: the first report, which
// answers the reconnect question; the snapshots, which become the subject on a trusted chain; the
// turns that drive a walk, and a turn that went missing; a camera repair derived against a report;
// and the connection ending. The state that lives only between one report and the next is here.
//
// It sits beneath the connection, which registers these on each session it takes hold of, and
// above the session handle (lib/live-session.js), trust (lib/cube-trust-state.js) and what the app
// remembers (lib/cube-memory.js). It reaches the shell only through `shell`, and a mounted screen
// only through `hooks`.
//
// Lifted out of lib/cube-connection.js on 2026-09-13 (the connection design's fourth unit).
import { state } from './app-state.js';
import { cubes, rememberArrangement, rememberConnection } from './cube-memory.js';
// Reconnecting a known cube: the readings that choose the picture and the words on reconnect, and
// the two-adjacent-side camera check that supports the user's answer. Never the trust — only the
// user's answer grants that (dev-docs/smart-cube-ux-prd.md, "Reconnecting a known cube").
import { classifyReconnect } from './cube-reconnect.js';
import { normaliseIdentity } from './cube-registry.js';
import { ingestFacelets } from './cube-subject.js';
import {
  chainTrusted, clearOffset, installOffset, markStale, repaintSettings, setConnected,
} from './cube-trust-state.js';
import { applyOffset } from './cube-trust.js';
import { conn, cubeRefused, holdSession, turnsReported } from './live-session.js';
import { hooks, shell } from './screen-slots.js';
import { Cube } from './solver-service.js';

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
const TURNED_SINCE_SCAN = 'it was turned after the camera saw it, before its next report';
/** What a repair that established nothing says. Tracking is unchanged, and the scan is not adopted
 *  over a report it could not be related to. */
const SCAN_UNCHECKED = 'This scan could not be checked against what your cube reports, so nothing was changed — scan it again.';
/** The 16-bit serial that came with the latest report, or null when it carried none. Stored
 *  beside the memory as information for wording, never proof: the GAN16's counter is
 *  per-connection and says nothing across a break. */
let lastSerialSeen = null;
/** The session's turn count when `state.reported` was recorded. A report says where the cube IS
 *  only while that count stands: after a turn it describes a cube that has since moved, which for a
 *  repair is the same as no report at all (repairTracking holds the scan for the next one). */
let reportedAtTurns = 0;
/** The camera reading this connection's checker holds as its STANDING evidence — the report it was
 *  derived against — or null when the last reading handed to `repairTracking` was not taken (a
 *  contradiction, a refusal, nothing established). It is what a corrected reading of the same look
 *  withdraws (see `retracting` there), and only that: a correction of a reading this layer refused
 *  withdraws nothing, because nothing of it stands. Cleared with the connection. */
let standingScan = null;

/**
 * Does what the cube has said account for every turn it has counted?
 *
 * A turn is counted the moment the cube reports it, and the snapshot that shows where it landed
 * follows about a second later, so in that window the report in force — and anything derived from
 * it — describes the cube BEFORE the turn. Exported because two readers need the same fact and two
 * ways of asking it would drift: a camera repair has nothing to derive against (repairTracking),
 * and the scan screen's reconnect check has no prediction to judge a side against
 * (lib/screens/scan/reconnect-check.js), which judged a side read after the turn against the cube
 * before it and called it a mismatch (found by verification, 2026-09-14).
 *
 * With no report at all the count is the connection's own zero, which is the moment the remembered
 * arrangement describes — so a check that has only the memory to go on is current until a turn.
 */
export const reportIsCurrent = () => reportedAtTurns === turnsReported();

/** Remember the arrangement the app is sure of (lib/cube-memory.js) with this connection's serial,
 *  and repaint Settings when the write's health flipped — which the memory, beneath the screens,
 *  does not do itself. */
export function rememberLastSeen(how, { force = false } = {}) {
  // Not while a scan waits for its report: `live` and the report beside it are from before the
  // camera looked, and remembering them would date that pair to now.
  if (scanAwaitingReport) return;
  if (rememberArrangement(how, { force, serial: lastSerialSeen ?? null })) repaintSettings();
}

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
 *  `retracting` says the reading is a CORRECTION of the scan before it — a sticker fixed by hand
 *  on a reading already accepted — and not a second look at the cube (2026-09-20). The two differ
 *  in what they say about the first scan: a second scan that disagrees says one of the two is
 *  wrong and nothing can tell which; a correction says the first was wrong, where, and that the
 *  corrected reading is the only reading of that look the camera ever produced. So it is not
 *  compared against the correction the first scan installed — that correction was derived from
 *  the very sticker being fixed, and comparing against it refused every genuine correction as
 *  "not what your cube is reporting" (scanner audit 2026-09-20, §1.3) — and the checker is told
 *  to withdraw the first scan rather than count a second (`cameraScan(…, { retracts })`), so its
 *  constancy rule has no pair to judge and a fresh scan afterwards is held to the corrected
 *  offset, not the misread one. Only when the first scan STANDS: a correction of a reading this
 *  layer refused is judged exactly as before, because that reading became nothing. And only
 *  against the report the standing scan was derived from: a look corrected after the cube has
 *  reported a turn describes the cube before it, and the screen hands those sides back to the
 *  camera before this is reached; here it is simply not a retraction. A correction that arrives
 *  while a report is awaited replaces the held scan as any scan does, and is reconciled as an
 *  observation: a held look cannot withdraw a scan the checker took, only follow it.
 *
 *  @returns {{ok: boolean, text: string}|null} what to tell the user, or null when the scan
 *  changed nothing about tracking (no cube, or it already agreed).
 */
export function repairTracking(scanned, { tracking = chainTrusted(), retracting = false } = {}) {
  if (!state.connected || !conn) return null;
  // A refused cube cannot be repaired by a camera, and this is the door that used to let one be.
  // The correction is derived FROM the cube's own report; if that report has been proved not to
  // add up, the correction built on it is arithmetic over a fiction — and adopting the scan
  // afterwards called the cube trusted again. A refusal is about the cube, and only a fresh
  // connection can revisit it.
  if (cubeRefused()) {
    standingScan = null;
    return {
      ok: false,
      text: 'This cube’s own reports have stopped adding up, so a scan cannot put it back in step — what the camera saw would be measured against a reading that means nothing. Disconnect it and pair again; the camera still solves the cube either way.',
    };
  }
  // The RAW report, not state.live: live has already had the current offset applied, so deriving
  // against it yields the identity — overwriting a correction the cube still needs.
  const reported = state.reported;
  if (!reported || !reportIsCurrent()) {
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
    //
    // A report from before the latest turn is the same case (found by audit, 2026-09-13): the pair
    // derived an offset of exactly that turn, and the next report was corrected by it twice over.
    // `tracking` travels with the hold, because by the report the trust in force is the scan's own.
    const heldTracking = scanAwaitingReport ? scanAwaitingReport.tracking : tracking;
    scanAwaitingReport = { facelets: scanned, turns: turnsReported(), tracking: heldTracking };
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
  //
  // Not on a retraction of the scan that stands: the correction in force is the one that scan
  // derived from the sticker now being fixed (the header says why).
  const retracts = retracting && standingScan !== null && standingScan.reported === reported;
  if (!retracts && tracking && scanned !== applyOffset(state.cube.offset, reported, Cube)) {
    standingScan = null;
    return {
      ok: false,
      text: 'This is not what your cube is reporting, and the cube was tracking. One of the two is wrong, so nothing was changed — check that you scanned the cube that is connected.',
    };
  }
  const offset = conn.cameraScan(scanned, reported, { retracts });
  // The checker may have REFUSED on this very scan — two scans implying two different corrections
  // with an unbroken stream between them is the self-consistent-but-wrong decoder it exists to
  // catch. Asked after the scan, because that is when the answer exists; `offset` still holds the
  // previous correction in that case, so applying it would silently keep a correction the checker
  // has just disowned.
  if (cubeRefused()) {
    standingScan = null;
    return {
      ok: false,
      text: 'This scan and the last one imply two different corrections, with nothing lost in between — so what this cube reports cannot be corrected by any fixed amount. cubus has stopped trusting its reports; the camera still solves it.',
    };
  }
  // A checker that established nothing repaired nothing, and the scan must not be adopted as if it
  // had: the next report would replace it, uncorrected, under the camera's trust.
  if (offset === null) { standingScan = null; return { ok: false, text: SCAN_UNCHECKED }; }
  // Recomputed on the spot: live is the last report WITH the correction applied, and leaving it
  // describing the old correction until the next ~1s snapshot lands means everything reading it
  // in between sees a position that is no longer claimed.
  const corrected = installOffset(offset, 'scan', [reported], Cube);
  if (corrected === null) { standingScan = null; return { ok: false, text: SCAN_UNCHECKED }; }
  standingScan = { reported };
  state.live = corrected;
  return state.cube.offset
    ? { ok: true, text: 'Tracking repaired — your cube is back in step for as long as it stays connected, and you never had to solve it.' }
    : null;
}

/** The cube is gone — dropped, or deliberately let go. ONE body, used by the driver's event, the
 *  Disconnect button and the failure path in connectOnce. Idempotent. */
export function onDisconnect() {
  holdSession(null);
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
  // And the scan that stood is evidence about a chain that has ended: nothing to withdraw now.
  standingScan = null;
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
export function onMovesLost() {
  markStale('a turn went unrecorded');
  if (hooks.liveGap) hooks.liveGap();
}

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
export function onCubeMove(m) {
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
export function adoptConnection(mac, name) {
  rememberConnection(mac, name);
  // A new connection starts knowing nothing about this cube. Trust and the last report belong to
  // the chain that just ended: inheriting them let a freshly paired cube be treated as verified
  // on the strength of a camera scan of some *other* cube.
  state.live = null;
  state.reported = null;
  // With the report, the count it was recorded at: the new session counts its own turns from zero,
  // so the last one's count left behind would say the report is a turn behind, or abreast of one
  // it never saw.
  reportedAtTurns = 0;
  lastSerialSeen = null;
  // Including a scan that was waiting to be reconciled: it is evidence about the cube that was in
  // front of the camera, and this may be another one. The same for the scan that stood.
  scanAwaitingReport = null;
  standingScan = null;
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

/** Say that the reconnect question changed: Home refreshes to show it; from any other screen,
 *  Settings repaints. */
function questionChanged() {
  if (state.screen === 'home') shell.refreshScreen();
  else repaintSettings();
}

/** The cube answered nothing — getState timed out or rejected. This used to be swallowed with an
 *  empty catch, and the screen showed a connected cube that had said nothing; now it is said. The
 *  reading is already 'no-report' when something is remembered (set at adoptConnection); with
 *  nothing remembered this is the moment the silence becomes a question worth drawing at all. */
export function reportSilence() {
  if (!state.connected || !awaitingReport) return;
  if (!state.reconnect) {
    state.reconnect = { reading: 'no-report', candidate: null, raw: null, seenAt: 0 };
  }
  questionChanged();
}

/** A camera reading held for this connection's first report, reconciled against that report.
 *  @returns {boolean} false when the report must go no further: the scan and it could not be
 *  reconciled. */
function reconcileHeldScan() {
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
  if (!scanAwaitingReport) return true;
  const { facelets: scanned, tracking } = scanAwaitingReport;
  scanAwaitingReport = null;
  awaitingReport = false;
  state.reconnect = null;
  const repaired = repairTracking(scanned, { tracking });
  if (repaired && !repaired.ok) {
    // The camera and this cube cannot be related by any fixed correction. The scan was good
    // knowledge of the cube in the hand; it is not knowledge of what this stream means, and a
    // stream nothing could reconcile must not go on being read as the trusted subject.
    markStale('a scan and the cube’s next report could not be reconciled');
    return false;
  }
  return true;
}

/** The reconnect question, as a report meets it: the connection's first report reads the
 *  evidence, and every report finds out whether a question is open.
 *  @returns {boolean} true when a question holds the subject, so the report goes no further. */
function readFirstReport(reported) {
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
      if (state.cube.isPhysical) ingestFacelets(r.candidate);
      questionChanged();
      return true;
    }
    // Nothing remembered (or nothing derivable): no question to ask — today's flow, in
    // publishReport. A question opened over the memory alone ('no report') closes here: the
    // report is the better evidence, and it said the memory was not usable after all.
    const hadQuestion = Boolean(state.reconnect);
    state.reconnect = null;
    if (hadQuestion) questionChanged();
  }
  // The candidate is FROZEN while the reconnect question is open: an untrusted report updating
  // the picture being confirmed would make it a picture nobody can confirm. The raw report is
  // still recorded, by onFacelets before this — the Yes derives against it and the repair scan
  // reads it — but `live` stays unclaimed (the cube's true arrangement is precisely what is being
  // asked) and the subject and the screens hold still until the answer.
  return Boolean(state.reconnect);
}

/** A report no question holds, on its way to the stream: corrected, made the subject when the
 *  subject is this cube, remembered on a trusted chain, and handed to the screen. */
function publishReport(reported, serial) {
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

/** A snapshot from the connected cube. Always records what the cube says; only changes the
 *  SUBJECT when the subject is that cube — otherwise pressing Random would have its arrangement
 *  quietly replaced by the real one a second later. */
export function onFacelets(reported, serial) {
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
  reportedAtTurns = turnsReported();
  lastSerialSeen = Number.isInteger(serial) ? serial & 0xffff : null;
  if (!reconcileHeldScan()) return;
  if (readFirstReport(reported)) return;
  publishReport(reported, serial);
}
