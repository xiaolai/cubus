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
  rule:
    | 'area-ratio'
    | 'row-spread'
    | 'column-spread'
    | 'step-short'
    | 'step-long'
    // Of 2026-09-21: a lattice whose row cannot be told from its column (`ROLL_TIE_BAND_DEG`).
    // Its unit is degrees, and it is the one rule that refuses a value BELOW its bound, since
    // what it measures is how far the face is from the tie.
    | 'roll-tie';
  value: number;
  bound: number;
}

/**
 * Decode a v3 detect output tensor of shape [4 + numClasses, numAnchors]
 * (row-major: rows cx,cy,w,h,cls0.. — the layout ml/export.py writes) into detections
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

/**
 * How far a lattice fit may miss, as a fraction of the shorter basis vector, before the nine boxes
 * are declared not to form a lattice at all and the level-frame grouping below is used — checked.
 *
 * Measured once, in `basisOf`: the two remaining antipodal directions against the basis's sum and
 * difference. A true 3x3 grid, sheared and foreshortened as hard as the goldens are, misses by a
 * few percent of a step; a diagonal mistaken for a basis vector misses by a whole step. Half a step
 * is the midpoint, and a fit that misses by that much is not describing a grid. (It was also
 * compared with each box's distance from its rounded cell, which is at most a half by construction
 * — a test that could never fire, removed 2026-09-21.)
 */
const LATTICE_TOLERANCE = 0.5;

/**
 * How near the 45° tie a face may roll before which axis is the row is left UNDECIDED (2026-09-21).
 *
 * The row is whichever basis vector is nearer horizontal, and at 45° neither is: the choice flipped
 * on the sign of a difference that detection jitter moves through zero, so one face held at 45°
 * read as `012345678` on one frame and `630741852` — its quarter turn — on the next. Either alone is
 * a rotation the assembly solves; alternating between them is a face the stillness gate never sees
 * settle. Inside the band the fit refuses (`roll-tie`), the panel asks for the side again, and a
 * child who turns the cube a few degrees either way is read at once. Three degrees is a band, not
 * a measurement: jitter on a 74 px sticker moves the fitted axes by well under a degree, so the
 * band is what keeps the two readings from meeting rather than the width of the noise.
 *
 * Measured as the gap between the two axes' tilts: a square lattice rolled by θ has tilts θ and
 * 90°−θ, so "within ±3° of 45°" is a gap under 6°. The gap is what a sheared lattice, whose axes
 * are not perpendicular, still has.
 */
export const ROLL_TIE_BAND_DEG = 3;

type Vec = readonly [number, number];

/** A box's own axes: the row step (pointing right) and the column step (pointing down), and the
 *  cell each of the nine sits in, `[column, row]` in `{-1, 0, 1}`. */
interface Lattice {
  row: [number, number];
  col: [number, number];
  cells: Map<Detection, [number, number]>;
}

/**
 * Why nine boxes gave no lattice — one name per stage, so a caller (and the scan trace) can say
 * which invariant failed rather than reading every refusal as one null (2026-09-21).
 *
 *   - `not-nine`: not nine distinct boxes;
 *   - `no-basis`: no pair of antipodal directions has the other two as its sum and difference
 *     within `LATTICE_TOLERANCE` of a step, for any candidate centre;
 *   - `no-cells`: a basis fits but the boxes do not land on nine distinct cells of the 3x3;
 *   - `roll-tie`: a lattice fits and its axes tilt too nearly alike to say which is the row.
 */
export type LatticeFailure = 'not-nine' | 'no-basis' | 'no-cells' | 'roll-tie';
export type LatticeFit =
  | { ok: true; lattice: Lattice }
  | { ok: false; reason: Exclude<LatticeFailure, 'roll-tie'> }
  | {
      ok: false;
      reason: 'roll-tie' /** the gap between the two axes' tilts, in degrees */;
      gap: number;
    };

const len2 = (v: Vec): number => v[0] * v[0] + v[1] * v[1];
const DEG = 180 / Math.PI;

