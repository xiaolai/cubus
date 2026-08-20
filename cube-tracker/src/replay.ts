// The e2e backbone: record once, replay many. A recorded session is a stream of
// camera frames + the smart-cube ground truth (the dev-only oracle). Replaying the
// frames through a LiveTracker offline turns "does it track a real cube?" into a
// deterministic, CI-able score — the false-commit rate above all (§12/#20). The same
// runner drives both a synthetic session (unit-tested here) and a real recorded one
// (run in the app / Node with the OpenCV detector).

import type { CubeState, Move } from './cube.js';
import { type SessionMetrics, scoreSession } from './harness.js';
import { LiveTracker, type LiveTrackerOptions } from './live.js';
import type { Localizer } from './perception/localize.js';
import type { Frame } from './perception/motion.js';

/** One recorded frame: the image plus its camera media time (ms). */
export interface SessionFrame {
  frame: Frame;
  t: number;
}

/** A recorded session: frames, the ground-truth move sequence, and the known start. */
export interface Session {
  frames: SessionFrame[];
  truthMoves: Move[]; // from the smart-cube oracle (clock-sync-corrected)
  initialState: CubeState; // acquired start state (from the oracle)
}

export interface LatencyMs {
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface SessionReport {
  committed: Move[]; // moves the tracker emitted
  finalState: CubeState | null;
  metrics: SessionMetrics; // recall / false-commit rate / matched / missed
  resyncs: number; // recovery resyncs after occlusion
  lostFrames: number; // frames reported lost (off-frame / off-model)
  latency: LatencyMs; // per-frame wall-clock
}

function percentiles(xs: number[]): LatencyMs {
  if (xs.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s[s.length - 1]! };
}

/**
 * Replay a recorded session through a fresh LiveTracker and score it against the
 * ground-truth moves. The `localizer` is the real OpenCV detector for a real session,
 * or a playback stub for a synthetic one — the runner is agnostic.
 */
export function replaySession(
  session: Session,
  localizer: Localizer,
  opts: LiveTrackerOptions = {},
): SessionReport {
  const live = new LiveTracker(localizer, opts);
  live.seed(session.initialState);
  const committed: Move[] = [];
  const times: number[] = [];
  let resyncs = 0;
  let lostFrames = 0;
  for (const sf of session.frames) {
    const t0 = performance.now();
    const u = live.pushFrame(sf.frame, sf.t);
    times.push(performance.now() - t0);
    if (u.kind === 'move') committed.push(u.move);
    else if (u.kind === 'resync') resyncs++;
    else if (u.kind === 'lost') lostFrames++;
  }
  return {
    committed,
    finalState: live.state(),
    metrics: scoreSession(committed, session.truthMoves),
    resyncs,
    lostFrames,
    latency: percentiles(times),
  };
}
