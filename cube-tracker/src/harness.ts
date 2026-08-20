// Validation-harness primitives (algorithm §12/#20, #21). The pure, testable core of
// the T6 benchmark: a canonical event normalization (`R2 ↔ R R`, since a smart-cube
// oracle emits only quarter-turns) and the metrics that gate a release — transition
// accuracy, move recall, and the separately-measured FALSE-COMMIT rate. The recorded
// ground-truth sessions and the clock-sync fit are the hardware-bound parts.

import type { Move } from './cube.js';

/**
 * Canonical quarter-turn stream: a half-turn `X2` expands to `[X, X]` (a smart cube
 * reports a 180° as two same-face quarter-turns). Note the SIGN of a half-turn is
 * unobservable, so `X2` canonicalizes to the unprimed pair — event-level labels for a
 * bare 180° cannot distinguish direction (§12/#21).
 */
export function toQuarterTurns(moves: readonly Move[]): Move[] {
  const out: Move[] = [];
  for (const m of moves) {
    if (m.endsWith('2')) {
      const face = m[0] as Move;
      out.push(face, face);
    } else {
      out.push(m);
    }
  }
  return out;
}

/** True iff two move streams are equal after canonical quarter-turn normalization. */
export function eventsMatch(a: readonly Move[], b: readonly Move[]): boolean {
  const qa = toQuarterTurns(a);
  const qb = toQuarterTurns(b);
  return qa.length === qb.length && qa.every((m, i) => m === qb[i]);
}

/** Longest-common-subsequence length of two move streams. */
function lcs(a: readonly Move[], b: readonly Move[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] =
        a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
  return dp[a.length]![b.length]!;
}

export interface SessionMetrics {
  matched: number;
  falseCommits: number; // committed a move the ground truth did not have (§12/#20)
  missed: number; // failed to commit a real move
  moveRecall: number; // matched / truth
  falseCommitRate: number; // falseCommits / predicted
}

/** Score a predicted move stream against ground truth (both quarter-turn-normalized). */
export function scoreSession(predicted: readonly Move[], truth: readonly Move[]): SessionMetrics {
  const p = toQuarterTurns(predicted);
  const t = toQuarterTurns(truth);
  const matched = lcs(p, t);
  const falseCommits = p.length - matched;
  const missed = t.length - matched;
  return {
    matched,
    falseCommits,
    missed,
    moveRecall: t.length === 0 ? 1 : matched / t.length,
    falseCommitRate: p.length === 0 ? 0 : falseCommits / p.length,
  };
}
