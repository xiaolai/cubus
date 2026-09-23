/**
 * WHICH CELL each detection occupies, from FEWER than nine of them — and a refusal whenever that
 * cannot be said (`dev-docs/scan-pipeline-audit-2026-09-23.md` §4, Stage 2, partial-lattice
 * observation).
 *
 * WHY. F1 is the cliff: `fitFace` needs nine detections after isolation, eight is `PARTIAL_FACE`,
 * and the frame's evidence is thrown away entire. On the stuck session of 2026-09-23 that was 177
 * frames of the white side — every one of them carrying eight good stickers and a centre the model
 * scored at 0.20–0.25 — discarded because the ninth was missing. A stage that discards what it
 * cannot immediately use is how a weak signal becomes total failure (§0.2), and this is the first
 * of those stages.
 *
 * THE QUESTION IS IDENTIFIABILITY, AND IT IS ANSWERED EXHAUSTIVELY, NOT ESTIMATED. Some partial
 * observations genuinely do not say which cells they occupy: four points at the corners of a 2×2
 * block are cells (0,0),(1,0),(0,1),(1,1) of one lattice and (0,0),(2,0),(0,2),(2,2) of another at
 * twice the step, and no amount of care distinguishes them. So every one of the 512 subsets of a
 * 3×3's cells was enumerated and classified, and the table is `USABLE_MASKS`.
 *
 * WHAT THE ENUMERATION SAID (2026-09-23; `tests/partial-lattice.test.ts` recomputes it and fails if
 * the table drifts):
 *
 *   | cells observed | masks | of which usable |
 *   |---|---|---|
 *   | 9 | 1 | 1 |
 *   | 8 | 9 | **9 — every one** |
 *   | 7 | 36 | 34 |
 *   | 6 | 84 | 60 |
 *   | 5 | 126 | 44 |
 *   | 4 | 126 | 12 |
 *   | ≤3 | 130 | 0 |
 *
 * The line that matters is EIGHT: every way of losing one sticker still determines the grid, so
 * those 177 frames are observations rather than nothing. Three points or fewer never determine it —
 * an affine map is fixed by three points, so any three can be read as any three cells. And the
 * plan's two named negatives hold: the 2×2 corner block is ambiguous, and of the 11,440 nine-cell
 * subsets of a 4×4 grid only 4 read as a full 3×3 — which are the four places a 3×3 window sits in
 * a 4×4, so they ARE 3×3s and the answer is right.
 *
 * ORIENTATION-PRESERVING READINGS ONLY, and that is not a simplification. `orient()` in
 * `onnx-postprocess.ts` fixes the basis's handedness from the image — the row points right, the
 * column points down — so a MIRRORED reading is not a reading the fit can produce. Counting
 * reflections as ambiguities makes even the full nine "ambiguous", which is the arithmetic saying
 * the question was asked wrongly.
 *
 * ROTATIONS ARE NOT AMBIGUITIES EITHER: the assembly searches all four turns of every face, so two
 * readings that differ by a quarter turn are one answer. Anything else — a different step, a shear,
 * a shift — is a second reading of one picture, and the observation is refused.
 *
 * A READING IS ONLY WORTH AS MUCH AS THE POINTS BEHIND IT, and that was MEASURED rather than
 * assumed (2026-09-23, on the 09-18 clip — real detector output against an INDEPENDENT truth). The
 * truth is the shipped full-face path: 336 frames of the clip where `fitFace` returned a proven
 * lattice reading (`ordering === 'lattice'`), which fixes what the nine cells are without this
 * module having any say in it. Each of those frames then had one detection removed and the
 * remaining eight handed here. Beside it, the null that matters at least as much: the same fit over
 * points drawn uniformly at random, which must read NOTHING.
 *
 *   |                         | right | wrong | refused | random points read, per 6,000 |
 *   |---|---|---|---|---|
 *   | as it stands            | 3,013 | 2 | 9 | 8 points: 0 · 9 points: 0 |
 *   | with `MAX_RESIDUAL` off | 3,022 | 2 | 0 | 8 points: ~478 · 9 points: ~29 |
 *
 * READ THAT TABLE HONESTLY, because the obvious reading of it is wrong. `MAX_RESIDUAL` does not
 * correct a single misreading of a real cube — both wrong answers survive it, and it costs 9 correct
 * ones. What it does is the whole right-hand column: without it, eight points of pure clutter read
 * as a face eight times in a hundred. The bound is not there to make readings of a cube better, it
 * is there so that a thing which is not a cube is not read as one, and that is worth nine frames of
 * a 612-frame clip many times over.
 *
 * WHY THE FLOOR IS EIGHT AND NOT THE ARITHMETIC FOUR. The same null, one point lower: at seven
 * detections random points still read about once in two thousand (2, 3 and 4 times per 6,000 on
 * three seeds), and at eight it is zero across 18,000 tries. Seven-detection frames are 5 of the
 * clip's 612; eight-detection frames are 16, and the stuck session's 177 discarded frames are the
 * case this module was built for. A floor that buys five frames by admitting a measurable rate of
 * invented faces is not a more capable fit — it is this repository's "never invent data" with an
 * arithmetic cause.
 *
 * SO IDENTIFIABILITY AND TRUST ARE TWO QUESTIONS with two different floors. `MIN_IDENTIFIABLE` is 4
 * because that is where the arithmetic says a partial observation CAN pin the grid; `MIN_TRUSTED` is
 * 8 because that is where a measurement says a reading can be told from clutter. Collapsing them
 * into one number would either throw away the table's meaning or manufacture faces out of noise.
 *
 * UNOBSERVED CELLS CARRY NO EVIDENCE. A cell nobody saw is `null` here and stays null: a finger
 * over a sticker is not a sticker of some colour, and the whole point of keeping the frame is to
 * add what was seen without inventing what was not.
 */

