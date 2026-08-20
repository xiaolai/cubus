// The 3x3 sticker-grid geometry: find nine same-size squares in a lattice among noise,
// reject non-grids, and read colors in reading order. Pure — no OpenCV.
import { describe, expect, it } from 'vitest';
import { type StickerCell, dedupeCells, findGrid, patchColor } from '../src/grid-detect.js';
import type { Frame, RGB } from '../src/types.js';

/** Build a 3x3 lattice of cells at (ox,oy) with spacing `step` and width `w`. */
function grid(ox: number, oy: number, step: number, w: number): StickerCell[] {
  const cells: StickerCell[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) cells.push({ cx: ox + c * step, cy: oy + r * step, w });
  return cells;
}

describe('findGrid', () => {
  it('finds a 3x3 lattice among unrelated candidates and orders it row-major', () => {
    const cells = grid(100, 100, 40, 36);
    // Shuffle + add distant noise squares that are not part of any grid.
    const noise: StickerCell[] = [
      { cx: 500, cy: 60, w: 36 },
      { cx: 40, cy: 400, w: 36 },
      { cx: 620, cy: 300, w: 36 },
    ];
    const all = [
      cells[8]!,
      noise[0]!,
      cells[3]!,
      cells[0]!,
      cells[5]!,
      noise[1]!,
      cells[1]!,
      cells[7]!,
      cells[2]!,
      noise[2]!,
      cells[4]!,
      cells[6]!,
    ];
    const idx = findGrid(all);
    expect(idx).not.toBeNull();
    const ordered = idx!.map((i) => all[i]!);
    // Reading order: cy non-decreasing across rows, cx increasing within each row.
    expect(ordered.map((c) => [c.cx, c.cy])).toEqual([
      [100, 100],
      [140, 100],
      [180, 100],
      [100, 140],
      [140, 140],
      [180, 140],
      [100, 180],
      [140, 180],
      [180, 180],
    ]);
  });

  it('returns null when candidates do not form a grid', () => {
    const scattered: StickerCell[] = Array.from({ length: 12 }, (_, i) => ({
      cx: (i * 97) % 640,
      cy: (i * 53) % 480,
      w: 36,
    }));
    expect(findGrid(scattered)).toBeNull();
  });

  it('returns null with fewer than nine candidates', () => {
    expect(findGrid(grid(0, 0, 40, 36).slice(0, 8))).toBeNull();
  });
});

describe('dedupeCells', () => {
  it('collapses the inner+outer edge of the same sticker', () => {
    const cells: StickerCell[] = [
      { cx: 100, cy: 100, w: 40 },
      { cx: 103, cy: 101, w: 38 }, // same sticker, slightly different edge
      { cx: 200, cy: 100, w: 40 },
    ];
    expect(dedupeCells(cells)).toHaveLength(2);
  });
});

describe('patchColor', () => {
  it('reads the median color of a patch', () => {
    const w = 5;
    const h = 5;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 200;
      data[i * 4 + 1] = 30;
      data[i * 4 + 2] = 30;
      data[i * 4 + 3] = 255;
    }
    const frame: Frame = { data, width: w, height: h };
    expect(patchColor(frame, 2, 2, 1)).toEqual([200, 30, 30] as RGB);
  });
});
