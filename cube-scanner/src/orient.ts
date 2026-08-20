// Recover per-face rotations from top-down flat reads (the tabletop scan). Each face is
// laid flat and read at an UNKNOWN quarter-turn, so we brute-force the 4^5 rotation
// combinations (one face pinned as the reference frame) and keep the one that assembles
// into a solvable cube. The colour-count + solvability constraints make the solvable
// combination essentially unique for a real scramble, so the user never aligns a face —
// they just show each side any way up. Pure + Node-tested.

import Cube from 'cubejs';
import { LOW_CONFIDENCE_THRESHOLD } from './assemble.js';
import { hsvDistance } from './color.js';
import { isStructurallyValid } from './facelet-cube.js';
import { FACES, type Face, type RGB, type ScanResult } from './types.js';

/**
 * Assign the 54 sticker colours to the 6 center colours with EXACTLY 9 per colour — a
 * balanced greedy assignment (smallest distances first, each center capped at 9). Enforcing
 * equal counts is what fixes the red↔orange / yellow↔orange confusion a plain nearest-colour
 * classify gets wrong (e.g. 12 orange, 7 red → never a valid cube). Centers are in FACES
 * order, so assignment index k maps to FACES[k]. Confidence is 1 - d(assigned)/d(next), so a
 * balance-forced sticker (assigned not its nearest) is flagged low-confidence.
 */
export function classifyBalanced(
  samples: readonly RGB[],
  centers: readonly RGB[],
): { letters: string[]; confidence: number[]; dist: number[][] } {
  const n = samples.length;
  const k = centers.length;
  const cap = Math.ceil(n / k);
  const dist = samples.map((s) => centers.map((c) => hsvDistance(s, c)));
  const pairs: { s: number; c: number; d: number }[] = [];
  for (let s = 0; s < n; s++) for (let c = 0; c < k; c++) pairs.push({ s, c, d: dist[s]![c]! });
  pairs.sort((a, b) => a.d - b.d);
  const assigned = new Array<number>(n).fill(-1);
  const count = new Array<number>(k).fill(0);
  let done = 0;
  for (const p of pairs) {
    if (assigned[p.s] !== -1 || count[p.c]! >= cap) continue;
    assigned[p.s] = p.c;
    count[p.c]!++;
    if (++done === n) break;
  }
  const letters = assigned.map((c) => FACES[c]!);
  const confidence = assigned.map((a, s) => {
    const row = dist[s]!;
    let second = Number.POSITIVE_INFINITY;
    for (let c = 0; c < k; c++) if (c !== a) second = Math.min(second, row[c]!);
    return second === 0 ? 0 : Math.max(0, 1 - row[a]! / second);
  });
  return { letters, confidence, dist };
}

/**
 * When the balanced read isn't a real cube, the errors are AMBIGUOUS stickers that landed on
 * the wrong side of a close color pair (red↔orange, white↔yellow). Generate alternative
 * labelings by SWAPPING such a pair's stickers (a swap keeps the 9-each counts), most-
 * ambiguous first, single then double, capped — one of these is the real cube.
 */
function ambiguousSwaps(
  letters: readonly string[],
  dist: readonly number[][],
  cap = 40,
): string[][] {
  const idxOf = (l: string): number => FACES.indexOf(l as Face);
  // Per sticker: assigned color, its best alternative, and how ambiguous (ratio ~1 = coin-flip).
  const flex: { s: number; a: number; alt: number; ratio: number }[] = [];
  for (let s = 0; s < letters.length; s++) {
    const a = idxOf(letters[s]!);
    const row = dist[s]!;
    let alt = -1;
    let altD = Number.POSITIVE_INFINITY;
    for (let c = 0; c < row.length; c++) if (c !== a && row[c]! < altD) [altD, alt] = [row[c]!, c];
    if (alt >= 0 && altD <= 1.6 * (row[a]! || 1e-6))
      flex.push({ s, a, alt, ratio: altD / (row[a]! || 1e-6) });
  }
  flex.sort((p, q) => p.ratio - q.ratio);
  // Group into a swappable pool per unordered color pair.
  const pairKey = (x: number, y: number): string => (x < y ? `${x},${y}` : `${y},${x}`);
  const pools = new Map<string, { A: number[]; B: number[]; a: number; b: number }>();
  for (const f of flex) {
    const key = pairKey(f.a, f.alt);
    const [a, b] = f.a < f.alt ? [f.a, f.alt] : [f.alt, f.a];
    const pool = pools.get(key) ?? { A: [], B: [], a, b };
    (f.a === a ? pool.A : pool.B).push(f.s);
    pools.set(key, pool);
  }
  const out: string[][] = [];
  for (const { A, B, a, b } of pools.values()) {
    const la = FACES[a]!;
    const lb = FACES[b]!;
    for (const i of A)
      for (const j of B) {
        if (out.length >= cap) return out;
        const alt = [...letters];
        alt[i] = lb;
        alt[j] = la;
        out.push(alt);
      }
    // A couple of double swaps for cases needing two corrections.
    for (let x = 0; x < A.length && x < 3; x++)
      for (let y = x + 1; y < A.length && y < 4; y++)
        for (let p = 0; p < B.length && p < 3; p++)
          for (let q = p + 1; q < B.length && q < 4; q++) {
            if (out.length >= cap) return out;
            const alt = [...letters];
            alt[A[x]!] = lb;
            alt[A[y]!] = lb;
            alt[B[p]!] = la;
            alt[B[q]!] = la;
            out.push(alt);
          }
  }
  return out;
}

