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
  /**
   * All `numClasses` scores, not just the winning one. OPTIONAL because a Detection can be built
   * by hand -- tests do it constantly -- and a partial set is worse than none: the repair in
   * `ai-assemble` needs all 54 or it cannot satisfy the counts at all.
   *
   * The argmax above throws five of six away, and the discarded five are what a whole-cube repair
   * needs: a cube has nine stickers of each colour, so a misread breaks the count, and the cheapest
   * repair is decided by how sure the detector was about each ALTERNATIVE. See `nine-of-each.ts`,
   * which measured this lifting simulated whole-cube reads from 80.0% to 98.7%.
   */
  scores?: number[];
}

export interface FaceFit {
  colors: number[]; // 9 colour classes, reading order (row-major)
  confidence: number[]; // 9 per-sticker confidences
  /**
   * 9 x numClasses scores in the same reading order. OPTIONAL on purpose: every existing consumer
   * reads `colors` and `confidence` and must keep working untouched, so this is added evidence
   * rather than a changed contract.
   */
  scores?: number[][];
  /**
   * The nine boxes the grid was fitted to, in MODEL space (the letterboxed square), same reading
   * order. OPTIONAL like `scores`, and for the same reason — added evidence, not a changed contract.
   * Whoever still holds the frame can map these back onto it (`sticker-pixels.ts`) and read the paint.
   */
  boxes?: [number, number, number, number][];
}

export type FitResult = { ok: true; face: FaceFit } | { ok: false; reason: FitReason };
export type FitReason = 'NO_FACE' | 'PARTIAL_FACE' | 'BAD_GEOMETRY';

/**
 * Decode a YOLOv11 detect output tensor of shape [4 + numClasses, numAnchors]
 * (row-major, the Detlib ONNX layout: rows cx,cy,w,h,cls0..) into detections
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
      // The tensor is the far side of a boundary: whatever the runtime hands back, a box only
      // means something if it is finite and has an area. A NaN coordinate would survive every
      // geometric check downstream, because every comparison against NaN is false -- so nine of
      // them would read as a face whose rows and columns nothing could dispute.
      const [cx, cy, w, h] = [at(0, a), at(1, a), at(2, a), at(3, a)];
      const side = (v: number): boolean => Number.isFinite(v) && v > 0;
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !side(w) || !side(h)) continue;
      const scores = new Array<number>(numClasses);
      for (let c = 0; c < numClasses; c++) scores[c] = at(4 + c, a);
      out.push({
        cx,
        cy,
        w,
        h,
        classId: best,
        confidence: bestScore,
        scores,
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
 * A box at least this much inside a larger one, of at most NESTED_MAX_AREA_RATIO its area, is a second
 * box on the same sticker, not a second sticker.
 *
 * WHY. When a face fills the frame (stickers near 200 px at the model's input, against ~74 px in
 * training) the permissive detectors drew two boxes on a sticker, one around it and one inside it.
 * Their IoU is about the ratio of their areas, under NMS's 0.45, so both survived, and `fitFace`'s nine
 * largest then held one sticker twice and missed another. Measured on 40 checked community sets (2,160
 * stickers, 22 contributors, 2026-09-15), dropping the inner box recovered stickers for every model
 * tried (v3 +0.9, V6FT +0.5, MNV4 +0.6 points of stickers read), changed none of the 20 golden reads,
 * and made the fit accept no photo of a 4x4 or of no cube that it did not already accept.
 *
 * The AREA bound is what keeps a box spanning several stickers (a whole face is about 9x one) from
 * removing the stickers inside it. The shared cases in `tests/fixtures/nested-detections.json` hold this
 * and `ml/cube_infer.py::drop_nested` to the same answers.
 */
export const NESTED_INSIDE = 0.7;
export const NESTED_MAX_AREA_RATIO = 4;

function overlapArea(a: Detection, b: Detection): number {
  const iw = Math.max(
    0,
    Math.min(a.cx + a.w / 2, b.cx + b.w / 2) - Math.max(a.cx - a.w / 2, b.cx - b.w / 2),
  );
  const ih = Math.max(
    0,
    Math.min(a.cy + a.h / 2, b.cy + b.h / 2) - Math.max(a.cy - a.h / 2, b.cy - b.h / 2),
  );
  return iw * ih;
}

/** Every box that is not nested in a larger box of similar scale, in the order given. */
export function dropNested(dets: Detection[]): Detection[] {
  return dets.filter((d) => {
    const area = d.w * d.h;
    return !dets.some((o) => {
      const outer = o.w * o.h;
      return (
        o !== d &&
        outer > area &&
        outer <= NESTED_MAX_AREA_RATIO * area &&
        overlapArea(d, o) >= NESTED_INSIDE * area
      );
    });
  });
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
    face: {
      colors: grid.map((d) => d.classId),
      confidence: grid.map((d) => d.confidence),
      // Only when EVERY sticker has them. Nine-of-each is a whole-cube constraint; a face with
      // eight score vectors and one gap cannot contribute to it, and silently passing a short
      // array would fail much further away from the cause.
      scores: grid.every((d) => d.scores) ? grid.map((d) => d.scores as number[]) : undefined,
      // Detections carry a CENTRE and a size; a box here is the corner form the pixel reader wants.
      boxes: grid.map(
        (d) => [d.cx - d.w / 2, d.cy - d.h / 2, d.w, d.h] as [number, number, number, number],
      ),
    },
  };
}
