// Two-corner guided scan (the fast path). A corner view shows THREE faces at once, so
// two opposite-corner shots cover all six:
//   shot 1 — the white·green·red corner  (Up, Front, Right)
//   shot 2 — the yellow·blue·orange corner (Down, Back, Left)
//
// Faces are assigned to slots by their CENTER color against coarse anchors — not by
// geometry — so a wrong corner or a non-cube (a face, a cabinet: no three matching cube
// centers) is REJECTED rather than sampled. Final classification stays calibration-free:
// assemble() reads each face's own sampled center as the reference, exactly like the
// flat scanner. The anchors here only decide "which quad is which face, and is this
// really that corner". Pure + Node-testable via synthetic frames and injected quads;
// the 3-face detector and camera live in the browser shell.

import { assemble } from './assemble.js';
import { rgbDistance } from './color.js';
import { type Quad, sampleQuad } from './homography.js';
import type { Face, Frame, RGB, ScanResult } from './types.js';

/** Coarse reference colors — ONLY for face assignment + non-cube rejection. */
export const CORNER_ANCHORS: Record<Face, RGB> = {
  U: [235, 235, 235], // white
  R: [185, 30, 35], // red
  F: [0, 155, 70], // green
  D: [255, 215, 0], // yellow
  L: [255, 110, 25], // orange
  B: [0, 80, 180], // blue
};

/** The two opposite corners that together show all six faces (standard color scheme). */
export const CORNER_SHOTS: readonly (readonly [Face, Face, Face])[] = [
  ['U', 'F', 'R'], // white · green · red
  ['D', 'B', 'L'], // yellow · blue · orange
];

export interface CornerShotResult {
  faces: Partial<Record<Face, RGB[]>>;
  matched: Face[]; // faces confidently assigned this shot
  ok: boolean; // every expected face matched a distinct center within tolerance
  reason?: 'need-3-faces' | 'wrong-corner';
}

export interface CornerScanOptions {
  anchors?: Record<Face, RGB>;
  /** Max CIEDE2000 center↔anchor distance to accept an assignment. */
  tolerance?: number;
  /** Override the sampler (defaults to the perspective sampler). */
  sample?: (frame: Frame, quad: Quad) => RGB[];
}

const DEFAULT_TOLERANCE = 28;

/**
 * Assign detected quads to a shot's expected faces by nearest center color. Greedy over
 * globally-best (quad, face) pairs so each quad and each face is used at most once; a
 * pair beyond `tolerance` is never accepted. `ok` only when all expected faces matched —
 * which requires three DISTINCT cube centers, the property a face/furniture lacks.
 */
export function assignCornerShot(
  frame: Frame,
  quads: readonly Quad[],
  expected: readonly Face[],
  opts: CornerScanOptions = {},
): CornerShotResult {
  const anchors = opts.anchors ?? CORNER_ANCHORS;
  const tol = opts.tolerance ?? DEFAULT_TOLERANCE;
  const sample = opts.sample ?? sampleQuad;
  const faces: Partial<Record<Face, RGB[]>> = {};
  if (quads.length < expected.length) {
    return { faces, matched: [], ok: false, reason: 'need-3-faces' };
  }
  const samplesByQuad = quads.map((q) => sample(frame, q));
  const pairs: { qi: number; face: Face; d: number }[] = [];
  for (let qi = 0; qi < samplesByQuad.length; qi++) {
    const center = samplesByQuad[qi]![4]!; // cell 4 = the invariant center sticker
    for (const face of expected) pairs.push({ qi, face, d: rgbDistance(center, anchors[face]) });
  }
  pairs.sort((a, b) => a.d - b.d);
  const usedQuad = new Set<number>();
  const usedFace = new Set<Face>();
  const matched: Face[] = [];
  for (const p of pairs) {
    if (usedQuad.has(p.qi) || usedFace.has(p.face) || p.d > tol) continue;
    usedQuad.add(p.qi);
    usedFace.add(p.face);
    faces[p.face] = samplesByQuad[p.qi]!;
    matched.push(p.face);
  }
  const ok = expected.every((f) => usedFace.has(f));
  return { faces, matched, ok, reason: ok ? undefined : 'wrong-corner' };
}

/** The two-corner capture state machine — pure, no camera, no DOM. */
export class CornerScanSession {
  private readonly captured = new Map<Face, RGB[]>();
  private shotIdx = 0;

  constructor(private readonly opts: CornerScanOptions = {}) {}

  /** Faces expected in the current shot (for guidance), or null when both are in. */
  nextShot(): readonly Face[] | null {
    return this.shotIdx < CORNER_SHOTS.length ? CORNER_SHOTS[this.shotIdx]! : null;
  }

  /** Try to capture the current shot from a frame + its detected quads. Advances on ok. */
  capture(frame: Frame, quads: readonly Quad[]): CornerShotResult {
    const expected = this.nextShot();
    if (!expected) return { faces: {}, matched: [], ok: false, reason: 'wrong-corner' };
    const res = assignCornerShot(frame, quads, expected, this.opts);
    if (res.ok) {
      for (const f of expected) this.captured.set(f, res.faces[f]!);
      this.shotIdx++;
    }
    return res;
  }

  complete(): boolean {
    return this.captured.size === 6;
  }

  /** Assemble + validate (structural parity + cubejs solvability) once both shots are in. */
  result(threshold?: number): ScanResult | null {
    if (!this.complete()) return null;
    const faces = Object.fromEntries(this.captured) as Record<Face, RGB[]>;
    return assemble(faces, threshold);
  }

  progress(): Face[] {
    return [...this.captured.keys()];
  }

  reset(): void {
    this.captured.clear();
    this.shotIdx = 0;
  }
}
