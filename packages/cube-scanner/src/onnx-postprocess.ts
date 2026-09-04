// Pure post-processing for the YOLOv11 sticker detector: decode raw model output →
// NMS → fit the front face's 3x3 grid → 9 colour classes in reading order. No DOM, no
// onnxruntime — it operates on a Float32Array, so it's Node-testable from a fixture
// exactly like the rest of the pure core. The browser shell (onnx-detect) only feeds it
// the model's output tensor.
//
// The model labels EVERY visible sticker (front face + any adjacent faces at an angle),
// so this must pick the nine that form the front-facing grid and REFUSE a frame that
// isn't a clean single face — the abstention the verifier design depends on.

/**
 * The lowest per-sticker score `fitFace` will build a face out of.
 *
 * Named rather than left as a bare default because it is one half of an invariant that spans two
 * files: it sits ABOVE `LOW_CONFIDENCE_THRESHOLD` in ai-assemble, which is what makes "a valid
 * cube with low-confidence stickers" unreachable. A change to either number that crossed them
 * would bring that state back silently, so `onnx-postprocess.test.ts` pins the ordering with the
 * mechanism written beside it.
 */
export const MIN_STICKER_CONFIDENCE = 0.25;

/** One detected sticker. Box coords are in the model's input space; only relative geometry is used. */
export interface Detection {
  cx: number;
  cy: number;
  w: number;
  h: number;
  classId: number; // 0..5 colour class
  confidence: number;
}

export interface FaceFit {
  colors: number[]; // 9 colour classes, reading order (row-major)
  confidence: number[]; // 9 per-sticker confidences
}

export type FitResult = { ok: true; face: FaceFit } | { ok: false; reason: FitReason };
export type FitReason = 'NO_FACE' | 'PARTIAL_FACE' | 'BAD_GEOMETRY';

/**
 * Decode a YOLOv11 detect output tensor of shape [4 + numClasses, numAnchors]
 * (row-major, the Ultralytics ONNX layout: rows cx,cy,w,h,cls0..) into detections
 * above `confThreshold`. Box coords are passed through in the model's input space.
 */
