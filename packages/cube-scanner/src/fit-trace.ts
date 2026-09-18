/**
 * What the scan saw in one frame, for someone working out why a side will not settle.
 *
 * The scan's own path answers one bit per frame — a face, or an abstention with a reason — and that
 * is right for the scan and useless for a diagnosis. "PARTIAL_FACE" does not say WHICH sticker was
 * missing, whether the detector saw it and scored it just under the threshold, or saw nothing there
 * at all. Those are three different faults with three different remedies, so this records what the
 * detector actually produced around the threshold, and where.
 *
 * FAITHFUL BY CONSTRUCTION. The verdict here is not re-derived: `kept` comes from
 * `detectionsFromOutput`, the same function `fitFromOutput` calls, and `fit` from the same
 * `fitFace`. A diagnostic that disagreed with the scan would describe a scan that never happened,
 * which is worse than no diagnostic. The one thing added is a second decode at a lower floor, used
 * ONLY to show what the scan discarded — never to decide anything. It cannot feed back: a
 * low-confidence box added to the scan's own set could make `dropNested` drop a real sticker, which
 * is exactly why the scan's set and this one are kept apart.
 */

import type { ModelOutput } from './detector.js';
import { type DetectOptions, detectionsFromOutput, NUM_CLASSES } from './onnx-detect.js';
import {
  type Detection,
  decodeDetections,
  type FaceFit,
  type FitResult,
  fitFace,
  MIN_STICKER_CONFIDENCE,
  nms,
} from './onnx-postprocess.js';

/**
 * How low a near-miss is still worth showing. Below the scan's 0.25, above noise: a sticker scored
 * 0.18 is a sticker the detector nearly saw, and one scored 0.02 is a sticker it did not.
 */
export const NEAR_FLOOR = 0.1;

/** Boxes kept per frame. A face is nine; the rest is what surrounds it, which is where faults hide. */
export const BOX_CAP = 16;

/**
 * Candidates considered for near-misses before NMS. NMS is quadratic, and a frame of low-confidence
 * noise can hold thousands of candidates above the floor — the trace must never slow the ticks it
 * is measuring. The top of the list by confidence is where anything worth showing is anyway.
 */
export const NEAR_CANDIDATES = 300;

/** One box, rounded for the log: centre and size in model space, and what the detector said. */
export interface TracedBox {
  x: number;
  y: number;
  w: number;
  h: number;
  cls: number;
  conf: number;
  /** True for a box the scan used; false for a near-miss it discarded. */
  kept: boolean;
}

/**
 * The box at the centre of the face, which is where a logo sits. Null when there are too few kept
 * boxes to say where the face is.
 *
 * `scores` is the box's score for every colour class, winner included — the question a logo raises
 * is not only what the centre was read as but what came second: whether a white centre printed
 * with a logo still scores white well above the other colours when it loses, and whether a plain
 * centre never does. Absent when the box was built without them.
 *
 * On a frame the scan read, this is the fitted grid's centre (`dist` 0); the search is for frames
 * it could not read, which is where a logo loses its centre.
 */
export type CentreProbe =
  | null
  | { found: false }
  | { found: true; cls: number; conf: number; kept: boolean; dist: number; scores?: number[] };

