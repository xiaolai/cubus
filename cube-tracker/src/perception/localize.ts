// The localizer boundary (algorithm §3.1, §12/#15, #17). It turns a raw camera Frame
// into a CameraObservation: it finds the cube's visible face quads + the 3×3 sticker
// lattice, reads each cell's color (via perception/color.ts), assigns camera slots,
// and reports whether the layers are aligned (not a paused mid-turn).
//
// There is NO offline implementation: a robust localizer needs OpenCV / a small
// learned detector AND real camera frames, and its verification is the on-device
// gauntlet (≥5 cubes × poses × lights × grips). This file defines the CONTRACT so the
// tracker's boundary is explicit; `createLocalizer` is a documented placeholder that
// detects nothing until the on-device implementation is wired in (T4).

import type { Face } from '../cube.js';
import type { CameraCell } from '../orientation.js';
import type { Frame } from './motion.js';

/** One localized face: its camera slot, its 9 cells, and the quad-fit confidence. */
export interface LocalizedFace {
  slot: Face; // which camera-frame direction the face points (up/right/front/…)
  cells: CameraCell[]; // the 9 sticker cells, camera-slot indexed
  quadConfidence: number;
}

/** The localizer's per-frame output — cells to feed the tracker, plus the gates. */
export interface LocalizerResult {
  cells: CameraCell[];
  alignedGeometry: boolean; // false for a paused mid-turn / rolling-shutter hybrid
}

export interface Localizer {
  detect(frame: Frame): LocalizerResult;
}

/**
 * Placeholder localizer. Returns no detection — the real classical/learned localizer
 * is implemented and verified on-device (see T4 in dev-docs/cube-tracker-plan.md).
 */
export function createLocalizer(): Localizer {
  return {
    detect(_frame: Frame): LocalizerResult {
      return { cells: [], alignedGeometry: false };
    },
  };
}
