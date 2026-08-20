// The localizer (algorithm §3.1, §12/#13, #15, #17). Turns a raw camera Frame into a
// CameraObservation. The HARD part — finding the cube's face quads in a cluttered,
// in-hand frame — is a `QuadDetector` you inject (OpenCV / a small learned model,
// verified on-device). The geometric core here — a perspective-correct homography
// sample of the 9 stickers from a quad, an annulus that skips the center logo,
// out-of-frame cells reported `unknown`, and center-referenced classification against
// a (possibly rolling) palette — is pure and verified offline against synthetic frames.

import { type Face, faceIndices } from '../cube.js';
import { unknownSoft } from '../likelihood.js';
import type { CameraCell } from '../orientation.js';
import type { SoftColor } from '../types.js';
import { CANONICAL_CENTERS, type RGB, classifySoft } from './color.js';
import type { Frame, Rect } from './motion.js';
import { type CenterPalette, staticPalette } from './palette.js';

export interface Point {
  x: number;
  y: number;
}
/** Four corners of a detected face, in TL, TR, BR, BL order. */
export type Quad = readonly [Point, Point, Point, Point];

/** One detected face: which camera direction it points, and its image quad. */
export interface DetectedFace {
  slot: Face;
  quad: Quad;
}

/** The injectable hard part: find the cube's visible face quads in a frame. */
export interface QuadDetector {
  detect(frame: Frame): { faces: DetectedFace[]; alignedGeometry: boolean };
}

export interface LocalizerResult {
  cells: CameraCell[];
  alignedGeometry: boolean;
  roi?: Rect; // bounding box of the detected faces — for ROI-restricted motion (§12/#17)
  centers?: { slot: Face; rgb: RGB }[]; // raw center-sticker colors — rolling palette + debug
}

export interface Localizer {
  detect(frame: Frame): LocalizerResult;
}

// --- geometric core (pure, offline-tested) -----------------------------------

interface Homography {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g: number;
  h: number;
}

/** Projective map from the unit square (0,0),(1,0),(1,1),(0,1) → the quad (Heckbert). */
export function computeHomography(quad: Quad): Homography {
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    return {
      a: p1.x - p0.x,
      b: p3.x - p0.x,
      c: p0.x,
      d: p1.y - p0.y,
      e: p3.y - p0.y,
      f: p0.y,
      g: 0,
      h: 0,
    };
  }
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-9) {
    // Degenerate / collinear quad — avoid dividing by ~0; fall back to the affine map.
    return {
      a: p1.x - p0.x,
      b: p3.x - p0.x,
      c: p0.x,
      d: p1.y - p0.y,
      e: p3.y - p0.y,
      f: p0.y,
      g: 0,
      h: 0,
    };
  }
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  return {
    a: p1.x - p0.x + g * p1.x,
    b: p3.x - p0.x + h * p3.x,
    c: p0.x,
    d: p1.y - p0.y + g * p1.y,
    e: p3.y - p0.y + h * p3.y,
    f: p0.y,
    g,
    h,
  };
}

function project(m: Homography, u: number, v: number): Point {
  const w = m.g * u + m.h * v + 1;
  return { x: (m.a * u + m.b * v + m.c) / w, y: (m.d * u + m.e * v + m.f) / w };
}

/** Perspective-correct map of a unit-square point through a quad (for tests/tools). */
export function projectQuad(quad: Quad, u: number, v: number): Point {
  return project(computeHomography(quad), u, v);
}

const RING_RADIUS = 0.08; // in unit-square coords (~half of a half-sticker), skips the center logo
const RING_N = 8;

/**
 * Sample the 9 sticker colors from a face quad, perspective-correctly. Each sticker is
 * read from an annulus (skipping the center logo/glare); a sticker whose annulus falls
 * mostly outside the frame is reported `null` (not visible) rather than fabricated from
 * clamped border pixels.
 */
export function sampleQuad(frame: Frame, quad: Quad): (RGB | null)[] {
  const m = computeHomography(quad);
  const med = (a: number[]): number => a.sort((x, y) => x - y)[a.length >> 1]!;
  const out: (RGB | null)[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const uc = (c + 0.5) / 3;
      const vc = (r + 0.5) / 3;
      const rs: number[] = [];
      const gs: number[] = [];
      const bs: number[] = [];
      for (let k = 0; k < RING_N; k++) {
        const ang = (k / RING_N) * 2 * Math.PI;
        const p = project(m, uc + RING_RADIUS * Math.cos(ang), vc + RING_RADIUS * Math.sin(ang));
        const px = Math.round(p.x);
        const py = Math.round(p.y);
        if (px < 0 || px >= frame.width || py < 0 || py >= frame.height) continue; // out of frame (after rounding)
        const i = (py * frame.width + px) * 4;
        rs.push(frame.data[i]!);
        gs.push(frame.data[i + 1]!);
        bs.push(frame.data[i + 2]!);
      }
      out.push(rs.length < RING_N / 2 ? null : [med(rs), med(gs), med(bs)]);
    }
  return out;
}

/** Classify sampled sticker colors; an out-of-frame (null) cell is `unknown`, not guessed. */
export function classifyCells(
  cells: (RGB | null)[],
  centers: Record<Face, RGB> = CANONICAL_CENTERS,
): SoftColor[] {
  return cells.map((rgb) => (rgb === null ? unknownSoft() : classifySoft(rgb, centers)));
}

/**
 * A functional localizer: compose an injected quad detector with the geometric
 * sample + classify core. `palette` supplies the 6 center reference colors — pass a
 * `rollingPalette()` so classification adapts to the cube's own centers under the
 * ambient light (§12/#13); the canonical default is for tests / bootstrap only. Each
 * detected face's center-sticker color is fed back to the palette (`observe`) and
 * reported in `result.centers` for the debug readout.
 */
export function createLocalizer(
  detector: QuadDetector = nullDetector(),
  palette: CenterPalette = staticPalette(),
): Localizer {
  return {
    detect(frame: Frame): LocalizerResult {
      const { faces, alignedGeometry } = detector.detect(frame);
      const centers = palette.get();
      const cells: CameraCell[] = [];
      const detectedCenters: { slot: Face; rgb: RGB }[] = [];
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const face of faces) {
        const sampled = sampleQuad(frame, face.quad);
        // A fully-offscreen face is not a real detection — omit it so the tracker's
        // off-frame timeout (which keys on empty cells) can still fire (§12/#7).
        if (sampled.every((s) => s === null)) continue;
        const centerRgb = sampled[4]; // cell 4 = the invariant center sticker
        if (centerRgb) {
          palette.observe?.(centerRgb);
          detectedCenters.push({ slot: face.slot, rgb: centerRgb });
        }
        const soft = classifyCells(sampled, centers);
        const idx = faceIndices(face.slot);
        soft.forEach((s, k) => cells.push({ slot: idx[k]!, soft: s }));
        for (const p of face.quad) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
      }
      if (cells.length === 0) return { cells, alignedGeometry, centers: detectedCenters };
      const x = Math.max(0, minX);
      const y = Math.max(0, minY);
      const roi: Rect = {
        x,
        y,
        w: Math.max(0, Math.min(frame.width, maxX) - x),
        h: Math.max(0, Math.min(frame.height, maxY) - y),
      };
      return { cells, alignedGeometry, roi, centers: detectedCenters };
    },
  };
}

/** No-op detector — the on-device OpenCV/learned detector plugs in here (T4). */
export function nullDetector(): QuadDetector {
  return { detect: (_frame: Frame) => ({ faces: [], alignedGeometry: false }) };
}