import { hungarian } from './nine-of-each.js';
import type { Detection } from './onnx-postprocess.js';

/** A cell of the 3×3, in reading order: `row * 3 + column`. */
export type Cell = number;

/**
 * The fewest cells that can EVER determine the grid — an arithmetic fact, not a policy.
 *
 * Four, from the enumeration, and only 12 of the 126 four-cell masks manage it — all of them spread
 * across the face rather than bunched. Three is impossible in principle: an affine map is determined
 * by three points, so three points fit any three cells.
 *
 * This is the floor of `USABLE_MASKS`, NOT the floor of the fit. Whether a reading can be believed
 * is a separate question with its own measured floor, `MIN_TRUSTED`.
 */
export const MIN_IDENTIFIABLE = 4;

/**
 * The fewest detections this fit will read — a measurement, and NOT `MIN_IDENTIFIABLE`.
 *
 * Eight, which is the size of the case the module was built for: eight good stickers and a ninth
 * the detector missed. The header's null is the argument. At eight detections, 18,000 sets of
 * uniformly random points produced zero readings; at seven, the same sweep reads one in about two
 * thousand, and the frames that floor would buy are 5 of the clip's 612.
 *
 * This is deliberately a HIGHER floor than the arithmetic allows. Four points can determine a grid
 * and are still not evidence that there is one: a fit over four points reads random clutter as a
 * face about once in ten tries, because four points leave an affine map only two spare constraints
 * and 504 candidate cell-triples to spend them on.
 */
export const MIN_TRUSTED = 8;

/**
 * How far the worst-placed detection may sit from its cell, as a fraction of a step, for the
 * reading to be believed.
 *
 * MEASURED, and what it separates is a face from CLUTTER — not a right reading from a wrong one.
 * See the header's table: it leaves both of the drop-one sweep's two wrong answers in place. What
 * it removes is the 8% of random eight-point sets that otherwise read as a face.
 *
 * 0.2 because the residual of a true reading is just the detector's own positional noise, and that
 * was measured on the clip's real nine-detection frames: 0.039 median, 0.085 at the 95th
 * percentile. Half a step further out is comfortably past anything the detector does and comfortably
 * inside what an arbitrary arrangement of points needs in order to pass.
 *
 * This is NOT `CELL_TOLERANCE`, and the two must not be merged. Half a step is where a point stops
 * being nearer its own cell than another, so it is the widest bound that can ASSIGN at all; this is
 * how well the assignment then has to fit for the reading to be an observation rather than an
 * arrangement that happens to be admissible.
 */
export const MAX_RESIDUAL = 0.2;