/**
 * The box nearest the nine's centroid: the middle sticker.
 *
 * THE ONLY CENTRE WORTH TRYING (measured 2026-09-21). The audit read a lattice fit that failed on a
 * pushed centre as "the wrong box was taken for the centre" and asked for every box to be tried.
 * Over 9,672 generated faces — rolled 0–90°, the middle box pushed up to 0.6 of a step in eight
 * directions, with and without jitter — every one of the 4,342 lattices that fitted had THIS box
 * at its (0,0), and never another. That is not luck: a lattice fits only while the antipodal
 * pairing survives, which holds the middle box within about 0.3 of a step of the ring's middle,
 * and the centroid moves a ninth of that push — so the true centre is nearest by a margin no fit
 * can lose. What failed on a centre pushed further was the PAIRING, from every candidate alike,
 * and the answer to that is a pairing that does not come apart (`antipodalDirs`).
 */
function centreOf(nine: readonly Detection[]): Detection {
  const mx = nine.reduce((s, d) => s + d.cx, 0) / 9;
  const my = nine.reduce((s, d) => s + d.cy, 0) / 9;
  let centre = nine[0]!;
  let nearest = Number.POSITIVE_INFINITY;
  for (const d of nine) {
    const dd = (d.cx - mx) * (d.cx - mx) + (d.cy - my) * (d.cy - my);
    if (dd < nearest) {
      nearest = dd;
      centre = d;
    }
  }
  return centre;
}

/**
 * Every way to pair off `items`, in ONE fixed order: the first item with each other in turn, then
 * the rest recursively. `ml/cube_infer.py` enumerates in the same order, so when two matchings
 * cost the same the two implementations break the tie alike.
 */
function perfectMatchings(items: readonly number[]): [number, number][][] {
  if (items.length === 0) return [[]];
  const [a, ...others] = items as [number, ...number[]];
  const out: [number, number][][] = [];
  for (let k = 0; k < others.length; k++) {
    const b = others[k]!;
    const rest = [...others.slice(0, k), ...others.slice(k + 1)];
    for (const m of perfectMatchings(rest)) out.push([[a, b], ...m]);
  }
  return out;
}
/** The 105 pairings of eight outer boxes, made once. */
const OUTER_MATCHINGS = perfectMatchings([0, 1, 2, 3, 4, 5, 6, 7]);

/**
 * The eight outer centres, relative to the centre, paired off as antipodes — the pairing whose
 * sums `p + q` come nearest to zero, taken together — and each pair's direction, `(p − q) / 2`.
 * Antipodes survive shear and foreshortening because a diagonal's partner is a whole step away.
 *
 * THE MATCHING IS EXACT, NOT GREEDY (2026-09-21). The first version took pairs one at a time by
 * the smallest sum, and that is where a face with its middle box drawn off-centre came apart: a
 * push of `p` steps moves every true pair's sum to `2p`, and past a fifth of a step — with the
 * jitter a real box carries — ONE wrong pair can come in under a true one, after which the walk is
 * committed to a wrong pairing, no basis fits, and the level-frame fallback read the face
 * scrambled. Taken as a whole, the true pairing costs `8p` against a wrong one's two step-long
 * sums, so it wins until the push nears half a step. Measured on generated faces rolled 20–50°
 * with the centre pushed 0.15–0.45 of a step (1,500 of them): greedy read 540 scrambled, this
 * reads 3, all pushed past a third of a step; on the 20 goldens the read is identical, fixture by
 * fixture; and the three scrambles the seeded sweep produced under ordinary jitter are gone.
 * 105 pairings of eight is nothing per frame.
 *
 * Always four pairs, by construction, which is why no guard stands here: the `pairs.length < 4`
 * test the greedy walk carried was unreachable on the complete graph it walked. Nine boxes that
 * are not distinct — the one input that could shorten `rel` — are refused as `not-nine` first.
 */
function antipodalDirs(rel: readonly Vec[]): [Vec, Vec, Vec, Vec] {
  let best = OUTER_MATCHINGS[0]!;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const m of OUTER_MATCHINGS) {
    let cost = 0;
    for (const [i, j] of m)
      cost += Math.sqrt(len2([rel[i]![0] + rel[j]![0], rel[i]![1] + rel[j]![1]]));
    if (cost < bestCost) {
      bestCost = cost;
      best = m;
    }
  }
  return best.map(
    ([i, j]): Vec => [(rel[i]![0] - rel[j]![0]) / 2, (rel[i]![1] - rel[j]![1]) / 2],
  ) as [Vec, Vec, Vec, Vec];
}

/**
 * The basis: the pair of directions whose sum and difference are the other two, either sign — or
 * null when the best pair misses by more than `LATTICE_TOLERANCE` of a step.
 */