export interface FrameTrace {
  /** The scan's verdict, from the scan's own boxes. */
  fit: FitResult;
  /** Boxes the scan kept (at or above its threshold, after NMS and nested-box removal). */
  kept: number;
  /** Boxes between NEAR_FLOOR and the threshold, in places no kept box already covers. */
  near: number;
  boxes: TracedBox[];
  centre: CentreProbe;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function box(d: Detection, kept: boolean): TracedBox {
  return {
    x: r1(d.cx),
    y: r1(d.cy),
    w: r1(d.w),
    h: r1(d.h),
    cls: d.classId,
    conf: r3(d.confidence),
    kept,
  };
}

/**
 * The box nearest the middle of the face, from kept boxes and near-misses alike.
 *
 * "The middle of the face" is the midpoint of the kept boxes' extent. With the centre sticker
 * missing — the case this exists for — the other eight still span the whole face, so their extent's
 * midpoint IS the empty cell. Within 0.6 of a sticker counts as there; further is "nothing at the
 * centre", which is its own answer: the detector did not see a sticker there at all.
 */
export function centreProbe(kept: Detection[], near: Detection[]): CentreProbe {
  if (kept.length < 4) return null;
  const xs = kept.map((d) => d.cx);
  const ys = kept.map((d) => d.cy);
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const my = (Math.min(...ys) + Math.max(...ys)) / 2;
  const size = kept.reduce((s, d) => s + (d.w + d.h) / 2, 0) / kept.length;
  let best: { d: Detection; kept: boolean; dist: number } | null = null;
  for (const [set, isKept] of [
    [kept, true],
    [near, false],
  ] as const) {
    for (const d of set) {
      const dist = Math.hypot(d.cx - mx, d.cy - my) / size;
      if (best === null || dist < best.dist) best = { d, kept: isKept, dist };
    }
  }
  if (best === null || best.dist > 0.6) return { found: false };
  return {
    found: true,
    cls: best.d.classId,
    conf: r3(best.d.confidence),
    kept: best.kept,
    dist: r3(best.dist),
    ...(best.d.scores ? { scores: best.d.scores.map(r3) } : {}),
  };
}

/**
 * The centre of a face the scan READ: the grid's own middle box, taken from the fit rather than
 * searched for. The search finds the middle from the extent of every kept box, and a stray box the fit
 * dropped as isolated still stretches that extent: on a real scan (2026-09-18) 115 read frames named
 * a different box as the centre, or said nothing was there, most of them beside one background box.
 */
function fittedCentre(face: FaceFit): CentreProbe {
  const scores = face.scores?.[4];
  return {
    found: true,
    cls: face.colors[4]!,
    conf: r3(face.confidence[4]!),
    kept: true,
    dist: 0,
    ...(scores ? { scores: scores.map(r3) } : {}),
  };
}

export interface TraceOptions extends DetectOptions {
  floor?: number;
  cap?: number;
}

/**
 * Trace one frame. Throws exactly where the scan throws (a head with the wrong row count), because
 * the verdict is the scan's own — and nowhere else, because the rest reads only what the verdict
 * has already read.
 */
export function traceFrame(
  output: ModelOutput,
  opts: TraceOptions = {},
  // The scan's own boxes, when the caller already has them: the panel decodes each frame once and
  // hands the same boxes to the fit, the trace and the ring check. They must be `detectionsFromOutput`
  // of this output with these options — anything else would describe a scan that never happened.
  kept: Detection[] = detectionsFromOutput(output, opts),
): FrameTrace {
  const threshold = opts.confThreshold ?? MIN_STICKER_CONFIDENCE;
  const fit = fitFace(kept, opts.minConf ?? MIN_STICKER_CONFIDENCE);

  // Decoded at the floor and put through NMS WITH the scan-grade boxes, so a near-miss that is only
  // a weaker duplicate of a real sticker is suppressed by it. What survives below the threshold
  // therefore sits where the scan saw nothing — which is the point of showing it.
  //
  // Unguarded on purpose. This reads the same tensor, with the same class count and anchor count,
  // that `detectionsFromOutput` has just read without error, so it cannot throw where the scan did
  // not. A try/catch here was written and then removed: its catch could not be reached, and a test
  // claiming to cover it could only assert that it had not run.
  const candidates = decodeDetections(
    output.data,
    opts.numClasses ?? NUM_CLASSES,
    output.anchors,
    opts.floor ?? NEAR_FLOOR,
  )
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, NEAR_CANDIDATES);
  const nearDets = nms(candidates, opts.iouThreshold ?? 0.45).filter(
    (d) => d.confidence < threshold,
  );

  const cap = opts.cap ?? BOX_CAP;
  const boxes = [
    ...[...kept].sort((a, b) => b.w * b.h - a.w * a.h).map((d) => box(d, true)),
    ...[...nearDets].sort((a, b) => b.confidence - a.confidence).map((d) => box(d, false)),
  ].slice(0, cap);

  return {
    fit,
    kept: kept.length,
    near: nearDets.length,
    boxes,
    centre: fit.ok ? fittedCentre(fit.face) : centreProbe(kept, nearDets),
  };
}