/**
 * Every subset of the nine cells that determines the grid, as a 9-bit mask (bit `c` is cell `c`).
 *
 * Generated by the enumeration described in the file header and PINNED here rather than computed at
 * load: it is a mathematical fact about a 3×3 grid, it never changes, and a table a reader can see
 * is worth more than one a reader has to re-derive. `tests/partial-lattice.test.ts` recomputes it
 * from first principles on every run and fails if these numbers and that computation part company.
 */
export const USABLE_MASKS: ReadonlySet<number> = new Set([
  99, 103, 107, 111, 113, 115, 117, 119, 121, 123, 125, 127, 141, 143, 149, 151, 157, 159, 165, 167,
  173, 175, 181, 183, 189, 191, 205, 207, 213, 215, 221, 223, 225, 227, 229, 231, 233, 235, 237,
  239, 241, 243, 245, 247, 249, 251, 253, 255, 270, 271, 284, 285, 286, 287, 302, 303, 316, 317,
  318, 319, 330, 331, 334, 335, 338, 339, 342, 343, 346, 347, 348, 349, 350, 351, 354, 355, 358,
  359, 362, 363, 366, 367, 369, 370, 371, 373, 374, 375, 377, 378, 379, 380, 381, 382, 383, 396,
  397, 398, 399, 405, 407, 412, 413, 414, 415, 421, 423, 428, 429, 430, 431, 437, 439, 444, 445,
  446, 447, 458, 459, 460, 461, 462, 463, 466, 467, 469, 470, 471, 474, 475, 476, 477, 478, 479,
  481, 482, 483, 485, 486, 487, 489, 490, 491, 492, 493, 494, 495, 497, 498, 499, 501, 502, 503,
  505, 506, 507, 508, 509, 510, 511,
]);

/** Where one detection sits: which cell, and the box that was seen there. */
export interface Observed {
  cell: Cell;
  detection: Detection;
}

/** A partial reading of a face: what was seen, and what was not. */
export interface PartialFace {
  /** Nine entries in reading order; `null` for a cell nobody observed. */
  cells: (Detection | null)[];
  /** How many of the nine were observed. */
  observed: number;
  /** The mask of observed cells — `USABLE_MASKS` contains it, by construction. */
  mask: number;
}

export type PartialFit =
  | { ok: true; face: PartialFace; residual: number }
  | { ok: false; reason: PartialRefusal; readings?: number; residual?: number };

/**
 * Why a set of detections is not a partial face.
 *
 *   - `too-few`: under `MIN_TRUSTED`, which no arrangement can rescue — see that constant for why
 *     the floor is a measurement and not the arithmetic minimum.
 *   - `no-lattice`: no assignment puts every detection on a distinct cell of one 3×3.
 *   - `mask-not-usable`: the assignment found is one the enumeration says cannot be unique, which
 *     means the tolerance admitted it and exactness would not. Refused for the same reason.
 *   - `poor-fit`: a single reading, on a usable mask, whose points sit further from their cells
 *     than `MAX_RESIDUAL` — admissible, and not an observation of this face. `residual` says how
 *     far, so a caller can see how near a miss it was.
 */
/** What to ask of `fitPartial` beyond the detections themselves. */
export interface PartialOptions {
  /**
   * The fewest detections to read, defaulting to `MIN_TRUSTED`.
   *
   * A caller that pools evidence across frames may have grounds this module does not — the header's
   * table is what such a caller should argue from, and it says plainly what each step down costs in
   * readings of clutter. Never below `MIN_IDENTIFIABLE`, which is arithmetic rather than policy, and
   * asking for less throws rather than quietly answering something meaningless.
   */
  minObserved?: number;
}

export type PartialRefusal = 'too-few' | 'no-lattice' | 'mask-not-usable' | 'poor-fit';

/**
 * How far a detection may sit from its predicted cell centre, as a fraction of the shorter basis
 * vector, and still count as being in that cell.
 *
 * Half a step is the point at which a box is nearer some OTHER cell, so this is not a tuned
 * constant but the largest value that can mean anything — and `LATTICE_TOLERANCE` in
 * `onnx-postprocess.ts` is the same number for the same reason. A partial fit is more exposed than
 * a full one (fewer points pin the basis), so the bound being a definition rather than a
 * measurement is what keeps it honest.
 */
export const CELL_TOLERANCE = 0.5;

