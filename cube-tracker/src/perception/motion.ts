// The motion gate (algorithm §12/#14, #17): a cheap per-frame stillness check so the
// expensive belief update runs only on stable frames. This is the pure, testable part
// — frame differencing + an N-frame stability accumulator. The GEOMETRIC layer-
// alignment gate (rejecting paused mid-turns) needs the localizer's detected quad and
// is part of perception/localize.ts (hardware-verified, not offline-testable).

/** A raw RGBA frame — not the DOM ImageData class, so it is Node-constructible. */
export interface Frame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Mean absolute luma difference between two frames, sampled every `step` pixels. */
export function frameDiff(a: Frame, b: Frame, step = 8): number {
  if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4 * step) {
    const la = 0.299 * a.data[i]! + 0.587 * a.data[i + 1]! + 0.114 * a.data[i + 2]!;
    const lb = 0.299 * b.data[i]! + 0.587 * b.data[i + 1]! + 0.114 * b.data[i + 2]!;
    sum += Math.abs(la - lb);
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

/** N-consecutive-low-diff stability accumulator. */
export class StabilityGate {
  private history: number[] = [];
  constructor(
    private readonly threshold = 6,
    private readonly need = 3,
  ) {}

  /** Push a frame diff; returns true once `need` consecutive diffs are below threshold. */
  push(diff: number): boolean {
    this.history.push(diff);
    if (this.history.length > this.need) this.history.shift();
    return this.history.length >= this.need && this.history.every((d) => d < this.threshold);
  }

  reset(): void {
    this.history = [];
  }
}
