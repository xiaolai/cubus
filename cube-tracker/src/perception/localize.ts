// The localizer (algorithm §3.1, §12/#15, #17). Turns a raw camera Frame into a
// CameraObservation. The HARD part — finding the cube's face quads in a cluttered,
// in-hand frame — is a `QuadDetector` you inject (OpenCV / a small learned model,
// verified on-device). The geometric core here — perspective-sample the 9 stickers
// from a quad and classify each via the center-referenced color model — is pure and
// verified offline against synthetic frames (the same way cube-scanner tests its
// homography on synthetic quads).

import { type Face, faceIndices } from '../cube.js';
import type { CameraCell } from '../orientation.js';
import type { SoftColor } from '../types.js';
import { CANONICAL_CENTERS, type RGB, classifySoft } from './color.js';
import type { Frame } from './motion.js';

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
}

export interface Localizer {
  detect(frame: Frame): LocalizerResult;
}

// --- geometric core (pure, offline-tested) -----------------------------------

function clampSample(frame: Frame, x: number, y: number): RGB {
  const px = Math.min(frame.width - 1, Math.max(0, Math.round(x)));
  const py = Math.min(frame.height - 1, Math.max(0, Math.round(y)));
  const i = (py * frame.width + px) * 4;
  return [frame.data[i]!, frame.data[i + 1]!, frame.data[i + 2]!];
}

function medianPatch(frame: Frame, cx: number, cy: number, ring: number): RGB {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let dy = -ring; dy <= ring; dy++)
    for (let dx = -ring; dx <= ring; dx++) {
      const [r, g, b] = clampSample(frame, cx + dx, cy + dy);
      rs.push(r);
      gs.push(g);
      bs.push(b);
    }
  const med = (a: number[]): number => a.sort((x, y) => x - y)[a.length >> 1]!;
  return [med(rs), med(gs), med(bs)];
}

/** Perspective (bilinear) map from the unit square to a quad. */
function bilerp(quad: Quad, u: number, v: number): Point {
  const [tl, tr, br, bl] = quad;
  const top = { x: tl.x + (tr.x - tl.x) * u, y: tl.y + (tr.y - tl.y) * u };
  const bot = { x: bl.x + (br.x - bl.x) * u, y: bl.y + (br.y - bl.y) * u };
  return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
}

/** Sample the 9 sticker colors from a detected face quad, row-major. */
export function sampleQuad(frame: Frame, quad: Quad, ring = 1): RGB[] {
  const out: RGB[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const p = bilerp(quad, (c + 0.5) / 3, (r + 0.5) / 3);
      out.push(medianPatch(frame, p.x, p.y, ring));
    }
  return out;
}

/** Classify 9 sampled sticker colors against the 6 center colors → soft distributions. */
export function classifyCells(
  rgb9: RGB[],
  centers: Record<Face, RGB> = CANONICAL_CENTERS,
): SoftColor[] {
  return rgb9.map((rgb) => classifySoft(rgb, centers));
}

/**
 * A functional localizer: compose an injected quad detector with the geometric
 * sample + classify core. Each detected face contributes 9 camera-slot cells.
 */
export function createLocalizer(
  detector: QuadDetector = nullDetector(),
  centers: Record<Face, RGB> = CANONICAL_CENTERS,
): Localizer {
  return {
    detect(frame: Frame): LocalizerResult {
      const { faces, alignedGeometry } = detector.detect(frame);
      const cells: CameraCell[] = [];
      for (const face of faces) {
        const soft = classifyCells(sampleQuad(frame, face.quad), centers);
        const idx = faceIndices(face.slot);
        soft.forEach((s, k) => cells.push({ slot: idx[k]!, soft: s }));
      }
      return { cells, alignedGeometry };
    },
  };
}

/** No-op detector — the on-device OpenCV/learned detector plugs in here (T4). */
export function nullDetector(): QuadDetector {
  return { detect: (_frame: Frame) => ({ faces: [], alignedGeometry: false }) };
}