/**
 * How far a detection may sit from a cell while a basis is only being PROPOSED.
 *
 * A basis built from three points carries their error and extrapolates it two cells away, so the
 * TRUE reading is often the one the strict bound rejects first: measured 2026-09-23, a jitter of a
 * twentieth of a step took the eight-of-nine fit from 27 of 27 to 9 of 27, not because the reading
 * was wrong but because it was never proposed. So the proposal is generous and the verdict is not
 * — every proposal is refit over all its points and then re-checked at `CELL_TOLERANCE`, which is
 * the bound that decides.
 *
 * A full step, because that is the widest a proposal can be and still assign each point to one
 * cell rather than to whichever of two it drifts nearer.
 */
const PROPOSAL_TOLERANCE = 1;

type Vec = readonly [number, number];
/** An affine map of cell coordinates to image coordinates: origin, row step, column step. */
interface Basis {
  origin: Vec;
  row: Vec;
  col: Vec;
}

/** The map taking cells `a`, `b`, `c` to points `pa`, `pb`, `pc`, or null when they are collinear. */
function basisFrom(
  cells: readonly [Cell, Cell, Cell],
  pts: readonly [Vec, Vec, Vec],
): Basis | null {
  const [ca, cb, cc] = cells;
  const at = (c: Cell): Vec => [c % 3, Math.floor(c / 3)];
  const [a, b, c] = [at(ca), at(cb), at(cc)];
  const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  if (det === 0) return null;
  const [pa, pb, pc] = pts;
  const row: Vec = [
    ((pb[0] - pa[0]) * (c[1] - a[1]) - (pc[0] - pa[0]) * (b[1] - a[1])) / det,
    ((pb[1] - pa[1]) * (c[1] - a[1]) - (pc[1] - pa[1]) * (b[1] - a[1])) / det,
  ];
  const col: Vec = [
    ((b[0] - a[0]) * (pc[0] - pa[0]) - (c[0] - a[0]) * (pb[0] - pa[0])) / det,
    ((b[0] - a[0]) * (pc[1] - pa[1]) - (c[0] - a[0]) * (pb[1] - pa[1])) / det,
  ];
  const origin: Vec = [
    pa[0] - row[0] * a[0] - col[0] * a[1],
    pa[1] - row[1] * a[0] - col[1] * a[1],
  ];
  return { origin, row, col };
}

const len = (v: Vec): number => Math.hypot(v[0], v[1]);

/** Where cell `c` lands under `basis`. */
const place = (basis: Basis, c: Cell): Vec => [
  basis.origin[0] + basis.row[0] * (c % 3) + basis.col[0] * Math.floor(c / 3),
  basis.origin[1] + basis.row[1] * (c % 3) + basis.col[1] * Math.floor(c / 3),
];

/**
 * Where each detection sits under `basis`, and how far the worst of them is from its cell — or
 * null if any is not within tolerance of a distinct one.
 */
function assign(
  basis: Basis,
  pts: readonly Vec[],
  tolerance = CELL_TOLERANCE,
): { cells: Cell[]; residual: number } | null {
  const scale = Math.min(len(basis.row), len(basis.col));
  // A DEGENERATE basis explains everything and so explains nothing: a zero step puts every cell in
  // one place, and every point would be "in tolerance" of all nine.
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const reach = tolerance * scale;
  // THE OPTIMAL MATCHING, NOT THE GREEDY ONE. Taking each point's nearest free cell in turn makes
  // the answer depend on the order the detections arrive in: an early point can take the cell a
  // later one needs, and the reading is then refused for a collision that a different order would
  // not have had. Measured 2026-09-23 — greedy read a rotated face with a twentieth of a step of
  // jitter in 27 of 81 cases and optimal reads far more, and NEITHER ever read one wrongly. Same
  // `hungarian` the whole-cube repair uses, so there is one matching in this package.
  //
  // The nine cell centres are computed ONCE per basis rather than once per point, and a point with
  // no cell inside `reach` ends the attempt where it is found: no matching can place it, so the rest
  // of the matrix and the Hungarian over it are work whose answer is already known. Both are exact —
  // the surviving bases and their assignments are unchanged — and together they are what makes 504
  // candidate bases per frame affordable. Without them the suite's noise sweep exceeds a three-minute
  // per-test timeout under coverage instrumentation.
  const centres: Vec[] = [];
  for (let c = 0; c < 9; c++) centres.push(place(basis, c));
  const cost: number[][] = [];
  for (const p of pts) {
    const row: number[] = [];
    let nearest = Number.POSITIVE_INFINITY;
    for (let c = 0; c < 9; c++) {
      const q = centres[c]!;
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < nearest) nearest = d;
      row.push(d);
    }
    if (!(nearest <= reach)) return null;
    cost.push(row);
  }
  // Padded to 9×9 with rows that cost the same everywhere, so they are indifferent and the optimum
  // over the real rows is unchanged.
  while (cost.length < 9) cost.push(new Array<number>(9).fill(0));
  const chosen = hungarian(cost);
  const out: Cell[] = [];
  let residual = 0;
  for (let k = 0; k < pts.length; k++) {
    const cell = chosen[k]!;
    const d = cost[k]![cell]!;
    if (!(d <= reach)) return null;
    out.push(cell);
    residual = Math.max(residual, d / scale);
  }
  return { cells: out, residual };
}

