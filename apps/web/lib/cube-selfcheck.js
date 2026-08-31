// Whether a decoder we have never run against its hardware may be believed.
//
// The app ships protocols nobody here owns a cube for (dev-docs/universal-cube-driver.md §6). The
// previous rule was "a brand without a capture does not ship — not behind a flag, not with a
// warning". That rule was protecting against ONE thing: believing a decode that has never been
// checked. This replaces it with a mechanism that never believes one, so the shipping question and
// the trusting question come apart.
//
// Three checks, layered, each catching what the one before it cannot:
//
//   Legality        the reported state is a reachable cube      catches garbage, wrong framing
//   Reconciliation  moves replay into the next reported state   catches a wrong move channel
//   Camera          the physical cube agrees                    catches a self-consistent lie
//
// Reconciliation is the strong one and it costs nothing: a wrong move decoder essentially never
// replays into the next facelet string. It is the same discipline as `crossChecked` in the solve
// path — one implementation checking itself proves nothing, so the two channels check each other
// and the camera checks both against the world.
//
// Pure. No DOM, no events, no timers; cubejs is injected exactly as it is in cube-trust.js.

import { deriveOffset, isCubeState } from './cube-trust.js';

/**
 * What we are entitled to believe about a cube right now.
 *
 * These are not confidence levels. Each names a different thing that is known, and the app treats
 * them differently:
 *
 *   `unknown`  nothing yet. The starting state, and the state after a reconnect.
 *   `reduced`  the cube reports moves but never a full state, so nothing can be reconciled. It may
 *              drive move-following; it may never source the trust offset. A camera scan is its
 *              only path to truth. (§5)
 *   `stream`   the move and state channels agree with each other. Strong evidence the decoder is
 *              right, and still not proof it matches the PHYSICAL cube — a uniformly mislabelled
 *              decoder is self-consistent.
 *   `trusted`  the camera agreed too. Everything above plus contact with reality.
 *   `refused`  something was provably wrong. Terminal for this connection; nothing downgrades a
 *              refusal back into a maybe.
 */
/** How many un-reconciled moves are worth holding.
 *
 *  Generous on purpose: a cube reporting state at ~1 Hz produces a handful of moves between
 *  snapshots, so this is only reached when snapshots have stopped entirely — at which point the
 *  backlog is already unreconcilable and holding more of it buys nothing. */
const MAX_PENDING_MOVES = 512;

export const VERDICT = Object.freeze({
  UNKNOWN: 'unknown',
  REDUCED: 'reduced',
  STREAM: 'stream',
  TRUSTED: 'trusted',
  REFUSED: 'refused',
});

/** Why a verdict is what it is. Surfaced to the report (§7), so it is a fact, never a sentence. */
export const REASON = Object.freeze({
  NOTHING_YET: 'nothing-yet',
  ILLEGAL_STATE: 'illegal-state',
  RECONCILED: 'reconciled',
  /** One reconciliation failed and the checker re-baselined. Not a verdict on the cube. */
  RESYNCED: 'resynced',
  RECONCILE_FAILED: 'reconcile-failed',
  NO_STATE_REPORTS: 'no-state-reports',
  CAMERA_AGREED: 'camera-agreed',
  CAMERA_DISAGREED: 'camera-disagreed',
  NO_CUBE_MODEL: 'no-cube-model',
});

/**
 * Does applying `moves` to `from` produce exactly `to`?
 *
 * The whole reconciliation check, and deliberately the narrowest possible statement of it: move
 * application only, no search, microseconds. An empty move list is NOT evidence — two identical
 * consecutive reports say nothing about the move channel — so it answers `null` rather than true.
 *
 * @returns {boolean|null} null when the question cannot be asked (no moves, or unusable input).
 */
export function reconciles(from, moves, to, Cube) {
  if (!Cube || typeof Cube.fromString !== 'function') return null;
  if (!Array.isArray(moves) || moves.length === 0) return null;
  if (!isCubeState(from, Cube) || !isCubeState(to, Cube)) return null;
  try {
    return Cube.fromString(from).move(moves.join(' ')).asString() === to;
  } catch {
    // A notation the cube model cannot parse is a fact about the move channel, not an accident:
    // it means the decoder emitted something that is not a turn. Report it as a failure to
    // reconcile rather than as "could not ask".
    return false;
  }
}

