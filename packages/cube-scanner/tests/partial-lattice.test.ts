// Partial-lattice observation: which cells a set of detections occupies, and when that cannot be
// said (`dev-docs/scan-pipeline-audit-2026-09-23.md` §4, Stage 2).
//
// The table in `partial-lattice.ts` is a mathematical fact about a 3×3 grid, so it is not taken on
// trust: this file RECOMPUTES it from first principles — exact rational arithmetic over every one
// of the 512 subsets — and fails if the shipped table and that computation part company. The
// runtime fit is then held to the same answers on noise-free points, which is what makes the table
// a specification of the fit rather than a note beside it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Detection, fitFace } from '../src/onnx-postprocess.js';
import {
  CELL_TOLERANCE,
  fitPartial,
  MAX_RESIDUAL,
  MIN_IDENTIFIABLE,
  MIN_TRUSTED,
  USABLE_MASKS,
} from '../src/partial-lattice.js';

/** Cell `c` as (column, row). */
const at = (c: number): [number, number] => [c % 3, Math.floor(c / 3)];

/**
 * Every reading of `cells` that lands inside a 3×3 grid, in EXACT integer arithmetic.
 *
 * The affine map is carried as numerators over a common denominator (`det`), so "this point lands
 * on a cell" is an integer divisibility test rather than a float comparison — the enumeration is
 * about whether a reading EXISTS, and "nearly integer" answers a different question.
 *
 * Orientation-preserving only, for the reason `partial-lattice.ts` gives: `orient()` fixes the
 * basis's handedness from the image, so a mirrored reading is not one the fit can produce. Counting
 * reflections makes even the full nine ambiguous, which is the arithmetic saying the question was
 * put wrongly.
 */
function readingsOf(cells: readonly number[]): number[][] {
  // The most spread-out non-collinear triple, the same handle the fit uses.
  let tri: [number, number, number] | null = null;
  let widest = 0;
  for (let a = 0; a < cells.length; a++) {
    for (let b = a + 1; b < cells.length; b++) {
      for (let c = b + 1; c < cells.length; c++) {
        const [ax, ay] = at(cells[a]!);
        const [bx, by] = at(cells[b]!);
        const [cx, cy] = at(cells[c]!);
        const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
        if (area > widest) {
          widest = area;
          tri = [a, b, c];
        }
      }
    }
  }
  if (!tri) return [];
  const [ax, ay] = at(cells[tri[0]]!);
  const [bx, by] = at(cells[tri[1]]!);
  const [cx, cy] = at(cells[tri[2]]!);
  const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (det === 0) return [];

  const out: number[][] = [];
  for (let x = 0; x < 9; x++) {
    for (let y = 0; y < 9; y++) {
      if (y === x) continue;
      for (let z = 0; z < 9; z++) {
        if (z === x || z === y) continue;
        const [ux, uy] = at(x);
        const [vx, vy] = at(y);
        const [wx, wy] = at(z);
        const aN = (vx - ux) * (cy - ay) - (wx - ux) * (by - ay);
        const bN = (bx - ax) * (wx - ux) - (cx - ax) * (vx - ux);
        const cN = (vy - uy) * (cy - ay) - (wy - uy) * (by - ay);
        const dN = (bx - ax) * (wy - uy) - (cx - ax) * (vy - uy);
        // det² is positive, so the sign of the map's determinant is the sign of this.
        if (aN * dN - bN * cN <= 0) continue;
        const eN = ux * det - aN * ax - bN * ay;
        const fN = uy * det - cN * ax - dN * ay;
        const image: number[] = [];
        let ok = true;
        for (const cell of cells) {
          const [px, py] = at(cell);
          const X = aN * px + bN * py + eN;
          const Y = cN * px + dN * py + fN;
          if (X % det !== 0 || Y % det !== 0) {
            ok = false;
            break;
          }
          const i = X / det;
          const j = Y / det;
          if (i < 0 || i > 2 || j < 0 || j > 2) {
            ok = false;
            break;
          }
          image.push(j * 3 + i);
        }
        if (!ok || new Set(image).size !== image.length) continue;
        if (!out.some((r) => TURNS.some((t) => r.every((c, i) => t[c] === image[i])))) {
          out.push(image);
        }
      }
    }
  }
  return out;
}