/** The 4^6 rotation search for one color labeling — returns a valid result or null. */
function solveRotations(
  faceLetters: Record<Face, string[]>,
  faceConf: Record<Face, number[]>,
  threshold: number,
): OrientationResult | null {
  for (let code = 0; code < 4096; code++) {
    const turns: Record<Face, number> = {
      U: code & 3,
      R: (code >> 2) & 3,
      F: (code >> 4) & 3,
      D: (code >> 6) & 3,
      L: (code >> 8) & 3,
      B: (code >> 10) & 3,
    };
    let facelets = '';
    for (const f of FACES) facelets += rotateFace(faceLetters[f], turns[f]).join('');
    if (isStructurallyValid(facelets) && cubejsRoundTrips(facelets)) {
      let min = 1;
      const lowConfidence: number[] = [];
      let idx = 0;
      for (const f of FACES) {
        for (const c of rotateFace(faceConf[f], turns[f])) {
          if (c < min) min = c;
          if (c < threshold) lowConfidence.push(idx);
          idx++;
        }
      }
      return { facelets, valid: true, confidence: min, lowConfidence, rotations: turns };
    }
  }
  return null;
}

/** Rotate a 3x3 face (row-major, 9 cells) clockwise by `q` quarter-turns. */
export function rotateFace<T>(cells: readonly T[], q: number): T[] {
  const CW = [6, 3, 0, 7, 4, 1, 8, 5, 2]; // new[i] = old[CW[i]] for a 90° CW turn
  let out = cells.slice();
  const n = ((q % 4) + 4) % 4;
  for (let t = 0; t < n; t++) out = CW.map((i) => out[i]!);
  return out;
}

function cubejsRoundTrips(facelets: string): boolean {
  try {
    return Cube.fromString(facelets).asString() === facelets;
  } catch {
    return false;
  }
}

export interface OrientationResult extends ScanResult {
  rotations?: Record<Face, number>; // recovered quarter-turns per face, when valid
}

/**
 * Given six faces read flat but at unknown rotation (identified by center colour), find
 * the quarter-turn per face that yields a solvable cube. Classification runs once (rotation
 * only permutes positions, not colours); then all 4^6 = 4096 per-face rotations are
 * searched. Because face identities are pinned by center colour, the solvable combination
 * is unique — the true cube — so every face may be shown any way up. Returns the assembled
 * result; when valid, `rotations` holds the recovered turns. If no combination is solvable
 * the identity arrangement is returned as invalid (a misread — re-show a face).
 */
export function solveOrientations(
  faces: Record<Face, RGB[]>,
  threshold: number = LOW_CONFIDENCE_THRESHOLD,
): OrientationResult {
  for (const f of FACES) {
    if (!faces[f] || faces[f].length !== 9)
      throw new Error(`face ${f}: expected 9 samples, got ${faces[f]?.length ?? 0}`);
  }
  const centers = FACES.map((f) => faces[f][4]!);
  const samples: RGB[] = [];
  for (const f of FACES) for (const s of faces[f]) samples.push(s);
  const { letters, confidence, dist } = classifyBalanced(samples, centers);
  const faceConf = Object.fromEntries(
    FACES.map((f, i) => [f, confidence.slice(i * 9, i * 9 + 9)]),
  ) as Record<Face, number[]>;
  const facesOf = (lts: readonly string[]): Record<Face, string[]> =>
    Object.fromEntries(FACES.map((f, i) => [f, lts.slice(i * 9, i * 9 + 9)])) as Record<
      Face,
      string[]
    >;

  // First the balanced read; then, if it's not a real cube, alternative labelings that swap
  // ambiguous close-color stickers (red↔orange, white↔yellow) until one solves.
  const r0 = solveRotations(facesOf(letters), faceConf, threshold);
  if (r0) return r0;
  for (const alt of ambiguousSwaps(letters, dist)) {
    const r = solveRotations(facesOf(alt), faceConf, threshold);
    if (r) return r;
  }

  // Nothing solved — return the identity arrangement, flagged invalid.
  const facelets = FACES.map((f) => facesOf(letters)[f].join('')).join('');
  let min = 1;
  const lowConfidence: number[] = [];
  confidence.forEach((c, i) => {
    if (c < min) min = c;
    if (c < threshold) lowConfidence.push(i);
  });
  return { facelets, valid: false, confidence: min, lowConfidence };
}
