// A cube is painted with exactly nine stickers of each of six colours. The detector does not know
// that, and `decodeDetections` throws the information away: it takes the argmax over six class
// scores and discards the other five one line later.
//
// WHAT THAT COSTS, measured rather than argued (`ml/assign_sim.py`, 2000 simulated cubes whose every
// face is drawn from one photograph so errors stay correlated the way real ones do):
//
//                              cubes read perfectly     argmax -> nine-of-each
//   shipped v3 detector              89.8%  ->  99.7%   (236 of 242 sticker errors repaired)
//   cubedet P_large                  69.2%  ->  96.5%
//   cubedet R_real                   80.0%  ->  98.7%
//
// That is the largest single gain measured anywhere in this work, it needs no retraining, and it
// helps whichever detector ships. The mechanism is simple: one misread breaks the count -- eight
// reds and ten oranges -- and the cheapest repair that restores nine-and-nine is almost always the
// right one, because the detector's own scores say which sticker it was least sure about.
//
// IT IS NOT FREE, and the same measurement says where it hurts. The constraint MOVES stickers, so
// on a weak model it breaks cubes that were right: 0.5% of v3's, 2.3% of P_large's, 3.2% of the
// from-scratch arms'. It amplifies a good detector and endangers a bad one, so it must never be
// applied blind -- `assignNineOfEach` returns the repair and says how much likelihood it cost, and
// the caller decides whether that price is worth paying.
//
// WHY AN ASSIGNMENT AND NOT A SEARCH. `misread-decode.ts` already finds the nearest legal cube by
// Hamming distance and can only name a sticker when exactly one is wrong, because at distance two
// the nearest legal cube need not be the user's. This is the complementary tool: it uses the
// detector's CONFIDENCE rather than counting edits, so it stays informative past one misread --
// and unlike a nearest-legal-cube search it cannot invent a colouring the counts forbid.

/** Six colour classes, as everywhere else in this package: 0 white, 1 red, 2 green, 3 yellow, 4 orange, 5 blue. */
export const NUM_COLORS = 6;
/** Stickers per colour on a 3x3 cube. Nine, and it is the entire premise of this file. */
export const PER_COLOR = 9;
/** A whole cube: six faces of nine. */
export const STICKERS = NUM_COLORS * PER_COLOR;

export interface NineOfEachResult {
  /** One colour class per sticker, in the order the scores were given. Exactly nine of each. */
  colors: number[];
  /** Indices whose colour the constraint CHANGED from the detector's own argmax. */
  changed: number[];
  /**
   * Total log-likelihood given up to satisfy the counts, in nats, always >= 0.
   *
   * Zero means the detector's own reading already had nine of each and nothing moved. A large
   * value means the constraint overruled confident predictions, which is the signature of a
   * reading too broken to repair rather than of a repair worth trusting.
   */
  cost: number;
}

/** Natural log with a floor, so a zero score costs a lot rather than making the whole sum -Infinity. */
const LOG_FLOOR = 1e-9;
const logp = (p: number): number => Math.log(Math.max(p, LOG_FLOOR));

/**
 * The most likely colouring that has exactly nine stickers of each colour.
 *
 * `scores[i][c]` is the detector's probability that sticker `i` is colour `c`. They need not sum to
 * one -- the head emits independent sigmoids, not a softmax -- and only their relative sizes matter.
 *
 * Solved as a rectangular assignment: each colour becomes nine interchangeable columns, so a colour
 * can be chosen nine times and never a tenth, and the Hungarian algorithm finds the maximum-weight
 * perfect matching. 54x54 is small enough that the cubic running time is irrelevant here.
 */
export function assignNineOfEach(scores: readonly (readonly number[])[]): NineOfEachResult {
  if (scores.length !== STICKERS) {
    throw new Error(`expected ${STICKERS} stickers, got ${scores.length}`);
  }
  for (const [i, row] of scores.entries()) {
    if (row.length !== NUM_COLORS)
      throw new Error(`sticker ${i} has ${row.length} scores, expected ${NUM_COLORS}`);
    for (const v of row) {
      // A NaN would propagate silently through the matching and produce an arbitrary assignment that
      // looks like a considered answer. Refuse at the boundary instead.
      if (!Number.isFinite(v) || v < 0)
        throw new Error(`sticker ${i} has a non-finite or negative score`);
    }
  }

  // Cost matrix: rows are stickers, columns are colour SLOTS (nine per colour). Minimising negative
  // log-likelihood maximises the product of the per-sticker probabilities.
  const cost: number[][] = scores.map((row) => {
    const out = new Array<number>(STICKERS);
    for (let c = 0; c < NUM_COLORS; c++) {
      const v = -logp(row[c]!);
      for (let k = 0; k < PER_COLOR; k++) out[c * PER_COLOR + k] = v;
    }
    return out;
  });

  const slotOf = hungarian(cost);
  const colors = slotOf.map((slot) => Math.floor(slot / PER_COLOR));

  const argmax = scores.map((row) => {
    let best = 0;
    for (let c = 1; c < NUM_COLORS; c++) if (row[c]! > row[best]!) best = c;
    return best;
  });
  const changed = colors.map((_, i) => i).filter((i) => colors[i] !== argmax[i]);
  let cost_ = 0;
  for (let i = 0; i < STICKERS; i++)
    cost_ += logp(scores[i]![argmax[i]!]!) - logp(scores[i]![colors[i]!]!);
  // Floating-point summation can land a hair below zero on an unchanged reading; the quantity is a
  // likelihood given up and cannot really be negative.
  return { colors, changed, cost: Math.max(0, cost_) };
}

/**
 * Minimum-cost perfect matching on a square matrix (Jonker-Volgenant shortest augmenting paths).
 *
 * Returns `col[r]`: the column assigned to row r. Implemented here rather than pulled in because it
 * is forty lines and this package ships to a browser, where a dependency costs download size that a
 * scan budget does not have.
 */
function hungarian(cost: readonly (readonly number[])[]): number[] {
  const n = cost.length;
  // 1-indexed potentials and assignment, the classic formulation: index 0 is the sentinel the
  // augmenting path starts from, which is what keeps the inner loop free of special cases.
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1).fill(0); // p[col] = row matched to col
  const way = new Int32Array(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }

  const col = new Array<number>(n);
  for (let j = 1; j <= n; j++) col[p[j]! - 1] = j - 1;
  return col;
}