/**
 * The basis that best explains `pts` sitting at `cells`, by least squares over ALL of them.
 *
 * A basis derived from three points is exact only if those three are — and a detector's boxes are
 * not. The error in the three is carried into the row and column vectors and then EXTRAPOLATED
 * two cells away, so a jitter of a fifth of a step at the source became most of a step at the far
 * corner and every candidate was refused as "no lattice" (measured 2026-09-23: the fit placed a
 * clean face and refused the same face with any jitter at all). Three points propose; every point
 * decides.
 *
 * Linear regression of x and y on (1, i, j) — a 3×3 normal-equation solve, closed form, no
 * iteration. Null when the cells are collinear and the system is singular.
 */
function refine(cells: readonly Cell[], pts: readonly Vec[]): Basis | null {
  let n = 0;
  let si = 0;
  let sj = 0;
  let sii = 0;
  let sjj = 0;
  let sij = 0;
  const sx: [number, number, number] = [0, 0, 0];
  const sy: [number, number, number] = [0, 0, 0];
  for (const [k, c] of cells.entries()) {
    const i = c % 3;
    const j = Math.floor(c / 3);
    const [x, y] = pts[k]!;
    n += 1;
    si += i;
    sj += j;
    sii += i * i;
    sjj += j * j;
    sij += i * j;
    sx[0] += x;
    sx[1] += x * i;
    sx[2] += x * j;
    sy[0] += y;
    sy[1] += y * i;
    sy[2] += y * j;
  }
  // The normal matrix [[n, si, sj], [si, sii, sij], [sj, sij, sjj]], inverted by cofactors.
  const m = [
    [n, si, sj],
    [si, sii, sij],
    [sj, sij, sjj],
  ];
  const det =
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
    m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
    m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  const inv = [
    [
      (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) / det,
      (m[0]![2]! * m[2]![1]! - m[0]![1]! * m[2]![2]!) / det,
      (m[0]![1]! * m[1]![2]! - m[0]![2]! * m[1]![1]!) / det,
    ],
    [
      (m[1]![2]! * m[2]![0]! - m[1]![0]! * m[2]![2]!) / det,
      (m[0]![0]! * m[2]![2]! - m[0]![2]! * m[2]![0]!) / det,
      (m[0]![2]! * m[1]![0]! - m[0]![0]! * m[1]![2]!) / det,
    ],
    [
      (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!) / det,
      (m[0]![1]! * m[2]![0]! - m[0]![0]! * m[2]![1]!) / det,
      (m[0]![0]! * m[1]![1]! - m[0]![1]! * m[1]![0]!) / det,
    ],
  ];
  const solve = (rhs: readonly [number, number, number]): [number, number, number] => [
    inv[0]![0]! * rhs[0] + inv[0]![1]! * rhs[1] + inv[0]![2]! * rhs[2],
    inv[1]![0]! * rhs[0] + inv[1]![1]! * rhs[1] + inv[1]![2]! * rhs[2],
    inv[2]![0]! * rhs[0] + inv[2]![1]! * rhs[1] + inv[2]![2]! * rhs[2],
  ];
  const [ox, rx, cx] = solve(sx);
  const [oy, ry, cy] = solve(sy);
  return { origin: [ox, oy], row: [rx, ry], col: [cx, cy] };
}

