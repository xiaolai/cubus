// The motion gate (algorithm §12/#14, #17): a cheap per-frame stillness check so the
// expensive belief update runs only on stable frames. Motion is measured on an OWNED
// downsampled-luma snapshot (so a reused capture buffer can't silently read as "no
// motion"), optionally restricted to the cube's ROI (so background motion or a tiny
// cube don't fool a full-frame diff). The geometric layer-alignment gate (rejecting
// paused mid-turns) needs the localizer's quad and is verified on-device.

/** A raw RGBA frame — not the DOM ImageData class, so it is Node-constructible. */
export interface Frame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Axis-aligned rectangle in original-frame pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An OWNED downsampled luma snapshot — a copy, never a reference to caller memory. */
export interface LumaGrid {
  data: Float32Array;
  gw: number;
  gh: number;
  step: number;
  w: number; // original frame width — grids of different frames must not compare equal
  h: number; // original frame height
}

/** Downsample a frame to an owned luma grid (samples every `step`-th pixel). */
export function toLuma(frame: Frame, step = 8): LumaGrid {
  const gw = Math.floor((frame.width - 1) / step) + 1;
  const gh = Math.floor((frame.height - 1) / step) + 1;
  const data = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      const i = (gy * step * frame.width + gx * step) * 4;
      data[gy * gw + gx] =
        0.299 * frame.data[i]! + 0.587 * frame.data[i + 1]! + 0.114 * frame.data[i + 2]!;
    }
  return { data, gw, gh, step, w: frame.width, h: frame.height };
}

/** Mean absolute luma difference between two grids, optionally within a pixel ROI. */
export function lumaDiff(a: LumaGrid, b: LumaGrid, roi?: Rect): number {
  // Guard on ORIGINAL dims AND step, not just grid dims: 9×9 and 16×16 both give a 2×2
  // grid, and 16×16 at step 8 vs 9 also collapse equal — different lattices must not compare.
  if (a.gw !== b.gw || a.gh !== b.gh || a.w !== b.w || a.h !== b.h || a.step !== b.step)
    return Number.POSITIVE_INFINITY;
  let sum = 0;
  let n = 0;
  for (let gy = 0; gy < a.gh; gy++)
    for (let gx = 0; gx < a.gw; gx++) {
      if (roi) {
        const px = gx * a.step;
        const py = gy * a.step;
        if (px < roi.x || px >= roi.x + roi.w || py < roi.y || py >= roi.y + roi.h) continue;
      }
      sum += Math.abs(a.data[gy * a.gw + gx]! - b.data[gy * a.gw + gx]!);
      n++;
    }
  // An ROI smaller than the sample lattice would leave n === 0 forever → never
  // stabilizes; fall back to the full-frame diff so the gate still works.
  if (n === 0) return roi ? lumaDiff(a, b) : Number.POSITIVE_INFINITY;
  return sum / n;
}

/** Mean absolute luma difference between two frames (full-frame convenience). */
export function frameDiff(a: Frame, b: Frame, step = 8): number {
  if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
  return lumaDiff(toLuma(a, step), toLuma(b, step));
}

/** N-consecutive-low-diff stability accumulator. */
export class StabilityGate {
  private history: number[] = [];
  private readonly threshold: number;
  private readonly need: number;

  constructor(threshold = 6, need = 3) {
    // Validate: a NaN/Infinity `need` would grow history unbounded; a non-positive
    // `need` would mark the initial infinite diff "stable" (§12/#11 audit).
    if (!Number.isInteger(need) || need < 1)
      throw new Error(`StabilityGate: need must be a positive integer, got ${need}`);
    if (!Number.isFinite(threshold) || threshold < 0)
      throw new Error(`StabilityGate: threshold must be finite ≥ 0, got ${threshold}`);
    this.threshold = threshold;
    this.need = need;
  }

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
