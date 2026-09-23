/**
 * WHICH FACE THE EVIDENCE IS ABOUT — track association, with explicit re-acquisition
 * (`dev-docs/scan-pipeline-audit-2026-09-23.md` §4, Stage 2).
 *
 * WHY THIS EXISTS, MEASURED RATHER THAN ARGUED. `FaceEvidence` on its own is worse than the
 * `Stillness` it replaces, and the 09-18 clip says so plainly: accumulating every fitted frame into
 * one pool and capturing on margin gave **150 captures of 33 distinct readings**, against
 * `Stillness(3, 500 ms)`'s 19 captures of 6. The cube spends much of a scan being TURNED, every pose
 * on the way is a "new view" worth full weight, and a pool with no owner happily reaches a confident
 * verdict about a face that was never in front of the camera. Soft evidence without association is
 * not a better gate, it is a faster way to be wrong.
 *
 * SO EVIDENCE BELONGS TO A TRACK, and a look joins the track only if it is a look at the SAME FACE.
 * The test is the reading, not the pose: a cube rolled from one side to the next moves continuously,
 * so pose continuity cannot tell "this side, tilted" from "the next side, arriving". What can is
 * whether the look agrees with what the track already believes — on the cells both have something to
 * say about, and under the best of the four quarter turns, because a face turned in the hand is the
 * same face.
 *
 * A TURN RE-INDEXES RATHER THAN RESTARTS. When the agreeing rotation is not the identity the track
 * carries its evidence round with the stickers (`FaceEvidence.reindex`). Without that, the helpful
 * thing a user does — turning the cube to show it better — would collapse the margin it had built.
 *
 * A GAP IS RE-ACQUIRED EXPLICITLY, never assumed. Frames where nothing fitted mean the face left, or
 * was covered, or the detector lost it; after `REACQUIRE_AFTER_MS` the track is suspended and the
 * next look has to earn its way back in by agreeing. Resuming silently is how evidence from face A
 * reaches face B, which this module exists to make structurally impossible.
 */

import { CELLS, FaceEvidence, type Look, type Verdict } from './face-evidence.js';

/**
 * Where each cell's sticker goes when the face is turned a quarter clockwise in the hand: cell `c`'s
 * evidence moves to `QUARTER_TURN[c]`.
 *
 * Stated as a DESTINATION map because that is what `FaceEvidence.reindex` takes. `stillness.ts`
 * carries the same permutation as a SOURCE map, which is its inverse — the two are not
 * interchangeable, and `face-track.test.ts` pins the direction by turning a face four times and
 * requiring the identity.
 */
export const QUARTER_TURN: readonly number[] = [2, 5, 8, 1, 4, 7, 0, 3, 6];

/**
 * How many of the cells two readings both observed must agree, as a fraction, for them to be the
 * same face.
 *
 * Seven ninths, following `sameSide` in the panel, which has used 7 of 8 since 2026-09-20 for the
 * same reason: one flickering sticker must not make a side into a new one, and two should. Held as a
 * fraction because a partial look has fewer cells to compare and the rule has to mean the same thing.
 */
export const MIN_AGREEMENT = 7 / 9;

/** Cells that must be observed in common before agreement is a meaningful question. */
export const MIN_SHARED_CELLS = 5;

/** After this long with no look, the track is suspended and must be re-acquired. */
export const REACQUIRE_AFTER_MS = 400;

/**
 * How many looks in a row may disagree before the track is LOST rather than merely interrupted.
 *
 * One disagreeing frame is noise, and treating it as a new face is expensive: measured on the 09-18
 * clip, a 74-frame stretch of ONE side held still contains 3 frames the fit reads in a different
 * order, and killing the track on each of them restarted the clock 18 times over twelve seconds —
 * so a stall could never reach its own bound and the scan had nothing to say, which is the dead end
 * this stage exists to end. Three in a row is a different face: the cube cannot be rolled to another
 * side and back inside three frames, and a genuine change produces disagreement on every frame after
 * it rather than one.
 *
 * The rejected looks are NOT accumulated while the track waits to see. Evidence from another face
 * must never reach this one even briefly, which is the invariant the whole module is for.
 */
export const MAX_CONSECUTIVE_MISSES = 3;

/** What became of a look that was offered to a track. */
export type Association =
  /**
   * It is this face. `turns` is how far the FACE has turned since the track's own frame — not how
   * far the reading had to be turned to be recognised, which is the inverse and the easier of the
   * two to reach for by accident.
   */
  | { kind: 'joined'; turns: number; reacquired: boolean }
  /** It is not this face. The track keeps what it had; the caller decides what to do next. */
  | { kind: 'rejected'; agreement: number; shared: number };

/** Turn a reading `turns` quarters, so cell `c` comes from where it was before. */
export function turnReading(colors: readonly number[], turns: number): number[] {
  let out = [...colors];
  for (let k = 0; k < ((turns % 4) + 4) % 4; k++) {
    const from = out;
    const next = new Array<number>(CELLS);
    for (let c = 0; c < CELLS; c++) next[QUARTER_TURN[c]!] = from[c]!;
    out = next;
  }
  return out;
}