/** The four quarter turns of the 3×3, as cell → cell. */
const TURN: readonly (readonly Cell[])[] = (() => {
  const turns: Cell[][] = [];
  let map: Cell[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  for (let k = 0; k < 4; k++) {
    turns.push([...map]);
    // A quarter turn clockwise: cell (i, j) → (2 − j, i).
    const next: Cell[] = new Array(9);
    for (let c = 0; c < 9; c++) {
      const i = map[c]! % 3;
      const j = Math.floor(map[c]! / 3);
      next[c] = i * 3 + (2 - j);
    }
    map = next;
  }
  return turns;
})();

/** Are two assignments the same answer — equal, or a quarter turn apart? */
function sameReading(a: readonly Cell[], b: readonly Cell[]): boolean {
  return TURN.some((turn) => a.every((c, i) => turn[c] === b[i]));
}

/**
 * The cell each detection occupies, or a refusal.
 *
 * Every candidate reading is enumerated rather than searched for: one non-collinear triple of the
 * observed points is mapped onto every ordered triple of cells, each gives a basis, and a basis is
 * kept when every point lands within tolerance of a distinct cell. What survives is the set of
 * readings the picture admits; one (up to a quarter turn) is an answer and more than one is not.
 *
 * At most 9·8·7 = 504 bases are tried, each a handful of arithmetic — and only on frames the full
 * fit has already refused, which is where the discarded evidence is.
 */
export function fitPartial(
  dets: readonly Detection[],
  { minObserved = MIN_TRUSTED }: PartialOptions = {},
): PartialFit {
  if (minObserved < MIN_IDENTIFIABLE) {
    throw new RangeError(
      `fitPartial: minObserved ${minObserved} is below MIN_IDENTIFIABLE ${MIN_IDENTIFIABLE}, where no set of cells determines the grid`,
    );
  }
  if (dets.length < minObserved || dets.length > 9) return { ok: false, reason: 'too-few' };
  const pts: Vec[] = dets.map((d) => [d.cx, d.cy]);
  // THE MOST SPREAD-OUT TRIPLE, not the first non-collinear one.
  //
  // The basis is built from three points and then EXTRAPOLATED to the rest, so the smaller the
  // triangle the more it multiplies their error: taking the first workable triple built the basis
  // from three neighbouring cells, and a twentieth of a step of jitter there became more than a
  // whole step at the far corner — every candidate was refused, and the fit read a clean face and
  // refused the same face with any noise at all (measured 2026-09-23: 72 of 216, failing for six of
  // the nine missing cells at every angle and seed). The largest triangle is the best-conditioned
  // handle available, and finding it is 56 comparisons on eight points.
  let tri: [number, number, number] | null = null;
  let widest = 1e-9;
  for (let a = 0; a < pts.length; a++) {
    for (let b = a + 1; b < pts.length; b++) {
      for (let c = b + 1; c < pts.length; c++) {
        const area = Math.abs(
          (pts[b]![0] - pts[a]![0]) * (pts[c]![1] - pts[a]![1]) -
            (pts[c]![0] - pts[a]![0]) * (pts[b]![1] - pts[a]![1]),
        );
        if (area > widest) {
          widest = area;
          tri = [a, b, c];
        }
      }
    }
  }
  if (!tri) return { ok: false, reason: 'no-lattice' };

  const readings: { cells: Cell[]; residual: number }[] = [];
  for (let x = 0; x < 9; x++) {
    for (let y = 0; y < 9; y++) {
      if (y === x) continue;
      for (let z = 0; z < 9; z++) {
        if (z === x || z === y) continue;
        const basis = basisFrom([x, y, z], [pts[tri[0]]!, pts[tri[1]]!, pts[tri[2]]!]);
        if (!basis) continue;
        // ORIENTATION-PRESERVING ONLY — see the file header. A mirrored basis is one `orient()`
        // never produces, so counting it as a second reading would refuse readings that are fine.
        if (basis.row[0] * basis.col[1] - basis.row[1] * basis.col[0] <= 0) continue;
        const proposed = assign(basis, pts, PROPOSAL_TOLERANCE);
        if (!proposed) continue;
        // THREE POINTS PROPOSE, EVERY POINT DECIDES. The proposal's basis carries the error of the
        // three it was built from; the refit spreads it over all of them, and the residual that
        // selects between readings is then a property of the reading rather than of which three
        // points happened to be picked. Twice, because the first refit can move a point across a
        // cell boundary and the second settles it; a third never changed an answer in testing.
        let fit = proposed;
        for (let pass = 0; pass < 2; pass++) {
          const better = refine(fit.cells, pts);
          const next = better && assign(better, pts, PROPOSAL_TOLERANCE);
          if (!next) break;
          fit = next;
        }
        // The VERDICT is at the strict bound: a reading whose points are not within half a step of
        // their cells after every point has had its say is not a reading of this face.
        const settled = refine(fit.cells, pts);
        const strict = settled && assign(settled, pts, CELL_TOLERANCE);
        if (!strict) continue;
        if (!readings.some((r) => sameReading(r.cells, strict.cells))) readings.push(strict);
      }
    }
  }
  if (readings.length === 0) return { ok: false, reason: 'no-lattice' };
  // THE RESIDUAL SELECTS AND THE TABLE GUARANTEES, and neither alone would do.
  //
  // AT THE DEFAULT FLOOR THIS LOOKUP CANNOT REFUSE ANYTHING, and that is a proof rather than an
  // oversight: `MIN_TRUSTED` is 8, a reading of eight or nine points occupies an eight- or
  // nine-cell mask, and the enumeration found EVERY one of those ten usable. It is live the moment a
  // caller lowers `minObserved`, which is the only condition under which a mask can be unusable —
  // so the test for it passes a lower floor rather than pretending the default reaches it.
  //
  // The tolerance has to be wide enough for a detector's jitter, and a tolerance that wide admits
  // readings the EXACT enumeration rules out: a skewed basis can put every point within half a step
  // of some cell without any of them being on one. Measured on exact points, 28 of the 382 masks of
  // four cells or more carried a second admissible reading for that reason alone.
  //
  // So the best-fitting reading is taken — on exact points its residual is zero and every impostor's
  // is not — and then the MASK it implies is looked up. The table is what makes that safe: for a
  // usable mask the enumeration has already proved no second EXACT reading exists, so a competing
  // reading is a tolerance artefact rather than a rival. For a mask that is not usable, a second
  // exact reading does exist and no residual can choose between them, which is the refusal.
  //
  // AND A TIE NEEDS NO BRANCH OF ITS OWN, which was measured rather than assumed. Two readings
  // fitting EXACTLY equally well would be a selection the residual has not made — but on a usable
  // mask it cannot happen, because the enumeration proves exactly one EXACT reading exists there, so
  // every rival is strictly worse. Swept over all 382 masks at ten rotations and three jitters plus
  // 9,000 sets of random points (20,460 fits, 2026-09-23): 954 exact ties, every one of them on a
  // mask this lookup has already refused, and none on a usable one. A branch below the refusal that
  // fires on nothing is a guard that cannot be tested and cannot fail, so it is not kept.
  readings.sort((a, b) => a.residual - b.residual);
  const best = readings[0]!;
  const cells = best.cells;
  const mask = cells.reduce((m, c) => m | (1 << c), 0);
  if (!USABLE_MASKS.has(mask)) {
    return { ok: false, reason: 'mask-not-usable', readings: readings.length };
  }
  // THE FIT HAS TO BE GOOD, NOT MERELY ADMISSIBLE. Everything above asks whether a reading is the
  // only one; this asks whether it is a reading of a FACE. Both are needed: on the clip's own
  // ground truth the uniqueness tests pass ten readings that are wrong, and nine of them sit here.
  if (best.residual > MAX_RESIDUAL) {
    return { ok: false, reason: 'poor-fit', readings: readings.length, residual: best.residual };
  }
  const grid: (Detection | null)[] = new Array(9).fill(null);
  cells.forEach((c, i) => {
    grid[c] = dets[i]!;
  });
  // The residual travels with the answer: accumulating evidence across frames (§4, Stage 2) has to
  // be able to weigh a clean reading against a marginal one, and this is the only number that says
  // which is which.
  return { ok: true, face: { cells: grid, observed: cells.length, mask }, residual: best.residual };
}
