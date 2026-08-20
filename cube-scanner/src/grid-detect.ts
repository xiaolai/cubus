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

/**
 * True when a color is plausibly a cube sticker: either VIVID (a saturated R/O/G/B/Y) or
 * BRIGHT (a white sticker). A dull mid-tone (grey wall, beige, wood) is neither, so it's
 * rejected. Note colour distance alone can't do this — white IS a grey, so a grey wall and
 * a white sticker are indistinguishable by hue; saturation+brightness separates them.
 */
function looksLikeSticker([r, g, b]: RGB): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max > 0 ? (max - min) / max : 0;
  const val = max / 255;
  // Vivid (a saturated cube colour) OR a bright NEUTRAL white. Skin/wood/beige are bright
  // but tinted (mid saturation), so they fail both — that's what drops the background.
  return sat >= 0.35 || (val >= 0.82 && sat < 0.2);
}

/**
 * Nearest-neighbour downscale so detection runs fast on a wide/high-res capture. Returns
 * the smaller frame and the scale factor (multiply detected coords by 1/scale to map back
 * to the full frame). A no-op when the frame is already within `targetW`.
 */
export function downscaleFrame(frame: Frame, targetW: number): { frame: Frame; scale: number } {
  if (frame.width <= targetW) return { frame, scale: 1 };
  const scale = targetW / frame.width;
  const w = Math.max(1, Math.round(frame.width * scale));
  const h = Math.max(1, Math.round(frame.height * scale));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(frame.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(frame.width - 1, Math.floor(x / scale));
      const si = (sy * frame.width + sx) * 4;
      const di = (y * w + x) * 4;
      data[di] = frame.data[si]!;
      data[di + 1] = frame.data[si + 1]!;
      data[di + 2] = frame.data[si + 2]!;
      data[di + 3] = 255;
    }
  }
  return { frame: { data, width: w, height: h }, scale };
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

/**
 * A cube face's nine stickers are all the SAME size, so keep only the dominant-size cluster
 * and drop size-outliers (a lone big rectangle, a tiny speck). The dominant size is the one
 * with the most similar-width candidates; keep those within [0.65, 1.5]× of it. This both
 * de-noises the overlay and lets the grid search lock on at more angles.
 */
export function keepDominantSize(cands: readonly StickerCell[]): StickerCell[] {
  if (cands.length < 9) return [...cands];
  const near = (a: number, b: number): boolean => a >= b * 0.65 && a <= b * 1.5;
  let bestW = cands[0]!.w;
  let bestCount = -1;
  for (const c of cands) {
    let n = 0;
    for (const o of cands) if (near(o.w, c.w)) n++;
    if (n > bestCount) {
      bestCount = n;
      bestW = c.w;
    }
  }
  return cands.filter((c) => near(c.w, bestW));
}

interface Neighbor {
  j: number;
  dx: number;
  dy: number;
  d: number;
}

const ROLE = [-1, 0, 1] as const;
const MIN_GRID_CELLS = 7; // accept a face with up to 2 stickers missing (logo, glare, finger)

/**
 * Fit a 3x3 lattice using candidate `i` as an anchor and its two nearest neighbors as the
 * basis (so a rotated / perspective-tilted face is fine). `i` may occupy ANY of the nine
 * positions — so a missing or logo-obscured CENTER doesn't block the fit. Returns the nine
 * cells in reading order (a gap filled at its predicted spot) with the count of real
 * matches, or null if fewer than MIN_GRID_CELLS line up.
 */
