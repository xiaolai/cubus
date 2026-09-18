// Pure post-processing for the v3 sticker detector: decode raw model output →
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

export type FitResult =
  | { ok: true; face: FaceFit }
  | { ok: false; reason: FitReason; geometry?: GeometryFailure };
export type FitReason = 'NO_FACE' | 'PARTIAL_FACE' | 'BAD_GEOMETRY';

/**
 * Which grid rule refused nine boxes, and by how much. Carried only on `BAD_GEOMETRY`, for the scan
 * trace: "bad geometry" alone does not say whether the boxes were uneven in SIZE or out of LINE,
 * and those are different faults — the first is a detector drawing loose boxes, the second a cube
 * held at an angle. Every bound here was set on one detector's boxes (`ml/golden/frames/`), so when
 * the detector changes, this is where a mismatch shows. `value` and `bound` share a unit (a ratio of
 * areas, or a distance in mean sticker sizes) so the two can be compared by eye.
 */
export interface GeometryFailure {
  rule: 'area-ratio' | 'row-spread' | 'column-spread' | 'step-short' | 'step-long';
  value: number;
  bound: number;
}

/**
 * Decode a v3 detect output tensor of shape [4 + numClasses, numAnchors]
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
 * A box with no other box within this many median sticker-sizes of it is not a sticker of the face
 * being shown: a sticker sits among its face's other stickers.
 *
 * WHY (2026-09-18). After v0.6.0 the detector began reporting one large false box in the BACKGROUND
 * — labelled orange at 0.34, about twelve sticker-widths from the cube, most likely skin — on almost
 * half the frames of a real scan. `fitFace` takes the nine LARGEST boxes, and that box was seventeen
 * times a sticker's area, so it always took a real sticker's place and the frame was refused as bad
 * geometry. A face that was detected perfectly well could not be read, and each refusal reset the
 * stillness run, so a side almost never settled.
 *
 * WHY ISOLATION AND NOT SIZE OR DISTANCE. Measured, not argued, on the 20 golden frames and 410 frames
 * recorded from a Studio Display camera: every real front sticker has at least FOUR other boxes within
 * this radius, and the background box had NONE in all 271 frames it spoiled. The alternatives failed:
 * dropping boxes over 4x the median area changed a golden read (render-02 has a real sticker at
 * 4.16x), and dropping boxes far from the boxes' median centre changed six — two to a different cube —
 * because neighbour-face slivers crowd one side and drag that centre off the face. Isolation is local,
 * so there is no centre to drag. It changes no golden read and recovers 223 of the 271 spoiled frames;
 * the rest held only eight real stickers under the false box.
 *
 * Distances are compared SQUARED. `Math.hypot` is not guaranteed to round as Python's does, and
 * `ml/cube_infer.py` runs this same rule for the golden gate; multiplication and addition round the
 * same way in both, so a box on the boundary gets the same answer in both.
 */
export const ISOLATION_RADIUS = 3;

/** `dets` without the boxes that have no other box within ISOLATION_RADIUS median sticker-sizes. */
export function dropIsolated(dets: Detection[]): Detection[] {
  if (dets.length === 0) return dets;
  const sides = dets.map((d) => (d.w + d.h) / 2).sort((a, b) => a - b);
  const reach = ISOLATION_RADIUS * sides[Math.floor(sides.length / 2)]!;
  const reach2 = reach * reach;
  return dets.filter((d) =>
    dets.some((o) => {
      if (o === d) return false;
      const dx = o.cx - d.cx;
      const dy = o.cy - d.cy;
      return dx * dx + dy * dy <= reach2;
    }),
  );
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
/**
 * The nine boxes in reading order, or the rule that refused them.
 *
 * Each refusal names what it measured. The DECISIONS are exactly the ones this made when it
 * returned null — the comparisons are unchanged, character for character — and the measurement is
 * computed beside them for the scan trace, never in their place. That matters in one corner: nine
 * boxes of zero area pass the area rule (`0 > 0 * 5` is false), where a ratio would be `0 / 0`.
 */
function gridOf(nine: Detection[]): { grid: Detection[] } | { fail: GeometryFailure } {
  const byY = [...nine].sort((a, b) => a.cy - b.cy);
  const rows = [byY.slice(0, 3), byY.slice(3, 6), byY.slice(6, 9)].map((r) =>
    r.sort((a, b) => a.cx - b.cx),
  );
  const size = nine.reduce((s, d) => s + (d.w + d.h) / 2, 0) / 9; // mean sticker size
  // Nine boxes of wildly different areas are not nine stickers of one face. A degenerate box
  // (w or h at zero) makes this infinite, which refuses rather than dividing by zero downstream.
  const areas = nine.map((d) => d.w * d.h);
  const largest = Math.max(...areas);
  const smallest = Math.min(...areas);
  if (largest > smallest * MAX_AREA_RATIO) {
    return { fail: { rule: 'area-ratio', value: largest / smallest, bound: MAX_AREA_RATIO } };
  }
  // Each row's 3 stickers must share a y-band (spread < ~1 sticker), and the 3 rows must
  // step apart in y; likewise columns in x. A non-grid arrangement (partial face, junk)
  // fails this and we abstain rather than emit a garbage face.
  for (const row of rows) {
    const spread = Math.max(...row.map((d) => d.cy)) - Math.min(...row.map((d) => d.cy));
    if (spread > size) return { fail: { rule: 'row-spread', value: spread / size, bound: 1 } };
  }
  // …and each column's 3 stickers must share an x-band. Without this, three rows sheared past
  // each other — row 0 at x 100, row 2 at x 400 — satisfied every rule above and read as a face.
  for (const c of [0, 1, 2]) {
    const xs = rows.map((r) => r[c]!.cx);
    const spread = Math.max(...xs) - Math.min(...xs);
    if (spread > size * MAX_COLUMN_SPREAD) {
      return { fail: { rule: 'column-spread', value: spread / size, bound: MAX_COLUMN_SPREAD } };
    }
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
    if (step < size * 0.4) return { fail: { rule: 'step-short', value: step / size, bound: 0.4 } };
    if (step > size * MAX_STEP)
      return { fail: { rule: 'step-long', value: step / size, bound: MAX_STEP } };
  }
  return { grid: rows.flat() };
}

/**
 * Pick the front face's nine stickers and return their colours in reading order, or
 * abstain. The front face's stickers are the largest (adjacent faces foreshorten to
 * slivers), so we take the 9 biggest and require them to form a real 3x3 grid.
 */
export function fitFace(dets: Detection[], minConf = MIN_STICKER_CONFIDENCE): FitResult {
  const good = dets.filter((d) => d.confidence >= minConf && d.classId >= 0 && d.classId < 6);
  if (good.length === 0) return { ok: false, reason: 'NO_FACE' };
  // Isolation is applied before the nine largest are chosen, not after: an isolated false box is
  // usually the LARGEST box in the frame, so it is exactly the one "the nine largest" would pick first.
  const neighboured = dropIsolated(good);
  if (neighboured.length < 9) return { ok: false, reason: 'PARTIAL_FACE' };
  const nine = [...neighboured].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 9);
  const fitted = gridOf(nine);
  if ('fail' in fitted) return { ok: false, reason: 'BAD_GEOMETRY', geometry: fitted.fail };
  const { grid } = fitted;
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
