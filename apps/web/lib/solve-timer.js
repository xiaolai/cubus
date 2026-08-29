// Timing a solve from the cube's own clock.
//
// ## Which clock, and why it is not the browser's
//
// A move arrives over BLE with variable latency — tens of milliseconds, and not constant. Timing
// on `performance.now()` at arrival therefore measures the radio as much as the solver, and the
// error lands unevenly across a solve. The GAN driver hands every move TWO times:
//
//     timestamp       host receive time (ms since epoch)  — carries BLE jitter
//     cubeTimestamp   the cube's own hardware clock (ms)  — monotonic while connected
//
// The cube stamps the move when it registers it, before any radio is involved, so `cubeTimestamp`
// deltas are what a solve actually took. This module uses only those. The host clock is kept for
// one job: a sanity cross-check (see `HOST_DISAGREEMENT_MS`).
//
// ## What is measured, precisely
//
//     ready    the instant the cube was verified sitting at the scramble arrangement
//     start    cubeTimestamp of the first move after that
//     end      cubeTimestamp of the move that left the cube solved
//
//     inspection = start - ready       how long the solver looked before touching it
//     elapsed    = end - start         the solve
//
// `ready` is recorded, not merely a flag, because it is the precondition the whole measurement
// rests on: a solve whose ready instant was never captured cannot be timed, and one whose ready
// is hours old is a cube left on a desk rather than a solve about to begin.
//
// ## The one bias, named rather than corrected
//
// `start` is the first move's COMPLETION, not its onset, so that move's own duration — order
// 100 ms for a fast solver, 300-500 ms for a beginner — is not counted. This is a hardware limit,
// not a design choice: a GAN cube emits a MOVE event when the face crosses its detection
// threshold, and there is no "move began" event. The gyro stream cannot stand in for one — it
// reports the whole cube's orientation in space rather than face rotation, carries only a host
// timestamp (reintroducing the BLE jitter this module exists to avoid), and is present only on
// `ui` models.
//
// Estimating the missing duration and subtracting it would manufacture a number the cube never
// reported, so it is not done. The bias is under 1% of a beginner's solve, always in the same
// direction, and identical across every solve recorded here — so it does not affect a user
// comparing against their own history, which is what this timer is for. It would matter only
// against a stackmat.
//
// ## When this refuses
//
// Refusing is the point. Every path that cannot produce a true number returns null rather than a
// plausible one, and the caller falls back to the manual timer:
//
//   * `cubeTimestamp` absent — the driver types it `number | null`, and a null is not a time.
//   * The cube's clock went backwards or the span is absurd — a reconnect resets the hardware
//     clock, so a solve spanning one is untimeable. Trust breaks on disconnect anyway.
//   * Moves were dropped. The driver numbers moves and snapshots with the same `serial`, so a
//     snapshot arriving further ahead than the moves we saw means packets were lost — and the
//     last move we hold is then not the move that finished the solve, which would undercount.
//   * The cube's own span and the host's disagree wildly, which means one of them is lying.
//
// ## Why this is a module and not screen code
//
// Phase 4 of dev-docs/smart-cube-ux-prd.md was built once, marked DONE, and did not survive the
// smart-cube removal and restore of 2026-08-26/28 — alone among the phases, because it lived
// entirely inside the Timer screen's body while phases 0, 2, 5 and 6 each had a file of their own.
// A feature with nowhere to live is a feature that gets deleted by accident. This is that file.
//
// Pure: no DOM, no storage, no globals, no timers.

/** The solved cube in Kociemba facelet order — the arrangement that stops the clock. */
export const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

/** Longest solve this will report. Past an hour the cube was put down, not solved. */
const MAX_SOLVE_MS = 60 * 60 * 1000;

/**
 * How long a recorded `ready` stays meaningful. A cube sitting at the scramble for ten minutes is
 * furniture, not a solve about to start, and timing an inspection from it would report a number
 * about someone's lunch. Past this the arming lapses and must be re-established.
 */
const READY_LAPSE_MS = 10 * 60 * 1000;

/**
 * How far the cube's measured span may differ from the host's before both are distrusted. The
 * host's span is BLE-jittered, so it is never exact; it is a cross-check for gross disagreement
 * (a clock reset, a stall), not a precision reference.
 */
const HOST_DISAGREEMENT_MS = 5000;

/** A usable hardware timestamp, or null. */
function stampOf(move) {
  const t = move?.cubeTimestamp;
  return typeof t === 'number' && Number.isFinite(t) ? t : null;
}