function gridFrom(
  cands: readonly StickerCell[],
  i: number,
): { cells: StickerCell[]; count: number } | null {
  const a = cands[i]!;
  const others: Neighbor[] = [];
  for (let j = 0; j < cands.length; j++) {
    if (j === i) continue;
    const dx = cands[j]!.cx - a.cx;
    const dy = cands[j]!.cy - a.cy;
    const d = Math.hypot(dx, dy);
    if (d > 1) others.push({ j, dx, dy, d });
  }
  if (others.length < 2) return null;
  others.sort((p, q) => p.d - q.d);
  const u = others[0]!; // nearest neighbor → one grid axis
  // Other axis: nearest neighbor roughly perpendicular to u, similar length, right-handed
  // (screen y-down) so the reading is a rotation of the true face, never a mirror.
  let v: Neighbor | null = null;
  for (const o of others) {
    const cos = (o.dx * u.dx + o.dy * u.dy) / (o.d * u.d);
    const cross = u.dx * o.dy - u.dy * o.dx;
    if (Math.abs(cos) < 0.55 && o.d > u.d * 0.5 && o.d < u.d * 2 && cross > 0) {
      v = o;
      break;
    }
  }
  if (!v) return null;
  const tol = Math.min(u.d, v.d) * 0.6;
  let best: { cells: StickerCell[]; count: number } | null = null;
  for (const rj of ROLE) {
    for (const ri of ROLE) {
      const cells: StickerCell[] = [];
      const used = new Set<number>();
      let count = 0;
      for (const gj of ROLE) {
        for (const gi of ROLE) {
          const px = a.cx + (gi - ri) * u.dx + (gj - rj) * v.dx;
          const py = a.cy + (gi - ri) * u.dy + (gj - rj) * v.dy;
          let bi = -1;
          let bd = tol;
          for (let k = 0; k < cands.length; k++) {
            if (used.has(k)) continue;
            const d = Math.hypot(cands[k]!.cx - px, cands[k]!.cy - py);
            if (d < bd) {
              bd = d;
              bi = k;
            }
          }
          if (bi >= 0) {
            used.add(bi);
            cells.push(cands[bi]!);
            count++;
          } else {
            cells.push({ cx: px, cy: py, w: a.w }); // predicted gap (logo/glare/occlusion)
          }
        }
      }
      if (count >= MIN_GRID_CELLS && (!best || count > best.count)) best = { cells, count };
    }
  }
  return best;
}

/**
 * Find a 3x3 sticker lattice (any rotation / mild perspective, up to 2 stickers missing) and
 * return the nine cells in reading order plus how many were really seen (`real`, 7..9), or
 * null. Structural gate: furniture has no lattice. `real` lets a caller keep the best frame.
 */
export function findGrid(
  cands: readonly StickerCell[],
): { cells: StickerCell[]; real: number } | null {
  if (cands.length < MIN_GRID_CELLS) return null;
  let best: { cells: StickerCell[]; count: number } | null = null;
  for (let i = 0; i < cands.length; i++) {
    const res = gridFrom(cands, i);
    if (res && (!best || res.count > best.count)) best = res;
    if (best && best.count === 9) break;
  }
  return best ? { cells: best.cells, real: best.count } : null;
}

/**
 * Median color of a RING around (cx,cy) — reads a sticker's color while skipping a center
 * logo (e.g. the GAN 冠 printed on the white center), which a central patch would sample.
 */
export function ringColor(frame: Frame, cx: number, cy: number, r: number): RGB {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * 2 * Math.PI;
    const px = Math.round(cx + r * Math.cos(a));
    const py = Math.round(cy + r * Math.sin(a));
    if (px < 0 || px >= frame.width || py < 0 || py >= frame.height) continue;
    const i = (py * frame.width + px) * 4;
    rs.push(frame.data[i]!);
    gs.push(frame.data[i + 1]!);
    bs.push(frame.data[i + 2]!);
  }
  const med = (a: number[]): number => (a.length ? a.sort((p, q) => p - q)[a.length >> 1]! : 0);
  return [med(rs), med(gs), med(bs)];
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
  /** The nine stickers + colors + how many were really seen (7..9), when a grid is present. */
  grid: { colors: RGB[]; cells: StickerCell[]; real: number } | null;
}

/** Extract a sub-rectangle of a frame as a new Frame (for cropping/zooming to the cube). */
export function cropFrame(frame: Frame, rx: number, ry: number, rw: number, rh: number): Frame {
  const x = Math.max(0, Math.min(frame.width - 1, Math.round(rx)));
  const y = Math.max(0, Math.min(frame.height - 1, Math.round(ry)));
  const w = Math.max(1, Math.min(frame.width - x, Math.round(rw)));
  const h = Math.max(1, Math.min(frame.height - y, Math.round(rh)));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) {
    const srow = ((y + j) * frame.width + x) * 4;
    const drow = j * w * 4;
    for (let k = 0; k < w * 4; k++) data[drow + k] = frame.data[srow + k]!;
  }
  return { data, width: w, height: h };
}