/** How well a look agrees with a belief, over the cells both have something to say about. */
export function agreementOf(
  belief: readonly number[],
  look: readonly number[],
): { agreement: number; shared: number } {
  let shared = 0;
  let same = 0;
  for (let c = 0; c < CELLS; c++) {
    // -1 is "nobody has observed this cell". A cell one side has not seen is not a disagreement, and
    // counting it as one would break a track every time a finger covered a sticker.
    if (belief[c]! < 0 || look[c]! < 0) continue;
    shared += 1;
    if (belief[c] === look[c]) same += 1;
  }
  return { agreement: shared === 0 ? 0 : same / shared, shared };
}

/**
 * One face, and the evidence about it.
 *
 * Built by the caller when a look belongs to no existing track, and discarded when the face is
 * captured or abandoned. Its whole job is to refuse looks that are about something else.
 */
export class FaceTrack {
  private readonly evidence = new FaceEvidence();
  private lastAt: number | null = null;
  private suspended = false;
  private misses = 0;
  /** Quarter turns applied since the track began, for the caller that wants to un-turn a capture. */
  private turned = 0;

  /** The colours the track currently believes, `-1` where nothing has been observed. */
  belief(minFrames = 1): number[] {
    return this.evidence.verdict(minFrames).colors;
  }

  /** Whether the track has any evidence at all. */
  get started(): boolean {
    return this.lastAt !== null;
  }

  /**
   * Whether this track has lost its face — enough looks in a row disagreed that it is something
   * else now. The caller should start a new track; this one keeps whatever it gathered.
   */
  get lost(): boolean {
    return this.misses >= MAX_CONSECUTIVE_MISSES;
  }

  /** Net quarter turns the face has been rotated through since the track began. */
  get quarterTurns(): number {
    return ((this.turned % 4) + 4) % 4;
  }

  /**
   * Offer a look. On `joined` the evidence has been added; on `rejected` nothing changed.
   *
   * THE DECISION IS MADE BEFORE ANYTHING IS ADDED. A look that is about another face must not leave
   * a trace here even briefly, because `verdict` may be consulted between frames and a capture
   * reached with foreign evidence in the pool is precisely the wrong cube this stage exists to stop.
   */
  offer(look: Look): Association {
    if (!this.started) {
      this.evidence.add(look);
      this.lastAt = look.now;
      return { kind: 'joined', turns: 0, reacquired: false };
    }
    const gap = this.lastAt !== null && look.now - this.lastAt > REACQUIRE_AFTER_MS;
    if (gap) this.suspended = true;

    const reading = look.cells.map((d) => (d ? d.classId : -1));
    const belief = this.belief();
    let bestTurns = 0;
    let best = { agreement: -1, shared: 0 };
    for (let turns = 0; turns < 4; turns++) {
      const got = agreementOf(belief, turnReading(reading, turns));
      if (got.agreement > best.agreement) {
        best = got;
        bestTurns = turns;
      }
    }
    if (best.shared < MIN_SHARED_CELLS || best.agreement < MIN_AGREEMENT) {
      this.misses += 1;
      return { kind: 'rejected', agreement: Math.max(best.agreement, 0), shared: best.shared };
    }
    this.misses = 0;
    // THE TWO ROTATIONS ARE INVERSES, AND USING THE WRONG ONE IS SILENT. `bestTurns` is how far the
    // NEW reading must be turned to sit in the track's frame; the FACE therefore turned by the
    // opposite amount, and it is the face's rotation that the stored evidence must follow. Turning
    // the evidence by `bestTurns` instead is right only for a half turn, which is its own inverse —
    // so it passes any test built on one and scrambles every other.
    const faceTurns = (4 - bestTurns) % 4;
    if (faceTurns !== 0) {
      // Carry the evidence round with the stickers rather than letting the new reading fight the old.
      let turn: readonly number[] = QUARTER_TURN;
      for (let k = 1; k < faceTurns; k++) {
        const from = turn;
        turn = QUARTER_TURN.map((_, c) => QUARTER_TURN[from[c]!]!);
      }
      this.evidence.reindex(turn);
      this.turned += faceTurns;
    }
    this.evidence.add(look);
    const reacquired = this.suspended;
    this.suspended = false;
    this.lastAt = look.now;
    return { kind: 'joined', turns: faceTurns, reacquired };
  }

  /** What the evidence says, and whether it is enough. */
  verdict(minFrames: number, margin?: number): Verdict {
    return this.evidence.verdict(minFrames, margin);
  }

  /**
   * Whether the caller should stop waiting and ask.
   *
   * A track that has gathered for `SETTLE_BOUND_MS` without capturing has something to say and no
   * prospect of resolving it alone — `verdict().unsettled` names the sticker. This is the whole of
   * what the redesign can do about a stall, and it is a bounded question rather than "hold still".
   */
  stalled(minFrames: number, margin?: number, bound?: number): boolean {
    return this.evidence.stalled(minFrames, margin, bound);
  }

  /** How long this track has been gathering, in milliseconds. */
  elapsedMs(): number {
    return this.evidence.elapsedMs();
  }
}