function basisOf(dirs: readonly [Vec, Vec, Vec, Vec]): [Vec, Vec] | null {
  const nearer = (p: Vec, q: Vec): number =>
    Math.min(len2([p[0] - q[0], p[1] - q[1]]), len2([p[0] + q[0], p[1] + q[1]]));
  let basis: [number, number] | null = null;
  let miss = Number.POSITIVE_INFINITY;
  for (let a = 0; a < 4; a++) {
    for (let b = a + 1; b < 4; b++) {
      const u = dirs[a]!;
      const v = dirs[b]!;
      const rest = [0, 1, 2, 3].filter((k) => k !== a && k !== b).map((k) => dirs[k]!);
      const sum: Vec = [u[0] + v[0], u[1] + v[1]];
      const diff: Vec = [u[0] - v[0], u[1] - v[1]];
      const r = Math.min(
        Math.sqrt(nearer(rest[0]!, sum)) + Math.sqrt(nearer(rest[1]!, diff)),
        Math.sqrt(nearer(rest[0]!, diff)) + Math.sqrt(nearer(rest[1]!, sum)),
      );
      if (r < miss) {
        miss = r;
        basis = [a, b];
      }
    }
  }
  if (basis === null) return null;
  const u = dirs[basis[0]]!;
  const v = dirs[basis[1]]!;
  const step = Math.sqrt(Math.min(len2(u), len2(v)));
  if (!(step > 0) || miss > LATTICE_TOLERANCE * step) return null;
  return [u, v];
}

/**
 * Row and column from a basis: the vector nearer horizontal is the row, pointing right; the other
 * is the column, pointing down. `gap` is how far apart the two tilts are, in radians — what the
 * roll-tie band (`ROLL_TIE_BAND_DEG`) is measured on.
 */
function orient(u0: Vec, v0: Vec): { row: [number, number]; col: [number, number]; gap: number } {
  const pointRight = (w: Vec): [number, number] =>
    w[0] < 0 || (w[0] === 0 && w[1] < 0) ? [-w[0], -w[1]] : [w[0], w[1]];
  const u = pointRight(u0);
  const v = pointRight(v0);
  const tilt = (w: Vec): number => Math.abs(Math.atan2(w[1], w[0]));
  let row = u;
  let col = v;
  if (tilt(v) < tilt(u)) {
    row = v;
    col = u;
  }
  if (col[1] < 0 || (col[1] === 0 && col[0] < 0)) col = [-col[0], -col[1]];
  return { row, col, gap: Math.abs(tilt(u) - tilt(v)) };
}

/** Every box's cell, exact then rounded — or null unless the nine are DISTINCT cells of the 3x3. */
function cellsOf(
  centre: Detection,
  others: readonly Detection[],
  rel: readonly Vec[],
  row: Vec,
  col: Vec,
): Map<Detection, [number, number]> | null {
  const det = row[0] * col[1] - row[1] * col[0];
  if (det === 0) return null;
  const cells = new Map<Detection, [number, number]>([[centre, [0, 0]]]);
  const taken = new Set<string>(['0,0']);
  for (let k = 0; k < 8; k++) {
    const p = rel[k]!;
    const i = (p[0] * col[1] - p[1] * col[0]) / det;
    const j = (row[0] * p[1] - row[1] * p[0]) / det;
    // Rounded, and not compared with the rounding: `|i − round(i)|` is at most a half by
    // construction, so the `> LATTICE_TOLERANCE` test that stood here could never be true
    // (2026-09-21, the same class of dead branch as the pairing guard above). What a basis that
    // fits leaves for this stage to refuse is a box outside the 3x3, or two on one cell — and a
    // basis whose vectors are parallel, which nine boxes on one line produce.
    const ci = Math.round(i);
    const cj = Math.round(j);
    if (ci < -1 || ci > 1 || cj < -1 || cj > 1) return null;
    const key = `${ci},${cj}`;
    if (taken.has(key)) return null;
    taken.add(key);
    cells.set(others[k]!, [ci, cj]);
  }
  return cells;
}