/**
 * Collect square sticker candidates from a binary mask (edges or threshold) into `out`.
 * A candidate is kept only if it is square-ish AND its center color is close to some cube
 * color — so background rectangles (walls, wood, paper) that hold no cube color are dropped.
 */
function collectCandidates(
  cv: OpenCv,
  binary: OpenCv,
  frame: Frame,
  minW: number,
  maxW: number,
  out: StickerCell[],
): void {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.findContours(binary, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const rect = cv.boundingRect(c);
      const { width: w, height: h } = rect;
      const aspect = w > 0 && h > 0 ? Math.min(w, h) / Math.max(w, h) : 0;
      const solidity = w * h > 0 ? Math.abs(cv.contourArea(c)) / (w * h) : 0;
      if (w >= minW && w <= maxW && aspect >= 0.5 && solidity > 0.35) {
        const cx = rect.x + w / 2;
        const cy = rect.y + h / 2;
        if (looksLikeSticker(patchColor(frame, cx, cy, w * 0.2))) out.push({ cx, cy, w });
      }
      c.delete();
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }
}

/**
 * Detect a cube face as a 3x3 grid of stickers. Returns all square candidates (so the UI
 * can show near-misses) plus the nine-sticker grid + colors when a lattice is found. This
 * is the structural gate that rejects "any rectangle" — furniture has no 3x3 lattice.
 *
 * Two INDEPENDENT candidate sources are merged so a face-on flat cube is found, not only a
 * tilted one: (1) auto-Canny edges (good with strong border contrast) and (2) an adaptive
 * local threshold (finds the stickers even under even lighting or glare, where the thin
 * gaps are low-contrast globally). Either one supplying the nine is enough.
 */
export function detectStickerGrid(cv: OpenCv, frame: Frame): GridResult {
  const src = cv.matFromImageData(frame);
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const thresh = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  const cleanup = [src, gray, edges, thresh, kernel];
  const minW = frame.width * 0.02;
  const maxW = frame.width * 0.5; // a close, face-on cube's stickers are large — keep them
  const raw: StickerCell[] = [];
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);
    // Source 1 — auto-Canny edges.
    const bin = new cv.Mat();
    const otsu = cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    bin.delete();
    const hi = otsu >= 1 ? otsu : 150;
    cv.Canny(gray, edges, 0.5 * hi, hi);
    cv.dilate(edges, edges, kernel);
    collectCandidates(cv, edges, frame, minW, maxW, raw);
    // Source 2 — adaptive threshold: each sticker is locally brighter than its dark gap
    // borders, so the cells segment even when the gaps are faint globally (even light) or
    // a face-on glossy sheen washes the surface out. This is the "only works at 45°" fix.
    const block = Math.max(3, Math.round(frame.width * 0.04) | 1); // odd, ~sticker-scale
    cv.adaptiveThreshold(gray, thresh, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, block, 6);
    collectCandidates(cv, thresh, frame, minW, maxW, raw);
  } finally {
    for (const m of cleanup) m.delete();
  }

  // Dedupe, then keep only the dominant-size cluster — the nine same-size stickers — so
  // size-outlier background rectangles are ignored (the user's insight).
  const candidates = keepDominantSize(dedupeCells(raw));
  const g = findGrid(candidates);
  // The 8 outer stickers: median of a central patch. The CENTER (index 4): a ring, so a
  // printed center logo (the GAN 冠) is skipped and the true sticker color is read.
  const grid = g
    ? {
        cells: g.cells,
        real: g.real,
        colors: g.cells.map((c, i) =>
          // Center: a wider ring (0.40w) to fully clear a large center logo (the GAN 冠),
          // which was bleeding blue into the white face's center read.
          i === 4
            ? ringColor(frame, c.cx, c.cy, c.w * 0.4)
            : patchColor(frame, c.cx, c.cy, c.w * 0.25),
        ),
      }
    : null;
  return { candidates, grid };
}
