// The guided 6-face capture state machine — pure, no camera, no DOM. It tracks
// which faces are in, samples a face's 9 stickers from a frame, and assembles
// the validated result once all 6 are captured. The live, camera-driven wrapper
// lives in live-scanner.ts; keeping the machine pure makes it fully testable
// from synthetic frames, exactly like the driver's fixture tests.

import { LOW_CONFIDENCE_THRESHOLD, assemble } from './assemble.js';
import { gridCells, sampleGrid } from './grid.js';
import { FACES, type Face, type Frame, type RGB, type Rect, type ScanResult } from './types.js';

/** Where the 3x3 sampling grid sits inside a frame. */
export type RegionFn = (frame: { width: number; height: number }) => Rect;

/** Default region: a centered square covering 80% of the frame's short side. */
export const defaultRegion: RegionFn = (frame) => {
  const size = Math.min(frame.width, frame.height) * 0.8;
  return { x: (frame.width - size) / 2, y: (frame.height - size) / 2, w: size, h: size };
};

/** Sample one face's 9 sticker colors from a frame (URFDLB reading order). */
export function sampleFace(frame: Frame, region: RegionFn = defaultRegion): RGB[] {
  return sampleGrid(frame, gridCells(region(frame)));
}

export interface ScanSessionOptions {
  /** Capture order; defaults to URFDLB. Must be an exact permutation of the 6 faces. */
  order?: readonly Face[];
  /** Per-sticker confidence below which a sticker is flagged. */
  lowConfidenceThreshold?: number;
}

/** Copy + validate a custom capture order as an exact permutation of the 6 faces. */
function validateOrder(order: readonly Face[]): readonly Face[] {
  const copy = [...order];
  const unique = new Set(copy);
  if (copy.length !== 6 || unique.size !== 6 || !FACES.every((f) => unique.has(f))) {
    throw new Error(`capture order must be a permutation of the 6 faces, got [${copy.join(',')}]`);
  }
  return copy;
}

/** The pure 6-face capture state machine. */
export class ScanSession {
  private readonly order: readonly Face[];
  private readonly threshold: number;
  private readonly captured = new Map<Face, RGB[]>();

  constructor(opts: ScanSessionOptions = {}) {
    this.order = opts.order ? validateOrder(opts.order) : FACES;
    this.threshold = opts.lowConfidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD;
  }

  /** The next face to capture in guidance order, or null when all 6 are in. */
  next(): Face | null {
    return this.order.find((f) => !this.captured.has(f)) ?? null;
  }

  /** Faces captured so far, in guidance order. */
  progress(): Face[] {
    return this.order.filter((f) => this.captured.has(f));
  }

  /** True once all 6 faces are captured. */
  complete(): boolean {
    return this.captured.size === 6;
  }

  /** Record one face's 9 sticker colors. Overwrites a prior capture of it. */
  captureFace(face: Face, stickers: RGB[]): void {
    if (stickers.length !== 9) {
      throw new Error(`face ${face}: expected 9 stickers, got ${stickers.length}`);
    }
    // Deep-copy so a caller reusing one scratch buffer across faces can't
    // retroactively mutate an earlier capture.
    this.captured.set(
      face,
      stickers.map((c) => [c[0], c[1], c[2]] as RGB),
    );
  }

  /** The assembled, validated result — or null until all 6 faces are captured. */
  result(): ScanResult | null {
    if (!this.complete()) return null;
    const faces = {} as Record<Face, RGB[]>;
    for (const face of FACES) faces[face] = this.captured.get(face)!;
    return assemble(faces, this.threshold);
  }

  /** Discard all captured faces and start over. */
  reset(): void {
    this.captured.clear();
  }
}