/**
 * Track one connection's evidence and hand back a verdict.
 *
 * Feed it what the cube says. It never asks the cube for anything, never touches the DOM, and
 * never decides what the app does with the answer — that separation is what lets it be tested
 * without hardware, a driver, or a screen.
 *
 * @param {object} opts
 * @param {Function} opts.Cube cubejs constructor, injected.
 * @param {number} [opts.needed] successful reconciliations before the stream is believed.
 *   One is the default and is already strong; the option exists so a caller can demand more of a
 *   brand nobody has ever run, not so it can demand fewer.
 * @param {number} [opts.tolerated] consecutive reconciliation failures before the cube is refused.
 *
 *   Not a softening of the check — a correction of it. A single failure used to be a permanent
 *   refusal, which conflates two different events: a WRONG DECODER, which fails every time, and a
 *   LOST PACKET, which is weather on a radio link and fails once. Under the old rule one moment of
 *   Bluetooth interference made a perfectly good cube untrusted for the rest of the session, with
 *   no way back.
 *
 *   Three is deliberate rather than round: a wrong decoder produces a failure on essentially every
 *   reconciliation, so it reaches three within a few seconds of turning, while three consecutive
 *   losses on a working link is a connection already failing in ways the user can see.
 */
export function createSelfCheck({ Cube, needed = 1, tolerated = 3 } = {}) {
  let verdict = VERDICT.UNKNOWN;
  let reason = REASON.NOTHING_YET;
  let lastState = null;
  let pending = [];
  let reconciled = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let resyncs = 0;
  let stateReports = 0;
  let moveReports = 0;
  let cameraScans = 0;
  let offset = null;

  /** Terminal by construction: once something is provably wrong, nothing argues it back. */
  function refuse(why) {
    verdict = VERDICT.REFUSED;
    reason = why;
    return verdict;
  }

  /**
   * Only a REFUSAL stops the checking.
   *
   * `TRUSTED` used to stop it too, which had the checks switch themselves off at the exact moment
   * they started mattering: one good reconciliation and a camera scan, and every later
   * contradiction was ignored for the rest of the connection. Trust is a running claim about a
   * live stream, not a badge awarded once — a cube whose decoder goes wrong at move 200 must still
   * be caught.
   */
  function settled() {
    return verdict === VERDICT.REFUSED;
  }

  return {
    get verdict() {
      return verdict;
    },
    get reason() {
      return reason;
    },
    /** The correction the camera established, or null. Only ever set by a passing camera check. */
    get offset() {
      return offset;
    },
    /** Counts, for the compatibility report. Facts a reader can check, not a summary. */
    get evidence() {
      return {
        reconciled,
        failed,
        resyncs,
        consecutiveFailures,
        stateReports,
        moveReports,
        cameraScans,
        needed,
        tolerated,
      };
    },

    /** A full state the cube reported. */
    onFacelets(facelets) {
      if (settled()) return verdict;
      if (!Cube) return refuse(REASON.NO_CUBE_MODEL);
      stateReports++;

      // Legality first. A decoder producing an unreachable arrangement is wrong, and no amount of
      // later agreement makes it right.
      if (!isCubeState(facelets, Cube)) return refuse(REASON.ILLEGAL_STATE);

      const answer = reconciles(lastState, pending, facelets, Cube);
      lastState = facelets;
      pending = [];
      if (answer === false) {
        failed++;
        consecutiveFailures++;
        // Persistent contradiction means the move channel and the state channel disagree about the
        // same cube, and we cannot tell which lies — so neither is usable. That is a refusal, not a
        // demotion to reduced trust, which means something else entirely ("reports no state").
        if (consecutiveFailures >= tolerated) return refuse(REASON.RECONCILE_FAILED);
        // Below the threshold: RESYNC. `lastState` has already been re-baselined to the state the
        // cube just reported, so the next reconciliation starts from solid ground rather than
        // measuring against a snapshot we already know is stale. A cube that has been trusted
        // stays trusted through a lost packet; one that has not, waits.
        resyncs++;
        if (verdict !== VERDICT.TRUSTED) reason = REASON.RESYNCED;
        return verdict;
      }
      if (answer === true) {
        consecutiveFailures = 0;
        reconciled++;
        // Never demote a cube the camera has already confirmed — but do keep checking it.
        if (reconciled >= needed && verdict !== VERDICT.TRUSTED) {
          verdict = VERDICT.STREAM;
          reason = REASON.RECONCILED;
        }
      }
      return verdict;
    },

    /** One turn the cube reported, in standard notation. */
    onMove(notation) {
      if (settled()) return verdict;
      moveReports++;
      // A reduced cube never reports a state, so nothing will ever consume `pending`. Letting it
      // grow is an unbounded array for the life of a connection — hours, on a cube a child is
      // playing with. The count still rises; only the unusable backlog is dropped.
      if (verdict === VERDICT.REDUCED) return verdict;
      pending.push(notation);
      // The same leak by a different route: a cube that DECLARED facelet support and then stopped
      // sending reports also never drains this. A cap is safe because an over-long run is already
      // unreconcilable — the next report will not match it either way — so the only thing lost by
      // trimming is memory. Dropping the OLDEST keeps the run adjacent to the report that will
      // eventually arrive, which is the half that could still reconcile.
      if (pending.length > MAX_PENDING_MOVES) pending.splice(0, pending.length - MAX_PENDING_MOVES);
      return verdict;
    },

    /**
     * Say the cube reports moves but never a full state.
     *
     * Not inferred from silence: "no facelets yet" and "no facelets ever" are different, and
     * guessing between them is how a cube gets quietly demoted a second before its first report
     * arrives. The caller knows, from the connection's declared capabilities.
     */
    declareNoStateReports() {
      if (settled()) return verdict;
      verdict = VERDICT.REDUCED;
      reason = REASON.NO_STATE_REPORTS;
      return verdict;
    },

    /**
     * The camera scanned the physical cube while it reported `reported`.
     *
     * This is the check that catches a decoder wrong the same way on both channels, and it is also
     * the repair: the offset absorbs a uniform colour-scheme or orientation permutation, so a
     * consistently rotated decoder is not broken, it is offset.
     */
    onCameraScan(scanned, reported) {
      if (settled()) return verdict;
      if (!Cube) return refuse(REASON.NO_CUBE_MODEL);
      if (!isCubeState(scanned, Cube) || !isCubeState(reported, Cube)) {
        // An unreadable scan is not evidence against the cube. Say nothing rather than accuse it.
        return verdict;
      }
      const derived = deriveOffset(scanned, reported, Cube);
      if (!derived) return refuse(REASON.CAMERA_DISAGREED);

      // What a SECOND scan buys, and what a first one cannot.
      //
      // `deriveOffset` succeeds for any two legal states — it simply computes the difference — so
      // a single scan can never reject anything. That is a property of the arithmetic, not a gap
      // in the wiring, and pretending otherwise would make this the weakest of the three checks
      // while it is described as the strongest.
      //
      // What IS checkable is the word "constant" in "the constant correction between what the cube
      // reports and what it physically is". A correction that changes between two observations is
      // not a correction; it means the cube's reports and the physical cube are not related by a
      // fixed relabelling, which is exactly the self-consistent-but-wrong decoder this check
      // exists to catch.
      if (offset !== null && derived !== offset) return refuse(REASON.CAMERA_DISAGREED);
      offset = derived;
      cameraScans++;
      // Reaching the camera without the stream check having passed leaves the move channel
      // unproven, so a reduced cube stays reduced: it has an offset now, but still may not source
      // one from its own reports.
      if (verdict === VERDICT.STREAM) {
        verdict = VERDICT.TRUSTED;
        reason = REASON.CAMERA_AGREED;
      }
      return verdict;
    },
  };
}

/** May this cube's own reports be used as the source of the trust offset? (§5) */
export function maySourceOffset(verdict) {
  return verdict === VERDICT.TRUSTED;
}

/**
 * May this cube drive move-following?
 *
 * Everything except a refusal, and `unknown` is deliberately included. Following a cube's moves
 * mirrors turns; it is not a claim about where the cube IS, which is what `maySourceOffset` guards.
 * Excluding `unknown` — as this did — meant a freshly connected cube could not drive the walk until
 * its first reconciliation landed, so the first turn or two of every session went nowhere. That is
 * a visible regression bought with no safety: an unverified cube is not a cube known to be wrong.
 *
 * A REFUSED cube is different in kind. The checker has PROVED its own two channels disagree, so
 * its moves are not merely unproven, they are known not to add up.
 */
export function mayFollowMoves(verdict) {
  return verdict !== VERDICT.REFUSED;
}
