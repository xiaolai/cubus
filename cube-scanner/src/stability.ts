// Motion detection for auto-capture: we snap a face only once the frame holds
// still, so the still isn't motion-blurred and the user isn't fighting a shutter
// button. Pure and Node-testable; the actual thresholds want tuning against a
// real webcam, but the "N steady frames in a row" logic is verified here.

import type { Frame } from './types.js';

/**
 * Mean absolute per-channel difference between two same-sized frames (0..255),
 * computed on a downsampled grid so it's O(1)-ish regardless of resolution.
 * Returns +Infinity if the sizes differ (treated as "not steady").
 */
export function frameDifference(a: Frame, b: Frame): number {
  if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
  const stepX = Math.max(1, Math.floor(a.width / 32));
  const stepY = Math.max(1, Math.floor(a.height / 32));
  let sum = 0;
  let n = 0;
  for (let y = 0; y < a.height; y += stepY) {
    for (let x = 0; x < a.width; x += stepX) {
      const i = (y * a.width + x) * 4;
      sum +=
        Math.abs(a.data[i]! - b.data[i]!) +
        Math.abs(a.data[i + 1]! - b.data[i + 1]!) +
        Math.abs(a.data[i + 2]! - b.data[i + 2]!);
      n += 3;
    }
  }
  return n ? sum / n : 0;
}

export interface SteadyOptions {
  /** Mean per-channel diff (0..255) below which a frame counts as still. */
  threshold?: number;
  /** How many consecutive still frames before we call it steady. */
  framesNeeded?: number;
}

/** Tracks whether the recent frames have held still (low motion). */
export class SteadyDetector {
  private readonly threshold: number;
  private readonly framesNeeded: number;
  private prev: Frame | null = null;
  private steadyCount = 0;

  constructor(opts: SteadyOptions = {}) {
    this.threshold = opts.threshold ?? 6;
    this.framesNeeded = opts.framesNeeded ?? 4;
  }

  /** Feed the current frame; returns true once the frame has held still. */
  push(frame: Frame): boolean {
    if (this.prev && frameDifference(this.prev, frame) <= this.threshold) {
      this.steadyCount++;
    } else {
      this.steadyCount = 0;
    }
    this.prev = frame;
    return this.steadyCount >= this.framesNeeded;
  }

  /** Motion 0..255 vs the previous frame (Infinity before the first frame). */
  motion(frame: Frame): number {
    return this.prev ? frameDifference(this.prev, frame) : Number.POSITIVE_INFINITY;
  }

  reset(): void {
    this.prev = null;
    this.steadyCount = 0;
  }
}
