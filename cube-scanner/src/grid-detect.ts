// Sticker-GRID face detection — the proven approach (as in kkoomen/qbr and most robust
// webcam cube scanners). We do NOT look for the face outline as one big rectangle (that
// matches any door / wall / face). Instead we find the NINE small sticker squares and
// require them to form a 3x3 lattice: a real face has nine same-size squares in a grid;
// furniture does not. Colours are then read per sticker and matched to the cube palette.
//
// The grid geometry (findGrid / reading order) and colour patch reader are PURE and
// Node-tested; only the OpenCV contour extraction (detectStickerGrid) is hardware-bound.

import type { Frame, RGB } from './types.js';

// OpenCV.js is injected; its surface is large and dynamically shaped.
export type OpenCv = any;

/** One sticker-square candidate: bounding-box center and width. */
export interface StickerCell {
  cx: number;
  cy: number;
  w: number;
}

const GRID_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/** Collapse near-duplicate candidates (Canny yields inner+outer edges of each sticker). */
export function dedupeCells(cands: readonly StickerCell[]): StickerCell[] {
  const kept: StickerCell[] = [];
  for (const c of cands) {
    if (!kept.some((k) => Math.hypot(k.cx - c.cx, k.cy - c.cy) < Math.min(k.w, c.w) * 0.4))
      kept.push(c);
  }
  return kept;
}

/** Sort nine candidate indices into reading order (rows top→bottom, each row left→right). */
function readingOrder(idx: readonly number[], cands: readonly StickerCell[]): number[] {
  const byRow = [...idx].sort((a, b) => cands[a]!.cy - cands[b]!.cy);
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    out.push(...byRow.slice(r * 3, r * 3 + 3).sort((a, b) => cands[a]!.cx - cands[b]!.cx));
  }
  return out;
}

/**
 * Find nine candidates forming a 3x3 lattice and return their indices in reading order,
 * or null. For each candidate treated as the center, predict the 3x3 grid at one-sticker
 * spacing and require a distinct real candidate near every one of the nine positions.
 */
export function findGrid(cands: readonly StickerCell[]): number[] | null {
  if (cands.length < 9) return null;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i]!;
    const step = c.w * 1.15; // sticker width + a thin gap ≈ center-to-center spacing
    const tol = c.w * 0.6;
    const matched: number[] = [];
    for (const [dx, dy] of GRID_OFFSETS) {
      const px = c.cx + dx * step;
      const py = c.cy + dy * step;
      let bi = -1;
      let bd = tol;
      for (let j = 0; j < cands.length; j++) {
        const d = Math.hypot(cands[j]!.cx - px, cands[j]!.cy - py);
        if (d < bd) {
          bd = d;
          bi = j;
        }
      }
      if (bi < 0) break;
      matched.push(bi);
    }
    if (matched.length === 9 && new Set(matched).size === 9) return readingOrder(matched, cands);
  }
  return null;
}

/** Median color of a small patch centred at (cx,cy) — samples the sticker's middle. */
export function patchColor(frame: Frame, cx: number, cy: number, r: number): RGB {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const x0 = Math.max(0, Math.round(cx - r));
  const x1 = Math.min(frame.width - 1, Math.round(cx + r));
  const y0 = Math.max(0, Math.round(cy - r));
  const y1 = Math.min(frame.height - 1, Math.round(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * frame.width + x) * 4;
      rs.push(frame.data[i]!);
      gs.push(frame.data[i + 1]!);
      bs.push(frame.data[i + 2]!);
    }
  }
  const med = (a: number[]): number => (a.length ? a.sort((p, q) => p - q)[a.length >> 1]! : 0);
  return [med(rs), med(gs), med(bs)];
}

/**
 * Detect a cube face as a 3x3 grid of stickers and read their nine colors (reading order),
 * or null when no grid is present. This is the structural gate that rejects "any rectangle".
 */
export function detectStickerGrid(
  cv: OpenCv,
  frame: Frame,
): { colors: RGB[]; cells: StickerCell[] } | null {
  const src = cv.matFromImageData(frame);
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  const cleanup = [src, gray, edges, contours, hierarchy, kernel];
  const minW = frame.width * 0.03;
  const maxW = frame.width * 0.32;
  const raw: StickerCell[] = [];
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);
    const bin = new cv.Mat();
    const otsu = cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    bin.delete();
    const hi = otsu >= 1 ? otsu : 150;
    cv.Canny(gray, edges, 0.5 * hi, hi);
    cv.dilate(edges, edges, kernel);
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const rect = cv.boundingRect(c);
      const { width: w, height: h } = rect;
      const aspect = w > 0 && h > 0 ? Math.min(w, h) / Math.max(w, h) : 0;
      const solidity = w * h > 0 ? Math.abs(cv.contourArea(c)) / (w * h) : 0;
      if (w >= minW && w <= maxW && aspect >= 0.7 && solidity > 0.4)
        raw.push({ cx: rect.x + w / 2, cy: rect.y + h / 2, w });
      c.delete();
    }
  } finally {
    for (const m of cleanup) m.delete();
  }

  const cands = dedupeCells(raw);
  const grid = findGrid(cands);
  if (!grid) return null;
  const cells = grid.map((i) => cands[i]!);
  const colors = cells.map((cell) => patchColor(frame, cell.cx, cell.cy, cell.w * 0.25));
  return { colors, cells };
}