export function decodeDetections(
  data: Float32Array | number[],
  numClasses: number,
  numAnchors: number,
  confThreshold = 0.25,
): Detection[] {
  const rows = 4 + numClasses;
  if (data.length < rows * numAnchors) {
    throw new Error(`output too small: ${data.length} < ${rows * numAnchors}`);
  }
  const at = (r: number, a: number): number => data[r * numAnchors + a]!;
  const out: Detection[] = [];
  for (let a = 0; a < numAnchors; a++) {
    let best = 0;
    let bestScore = at(4, a);
    for (let c = 1; c < numClasses; c++) {
      const s = at(4 + c, a);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (bestScore >= confThreshold) {
      out.push({
        cx: at(0, a),
        cy: at(1, a),
        w: at(2, a),
        h: at(3, a),
        classId: best,
        confidence: bestScore,
      });
    }
  }
  return out;
}

function iou(a: Detection, b: Detection): number {
  const ax0 = a.cx - a.w / 2;
  const ay0 = a.cy - a.h / 2;
  const bx0 = b.cx - b.w / 2;
  const by0 = b.cy - b.h / 2;
  const ix0 = Math.max(ax0, bx0);
  const iy0 = Math.max(ay0, by0);
  const ix1 = Math.min(ax0 + a.w, bx0 + b.w);
  const iy1 = Math.min(ay0 + a.h, by0 + b.h);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Greedy non-maximum suppression, highest confidence first. Class-agnostic (stickers don't overlap). */
export function nms(dets: Detection[], iouThreshold = 0.45): Detection[] {
  const order = [...dets].sort((a, b) => b.confidence - a.confidence);
  const kept: Detection[] = [];
  for (const d of order) {
    if (kept.every((k) => iou(k, d) < iouThreshold)) kept.push(d);
  }
  return kept;
}

/**
 * The largest step between adjacent rows or columns, as a multiple of the mean sticker size.
 *
 * There was a MINIMUM step and no maximum, so nine boxes scattered across the frame — a column
 * 200 px away from its neighbours — stepped apart happily and read as a face. A real 3x3 face
 * steps by roughly one sticker plus its gap; the widest a golden fixture reaches is 1.54, on a
 * photo held at an angle. See MAX_AREA_RATIO for why every bound here is set by the fixtures.
 */
const MAX_STEP = 2.5;
/**
 * How far apart, in mean sticker sizes, the three stickers of one COLUMN may sit in x.
 *
 * The mirror of the row rule above it — and deliberately NOT the same number. A row's y-spread is
 * bounded at one sticker and the goldens sit right on it (render-07: 1.00); a column's x-spread
 * reaches 1.95 on the same set (render-01), because the hold that shears a face horizontally is
 * the common one and the renders are deliberately extreme. So 1.0 here — the obvious symmetric
 * choice, and the one first tried — would REFUSE seven of the twenty golden fixtures. This is the
 * value the fixtures permit, and it still refuses three rows sheared past each other, which is
 * what the check is for.
 */
const MAX_COLUMN_SPREAD = 3;
/**
 * Largest allowed ratio between the biggest and smallest box AREA among the nine.
 *
 * AREA, not mean side length, and that is the whole point of the bound. The case it exists to
 * refuse is eight front stickers plus one sliver of a NEIGHBOURING face: foreshortening squashes
 * such a box along one axis only, so its mean side is about half a front sticker's (a ratio of
 * 2.0) while a legitimately angled render already reaches 1.81 — five percent of separation,
 * which is not a bound, it is a coin toss. In AREA the same sliver is 7.2x and the worst
 * legitimate golden is 3.42x, so the two populations are actually apart.
 *
 * Every number in this file was chosen the same way: measured over all 20 fixtures in
 * `ml/golden/frames/`, and set high enough that not one of their reads changes. They are sanity
 * bounds, not tight ones — the goldens set the ceiling, and a heuristic that refuses a frame the
 * gate says is readable is worse than one that admits a frame it should not.
 */
const MAX_AREA_RATIO = 5;

/** Split 9 detections into 3 rows of 3 (reading order) iff they form a plausible 3x3 grid. */
function toGrid(nine: Detection[]): Detection[] | null {
  const byY = [...nine].sort((a, b) => a.cy - b.cy);
  const rows = [byY.slice(0, 3), byY.slice(3, 6), byY.slice(6, 9)].map((r) =>
    r.sort((a, b) => a.cx - b.cx),
  );
  const size = nine.reduce((s, d) => s + (d.w + d.h) / 2, 0) / 9; // mean sticker size
  // Nine boxes of wildly different areas are not nine stickers of one face. A degenerate box
  // (w or h at zero) makes this infinite, which refuses rather than dividing by zero downstream.
  const areas = nine.map((d) => d.w * d.h);
  if (Math.max(...areas) > Math.min(...areas) * MAX_AREA_RATIO) return null;
  // Each row's 3 stickers must share a y-band (spread < ~1 sticker), and the 3 rows must
  // step apart in y; likewise columns in x. A non-grid arrangement (partial face, junk)
  // fails this and we abstain rather than emit a garbage face.
  for (const row of rows) {
    if (Math.max(...row.map((d) => d.cy)) - Math.min(...row.map((d) => d.cy)) > size) return null;
  }
  // …and each column's 3 stickers must share an x-band. Without this, three rows sheared past
  // each other — row 0 at x 100, row 2 at x 400 — satisfied every rule above and read as a face.
  for (const c of [0, 1, 2]) {
    const xs = rows.map((r) => r[c]!.cx);
    if (Math.max(...xs) - Math.min(...xs) > size * MAX_COLUMN_SPREAD) return null;
  }
  const rowY = rows.map((r) => r.reduce((s, d) => s + d.cy, 0) / 3);
  const colX = [0, 1, 2].map((c) => rows.reduce((s, r) => s + r[c]!.cx, 0) / 3);
  const steps = [
    rowY[1]! - rowY[0]!,
    rowY[2]! - rowY[1]!,
    colX[1]! - colX[0]!,
    colX[2]! - colX[1]!,
  ];
  for (const step of steps) {
    if (step < size * 0.4 || step > size * MAX_STEP) return null;
  }
  return rows.flat();
}

/**
 * Pick the front face's nine stickers and return their colours in reading order, or
 * abstain. The front face's stickers are the largest (adjacent faces foreshorten to
 * slivers), so we take the 9 biggest and require them to form a real 3x3 grid.
 */
export function fitFace(dets: Detection[], minConf = MIN_STICKER_CONFIDENCE): FitResult {
  const good = dets.filter((d) => d.confidence >= minConf && d.classId >= 0 && d.classId < 6);
  if (good.length === 0) return { ok: false, reason: 'NO_FACE' };
  if (good.length < 9) return { ok: false, reason: 'PARTIAL_FACE' };
  const nine = [...good].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 9);
  const grid = toGrid(nine);
  if (!grid) return { ok: false, reason: 'BAD_GEOMETRY' };
  return {
    ok: true,
    face: { colors: grid.map((d) => d.classId), confidence: grid.map((d) => d.confidence) },
  };
}