/** The four quarter turns, as cell → cell. */
const TURNS: number[][] = (() => {
  const out: number[][] = [];
  let m = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  for (let k = 0; k < 4; k++) {
    out.push([...m]);
    const next = new Array<number>(9);
    for (let c = 0; c < 9; c++) {
      const [i, j] = at(m[c]!);
      next[c] = i * 3 + (2 - j);
    }
    m = next;
  }
  return out;
})();

/** The cells a fit placed, in the order the detections were given. */
const readingOf = (face: { cells: (Detection | null)[] }, dets: readonly Detection[]): number[] =>
  dets.map((d) => face.cells.findIndex((x) => x === d));

/** Two readings are one answer when they differ by a quarter turn — the assembly searches all four. */
const sameReading = (a: readonly number[], b: readonly number[]): boolean =>
  TURNS.some((t) => a.every((c, i) => t[c] === b[i]));

/** Recompute, exactly, whether `mask`'s cells determine the grid. */
function determinesGrid(mask: number): boolean {
  const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => (mask & (1 << c)) !== 0);
  if (cells.length < 3) return false;
  return readingsOf(cells).length === 1;
}

describe('which partial observations determine the grid — recomputed, not trusted', () => {
  const computed = new Set<number>();
  for (let mask = 0; mask < 512; mask++) if (determinesGrid(mask)) computed.add(mask);

  it('agrees with the table the module ships', () => {
    const shipped = [...USABLE_MASKS].sort((a, b) => a - b);
    const here = [...computed].sort((a, b) => a - b);
    expect(here).toEqual(shipped);
  });

  it('says every way of losing ONE sticker still determines the grid', () => {
    // The line that matters: 177 frames of the stuck session carried eight good stickers and were
    // discarded entire. Every one of them is an observation.
    for (let missing = 0; missing < 9; missing++) {
      const mask = 0b111111111 & ~(1 << missing);
      expect(computed.has(mask), `losing cell ${missing}`).toBe(true);
    }
  });

  it('never determines it from three or fewer', () => {
    // Not unlucky — impossible: an affine map is fixed by three points, so any three points fit any
    // three cells. `MIN_IDENTIFIABLE` is the arithmetic, not a policy — and it is NOT the floor the
    // fit applies, which is `MIN_TRUSTED` and comes from a measurement.
    for (let mask = 0; mask < 512; mask++) {
      const size = [...Array(9).keys()].filter((c) => mask & (1 << c)).length;
      if (size <= 3) expect(computed.has(mask), `mask ${mask}`).toBe(false);
    }
    const smallest = Math.min(
      ...[...computed].map((m) => [...Array(9).keys()].filter((c) => m & (1 << c)).length),
    );
    expect(smallest).toBe(MIN_IDENTIFIABLE);
  });

  it('refuses the two negatives the plan names', () => {
    const cell = (i: number, j: number) => j * 3 + i;
    // A 2×2 corner block: the same points are cells of one lattice and of another at twice the step.
    const block = (1 << cell(0, 0)) | (1 << cell(1, 0)) | (1 << cell(0, 1)) | (1 << cell(1, 1));
    expect(computed.has(block)).toBe(false);
    // The four corners: likewise, and the reason a spread of four is not automatically enough.
    const corners = (1 << cell(0, 0)) | (1 << cell(2, 0)) | (1 << cell(0, 2)) | (1 << cell(2, 2));
    expect(computed.has(corners)).toBe(false);
  });

  it('counts the same as the run of 2026-09-23, size by size', () => {
    // The table in the module header, asserted. A change to the rule that moved any of these is a
    // change to what the scanner will believe from a partial frame, and should be seen.
    const bySize = new Map<number, number>();
    for (const m of computed) {
      const size = [...Array(9).keys()].filter((c) => m & (1 << c)).length;
      bySize.set(size, (bySize.get(size) ?? 0) + 1);
    }
    expect([...bySize].sort((a, b) => a[0] - b[0])).toEqual([
      [4, 12],
      [5, 44],
      [6, 60],
      [7, 34],
      [8, 9],
      [9, 1],
    ]);
  });
});

