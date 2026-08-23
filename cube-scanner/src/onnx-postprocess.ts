// Pure post-processing for the YOLOv11 sticker detector: decode raw model output →
// NMS → fit the front face's 3x3 grid → 9 colour classes in reading order. No DOM, no
// onnxruntime — it operates on a Float32Array, so it's Node-testable from a fixture
// exactly like the rest of the pure core. The browser shell (onnx-detect) only feeds it
// the model's output tensor.
//
// The model labels EVERY visible sticker (front face + any adjacent faces at an angle),
// so this must pick the nine that form the front-facing grid and REFUSE a frame that
// isn't a clean single face — the abstention the verifier design depends on.

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
  boxes: Detection[]; // the 9 grid stickers, reading order — so the caller can sample their
  // true pixel colours and classify RELATIVE to the cube's own centres (lighting-robust),
  // instead of trusting the detector's absolute class (which drifts red↔orange under lighting).
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

/** Split 9 detections into 3 rows of 3 (reading order) iff they form a plausible 3x3 grid. */
function toGrid(nine: Detection[]): Detection[] | null {
  const byY = [...nine].sort((a, b) => a.cy - b.cy);
  const rows = [byY.slice(0, 3), byY.slice(3, 6), byY.slice(6, 9)].map((r) =>
    r.sort((a, b) => a.cx - b.cx),
  );
  const size = nine.reduce((s, d) => s + (d.w + d.h) / 2, 0) / 9; // mean sticker size
  // Each row's 3 stickers must share a y-band (spread < ~1 sticker), and the 3 rows must
  // step apart in y; likewise columns in x. A non-grid arrangement (partial face, junk)
  // fails this and we abstain rather than emit a garbage face.
  for (const row of rows) {
    if (Math.max(...row.map((d) => d.cy)) - Math.min(...row.map((d) => d.cy)) > size) return null;
  }
  const rowY = rows.map((r) => r.reduce((s, d) => s + d.cy, 0) / 3);
  const colX = [0, 1, 2].map((c) => rows.reduce((s, r) => s + r[c]!.cx, 0) / 3);
  if (rowY[1]! - rowY[0]! < size * 0.4 || rowY[2]! - rowY[1]! < size * 0.4) return null;
  if (colX[1]! - colX[0]! < size * 0.4 || colX[2]! - colX[1]! < size * 0.4) return null;
  return rows.flat();
}

/**
 * Pick the front face's nine stickers and return their colours in reading order, or
 * abstain. The front face's stickers are the largest (adjacent faces foreshorten to
 * slivers), so we take the 9 biggest and require them to form a real 3x3 grid.
 */
export function fitFace(dets: Detection[], minConf = 0.25): FitResult {
  const good = dets.filter((d) => d.confidence >= minConf && d.classId >= 0 && d.classId < 6);
  if (good.length === 0) return { ok: false, reason: 'NO_FACE' };
  if (good.length < 9) return { ok: false, reason: 'PARTIAL_FACE' };
  const nine = [...good].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 9);
  const grid = toGrid(nine);
  if (!grid) return { ok: false, reason: 'BAD_GEOMETRY' };
  return {
    ok: true,
    face: {
      colors: grid.map((d) => d.classId),
      confidence: grid.map((d) => d.confidence),
      boxes: grid,
    },
  };
}
