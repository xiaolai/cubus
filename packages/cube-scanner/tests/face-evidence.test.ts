// Evidence about a face, accumulated over frames (`dev-docs/scan-pipeline-audit-2026-09-23.md` §4,
// Stage 2). The cases here are about the three things this module exists to get right: a frame is
// worth what it adds and not what it repeats, an unobserved cell stays unobserved, and a cell that
// will not settle is NAMED rather than waited on.

import { describe, expect, it } from 'vitest';
import {
  CAPTURE_MARGIN,
  CELLS,
  COLOURS,
  FaceEvidence,
  poseOf,
  REPEAT_DECAY,
  SETTLE_BOUND_MS,
  sameView,
} from '../src/face-evidence.js';
import type { Detection } from '../src/onnx-postprocess.js';

/** A detection at a lattice position, reading `colour` with confidence `p`. */
function sticker(cell: number, colour: number, p = 0.92, step = 40, origin = 300): Detection {
  const scores = new Array<number>(COLOURS).fill((1 - p) / (COLOURS - 1));
  scores[colour] = p;
  return {
    cx: origin + (cell % 3) * step,
    cy: origin + Math.floor(cell / 3) * step,
    w: 26,
    h: 26,
    classId: colour,
    confidence: p,
    scores,
  };
}

/** A whole face reading `colours`, optionally shifted so it is a different viewpoint. */
function face(colours: readonly number[], shift = 0, p = 0.92): (Detection | null)[] {
  return colours.map((c, i) => (c < 0 ? null : sticker(i, c, p, 40, 300 + shift)));
}

const SOLID = [0, 1, 2, 3, 4, 5, 0, 1, 2];

describe('a frame is worth what it adds', () => {
  it('pays full weight for the first look and a decaying one while the cube is held', () => {
    const ev = new FaceEvidence();
    expect(ev.add({ cells: face(SOLID), frameId: 1, now: 0 })).toBe(1);
    // Same pose, so the same photograph of the same cube: worth a fraction, not another whole look.
    expect(ev.add({ cells: face(SOLID), frameId: 2, now: 33 })).toBeCloseTo(REPEAT_DECAY, 10);
    expect(ev.add({ cells: face(SOLID), frameId: 3, now: 66 })).toBeCloseTo(REPEAT_DECAY ** 2, 10);
  });

  it('pays full weight again once the cube actually moves', () => {
    const ev = new FaceEvidence();
    ev.add({ cells: face(SOLID), frameId: 1, now: 0 });
    ev.add({ cells: face(SOLID), frameId: 2, now: 33 });
    // A new viewpoint is new information about the same cube, so the decay resets.
    expect(ev.add({ cells: face(SOLID, 60), frameId: 3, now: 66 })).toBe(1);
  });

  it('bounds what one viewpoint can ever be worth', () => {
    // THE DEFENCE AGAINST T3 — "persistence is not truth". A cube held at one angle for a hundred
    // frames must not accumulate a hundred frames' confidence, or the gate is "held still long
    // enough" again, which is the rule being replaced.
    const ev = new FaceEvidence();
    for (let k = 0; k < 100; k++) ev.add({ cells: face(SOLID), frameId: k, now: k * 33 });
    const v = ev.verdict(1);
    expect(v.frames).toBe(100);
    expect(v.effectiveFrames).toBeLessThanOrEqual(1 / (1 - REPEAT_DECAY) + 1e-9);
  });

  it('gives a repeated photograph nothing at all', () => {
    // D2: a re-served frame is not a second look. Checked before the pose, because a repeat
    // necessarily has an unmoved pose and would otherwise be a merely-discounted look.
    const ev = new FaceEvidence();
    ev.add({ cells: face(SOLID), frameId: 7, now: 0 });
    expect(ev.add({ cells: face(SOLID), frameId: 7, now: 33 })).toBe(0);
    expect(ev.verdict(1).frames).toBe(1);
  });
});

describe('an unobserved cell carries no evidence', () => {
  it('names it, and never guesses a colour for it', () => {
    const cells = face(SOLID);
    cells[4] = null;
    const ev = new FaceEvidence();
    ev.add({ cells, frameId: 1, now: 0 });
    const v = ev.verdict(1);
    expect(v.unobserved).toEqual([4]);
    expect(v.colors[4]).toBe(-1);
    // A finger over a sticker is not a sticker of some colour: it cannot be captured either.
    expect(v.captured).toBe(false);
  });

  it('separates "nobody looked" from "looked, and it is a coin toss"', () => {
    // The distinction `Stillness` could not make, and the whole reason it could only say "hold
    // still": one of these is answered by showing the side again, the other by tapping a sticker.
    const tied = face(SOLID);
    const ambiguous = sticker(0, 1, 0.5);
    ambiguous.scores = [0.5, 0.5, 0, 0, 0, 0];
    tied[0] = ambiguous;
    tied[1] = null;
    const ev = new FaceEvidence();
    ev.add({ cells: tied, frameId: 1, now: 0 });
    const v = ev.verdict(1);
    expect(v.unobserved).toEqual([1]);
    expect(v.unsettled).toContain(0);
    expect(v.unsettled).not.toContain(1);
  });
});