/** A face at `step` pixels, rotated by `deg`, with only `mask`'s cells present. */
function facePoints(mask: number, step = 40, deg = 0, jitter = 0): Detection[] {
  const t = (deg * Math.PI) / 180;
  const out: Detection[] = [];
  for (let c = 0; c < 9; c++) {
    if (!(mask & (1 << c))) continue;
    const [i, j] = at(c);
    const x = (i - 1) * step;
    const y = (j - 1) * step;
    out.push({
      cx: 300 + x * Math.cos(t) - y * Math.sin(t) + (c % 2 ? jitter : -jitter),
      cy: 300 + x * Math.sin(t) + y * Math.cos(t) + (c % 3 ? jitter : -jitter),
      w: 26,
      h: 26,
      classId: c % 6,
      confidence: 0.9,
      scores: [0, 1, 2, 3, 4, 5].map((k) => (k === c % 6 ? 0.9 : 0.02)),
    });
  }
  return out;
}

describe('the fit answers what the enumeration says it can', () => {
  it('places eight stickers when the ninth is missing, at any rotation', () => {
    // THE CASE THE MODULE EXISTS FOR (§3, F1): 177 frames of the stuck session carried eight good
    // stickers and were discarded entire.
    for (let missing = 0; missing < 9; missing++) {
      const mask = 0b111111111 & ~(1 << missing);
      const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => c !== missing);
      for (const deg of [0, 12, 33, 87]) {
        const dets = facePoints(mask, 40, deg);
        const got = fitPartial(dets);
        expect(got.ok, `missing ${missing} at ${deg}°`).toBe(true);
        if (!got.ok) continue;
        expect(got.face.observed).toBe(8);
        // Exactly one cell unobserved — a finger over a sticker is not a sticker of some colour.
        expect(got.face.cells.filter((c) => c === null)).toHaveLength(1);
        // A ROTATION OF THE TRUTH, not the truth itself. The assembly searches all four turns of
        // every face, so a reading a quarter turn round is the same answer — and asserting the
        // identity here would be asserting something the module deliberately does not promise, which
        // is how a test comes to pin a coincidence. A face drawn at 87° reads as a turned one.
        expect(
          sameReading(cells, readingOf(got.face, dets)),
          `missing ${missing} at ${deg}° read as something that is not a turn of the truth`,
        ).toBe(true);
        // Exact points, so the fit should be all but perfect — far inside the bound.
        expect(got.residual).toBeLessThan(0.01);
      }
    }
  });

  it('refuses everything under the measured floor, whatever the table says of it', () => {
    // The two floors are different questions and this is where they visibly part company: there are
    // masks IN `USABLE_MASKS` — cells the enumeration PROVES determine the grid — that the fit still
    // will not read, because `MIN_TRUSTED` asks whether a reading can be told from clutter and the
    // enumeration does not ask that at all.
    for (let mask = 0; mask < 512; mask++) {
      const size = [...Array(9).keys()].filter((c) => mask & (1 << c)).length;
      if (size >= MIN_TRUSTED) continue;
      const got = fitPartial(facePoints(mask));
      expect(got.ok, `mask ${mask} of ${size}`).toBe(false);
      if (!got.ok) expect(got.reason).toBe('too-few');
    }
    const fourButUsable = [...USABLE_MASKS].find(
      (m) => [...Array(9).keys()].filter((c) => m & (1 << c)).length === MIN_IDENTIFIABLE,
    );
    expect(fourButUsable).toBeDefined();
    expect(fitPartial(facePoints(fourButUsable!)).ok).toBe(false);
  });

  it('agrees with the enumeration on every mask it will read, on exact points', () => {
    // The table is a SPECIFICATION of the fit over the range the fit answers in, so the two are
    // compared across all of it — this is what stops the fit and its own table drifting apart.
    let checked = 0;
    for (let mask = 0; mask < 512; mask++) {
      const size = [...Array(9).keys()].filter((c) => mask & (1 << c)).length;
      if (size < MIN_TRUSTED) continue;
      const got = fitPartial(facePoints(mask));
      expect(got.ok, `mask ${mask}`).toBe(USABLE_MASKS.has(mask));
      checked += 1;
    }
    expect(checked).toBe(10); // the 9 ways of losing one sticker, and the full nine
  });

  it('reads a jittered face up to the bound, and refuses past it — for a stated reason', () => {
    // WHICH BOUND GOVERNS A NOISY FACE, pinned because the obvious answer is the wrong one. It is
    // `MAX_RESIDUAL`, not `CELL_TOLERANCE`: half a step is the widest a point can be ASSIGNED at,
    // and a fit is refused long before that for being a poor fit rather than an unassignable one.
    //
    // `facePoints` shifts every point by ±jitter on BOTH axes, so the displacement is jitter·√2 —
    // which makes the crossing point arithmetic rather than a tuned observation: refusal must begin
    // where jitter·√2 passes MAX_RESIDUAL, at 0.141 of a step. Measured 2026-09-23: read 72 of 72 at
    // 0.12, 16 of 72 at 0.15, 0 of 72 at 0.20 — and every refusal `poor-fit`.
    const cases = (jitter: number): { ok: number; poor: number } => {
      let ok = 0;
      let poor = 0;
      for (let missing = 0; missing < 9; missing++) {
        for (const deg of [0, 12, 33, 87, 150, 222, 300, 45]) {
          const got = fitPartial(facePoints(0b111111111 & ~(1 << missing), 40, deg, jitter * 40));
          if (got.ok) ok += 1;
          else if (got.reason === 'poor-fit') poor += 1;
        }
      }
      return { ok, poor };
    };
    // The claim this case rests on, asserted rather than left in a comment: the fit is bounded by
    // how WELL it fits, strictly before it is bounded by what it can assign.
    expect(MAX_RESIDUAL).toBeLessThan(CELL_TOLERANCE);
    const crossing = MAX_RESIDUAL / Math.SQRT2;
    expect(crossing).toBeGreaterThan(0.12);
    expect(crossing).toBeLessThan(0.15);
    // Comfortably inside: 0.12 of a step is already more than the real detector does — its worst
    // placement on the clip's nine-detection frames is 0.085 at the 95th percentile.
    expect(cases(0.12).ok).toBe(72);
    // Comfortably outside, and refused as a poor fit rather than as no lattice: the reading is still
    // there to be had, it simply does not fit well enough to be called an observation.
    expect(cases(0.2)).toEqual({ ok: 0, poor: 72 });
  });

  it('cannot meet an unusable mask at the floor it applies \u2014 and obeys the table below it', () => {
    // WHY THE TABLE LOOKUP LOOKS DEAD, AND IS NOT. At `MIN_TRUSTED` a reading occupies eight or nine
    // cells, and the enumeration found every one of those ten masks usable \u2014 so at the shipped
    // floor that refusal is unreachable BY PROOF, which is a different thing from unreachable by
    // accident.
    for (let mask = 0; mask < 512; mask++) {
      const size = [...Array(9).keys()].filter((c) => mask & (1 << c)).length;
      if (size >= MIN_TRUSTED) expect(USABLE_MASKS.has(mask), `mask ${mask}`).toBe(true);
    }

    // BELOW THE FLOOR IT DECIDES 94 MASKS ON ITS OWN, and this is the sweep that says so: over every
    // mask of `MIN_IDENTIFIABLE` cells or more, the fit must answer exactly what the enumeration
    // says. Delete the lookup and 94 of these come back a confident `ok` \u2014 one reading offered
    // for a picture that provably has two, which is this repository's "never invent data" with an
    // arithmetic cause. Hand-picked negatives do NOT catch that: the 2\u00d72 block still refuses
    // without the table, as `ambiguous`, so a case that accepts either reason passes a fit that has
    // stopped consulting the table at all.
    let checked = 0;
    for (let mask = 0; mask < 512; mask++) {
      const size = [...Array(9).keys()].filter((c) => mask & (1 << c)).length;
      if (size < MIN_IDENTIFIABLE) continue;
      const got = fitPartial(facePoints(mask), { minObserved: MIN_IDENTIFIABLE });
      expect(got.ok, `mask ${mask} of ${size} cells`).toBe(USABLE_MASKS.has(mask));
      checked += 1;
    }
    expect(checked).toBe(382); // every mask of four cells or more

    // The plan's two named negatives, refused by the table BY NAME rather than by a coincidence of
    // tolerance \u2014 which is the distinction the sweep above exists to keep.
    const cell = (i: number, j: number) => j * 3 + i;
    const block = (1 << cell(0, 0)) | (1 << cell(1, 0)) | (1 << cell(0, 1)) | (1 << cell(1, 1));
    const corners = (1 << cell(0, 0)) | (1 << cell(2, 0)) | (1 << cell(0, 2)) | (1 << cell(2, 2));
    for (const [name, mask] of [
      ['2\u00d72 block', block],
      ['four corners', corners],
    ] as const) {
      const got = fitPartial(facePoints(mask), { minObserved: MIN_IDENTIFIABLE });
      expect(got.ok, name).toBe(false);
      if (!got.ok) expect(got.reason, name).toBe('mask-not-usable');
    }
  });

  it('refuses a floor the arithmetic forbids, loudly', () => {
    // Three points fit any three cells, so a floor of three is not a permissive setting — it is a
    // request for an answer that does not exist. Throwing beats returning a refusal a caller can
    // mistake for "this frame was poor".
    expect(() => fitPartial(facePoints(0b111111111), { minObserved: 3 })).toThrow(RangeError);
  });

  it('reads nothing at all out of points that are not a face', () => {
    // THE NULL, and at the floor this fit applies it is empty. Everything above asks whether a
    // reading is unique; a unique reading of a cluttered desk is still the scanner inventing a cube.
    //
    // MEASURED 2026-09-23 over three seeds and 18,000 sets at each size: zero. The same sweep with
    // `MAX_RESIDUAL` lifted reads about 478 of every 6,000 eight-point sets and 29 of every 6,000
    // nine-point ones, which is the entire reason that bound exists — see the module header, where
    // the drop-one table shows it correcting no misreading of a real cube whatsoever.
    let seed = 20260923;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const read: string[] = [];
    for (const n of [MIN_TRUSTED, 9]) {
      for (let t = 0; t < 3000; t++) {
        const dets: Detection[] = [];
        for (let k = 0; k < n; k++) {
          dets.push({
            cx: rnd() * 400,
            cy: rnd() * 400,
            w: 24,
            h: 24,
            classId: 0,
            confidence: 0.9,
          });
        }
        const got = fitPartial(dets);
        if (got.ok) read.push(`${n} points, residual ${got.residual.toFixed(3)}`);
      }
    }
    expect(read, `random points read as faces: ${read.slice(0, 5).join('; ')}`).toEqual([]);
  });

  it('rejects an admissible reading that does not FIT, and says how badly', () => {
    // `MAX_RESIDUAL` has to be reachable by a real refusal or it is decoration. A face sheared until
    // its points are a fifth of a step off their cells is still assignable — every point is nearer
    // its own cell than any other — and is not an observation of this face.
    const mask = 0b111111111 & ~(1 << 8);
    const dets = facePoints(mask).map((d, k) => ({ ...d, cx: d.cx + (k % 2 ? 14 : -14) }));
    const got = fitPartial(dets);
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.reason).toBe('poor-fit');
      expect(got.residual!).toBeGreaterThan(MAX_RESIDUAL);
    }
  });
});

