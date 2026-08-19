// Sample the 9 stickers of one face from a frame. Each sticker is read as the
// per-channel MEDIAN of an annulus around the cell center — the ring skips the
// central logo/glare disc and the outer sticker borders + inter-sticker gaps, so
// the sample reflects the sticker body, not the plastic or the GAN logo.

import type { Frame, RGB, Rect } from './types.js';

// Fraction of the cell half-size to skip at the center (logo) and at the edge.
const INNER = 0.3;
const OUTER = 0.8;

/** Split a square-ish region into 9 cell rects, row-major (top-left first). */
export function gridCells(region: Rect): Rect[] {
  const cw = region.w / 3;
  const ch = region.h / 3;
  const cells: Rect[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      cells.push({ x: region.x + col * cw, y: region.y + row * ch, w: cw, h: ch });
    }
  }
  return cells;
}

// Fail loud on a malformed frame: a truncated buffer would otherwise read
// `undefined` channels (the non-null assertions below would lie) and produce
// bogus colors that could be mistaken for a real face.
function assertFrame(frame: Frame): void {
  const { width, height, data } = frame;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid frame dimensions: ${width}x${height}`);
  }
  if (data.length < width * height * 4) {
    throw new Error(`frame buffer too small: ${data.length} < ${width * height * 4}`);
  }
}

function pixel(frame: Frame, x: number, y: number): RGB {
  const cx = Math.min(frame.width - 1, Math.max(0, x));
  const cy = Math.min(frame.height - 1, Math.max(0, y));
  const i = (cy * frame.width + cx) * 4;
  return [frame.data[i]!, frame.data[i + 1]!, frame.data[i + 2]!];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Median color of the annulus around one cell. */
export function sampleCell(frame: Frame, cell: Rect): RGB {
  assertFrame(frame);
  const cx = cell.x + cell.w / 2;
  const cy = cell.y + cell.h / 2;
  const half = Math.min(cell.w, cell.h) / 2;
  const inner = INNER * half;
  const outer = OUTER * half;

  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const x0 = Math.floor(cell.x);
  const x1 = Math.ceil(cell.x + cell.w);
  const y0 = Math.floor(cell.y);
  const y1 = Math.ceil(cell.y + cell.h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (dist < inner || dist > outer) continue;
      const [r, g, b] = pixel(frame, x, y);
      rs.push(r);
      gs.push(g);
      bs.push(b);
    }
  }
  // Degenerate cell (too small for a ring): fall back to the pixel the center
  // falls in. Pixels are modeled centered at x+0.5, so floor(cx) is that pixel.
  if (rs.length === 0) return pixel(frame, Math.floor(cx), Math.floor(cy));
  return [median(rs), median(gs), median(bs)];
}

/** Median color of each of the given cells. */
export function sampleGrid(frame: Frame, cells: Rect[]): RGB[] {
  return cells.map((cell) => sampleCell(frame, cell));
}
