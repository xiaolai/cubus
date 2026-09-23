/**
 * EVIDENCE ABOUT A FACE, ACCUMULATED OVER FRAMES — the replacement for `Stillness`
 * (`dev-docs/scan-pipeline-audit-2026-09-23.md` §4, Stage 2, evidence accumulation).
 *
 * WHAT `Stillness` DID AND WHY IT HAD TO GO. It asked for N *identical* reads of the eight inside a
 * duration. That makes every frame a hard label and throws away how sure the detector was, so one
 * sticker alternating between red and orange — the detector's known weak pair — breaks every run and
 * the side is never captured at all. The panel says "hold still" for as long as anyone is willing to
 * hold it. That is the audit's §0.2 shape exactly: a stage that discards the evidence behind its
 * decision turns a weak signal into total failure.
 *
 * WHAT THIS DOES INSTEAD. Each cell keeps a six-way score, summed over frames in LOG space, so a
 * frame contributes what it actually saw rather than a vote. A cell that reads red 0.55 / orange 0.45
 * twenty times ends up confident; under `Stillness` it never settled. A capture happens when every
 * cell's best colour leads its runner-up by `CAPTURE_MARGIN` — a log-odds, so it is a statement about
 * evidence rather than about agreement.
 *
 * TEN COPIES OF ONE VIEW ARE NOT TEN OBSERVATIONS, and this is the part that needs care. Consecutive
 * frames of a motionless cube are the same photograph: the detector makes the same mistake on each,
 * so summing them manufactures confidence out of repetition. That is `Stillness`'s T3 — "persistence
 * is not truth" — and it would be much worse here, because adding log-evidence compounds. So a
 * frame's weight is decided by whether it is a NEW VIEW, not by whether it is a new reading:
 *
 *   - a frame whose pose has not moved is worth `REPEAT_DECAY` times the one before it, so a still
 *     cube contributes a bounded total however long it is held — the geometric sum, at most
 *     `1 / (1 - REPEAT_DECAY)` frames' worth from a single viewpoint;
 *   - a frame whose pose HAS moved is a genuinely new look and is worth a full unit;
 *   - and a repeated frame id (D2) is worth nothing at all, because it is not a new photograph in
 *     the first place.
 *
 * Keying on the POSE rather than on the reading is deliberate. Weighting by "the reading changed"
 * would pay a flickering sticker for flickering and starve a stable one, which is the opposite of
 * what evidence means.
 *
 * AN UNOBSERVED CELL STAYS UNOBSERVED. A finger over a sticker is not a sticker of some colour, so a
 * cell nobody saw accumulates nothing and `unobserved()` names it. The caller's bound is what turns
 * that into a question — a look, or an offer to paint — and never into an endless wait.
 */

import type { Detection } from './onnx-postprocess.js';

/** How many colour classes a sticker can be. */
export const COLOURS = 6;
/** Cells in a face, in reading order. */
export const CELLS = 9;

/**
 * The log-odds a cell's best colour must lead its runner-up by before the face can be captured.
 *
 * In nats, over the accumulated evidence: 2.2 is about 9:1. Below the whole-face margin a single
 * confident frame (a 0.9/0.05 read is already ~2.9 nats) can carry a cell on its own, which is what
 * makes a clean face capture in about as many frames as `Stillness` needed; above it, no amount of
 * one repeated viewpoint can, because `REPEAT_DECAY` bounds what one viewpoint is worth.
 */
export const CAPTURE_MARGIN = 2.2;

/**
 * What the n-th consecutive frame from an unmoved pose is worth, relative to the one before it.
 *
 * A half, so one viewpoint is worth at most two frames however long it is held (1 + ½ + ¼ + … = 2).
 * This is the whole defence against T3: without it, a consistent misread accumulates without bound
 * and the gate becomes "held still long enough", which is the rule being replaced.
 */
export const REPEAT_DECAY = 0.5;

/** Below this weight a frame is not worth the arithmetic; a still cube stops paying in. */
const NEGLIGIBLE_WEIGHT = 1e-3;

