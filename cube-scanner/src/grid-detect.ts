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

/** Collapse near-duplicate candidates (Canny yields inner+outer edges of each sticker). */
export function dedupeCells(cands: readonly StickerCell[]): StickerCell[] {
  const kept: StickerCell[] = [];
  for (const c of cands) {
    if (!kept.some((k) => Math.hypot(k.cx - c.cx, k.cy - c.cy) < Math.min(k.w, c.w) * 0.4))
      kept.push(c);
  }
  return kept;
}

interface Neighbor {
  j: number;
  dx: number;
  dy: number;
  d: number;
}

/**
 * Try candidate `i` as the grid center: estimate the lattice basis from its own neighbors
 * (so a rotated / perspective-tilted face is fine, not just an axis-aligned one), then
 * require a distinct candidate at each of the nine lattice positions. Returns the nine
 * indices in LATTICE reading order — a pure rotation of the true face, which the
 * orientation solver then resolves — or null.
 */
function tryGrid(cands: readonly StickerCell[], i: number): number[] | null {
  const c = cands[i]!;
  const others: Neighbor[] = [];
  for (let j = 0; j < cands.length; j++) {
    if (j === i) continue;
    const dx = cands[j]!.cx - c.cx;
    const dy = cands[j]!.cy - c.cy;
    const d = Math.hypot(dx, dy);
    if (d > 1) others.push({ j, dx, dy, d });
  }
  if (others.length < 3) return null;
  others.sort((a, b) => a.d - b.d);
  const u = others[0]!; // nearest neighbor → one grid axis
  // The other axis: nearest neighbor roughly perpendicular to u, similar length, and on the
  // right-handed side (screen y-down) so the reading is a rotation of the true face, never a mirror.
  let v: Neighbor | null = null;
  for (const o of others) {
    const cos = (o.dx * u.dx + o.dy * u.dy) / (o.d * u.d);
    const cross = u.dx * o.dy - u.dy * o.dx;
    if (Math.abs(cos) < 0.4 && o.d > u.d * 0.5 && o.d < u.d * 1.8 && cross > 0) {
      v = o;
      break;
    }
  }
  if (!v) return null;
  const tol = Math.min(u.d, v.d) * 0.5;
  const grid: number[] = [];
  for (let gj = -1; gj <= 1; gj++) {
    for (let gi = -1; gi <= 1; gi++) {
      const px = c.cx + gi * u.dx + gj * v.dx;
      const py = c.cy + gi * u.dy + gj * v.dy;
      let bi = -1;
      let bd = tol;
      for (let k = 0; k < cands.length; k++) {
        const d = Math.hypot(cands[k]!.cx - px, cands[k]!.cy - py);
        if (d < bd) {
          bd = d;
          bi = k;
        }
      }
      if (bi < 0) return null;
      grid.push(bi);
    }
  }
  return new Set(grid).size === 9 ? grid : null;
}

/**
 * Find nine candidates forming a 3x3 lattice (any rotation / mild perspective) and return
 * their indices in reading order, or null. Structural gate: furniture has no such lattice.
 */
export function findGrid(cands: readonly StickerCell[]): number[] | null {
  if (cands.length < 9) return null;
  for (let i = 0; i < cands.length; i++) {
    const g = tryGrid(cands, i);
    if (g) return g;
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

export interface GridResult {
  /** Every sticker-square candidate that passed the size/shape filter (for the overlay). */
  candidates: StickerCell[];
  /** The nine stickers + their colors when a 3x3 grid is present, else null. */
  grid: { colors: RGB[]; cells: StickerCell[] } | null;
}

/**
 * Detect a cube face as a 3x3 grid of stickers. Returns all square candidates (so the UI
 * can show near-misses) plus the nine-sticker grid + colors when a lattice is found. This
 * is the structural gate that rejects "any rectangle" — furniture has no 3x3 lattice.
 */
export function detectStickerGrid(cv: OpenCv, frame: Frame): GridResult {
  const src = cv.matFromImageData(frame);
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  const cleanup = [src, gray, edges, contours, hierarchy, kernel];
  const minW = frame.width * 0.02;
  const maxW = frame.width * 0.42; // a close cube's stickers are large — don't reject them
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
      if (w >= minW && w <= maxW && aspect >= 0.6 && solidity > 0.35)
        raw.push({ cx: rect.x + w / 2, cy: rect.y + h / 2, w });
      c.delete();
    }
  } finally {
    for (const m of cleanup) m.delete();
  }

  const candidates = dedupeCells(raw);
  const idx = findGrid(candidates);
  const grid = idx
    ? {
        cells: idx.map((i) => candidates[i]!),
        colors: idx.map((i) =>
          patchColor(frame, candidates[i]!.cx, candidates[i]!.cy, candidates[i]!.w * 0.25),
        ),
      }
    : null;
  return { candidates, grid };
}