/** The lattice with `centre` as its middle box, or the stage that refused it. */
function latticeAbout(centre: Detection, nine: readonly Detection[]): LatticeFit {
  const others = nine.filter((d) => d !== centre);
  const rel = others.map((d): Vec => [d.cx - centre.cx, d.cy - centre.cy]);
  const basis = basisOf(antipodalDirs(rel));
  if (!basis) return { ok: false, reason: 'no-basis' };
  const { row, col, gap } = orient(basis[0], basis[1]);
  const cells = cellsOf(centre, others, rel, row, col);
  if (!cells) return { ok: false, reason: 'no-cells' };
  if (gap < (2 * ROLL_TIE_BAND_DEG) / DEG) return { ok: false, reason: 'roll-tie', gap: gap * DEG };
  return { ok: true, lattice: { row, col, cells } };
}

/**
 * The 3x3 lattice the nine boxes form, or why they form none.
 *
 * WHY THIS EXISTS (2026-09-20). `gridOf` groups rows by sorting on `cy` and slicing into threes,
 * which is the true rows only while the top row's lowest box is above the middle row's highest —
 * `tan(roll) < 0.5`, about 26.6° of roll in the image plane. Past that the grouping is wrong, and
 * the row-spread rule that should have refused it did not: its bound is the mean box SIDE, and an
 * axis-aligned box around a rolled square grows by `cos + sin`, exactly as the spread it is compared
 * with does. Measured on the real `fitFace`: from 27° to 45° a face was accepted in the order
 * `[3,0,1,6,4,2,7,8,5]` — corners on edge positions and edges on corners — which is not a rotation,
 * so the assembly's rotation search could not undo it and refused the cube as "a colour was
 * misread". A child tilting a cube in the hand is the ordinary case — and so, it turned out, were
 * three of the twenty goldens: `render-00`, `-03` and `-04` roll 27°, 37° and 41° by this lattice's
 * own basis, and `ml/golden/expected.json` had pinned the scrambled order for each of them, which
 * the gate then held every runtime to. The audit had measured "no golden past 17°" off the FITTED
 * grid's top row, which on a scrambled assignment is not a row. Re-pinned on 2026-09-20 to the
 * lattice's reading, reconstructed by hand from the centres (render-03 and -04 are one face at two
 * poses, and now read alike); `dev-docs/scanner-audit-2026-09-20.md` §1.1 and §7.
 *
 * The lattice is found from the boxes' own geometry, without assuming which way is up. It is the
 * stages above, composed: a centre; the other eight paired off as antipodes (`antipodalDirs`); of
 * the four pair directions, the basis is the pair whose sum and difference are the other two
 * (`basisOf`); every box then has exact lattice coordinates, rounded to its cell (`cellsOf`); and
 * the row is whichever basis vector is nearer horizontal (`orient`), so a face rolled past 45°
 * reads as its quarter turn — a ROTATION of the truth, which is what the assembly solves for
 * anyway — unless the two are too near alike to say (`ROLL_TIE_BAND_DEG`).
 *
 * The centre is the box nearest the centroid, and `centreOf` says why that is the only one worth
 * trying; the pairing about it is exact, and `antipodalDirs` says how far a pushed middle box can
 * go before it fails (2026-09-21). Past that the face reaches the level-frame fallback, and `gridOf`
 * records why no level check can guard it.
 *
 * Nothing about the geometry RULES changes: `gridOf` uses this only to de-roll the coordinates when
 * the level-frame grouping disagrees with the lattice, and runs the very same rules on them. A frame
 * the sort already groups the way the lattice does — seventeen of the twenty goldens, every recorded
 * frame — takes the path it always took, byte for byte. `ml/cube_infer.py::fit_lattice` is this
 * function in Python, and `tests/fixtures/rolled-grids.json` and `rolled-grids-sweep.json` hold
 * both to the same answers.
 */
export function fitLattice(nine: readonly Detection[]): LatticeFit {
  if (nine.length !== 9 || new Set(nine).size !== 9) return { ok: false, reason: 'not-nine' };
  return latticeAbout(centreOf(nine), nine);
}

/** `fitLattice`, as the lattice alone: what the de-roll and the existing tests read. */
export function latticeOf(nine: readonly Detection[]): Lattice | null {
  const fit = fitLattice(nine);
  return fit.ok ? fit.lattice : null;
}

/** The nine in reading order as the lattice places them: row by row, left to right. */
function latticeOrder(nine: readonly Detection[], lattice: Lattice): Detection[] {
  return [...nine].sort((a, b) => {
    const [ai, aj] = lattice.cells.get(a)!;
    const [bi, bj] = lattice.cells.get(b)!;
    return aj - bj || ai - bi;
  });
}