/**
 * How long a face may gather evidence before the caller must stop waiting and ASK.
 *
 * THIS, NOT MORE ACCUMULATION, IS THE ANSWER TO A STALL — and the measurement is what says so. A
 * ring sticker alternating between two near-tied colours was replayed through both gates over 74
 * real held frames: `Stillness` never captures (its run breaks on every alternation), and neither
 * does this, because `REPEAT_DECAY` bounds what one viewpoint is worth and the cell's margin stays
 * near zero. That is not a defect in either gate. From ONE viewpoint there is no way to tell
 * frame-to-frame noise, which averaging would fix, from a systematic misread, which it would only
 * launder into false confidence — so a gate that kept accumulating until it felt sure would be
 * T3 ("persistence is not truth") with extra steps.
 *
 * What CAN be fixed is the waiting. At the bound the evidence names the cell that will not settle
 * (`Verdict.unsettled`), and the caller turns that into a question a person can answer — show this
 * side again, or tap that sticker. `Stillness` could only say "hold still", for as long as anyone
 * was willing to hold it, which is the dead end §0.2 describes.
 *
 * Four seconds: long enough that an ordinary side settles inside it with room to spare (every side
 * of the 09-18 clip captures in well under a second of its own track), short enough that a person
 * is not left holding a cube at a camera that has nothing to say.
 */
export const SETTLE_BOUND_MS = 4000;

/**
 * How far a face's pose may move and still count as the same viewpoint, as a fraction of its own
 * sticker spacing.
 *
 * A fifth of a step. Comfortably above the detector's own positional jitter — 0.039 of a step at the
 * median and 0.085 at the 95th percentile, measured over the golden frames — so a held cube is not
 * mistaken for a moving one by noise alone; and well under the half step at which a sticker is
 * nearer its neighbour's cell, so a real movement is not mistaken for a held one.
 */
export const SAME_VIEW_TOLERANCE = 0.2;

/** The smallest score treated as a probability rather than as a log of zero. */
const EPS = 1e-6;

/** Where a face was, well enough to say whether it moved. */
export interface Pose {
  /** Centroid of the observed cells, in image pixels. */
  x: number;
  y: number;
  /** Mean spacing between neighbouring observed cells, in pixels — the face's apparent size. */
  step: number;
  /** The face's roll, in radians. */
  angle: number;
}

/** One look at a face: which cell held which detection, and which photograph it came from. */
export interface Look {
  /** Nine entries in reading order; `null` for a cell nobody observed. */
  cells: readonly (Detection | null)[];
  /** The photograph's identity. A repeat contributes nothing (D2). `undefined` when unknown. */
  frameId?: number;
  /** Monotonic clock reading. */
  now: number;
}

/** What the accumulated evidence says right now. */
export interface Verdict {
  /** True when every cell has been observed and leads by `CAPTURE_MARGIN`. */
  captured: boolean;
  /** The best colour per cell; `-1` for a cell nobody has observed. */
  colors: number[];
  /** Per cell, how far its best colour leads the runner-up, in nats. `0` where unobserved. */
  margins: number[];
  /** Cells nobody has observed yet. */
  unobserved: number[];
  /**
   * Cells that HAVE been observed and still do not lead by the margin — the sticker that keeps
   * changing.
   *
   * The difference from `unobserved` is the whole point: nobody saw one, and the other has been
   * seen many times and remains a coin toss. `Stillness` could not tell them apart — both were
   * simply "not settled yet" — so the only thing the scan could say was "hold still", for as long
   * as the user was willing to. Naming this cell is what lets the caller ask a question with an
   * answer in it.
   */
  unsettled: number[];
  /** How many distinct photographs have contributed. */
  frames: number;
  /** The total weight paid in — frames, discounted for repetition. */
  effectiveFrames: number;
}