describe('the fit measured against a truth it did not produce', () => {
  // THE MEASUREMENT THE CONSTANTS COME FROM, re-run on every test run rather than quoted from a
  // notebook — and crucially NOT against itself. The truth is `fitFace`, the shipped full-face path:
  // a different function, already trusted by the whole scanner, which on these frames returns a
  // PROVEN lattice ordering (D6). That fixes what the nine cells are with no input from this module.
  // Removing one detection then asks this module the question it exists to answer, with the answer
  // already known. Real detector output, no synthetic lattice, no assumed noise model.
  const clip = JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures', 'logo-cube-clip.json'), 'utf8'),
  ) as { fps: number; frames: number[][][] };

  const detectionOf = (row: number[]): Detection => {
    const scores = row.slice(4, 10);
    let classId = 0;
    for (let c = 1; c < scores.length; c++) if (scores[c]! > scores[classId]!) classId = c;
    return {
      cx: row[0]!,
      cy: row[1]!,
      w: row[2]!,
      h: row[3]!,
      classId,
      confidence: scores[classId]!,
      scores,
    };
  };

  /** The nine detections `fitFace` fitted, in ITS reading order. */
  function truthOf(boxes: number[][]): Detection[] | null {
    const dets = boxes.map(detectionOf);
    const fit = fitFace(dets);
    // `'sorted'` is exactly the ordering D6 says was never proven, so it cannot be a truth here.
    if (!fit.ok || fit.face.ordering !== 'lattice' || !fit.face.boxes) return null;
    const nine = fit.face.boxes.map(([x0, y0, w, h]) =>
      // `boxes` are corner-and-size; the detections are centre-and-size.
      dets.find(
        (d) => Math.abs(d.cx - (x0 + w / 2)) < 1e-6 && Math.abs(d.cy - (y0 + h / 2)) < 1e-6,
      ),
    );
    return nine.every((d) => d !== undefined) ? (nine as Detection[]) : null;
  }

  it('recovers the full fit\u2019s own reading from eight of its nine points', () => {
    const bases = clip.frames.map(truthOf).filter((n): n is Detection[] => n !== null);
    // The clip must actually supply a truth to test against — a sweep over nothing passes silently,
    // which is the failure this repository refuses by name.
    expect(bases.length).toBeGreaterThanOrEqual(300);

    let right = 0;
    let wrong = 0;
    let refused = 0;
    for (const nine of bases) {
      for (let k = 0; k < 9; k++) {
        const kept = nine.filter((_, i) => i !== k);
        const want = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => i !== k);
        const got = fitPartial(kept);
        if (!got.ok) refused += 1;
        else if (sameReading(want, readingOf(got.face, kept))) right += 1;
        else wrong += 1;
      }
    }
    // MEASURED 2026-09-23: 336 frames, 3,024 trials — 3,013 right, 2 wrong, 9 refused. The bands are
    // wide enough not to fail on arithmetic if the detector or the clip moves, and tight enough that
    // the property they pin cannot quietly stop being true.
    expect(right + wrong + refused).toBe(bases.length * 9);
    expect(right / (right + wrong)).toBeGreaterThan(0.99);
    // A REFUSAL IS THE RIGHT FAILURE AND A WRONG ANSWER IS NOT, so they are never interchangeable.
    expect(wrong).toBeLessThanOrEqual(5);
  });
});
