// The 3x3 sticker-grid geometry: find nine same-size squares in a lattice among noise,
// reject non-grids, and read colors in reading order. Pure — no OpenCV.
import { describe, expect, it } from 'vitest';
import {
  type StickerCell,
  dedupeCells,
  downscaleFrame,
  findGrid,
  patchColor,
} from '../src/grid-detect.js';
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
    expect(new Set(idx!).size).toBe(9); // nine distinct cells
    const ordered = idx!.map((i) => all[i]!);
    // The nine found cells are exactly the grid's nine (as a set), not the noise.
    const found = new Set(ordered.map((c) => `${c.cx},${c.cy}`));
    for (const c of cells) expect(found.has(`${c.cx},${c.cy}`)).toBe(true);
    // The middle of the lattice order is the grid's center sticker.
    expect([ordered[4]!.cx, ordered[4]!.cy]).toEqual([140, 140]);
  });

  it('finds a rotated (tilted) 3x3 grid — not only axis-aligned', () => {
    const base = grid(0, 0, 40, 34); // centered on the middle cell (index 4) at (40,40)
    const cx = base[4]!.cx;
    const cy = base[4]!.cy;
    const a = (30 * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const rotated: StickerCell[] = base.map((c) => {
      const dx = c.cx - cx;
      const dy = c.cy - cy;
      return { cx: cx + dx * cos - dy * sin, cy: cy + dx * sin + dy * cos, w: c.w };
    });
    const idx = findGrid(rotated);
    expect(idx).not.toBeNull();
    expect(new Set(idx!).size).toBe(9);
    expect(idx![4]).toBe(4); // middle of the lattice order is still the center sticker
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

describe('downscaleFrame', () => {
  it('halves a wide frame and reports the scale, preserving color', () => {
    const w = 8;
    const h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 10;
      data[i * 4 + 1] = 150;
      data[i * 4 + 2] = 70;
      data[i * 4 + 3] = 255;
    }
    const { frame, scale } = downscaleFrame({ data, width: w, height: h }, 4);
    expect(scale).toBe(0.5);
    expect(frame.width).toBe(4);
    expect(frame.height).toBe(4);
    expect([frame.data[0], frame.data[1], frame.data[2]]).toEqual([10, 150, 70]);
  });

  it('is a no-op when the frame is already small enough', () => {
    const f: Frame = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
    const { frame, scale } = downscaleFrame(f, 640);
    expect(scale).toBe(1);
    expect(frame).toBe(f);
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