/** The pose of a set of observed cells, or null when too few were seen to say. */
export function poseOf(cells: readonly (Detection | null)[]): Pose | null {
  const seen: { i: number; d: Detection }[] = [];
  for (const [i, d] of cells.entries()) if (d) seen.push({ i, d });
  if (seen.length < 2) return null;
  let sx = 0;
  let sy = 0;
  for (const { d } of seen) {
    sx += d.cx;
    sy += d.cy;
  }
  const x = sx / seen.length;
  const y = sy / seen.length;
  // The row direction, averaged over every pair of cells that sit in the same row one column apart —
  // which is what "the face's roll" means, and is defined without fitting anything.
  let vx = 0;
  let vy = 0;
  let pairs = 0;
  let spacing = 0;
  for (const a of seen) {
    for (const b of seen) {
      const ai = a.i % 3;
      const aj = Math.floor(a.i / 3);
      const bi = b.i % 3;
      const bj = Math.floor(b.i / 3);
      if (aj !== bj || bi - ai !== 1) continue;
      vx += b.d.cx - a.d.cx;
      vy += b.d.cy - a.d.cy;
      spacing += Math.hypot(b.d.cx - a.d.cx, b.d.cy - a.d.cy);
      pairs += 1;
    }
  }
  if (pairs === 0) {
    // No two cells side by side: fall back to the spread, which still says whether the face moved.
    let far = 0;
    for (const a of seen) {
      for (const b of seen) far = Math.max(far, Math.hypot(a.d.cx - b.d.cx, a.d.cy - b.d.cy));
    }
    return { x, y, step: far / 2, angle: 0 };
  }
  return { x, y, step: spacing / pairs, angle: Math.atan2(vy / pairs, vx / pairs) };
}

/** Whether two poses are the same viewpoint — the cube was held, not moved. */
export function sameView(a: Pose | null, b: Pose | null): boolean {
  if (!a || !b) return false;
  const step = Math.min(a.step, b.step);
  if (!(step > 0)) return false;
  const moved = Math.hypot(a.x - b.x, a.y - b.y) / step;
  const resized = Math.abs(a.step - b.step) / step;
  // Angles wrap, and a quarter turn is a different view of the same face rather than a big angle.
  let turned = Math.abs(a.angle - b.angle) % (Math.PI * 2);
  if (turned > Math.PI) turned = Math.PI * 2 - turned;
  return (
    moved <= SAME_VIEW_TOLERANCE && resized <= SAME_VIEW_TOLERANCE && turned <= SAME_VIEW_TOLERANCE
  );
}

/**
 * Six-way evidence for nine cells, accumulated over looks.
 *
 * One instance per FACE TRACK — see `face-track.ts`. Evidence from one face must never reach
 * another, and keeping the accumulator per track rather than per panel is what makes that
 * structural instead of a rule somebody has to remember.
 */
export class FaceEvidence {
  /** Cell-major, `CELLS * COLOURS`: accumulated log-evidence. */
  private readonly score = new Float64Array(CELLS * COLOURS);
  /** Per cell, how much weight has been paid in — a cell at zero is unobserved. */
  private readonly paid = new Float64Array(CELLS);
  private lastFrame: number | null = null;
  private lastPose: Pose | null = null;
  /** What the next frame from an unmoved pose is worth. */
  private repeatWeight = 1;
  private distinctFrames = 0;
  private totalWeight = 0;
  private firstAt: number | null = null;
  private lastAt: number | null = null;

  /**
   * Add a look. Returns the weight it was actually worth, which is zero for a repeated frame.
   *
   * THE WEIGHT IS DECIDED BEFORE ANYTHING IS ADDED, and from the POSE. A frame that did not move the
   * face is worth `REPEAT_DECAY` of the last one; a frame that moved it is worth a full unit and
   * resets the decay, because a new viewpoint is new information about the same cube.
   */
  add(look: Look): number {
    // A photograph already counted is not a second look at the cube (D2). Checked first, because a
    // re-served frame necessarily has an unmoved pose and would otherwise be indistinguishable from
    // a genuinely still one — which is exactly the confusion that let one frame settle a side.
    if (look.frameId !== undefined && look.frameId === this.lastFrame) return 0;
    if (look.frameId !== undefined) this.lastFrame = look.frameId;

    const pose = poseOf(look.cells);
    const held = sameView(this.lastPose, pose);
    this.repeatWeight = held ? this.repeatWeight * REPEAT_DECAY : 1;
    this.lastPose = pose ?? this.lastPose;
    const weight = this.repeatWeight;

    this.distinctFrames += 1;
    this.firstAt ??= look.now;
    this.lastAt = look.now;
    if (weight < NEGLIGIBLE_WEIGHT) return 0;
    this.totalWeight += weight;

    for (const [cell, d] of look.cells.entries()) {
      // AN UNOBSERVED CELL ACCUMULATES NOTHING. Not a uniform prior, not a zero — nothing. A cell
      // nobody saw must stay distinguishable from a cell seen and found ambiguous.
      if (!d) continue;
      const scores = d.scores;
      const base = cell * COLOURS;
      if (scores && scores.length === COLOURS) {
        let total = 0;
        for (const v of scores) total += Math.max(v, 0);
        if (total <= 0) continue;
        for (let c = 0; c < COLOURS; c++) {
          this.score[base + c]! += weight * Math.log(Math.max(scores[c]! / total, EPS));
        }
      } else {
        // No per-class scores: the winner and its confidence are all there is, so the rest share
        // what is left. Honest about being less informative than a full distribution.
        const rest = Math.max(1 - d.confidence, EPS) / (COLOURS - 1);
        for (let c = 0; c < COLOURS; c++) {
          const p = c === d.classId ? Math.max(d.confidence, EPS) : rest;
          this.score[base + c]! += weight * Math.log(p);
        }
      }
      this.paid[cell]! += weight;
    }
    return weight;
  }