/** The nine grouped as the level-frame rules group them: sorted on `cy`, sliced into three, each row
 *  sorted on `cx`. The grouping `gridOf` has always used, and the one its bounds were measured on. */
function rowsByY(nine: readonly Detection[]): Detection[][] {
  const byY = [...nine].sort((a, b) => a.cy - b.cy);
  return [byY.slice(0, 3), byY.slice(3, 6), byY.slice(6, 9)].map((r) =>
    r.sort((a, b) => a.cx - b.cx),
  );
}

/**
 * The nine boxes in reading order, or the rule that refused them.
 *
 * Each refusal names what it measured. The DECISIONS are exactly the ones this made when it
 * returned null — the comparisons are unchanged, character for character — and the measurement is
 * computed beside them for the scan trace, never in their place. That matters in one corner: nine
 * boxes of zero area pass the area rule (`0 > 0 * 5` is false), where a ratio would be `0 / 0`.
 *
 * DE-ROLLED FIRST WHEN THE LATTICE SAYS THE SORT IS WRONG (2026-09-20, see `fitLattice`). When the
 * level-frame grouping and the lattice agree on the order, the rules run on the coordinates as they
 * are — the path every golden and recorded frame takes, unchanged. When they disagree, the nine
 * centres are turned about the lattice's centre by minus the row's angle, so the rows are level,
 * and the SAME rules run on the turned coordinates; the boxes' sizes are left as measured. The
 * result is reported in the original detections, so a caller sees nothing but the right order.
 *
 * A LATTICE AT THE TIE IS REFUSED, NOT HANDED TO THE SORT (2026-09-21): a lattice whose row cannot
 * be told from its column (`roll-tie`) is a face rolled about 45°, which the sort would read
 * scrambled.
 *
 * AND A FACE WITH NO LATTICE STILL GOES TO THE SORT, ON MEASUREMENT (2026-09-21). Refusing the
 * lattice proves nothing about the roll, and the audit asked for the fallback to refuse a grid
 * whose rows are not level. Three such measures were built and held to the 20 goldens, nine of
 * which have no lattice and read correctly through the sort: the y-sorted rows' own roll (goldens
 * to 25.4°; the scrambled grouping the check exists for rolls UNDER 18°), the middle box's bend off
 * its row's line (goldens to 1.28 half-rows; a scrambled trio is exactly 1.0), and the grid's roll
 * read off its shortest edges (goldens 38–42°; scrambles 25–46°). None separates the extreme
 * renders from a scrambled grid — at box-centre level they are the same shape — and each refused
 * nine golden reads. What protects the fallback instead is that the lattice now FITS the faces
 * that used to reach it scrambled (`antipodalDirs`); the residue, a middle box drawn more than a
 * third of a step off-centre, is measured there and is open.
 */
function gridOf(nine: Detection[]): { grid: Detection[] } | { fail: GeometryFailure } {
  const fit = fitLattice(nine);
  if (fit.ok) {
    const level = rowsByY(nine).flat();
    const ordered = latticeOrder(nine, fit.lattice);
    if (level.every((d, k) => d === ordered[k])) return rulesOn(nine);
    const phi = Math.atan2(fit.lattice.row[1], fit.lattice.row[0]);
    const cos = Math.cos(-phi);
    const sin = Math.sin(-phi);
    const centre = ordered[4]!;
    const turned = nine.map((d) => ({
      ...d,
      cx: centre.cx + (d.cx - centre.cx) * cos - (d.cy - centre.cy) * sin,
      cy: centre.cy + (d.cx - centre.cx) * sin + (d.cy - centre.cy) * cos,
    }));
    const fitted = rulesOn(turned);
    if ('fail' in fitted) return fitted;
    return { grid: fitted.grid.map((t) => nine[turned.indexOf(t)]!) };
  }
  if (fit.reason === 'roll-tie') {
    return { fail: { rule: 'roll-tie', value: fit.gap, bound: 2 * ROLL_TIE_BAND_DEG } };
  }
  return rulesOn(nine);
}

/** The level-frame rules, on whatever coordinates they are handed. See `gridOf`. */
function rulesOn(nine: Detection[]): { grid: Detection[] } | { fail: GeometryFailure } {
  const rows = rowsByY(nine);
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
