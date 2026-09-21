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
 *              only path to truth. (§5) A DECLARED capability, so a cube that then reports a state
 *              has contradicted it and leaves this verdict — see `onFacelets`.
 *   `stream`   the move and state channels agree with each other. Strong evidence the decoder is
 *              right, and still not proof it matches the PHYSICAL cube — a uniformly mislabelled
 *              decoder is self-consistent.
 *   `trusted`  the camera agreed too. Everything above plus contact with reality.
 *   `refused`  something was provably wrong. Terminal for this connection; nothing downgrades a
 *              refusal back into a maybe.
 *
 * The order the evidence arrives in does not matter. A camera scan before the stream check has
 * passed leaves the offset in hand and the verdict where it was; the reconciliation that lands
 * afterwards reaches `trusted` just as a scan after a reconciliation does. Requiring one order was
 * a hole rather than a rule: the app's own repair flow scans FIRST, so a camera-first cube could
 * never become trusted at all (found 2026-09-04).
 */
export const VERDICT = Object.freeze({
  UNKNOWN: 'unknown',
  REDUCED: 'reduced',
  STREAM: 'stream',
  TRUSTED: 'trusted',
  REFUSED: 'refused',
});

/** How many un-reconciled moves are worth holding.
 *
 *  Generous on purpose: a cube reporting state at ~1 Hz produces a handful of moves between
 *  snapshots, so this is only reached when snapshots have stopped entirely — at which point the
 *  backlog is already unreconcilable and holding more of it buys nothing. */
const MAX_PENDING_MOVES = 512;