function serialOf(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * A solve timer driven by the cube.
 *
 * The states, and why the arming one exists: "start on the first turn" is ambiguous, because
 * applying the scramble is also turns. The only instant the app can KNOW setup has finished is
 * when the cube reaches the exact arrangement the scramble was meant to produce — so that, and
 * nothing heuristic, is what arms it.
 *
 *     idle  --facelets === target-->  armed
 *     armed --first move----------->  running
 *     running --facelets === SOLVED->  stopped   (elapsed from the move stamps)
 *
 * @param {object} opts
 * @param {() => string|null} opts.target  the scramble's arrangement, or null when there is none
 * @param {() => boolean} opts.trusted     whether the cube's reports may be believed at all
 * @param {() => number} [opts.now]        host clock, injectable so staleness is testable
 */
export function createSolveTimer({ target, trusted, now = () => Date.now() }) {
  let state = 'idle';
  /** The recorded ready instant: { at, serial } on the host clock, since no move has stamped yet. */
  let ready = null;
  let first = null; // { stamp, host, serial }
  let last = null;
  let moves = 0;
  let refusal = null;

  const reset = () => {
    state = 'idle';
    ready = null;
    first = last = null;
    moves = 0;
    refusal = null;
  };

  /** A snapshot from the cube. Arms on the target, stops on solved. */
  const facelets = (f, serial) => {
    if (!trusted()) {
      // An untrusted cube's arrangement is not evidence: it may be reporting a position derived
      // from a chain nobody can vouch for. Arming on it would start a clock against a fiction.
      if (state !== 'idle') reset();
      return state;
    }
    if (state === 'idle') {
      const want = target();
      if (want && f === want) {
        state = 'armed';
        // Recorded, not just flagged. The host clock is the only one available here — no move has
        // been stamped yet — and it is used for staleness and inspection, never for the solve.
        ready = { at: now(), serial: serialOf(serial) };
      }
      return state;
    }
    if (state === 'armed' && ready && now() - ready.at > READY_LAPSE_MS) {
      // The cube has sat at the scramble too long for this to be a solve beginning.
      reset();
      return state;
    }
    if (state === 'armed' && f !== target()) {
      // Moved off the target without a move event reaching us — the stream is not intact, so a
      // clock started now would not know where it began.
      reset();
      return state;
    }
    if (state === 'running' && f === SOLVED) {
      const s = serialOf(serial);
      const ls = last ? serialOf(last.serial) : null;
      if (s !== null && ls !== null && s > ls) {
        // The snapshot is ahead of the last move we hold: moves were dropped, so `last` is not
        // the move that finished the solve and the span would be short.
        refusal = 'moves were dropped, so this solve could not be timed';
      }
      state = 'stopped';
    }
    return state;
  };

  /** A move from the cube. Starts the clock on the first one after arming. */
  const move = (m) => {
    if (state === 'stopped' || !trusted()) return state;
    const stamp = stampOf(m);
    if (state === 'armed') {
      if (!ready) {
        // Cannot happen through `facelets`, which sets both together; a guard so a future caller
        // cannot start a clock whose precondition was never established.
        refusal = 'the cube was never seen at the scramble, so this could not be timed';
        state = 'running';
        first = last = null;
        moves = 1;
        return state;
      }
      if (stamp === null) {
        refusal = 'this cube did not timestamp its moves';
        state = 'running'; // still a solve in progress; it just cannot be timed
        first = last = null;
        moves = 1;
        return state;
      }
      state = 'running';
      first = last = { stamp, host: m.timestamp, serial: m.serial };
      moves = 1;
      return state;
    }
    if (state === 'running') {
      moves += 1;
      if (stamp !== null && first) last = { stamp, host: m.timestamp, serial: m.serial };
    }
    return state;
  };

  /**
   * The finished solve, or null when it cannot be reported truthfully.
   * @returns {{ ms: number, moves: number, seconds: string }|null}
   */
  const result = () => {
    if (state !== 'stopped' || refusal || !first || !last || !ready) return null;
    const ms = last.stamp - first.stamp;
    if (!(ms > 0) || ms > MAX_SOLVE_MS) return null; // clock reset, or put down mid-solve
    if (typeof first.host === 'number' && typeof last.host === 'number') {
      const hostMs = last.host - first.host;
      if (Number.isFinite(hostMs) && Math.abs(hostMs - ms) > HOST_DISAGREEMENT_MS) return null;
    }
    // How long the solver looked before touching it. Host-clocked on both ends, so it is a
    // coarser number than `ms` and is reported as such — null rather than a fabricated 0.
    const inspectionMs =
      typeof first.host === 'number' && first.host >= ready.at ? first.host - ready.at : null;
    return { ms, moves, seconds: (ms / 1000).toFixed(2), inspectionMs };
  };

  return {
    facelets,
    move,
    reset,
    result,
    get state() {
      return state;
    },
    /** Why a finished solve is not being reported, or null. For the caller's words, not a throw. */
    get refusal() {
      return refusal;
    },
    get moveCount() {
      return moves;
    },
    /** The recorded ready instant, or null. Exposed so a caller can show what it is waiting on. */
    get readyAt() {
      return ready ? ready.at : null;
    },
  };
}
