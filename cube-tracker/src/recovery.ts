// Recovery + cold-start acquisition — a separate subsystem from the tracking loop
// (algorithm §12/#16). After occlusion the move SEQUENCE is unrecoverable (§12/#1);
// we recover the STATE by searching the bounded-depth ball of the last confident
// state and matching each candidate to the current view. Filtering is TERMINAL-ONLY
// (no unsound intermediate pruning — §12/#10). Beyond N_max, we re-acquire (§12/#6).

import {
  type CubeState,
  FACES,
  type Face,
  MOVE_NAMES,
  type Orientation,
  applyMove,
  cloneState,
  decodeFacelets,
  encodeFacelets,
  isStructurallyValid,
} from './cube.js';
import type { CubeView } from './likelihood.js';
import { type CameraCell, bestOrientationMatch, faceMapOf } from './orientation.js';

/** Compact packed key (BigInt) — cheaper than the verbose stateKey for a big ball. */
export function packKey(s: CubeState): string {
  let v = 0n;
  for (const x of s.cp) v = v * 8n + BigInt(x);
  for (const x of s.co) v = v * 3n + BigInt(x);
  for (const x of s.ep) v = v * 12n + BigInt(x);
  for (const x of s.eo) v = v * 2n + BigInt(x);
  return v.toString(36);
}

/** BFS ball of all states within `maxDepth` moves of `state` (HTM). */
export function ballWithinDepth(
  state: CubeState,
  maxDepth: number,
): Map<string, { state: CubeState; dist: number }> {
  const ball = new Map<string, { state: CubeState; dist: number }>();
  ball.set(packKey(state), { state, dist: 0 });
  let frontier = [state];
  for (let d = 1; d <= maxDepth; d++) {
    const next: CubeState[] = [];
    for (const st of frontier) {
      for (const m of MOVE_NAMES) {
        const t = applyMove(st, m);
        const k = packKey(t);
        if (!ball.has(k)) {
          ball.set(k, { state: t, dist: d });
          next.push(t);
        }
      }
    }
    frontier = next;
  }
  return ball;
}

/** The states at EXACTLY `depth` moves (HTM) from `state` — for exact-depth test fixtures (§12/#23). */
export function exactDepthShell(state: CubeState, depth: number): CubeState[] {
  const ball = ballWithinDepth(state, depth);
  return [...ball.values()].filter((e) => e.dist === depth).map((e) => e.state);
}

export interface RecoveryOptions {
  maxDepth: number;
  fitFloor: number; // min mean soft-match to accept any candidate (else re-acquire)
  margin: number; // min lead over the runner-up to resync (else ambiguous)
}
// fitFloor is high on purpose: only a near-perfect match may resync, so a partial
// match to a WRONG state (the danger past N_max — §12/#6) falls through to reacquire.
export const DEFAULT_RECOVERY: RecoveryOptions = { maxDepth: 4, fitFloor: 0.8, margin: 0.02 };

export type RecoveryResult =
  | { kind: 'resync'; state: CubeState; orientation: Orientation; confidence: number }
  | { kind: 'ambiguous'; candidates: CubeState[] } // need another view (§12/#5/#11)
  | { kind: 'reacquire' }; // beyond the ball — re-acquire state (§12/#6)

/**
 * Recover the current STATE after occlusion, from the last confident state and a
 * fresh camera observation. Enumerates the depth-≤N ball, scores every candidate by
 * its best-orientation fit, and resyncs to a unique dominant survivor.
 */
export function recoverState(
  committed: CubeState,
  cameraObs: CameraCell[],
  opts: RecoveryOptions = DEFAULT_RECOVERY,
): RecoveryResult {
  const ball = ballWithinDepth(committed, opts.maxDepth);
  let best = Number.NEGATIVE_INFINITY;
  let second = Number.NEGATIVE_INFINITY;
  let bestState: CubeState | null = null;
  let bestOrient = 0;
  const scored: { state: CubeState; score: number }[] = [];
  for (const { state } of ball.values()) {
    const { score, orientations } = bestOrientationMatch(encodeFacelets(state), cameraObs);
    scored.push({ state, score });
    if (score > best) {
      second = best;
      best = score;
      bestState = state;
      bestOrient = orientations[0]!;
    } else if (score > second) {
      second = score;
    }
  }
  if (bestState === null || best < opts.fitFloor) return { kind: 'reacquire' };
  if (best - second < opts.margin) {
    const candidates = scored.filter((s) => best - s.score < opts.margin).map((s) => s.state);
    return { kind: 'ambiguous', candidates };
  }
  return {
    kind: 'resync',
    state: cloneState(bestState),
    orientation: faceMapOf(bestOrient),
    confidence: best,
  };
}

/**
 * Cold-start acquisition: assemble one fully-known legal state from partial views
 * already placed in a common cube frame. (Resolving orientation across a freely
 * rotating cube during acquisition is the tracker's job — T5; this is the pure
 * assembler + legality gate.)
 */
export function acquireState(views: CubeView[]): { state: CubeState; confidence: number } | null {
  const sum = new Array<Record<Face, number>>(54);
  const covered = new Set<number>();
  for (const v of views) {
    for (const cell of v.cells) {
      covered.add(cell.index);
      const acc = sum[cell.index] ?? { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0 };
      for (const f of FACES) acc[f] += cell.soft[f];
      sum[cell.index] = acc;
    }
  }
  if (covered.size < 54) return null; // not fully observed yet — keep accumulating
  const chars = new Array<string>(54);
  let minConf = 1;
  for (let i = 0; i < 54; i++) {
    const acc = sum[i]!;
    let bestFace: Face = 'U';
    let bestVal = Number.NEGATIVE_INFINITY;
    let total = 0;
    for (const f of FACES) {
      total += acc[f];
      if (acc[f] > bestVal) {
        bestVal = acc[f];
        bestFace = f;
      }
    }
    chars[i] = bestFace;
    minConf = Math.min(minConf, total === 0 ? 0 : bestVal / total);
  }
  const facelets = chars.join('');
  if (!isStructurallyValid(facelets)) return null; // inconsistent read — reject, don't trust
  return { state: decodeFacelets(facelets)!, confidence: minConf };
}