/** Why a verdict is what it is. Surfaced to the report (§7), so it is a fact, never a sentence. */
export const REASON = Object.freeze({
  NOTHING_YET: 'nothing-yet',
  ILLEGAL_STATE: 'illegal-state',
  RECONCILED: 'reconciled',
  /** One reconciliation failed and the checker re-baselined. Not a verdict on the cube. */
  RESYNCED: 'resynced',
  RECONCILE_FAILED: 'reconcile-failed',
  NO_STATE_REPORTS: 'no-state-reports',
  /** A cube that DECLARED it reports no state reported one. The declaration was wrong, and which
   *  half is wrong is not knowable — that they disagree is, and that is the reportable half. */
  CAPABILITY_CONTRADICTED: 'capability-contradicted',
  CAMERA_AGREED: 'camera-agreed',
  /** A scan re-established the correction after a lost turn. A repair, not a contradiction. */
  OFFSET_RESYNCED: 'offset-resynced',
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
  // ONE state record, and small transitions over it (audit-fix, 2026-09-21). This was fifteen `let`s read
  // and written across two eighty-line methods, and how a retraction interplays with a lost turn
  // could only be worked out by reading both end to end. Every transition below names the fields
  // it touches, mutates `s` in one place, and answers the verdict; the object returned is the
  // door and nothing more.
  const s = freshState();
  const limits = { needed, tolerated };

  return {
    get verdict() {
      return s.verdict;
    },
    get reason() {
      return s.reason;
    },
    /** The correction the camera established, or null. Only ever set by a passing camera check. */
    get offset() {
      return s.offset;
    },
    /** Counts, for the compatibility report. Facts a reader can check, not a summary. */
    get evidence() {
      return evidenceOf(s, limits);
    },

    /**
     * How many turns are known to have gone missing on this connection.
     *
     * Deliberately NOT derivable from the verdict: a cube the camera has confirmed stays trusted
     * through a lost packet — that is the whole point of the tolerance — so the verdict is exactly
     * the same before and after, and a caller watching only the verdict announces nothing. The
     * count is what rises, so the count is what a caller watches. (Found 2026-09-04: a lost turn
     * on a TRUSTED cube changed neither verdict nor reason, so nothing reached the screen.)
     */
    get losses() {
      return s.resyncs;
    },

    /** A full state the cube reported. */
    onFacelets(facelets) {
      if (settled(s)) return s.verdict;
      if (!Cube) return refuse(s, REASON.NO_CUBE_MODEL);
      s.stateReports++;
      // Legality first. A decoder producing an unreachable arrangement is wrong, and no amount of
      // later agreement makes it right.
      if (!isCubeState(facelets, Cube)) return refuse(s, REASON.ILLEGAL_STATE);
      noteDeclarationContradicted(s);
      return reconcileReport(s, facelets, Cube, limits);
    },

    /** One turn the cube reported, in standard notation. */
    onMove(notation) {
      if (settled(s)) return s.verdict;
      s.moveReports++;
      // A reduced cube never reports a state, so nothing will ever consume `pending`. Letting it
      // grow is an unbounded array for the life of a connection — hours, on a cube a child is
      // playing with. The count still rises; only the unusable backlog is dropped.
      if (s.verdict === VERDICT.REDUCED) return s.verdict;
      s.pending.push(notation);
      // The same leak by a different route: a cube that DECLARED facelet support and then stopped
      // sending reports also never drains this. A cap is safe because an over-long run is already
      // unreconcilable — the next report will not match it either way — so the only thing lost by
      // trimming is memory. Dropping the OLDEST keeps the run adjacent to the report that will
      // eventually arrive, which is the half that could still reconcile.
      if (s.pending.length > MAX_PENDING_MOVES) {
        s.pending.splice(0, s.pending.length - MAX_PENDING_MOVES);
      }
      return s.verdict;
    },

    /**
     * Say the cube reports moves but never a full state.
     *
     * Not inferred from silence: "no facelets yet" and "no facelets ever" are different, and
     * guessing between them is how a cube gets quietly demoted a second before its first report
     * arrives. The caller knows, from the connection's declared capabilities.
     *
     * A declaration, therefore, and not a fact — so a state report afterwards overrules it rather
     * than being ignored. `onFacelets` is where that happens.
     */
    declareNoStateReports() {
      if (settled(s)) return s.verdict;
      s.verdict = VERDICT.REDUCED;
      s.reason = REASON.NO_STATE_REPORTS;
      return s.verdict;
    },

    /**
     * The camera scanned the physical cube while it reported `reported`.
     *
     * This is the check that catches a decoder wrong the same way on both channels, and it is also
     * the repair — but only for the drift it was designed for: turns nobody counted while the link
     * was down. With `H` the turns before the break, `D` the untracked ones and `M` anything since,
     * the cube is at `H·D·M` and reports `H·M`, so the correction is `H·D·H⁻¹` — fixed the moment
     * H and D are, and unmoved by every later turn.
     *
     * **A uniformly relabelled decoder is NOT absorbed, and the comment here used to say it was**
     * (corrected 2026-09-04). A decoder reading the cube in a rotated frame reports `Y⁻¹·P·Y` for
     * a physical `P`, so the correction is `P·Y⁻¹·P⁻¹·Y` — a commutator, which moves with the
     * cube. Measured over all eighteen turns from a fixed scrambled state: it stays constant for
     * exactly the six U and D turns (the ones that commute with a y rotation) and moves for the
     * other twelve. So the constancy rule (`takeScan`) refuses such a decoder on the second scan,
     * which is the correct outcome: a rotated decoder is broken, because no fixed correction
     * repairs it.
     *
     * **`retracts`: this reading WITHDRAWS the previous scan rather than following it**
     * (2026-09-20). A sticker corrected by hand after a scan was accepted is not a second look at
     * the cube: the camera looked once, read one sticker wrong, and the corrected reading is the
     * only reading of that look there is. Judged as a second scan it differs from the first by
     * design — that is what a correction IS — so the constancy rule refused the cube for the
     * camera's own misread, and a fresh scan afterwards was refused for disagreeing with the
     * reading the person had just corrected (scanner audit 2026-09-20, §1.3). A retraction is
     * therefore not a contradiction: the first scan's offset is forgotten before this one is
     * derived, the scan count does not rise — one withdrawn, one put in its place — and the rest
     * of the rule stands: the NEXT scan with an intact stream between is held to this offset. With
     * no scan to withdraw it is an ordinary first scan — and so is a "retraction" of a scan that
     * is not the one standing (`takeScan` says how that is known).
     */
    onCameraScan(scanned, reported, { retracts = false } = {}) {
      if (settled(s)) return s.verdict;
      if (!Cube) return refuse(s, REASON.NO_CUBE_MODEL);
      if (!isCubeState(scanned, Cube) || !isCubeState(reported, Cube)) {
        // An unreadable scan is not evidence against the cube. Say nothing rather than accuse it.
        return s.verdict;
      }
      const derived = deriveOffset(scanned, reported, Cube);
      if (!derived) return refuse(s, REASON.CAMERA_DISAGREED);
      return takeScan(s, derived, reported, retracts);
    },
  };
}

/** Everything one connection's checker knows, before it has heard anything. */
function freshState() {
  return {
    verdict: VERDICT.UNKNOWN,
    reason: REASON.NOTHING_YET,
    lastState: null,
    pending: [],
    reconciled: 0,
    failed: 0,
    consecutiveFailures: 0,
    resyncs: 0,
    offsetResyncs: 0,
    contradictions: 0,
    stateReports: 0,
    moveReports: 0,
    cameraScans: 0,
    /** Camera scans withdrawn by a corrected reading of the same look — see `takeScan`. */
    retractions: 0,
    offset: null,
    /** Has a turn gone missing since the last camera scan?
     *
     *  The constancy rule in `takeScan` rests on "the physical cube and the cube's own tracking
     *  differ by a CONSTANT permutation" — which holds only while nothing new goes untracked. A
     *  reconciliation failure is exactly the event that breaks it: turns happened that the cube did
     *  not record, so the correction legitimately moves. Without this flag the next scan looked
     *  like a decoder contradicting itself and the cube was refused for repairing itself. */
    lostSinceScan: false,
    /** The report the standing scan was derived against: the LOOK of the cube that scan read, and
     *  the one thing a retraction may withdraw. See `takeScan`. */
    scanReported: null,
  };
}

/** Terminal by construction: once something is provably wrong, nothing argues it back. */
function refuse(s, why) {
  s.verdict = VERDICT.REFUSED;
  s.reason = why;
  return s.verdict;
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
function settled(s) {
  return s.verdict === VERDICT.REFUSED;
}

/**
 * A cube that DECLARED it never reports a full state has just reported one. The declaration and
 * the stream disagree, and this is the only place that can notice.
 *
 * Not a refusal: reporting MORE than was declared is no evidence the decoder is wrong. But leaving
 * it in `reduced` would be worse than either — the verdict would go on saying "nothing can be
 * reconciled" about a stream that is arriving, so the reconciliation check would never run, the
 * offset could never be sourced, and no screen would ever say why. It returns to `unknown` and
 * takes the ordinary path from here; the contradiction is counted and named, so it is reported
 * rather than absorbed.
 */
function noteDeclarationContradicted(s) {
  if (s.verdict !== VERDICT.REDUCED) return;
  s.contradictions++;
  s.verdict = VERDICT.UNKNOWN;
  s.reason = REASON.CAPABILITY_CONTRADICTED;
}

/** A legal report against the moves since the last one: a resync, a refusal, or a step towards
 *  trust. The one transition that reads `pending`, and it empties it. */
function reconcileReport(s, facelets, Cube, { needed, tolerated }) {
  const answer = reconciles(s.lastState, s.pending, facelets, Cube);
  s.lastState = facelets;
  s.pending = [];
  if (answer === false) {
    s.failed++;
    s.consecutiveFailures++;
    // Persistent contradiction means the move channel and the state channel disagree about the
    // same cube, and we cannot tell which lies — so neither is usable. That is a refusal, not a
    // demotion to reduced trust, which means something else entirely ("reports no state").
    if (s.consecutiveFailures >= tolerated) return refuse(s, REASON.RECONCILE_FAILED);
    // Below the threshold: RESYNC. `lastState` has already been re-baselined to the state the
    // cube just reported, so the next reconciliation starts from solid ground rather than
    // measuring against a snapshot we already know is stale. A cube that has been trusted
    // stays trusted through a lost packet; one that has not, waits.
    s.resyncs++;
    // Two things a lost turn does, and both of them matter whatever the verdict is.
    //
    // The reason moves even on a TRUSTED cube — it used to be suppressed there, which meant a
    // trusted cube losing a turn changed nothing at all and the app announced nothing. The
    // whole point of tolerating a loss is that the VERDICT survives it, so the verdict cannot
    // also be the channel that reports it.
    //
    // And the correction is now stale: turns happened off the record, so the next scan must be
    // allowed to re-baseline rather than being read as a decoder contradicting itself.
    s.reason = REASON.RESYNCED;
    s.lostSinceScan = true;
    return s.verdict;
  }
  if (answer === true) {
    s.consecutiveFailures = 0;
    s.reconciled++;
    if (s.reconciled >= needed) {
      // Order-free. A camera check that already passed is standing evidence, so the
      // reconciliation that completes the pair reaches TRUSTED whichever arrived first —
      // and a cube already TRUSTED lands here too, which is how the reason comes back from
      // `resynced` after a recovered link. Never a demotion: the checks keep running on a
      // trusted cube, but only a refusal moves it down.
      if (s.cameraScans > 0) {
        s.verdict = VERDICT.TRUSTED;
        s.reason = REASON.CAMERA_AGREED;
      } else if (s.verdict !== VERDICT.TRUSTED) {
        s.verdict = VERDICT.STREAM;
        s.reason = REASON.RECONCILED;
      }
    }
  }
  return s.verdict;
}

/**
 * A correction the camera derived, taken as evidence: the constancy rule, the retraction of a
 * scan, and what either does to the verdict.
 *
 * What a SECOND scan buys, and what a first one cannot. `deriveOffset` succeeds for any two legal
 * states — it simply computes the difference — so a single scan can never reject anything. That is
 * a property of the arithmetic, not a gap in the wiring, and pretending otherwise would make this
 * the weakest of the three checks while it is described as the strongest.
 *
 * What IS checkable is the word "constant" in "the constant correction between what the cube
 * reports and what it physically is". A correction that changes between two observations is not a
 * correction; it means the cube's reports and the physical cube are not related by any fixed
 * permutation, which is exactly the self-consistent-but-wrong decoder this check exists to catch.
 *
 * And the one case where a moved correction is innocent, which the rule used to accuse: a turn
 * went missing in between. Then D grew, so H·D·H⁻¹ genuinely changed, and the scan is the repair
 * rather than the contradiction. The window is exact — it opens on a reconciliation failure and
 * closes on the next scan — so the rule still holds over every pair of scans with an intact stream
 * between them, which is the pair that can prove anything.
 *
 * A RETRACTION IS OF THE SCAN THAT STANDS, AND THE CHECKER KNOWS WHICH THAT IS (2026-09-20).
 * `retracts` used to be honoured whenever any scan had ever been taken, so a reading flagged as a
 * correction after the cube had been turned — a report later than the one the standing scan read —
 * walked past the constancy rule, replaced the offset, cleared `lostSinceScan` and could leave the
 * cube TRUSTED on a comparison the rule exists to make (audit-fix, 2026-09-21). A correction is of
 * one LOOK of the cube, and the look a scan read is named by the report it was derived against:
 * only a reading derived against that same report withdraws it. Anything else is an ordinary scan,
 * however it is flagged, and is held to the offset like one.
 */
function takeScan(s, derived, reported, retracts) {
  const retracting = retracts && s.scanReported !== null && s.scanReported === reported;
  if (retracting) s.retractions++;
  const rebaselined = !retracting && s.offset !== null && derived !== s.offset;
  if (rebaselined) {
    if (!s.lostSinceScan) return refuse(s, REASON.CAMERA_DISAGREED);
    s.offsetResyncs++;
  }
  s.offset = derived;
  s.lostSinceScan = false;
  s.scanReported = reported;
  if (!retracting) s.cameraScans++;
  // Reaching the camera without the stream check having passed leaves the move channel
  // unproven, so a reduced cube stays reduced: it has an offset now, but still may not source
  // one from its own reports. An UNKNOWN cube keeps its verdict too — and keeps the scan as
  // standing evidence, which is what lets `reconcileReport` finish the pair in either order.
  if (s.verdict === VERDICT.STREAM) s.verdict = VERDICT.TRUSTED;
  if (s.verdict === VERDICT.TRUSTED) {
    s.reason = rebaselined ? REASON.OFFSET_RESYNCED : REASON.CAMERA_AGREED;
  }
  return s.verdict;
}

/** The counts, as the report carries them. */
function evidenceOf(s, { needed, tolerated }) {
  return {
    reconciled: s.reconciled,
    failed: s.failed,
    resyncs: s.resyncs,
    offsetResyncs: s.offsetResyncs,
    contradictions: s.contradictions,
    consecutiveFailures: s.consecutiveFailures,
    stateReports: s.stateReports,
    moveReports: s.moveReports,
    cameraScans: s.cameraScans,
    retractions: s.retractions,
    needed,
    tolerated,
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