  /** Whether the caller should stop waiting and ask — the bound is reached and something is open. */
  stalled(minFrames: number, margin: number = CAPTURE_MARGIN, bound = SETTLE_BOUND_MS): boolean {
    if (this.elapsedMs() < bound) return false;
    const v = this.verdict(minFrames, margin);
    return !v.captured;
  }

  /** How long evidence has been arriving, in milliseconds. */
  elapsedMs(): number {
    return this.firstAt === null || this.lastAt === null ? 0 : this.lastAt - this.firstAt;
  }

  /** Cells nobody has observed. */
  unobserved(): number[] {
    const out: number[] = [];
    for (let cell = 0; cell < CELLS; cell++) if (this.paid[cell]! <= 0) out.push(cell);
    return out;
  }

  /** What the evidence says, and whether it is enough. */
  verdict(minFrames: number, margin: number = CAPTURE_MARGIN): Verdict {
    const colors: number[] = [];
    const margins: number[] = [];
    for (let cell = 0; cell < CELLS; cell++) {
      if (this.paid[cell]! <= 0) {
        colors.push(-1);
        margins.push(0);
        continue;
      }
      const base = cell * COLOURS;
      let best = 0;
      let bestValue = Number.NEGATIVE_INFINITY;
      let runnerUp = Number.NEGATIVE_INFINITY;
      for (let c = 0; c < COLOURS; c++) {
        const v = this.score[base + c]!;
        if (v > bestValue) {
          runnerUp = bestValue;
          bestValue = v;
          best = c;
        } else if (v > runnerUp) {
          runnerUp = v;
        }
      }
      colors.push(best);
      margins.push(bestValue - runnerUp);
    }
    const unobserved = this.unobserved();
    const unsettled: number[] = [];
    for (let cell = 0; cell < CELLS; cell++) {
      if (this.paid[cell]! > 0 && margins[cell]! < margin) unsettled.push(cell);
    }
    const captured =
      unobserved.length === 0 && this.distinctFrames >= minFrames && unsettled.length === 0;
    return {
      captured,
      colors,
      margins,
      unobserved,
      unsettled,
      frames: this.distinctFrames,
      effectiveFrames: this.totalWeight,
    };
  }

  /**
   * Re-index every cell's evidence for a face turned a quarter in the hand.
   *
   * `turn[c]` is where cell `c`'s evidence GOES. Association is what this exists for: a face the user
   * rotates is the same face, and its evidence has to travel with the stickers rather than smear
   * across them. Without it a quarter turn would pit a cell's old evidence against its new, and the
   * margin would collapse exactly when the user did the helpful thing and turned the cube.
   */
  reindex(turn: readonly number[]): void {
    if (turn.length !== CELLS) throw new RangeError(`reindex: expected ${CELLS} destinations`);
    const seen = new Set(turn);
    if (seen.size !== CELLS) throw new RangeError('reindex: destinations are not a permutation');
    const score = Float64Array.from(this.score);
    const paid = Float64Array.from(this.paid);
    for (let cell = 0; cell < CELLS; cell++) {
      const to = turn[cell]!;
      this.paid[to] = paid[cell]!;
      for (let c = 0; c < COLOURS; c++) this.score[to * COLOURS + c] = score[cell * COLOURS + c]!;
    }
    // The pose is about the picture, not about the cells, so a re-index invalidates it: the next
    // frame must count as a new view, or a turn would be discounted as "held still".
    this.lastPose = null;
    this.repeatWeight = 1;
  }
}