describe('capture is by evidence, not by agreement', () => {
  it('captures a confident face once every cell leads by the margin', () => {
    const ev = new FaceEvidence();
    for (let k = 0; k < 4; k++) {
      ev.add({ cells: face(SOLID, k * 60), frameId: k, now: k * 100 });
    }
    const v = ev.verdict(3);
    expect(v.captured).toBe(true);
    expect(v.colors).toEqual(SOLID);
    expect(Math.min(...v.margins)).toBeGreaterThanOrEqual(CAPTURE_MARGIN);
  });

  it('never captures a cell that keeps changing, however long it is held', () => {
    // The stall, in its own terms. A cell alternating between two near-tied colours accumulates
    // almost nothing either way — which is correct, and is why the answer is the bound below and
    // not more patience.
    const ev = new FaceEvidence();
    for (let k = 0; k < 200; k++) {
      const cells = face(SOLID);
      const flip = sticker(0, k % 2 === 0 ? 0 : 3, 0.52);
      flip.scores = [0, 0, 0, 0, 0, 0];
      flip.scores[k % 2 === 0 ? 0 : 3] = 0.52;
      flip.scores[k % 2 === 0 ? 3 : 0] = 0.46;
      cells[0] = flip;
      ev.add({ cells, frameId: k, now: k * 33 });
    }
    const v = ev.verdict(3);
    expect(v.captured).toBe(false);
    expect(v.unsettled).toEqual([0]);
  });

  it('stops waiting at the bound and says what is open', () => {
    // What the redesign can actually do about a stall: a bounded question naming the sticker,
    // instead of "hold still" for as long as anyone is willing to.
    const ev = new FaceEvidence();
    const tick = 33;
    for (let now = 0; now <= SETTLE_BOUND_MS + tick; now += tick) {
      const cells = face(SOLID);
      const flip = sticker(0, 0, 0.52);
      flip.scores = [0.52, 0, 0, 0.46, 0, 0];
      cells[0] = flip;
      ev.add({ cells, frameId: now, now });
    }
    expect(ev.stalled(3)).toBe(true);
    expect(ev.verdict(3).unsettled).toEqual([0]);
  });

  it('is not stalled before the bound', () => {
    const ev = new FaceEvidence();
    ev.add({ cells: face(SOLID), frameId: 1, now: 0 });
    ev.add({ cells: face(SOLID), frameId: 2, now: 100 });
    expect(ev.stalled(3)).toBe(false);
  });
});

describe('evidence travels with the stickers when the face turns', () => {
  it('re-indexes to a permutation and refuses anything else', () => {
    const ev = new FaceEvidence();
    ev.add({ cells: face(SOLID), frameId: 1, now: 0 });
    const turn = [2, 5, 8, 1, 4, 7, 0, 3, 6];
    ev.reindex(turn);
    const moved = ev.verdict(1).colors;
    for (let c = 0; c < CELLS; c++) expect(moved[turn[c]!]).toBe(SOLID[c]);
    expect(() => ev.reindex([0, 0, 0, 0, 0, 0, 0, 0, 0])).toThrow(RangeError);
    expect(() => ev.reindex([0, 1, 2])).toThrow(RangeError);
  });

  it('counts the frame after a turn as a new view', () => {
    // A turn is the most informative thing a user does. Discounting the frame after it as "held
    // still" would punish exactly the helpful move.
    const ev = new FaceEvidence();
    ev.add({ cells: face(SOLID), frameId: 1, now: 0 });
    ev.add({ cells: face(SOLID), frameId: 2, now: 33 });
    ev.reindex([2, 5, 8, 1, 4, 7, 0, 3, 6]);
    expect(ev.add({ cells: face(SOLID), frameId: 3, now: 66 })).toBe(1);
  });
});

describe('the pose is what says whether the cube moved', () => {
  it('reads a face back as its own centre, spacing and roll', () => {
    const p = poseOf(face(SOLID));
    expect(p).not.toBeNull();
    expect(p!.step).toBeCloseTo(40, 6);
    expect(p!.angle).toBeCloseTo(0, 6);
  });

  it('calls a small wobble the same view and a real move a different one', () => {
    const still = poseOf(face(SOLID, 2));
    const base = poseOf(face(SOLID));
    expect(sameView(base, still)).toBe(true);
    expect(sameView(base, poseOf(face(SOLID, 40)))).toBe(false);
  });

  it('says nothing about a pose it cannot see', () => {
    expect(poseOf([null, null, null, null, null, null, null, null, null])).toBeNull();
    expect(sameView(null, poseOf(face(SOLID)))).toBe(false);
  });
});
