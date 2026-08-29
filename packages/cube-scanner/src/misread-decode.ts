// Where a colour misread is, and how many there are — by decoding, not by counting.
//
// A cube colouring is a codeword, and "which cube did the camera mean?" is a decoding problem.
// The governing number is the code's minimum distance, and it is THREE: no two legal colourings
// are closer than three stickers (exhaustively verified in tests/misread-decode.test.ts; the
// witness is a 3-cycle of the U-layer edges with their white stickers kept up, which changes
// exactly three facelets and is a perfectly legal cube).
//
// Everything this module is allowed to claim follows from that:
//
//   * ONE misread sticker is always uniquely recoverable. The true cube is 1 away; every other
//     legal cube is >= 3 from the true cube, hence >= 2 from the reading. The nearest legal cube
//     is unique and it is the right one. This is why `distance === 1` may be pointed at.
//   * From TWO onward there is no guarantee, ever. A reading two stickers from your cube can sit
//     one sticker from a DIFFERENT legal cube, and a nearest-cube decoder will then "repair" a
//     sticker that was read correctly. So above 1 this module reports a COUNT and refuses to
//     accuse. Measured, that undershoot starts appearing at three misreads.
//   * The distance is never an OVERSTATEMENT — the true cube is always a legal repair at exactly
//     the true number of misreads, so the minimum can never exceed it. That is what makes
//     "at least N stickers were misread" an honest sentence at every N.
//
// The method. For a fixed rotation combo the 54 facelets partition into 8 corner triples, 12 edge
// pairs and 6 centres. A legal cube needs the 8 observed triples to BE the 8 real corner cubies
// (each in some orientation) and the 12 pairs to be the 12 real edge cubies — so the minimum
// number of edits is a minimum-cost perfect matching, not a search over candidate patches. The
// old count-guided approach re-ran the whole 4^6 rotation search once per candidate patch and
// cost ~3 s at three misreads (and ~85 s when they were spread across three colours); this is
// 56-99 ms up to four, because k stops driving the work.
//
// Two traps, both paid for in bugs during development:
//
//   1. Piece inventory is NOT solvability. A minimum matching can produce a structurally valid
//      colouring that violates the parity constraints, and its distance then undershoots the real
//      answer — measured, in 14 of 15 trials at three misreads. So the budget is raised until a
//      repair is genuinely SOLVABLE, never merely well-formed.
//   2. Orientation is part of the choice, not a post-hoc argmin. Collapsing each (slot, cubie)
//      pair to its best orientation silently discards valid repairs when orientations tie, and
//      made the decoder report distances GREATER than the number of injected misreads — which is
//      impossible. Enumerating (cubie, orientation) pairs fixed it and ran faster.
//
// Full derivation, measurements and the refutation pass: dev-docs/misread-decoding.md.

import Cube from 'cubejs';
import {
  CORNER_COLOR,
  CORNER_FACELET,
  EDGE_COLOR,
  EDGE_FACELET,
  isStructurallyValid,
  rotateFace,
} from './facelet-cube.js';
import { FACES, type Face } from './types.js';

/** Six faces of nine colour classes each — the detector's output, at unknown rotations. */
export interface ColorFaces {
  colors: number[];
}

/** One sticker a repair changes, in the coordinates a user actually taps (the capture AS SHOWN). */
export interface DecodedSticker {
  face: Face;
  index: number;
  to: number;
}

/**
 * What the decoder concluded.
 *
 * - `repair`  — `distance` stickers must change, and `stickers` lists every sticker that some
 *               minimum repair changes. Trustworthy as an ACCUSATION only at distance 1, where
 *               the repair is provably unique; above that it is a set of candidates and the
 *               caller must not present it as fact.
 * - `beyond`  — no repair exists within `distance` edits, so strictly more than that are wrong.
 *               Still an honest lower bound, just a loose one.
 * - `unknown` — the search hit its work budget. Nothing may be claimed.
 */
export type MisreadDecode =
  | { kind: 'repair'; distance: number; stickers: DecodedSticker[]; unique: boolean }
  | { kind: 'beyond'; distance: number }
  | { kind: 'unknown' };

export interface DecodeOptions {
  /** Largest repair to look for. Past this the answer is `beyond`, which is still truthful. */
  maxDistance?: number;
  /** Hard backstop on search nodes. Exceeding it yields `unknown` rather than a silent wrong answer. */
  nodeBudget?: number;
}

const CORNER_ORI = 3;
const EDGE_ORI = 2;
/**
 * Four misreads is where repair uniqueness collapses (9 of 24 trials) and cost starts climbing,
 * and beyond it the honest advice is "show the sides again" regardless of what a search finds.
 */
const DEFAULT_MAX_DISTANCE = 4;
/** Generous enough that no measured case approaches it; present so a pathological input fails loud. */
const DEFAULT_NODE_BUDGET = 20_000_000;

/** Canonical facelet index -> the index of that sticker in the capture as shown at rotation `k`. */
const SHOWN_INDEX: readonly (readonly number[])[] = [0, 1, 2, 3].map((k) =>
  rotateFace([0, 1, 2, 3, 4, 5, 6, 7, 8], k),
);

/** Per-slot cost of every (cubie, orientation) choice, plus the canonical colours to write. */
interface Tensors {
  corner: number[][][];
  edge: number[][][];
  cornerColors: number[][];
  edgeColors: number[][];
}

function letterIndex(letter: string): number {
  const i = FACES.indexOf(letter as Face);
  if (i < 0) throw new Error(`not a face letter: ${letter}`);
  return i;
}

/** The canonical colour of each cubie sticker, given what colour sits at each face's centre. */
function canonicalColors(faceCentre: number[]): { corner: number[][]; edge: number[][] } {
  return {
    corner: CORNER_COLOR.map((t) => t.map((l) => faceCentre[letterIndex(l)]!)),
    edge: EDGE_COLOR.map((t) => t.map((l) => faceCentre[letterIndex(l)]!)),
  };
}

function buildTensors(
  colors54: number[],
  canon: { corner: number[][]; edge: number[][] },
): Tensors {
  const corner: number[][][] = [];
  for (let i = 0; i < 8; i++) {
    const observed = CORNER_FACELET[i]!.map((x) => colors54[x]!);
    const perCubie: number[][] = [];
    for (let j = 0; j < 8; j++) {
      const row: number[] = [];
      for (let r = 0; r < CORNER_ORI; r++) {
        let d = 0;
        for (let t = 0; t < 3; t++) if (observed[t] !== canon.corner[j]![(t + r) % 3]) d++;
        row.push(d);
      }
      perCubie.push(row);
    }
    corner.push(perCubie);
  }
  const edge: number[][][] = [];
  for (let i = 0; i < 12; i++) {
    const observed = EDGE_FACELET[i]!.map((x) => colors54[x]!);
    const perCubie: number[][] = [];
    for (let j = 0; j < 12; j++) {
      const row: number[] = [];
      for (let r = 0; r < EDGE_ORI; r++) {
        let d = 0;
        for (let t = 0; t < 2; t++) if (observed[t] !== canon.edge[j]![(t + r) % 2]) d++;
        row.push(d);
      }
      perCubie.push(row);
    }
    edge.push(perCubie);
  }
  return { corner, edge, cornerColors: canon.corner, edgeColors: canon.edge };
}

/**
 * An admissible lower bound on the edits this rotation needs: each slot's cheapest cubie, ignoring
 * the requirement that every cubie be used once. Cheap enough to run on all 4096 rotations, and
 * never an overestimate, so pruning on it cannot discard the true answer.
 */
function lowerBound(t: Tensors): number {
  let lb = 0;
  for (const slot of t.corner) {
    let best = 3;
    for (const ori of slot) for (const d of ori) if (d < best) best = d;
    lb += best;
  }
  for (const slot of t.edge) {
    let best = 2;
    for (const ori of slot) for (const d of ori) if (d < best) best = d;
    lb += best;
  }
  return lb;
}

interface Assignment {
  cubie: number[];
  ori: number[];
  total: number;
}

/**
 * Every assignment of cubies-with-orientation to slots costing at most `budget`, by DFS with an
 * admissible suffix bound. Orientation is enumerated, never collapsed to an argmin — see the
 * header's trap 2. Returns null if the node budget was exhausted, so the caller can refuse
 * rather than answer from a truncated search.
 */
function assignments(
  tensor: number[][][],
  n: number,
  budget: number,
  counter: { nodes: number; limit: number },
): Assignment[] | null {
  const rowMin: number[] = [];
  for (const slot of tensor) {
    let best = Number.POSITIVE_INFINITY;
    for (const ori of slot) for (const d of ori) if (d < best) best = d;
    rowMin.push(best);
  }
  const suffix = new Array<number>(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1]! + rowMin[i]!;

  const out: Assignment[] = [];
  const used = new Array<boolean>(n).fill(false);
  const cubie = new Array<number>(n);
  const ori = new Array<number>(n);
  let exhausted = false;

  const walk = (i: number, acc: number): void => {
    if (exhausted) return;
    if (++counter.nodes > counter.limit) {
      exhausted = true;
      return;
    }
    if (acc + suffix[i]! > budget) return;
    if (i === n) {
      out.push({ cubie: [...cubie], ori: [...ori], total: acc });
      return;
    }
    for (let j = 0; j < n; j++) {
      if (used[j]) continue;
      const orientations = tensor[i]![j]!;
      for (let r = 0; r < orientations.length; r++) {
        const next = acc + orientations[r]!;
        if (next + suffix[i + 1]! > budget) continue;
        used[j] = true;
        cubie[i] = j;
        ori[i] = r;
        walk(i + 1, next);
        used[j] = false;
        if (exhausted) return;
      }
    }
  };
  walk(0, 0);
  return exhausted ? null : out;
}

/** Write a corner and edge assignment into a full 54-facelet colour array. */
function realise(t: Tensors, corners: Assignment, edges: Assignment, base: number[]): number[] {
  const out = [...base];
  for (let i = 0; i < 8; i++) {
    const colours = t.cornerColors[corners.cubie[i]!]!;
    for (let p = 0; p < 3; p++) out[CORNER_FACELET[i]![p]!] = colours[(p + corners.ori[i]!) % 3]!;
  }
  for (let i = 0; i < 12; i++) {
    const colours = t.edgeColors[edges.cubie[i]!]!;
    for (let p = 0; p < 2; p++) out[EDGE_FACELET[i]![p]!] = colours[(p + edges.ori[i]!) % 2]!;
  }
  return out;
}

/**
 * Legal by BOTH oracles: the pure parity gate and an independent cubejs round-trip. Two
 * implementations on purpose — the cross-check is what makes the invariant real (see AGENTS.md).
 */
function isLegal(colors54: number[], centreOwner: Map<number, Face>): boolean {
  let s = '';
  for (const c of colors54) {
    const owner = centreOwner.get(c);
    if (owner === undefined) return false;
    s += owner;
  }
  if (!isStructurallyValid(s)) return false;
  try {
    return Cube.fromString(s).asString() === s;
  } catch {
    return false;
  }
}

/** Lay the six as-shown faces out as one 54-entry canonical array under a rotation combo. */
function flatten(faces: Record<Face, ColorFaces>, rotations: number[]): number[] {
  const out: number[] = [];
  for (let fi = 0; fi < 6; fi++) {
    for (const c of rotateFace(faces[FACES[fi]!]!.colors, rotations[fi]!)) out.push(c);
  }
  return out;
}

/**
 * Find the fewest sticker changes that turn this reading into a legal cube.
 *
 * `centreOwner` maps a centre colour to the face it names; the caller has already established the
 * six are distinct, because a reading whose centres collide is a different failure with a
 * different answer (name the two sides) and no amount of decoding improves it.
 */
export function decodeMisread(
  faces: Record<Face, ColorFaces>,
  centreOwner: Map<number, Face>,
  options: DecodeOptions = {},
): MisreadDecode {
  const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;
  const counter = { nodes: 0, limit: options.nodeBudget ?? DEFAULT_NODE_BUDGET };
  const faceCentre = FACES.map((f) => faces[f]!.colors[4]!);
  const canon = canonicalColors(faceCentre);

  // Pass 1 — price every rotation cheaply, and keep only those that could still win.
  const candidates: { rotations: number[]; bound: number }[] = [];
  for (let combo = 0; combo < 4096; combo++) {
    const rotations = [0, 1, 2, 3, 4, 5].map((i) => (combo >> (2 * i)) & 3);
    const bound = lowerBound(buildTensors(flatten(faces, rotations), canon));
    if (bound <= maxDistance) candidates.push({ rotations, bound });
  }

  // Pass 2 — widen the budget until some rotation yields a repair that is actually solvable.
  for (let budget = 0; budget <= maxDistance; budget++) {
    const found: { rotations: number[]; observed: number[]; repaired: number[] }[] = [];
    for (const { rotations, bound } of candidates) {
      if (bound > budget) continue;
      const observed = flatten(faces, rotations);
      const tensors = buildTensors(observed, canon);
      const corners = assignments(tensors.corner, 8, budget, counter);
      if (corners === null) return { kind: 'unknown' };
      const edges = assignments(tensors.edge, 12, budget, counter);
      if (edges === null) return { kind: 'unknown' };
      for (const c of corners) {
        for (const e of edges) {
          if (c.total + e.total !== budget) continue;
          const repaired = realise(tensors, c, e, observed);
          if (isLegal(repaired, centreOwner)) found.push({ rotations, observed, repaired });
        }
      }
    }
    if (found.length === 0) continue;

    // Every sticker some minimum repair changes, in the coordinates the user taps.
    const stickers = new Map<string, DecodedSticker>();
    const shapes = new Set<string>();
    for (const { rotations, observed, repaired } of found) {
      shapes.add(repaired.join(','));
      for (let p = 0; p < 54; p++) {
        if (repaired[p] === observed[p]) continue;
        const fi = Math.floor(p / 9);
        const index = SHOWN_INDEX[rotations[fi]!]![p % 9]!;
        stickers.set(`${fi}:${index}`, { face: FACES[fi]!, index, to: repaired[p]! });
      }
    }
    return {
      kind: 'repair',
      distance: budget,
      stickers: [...stickers.values()],
      unique: shapes.size === 1,
    };
  }
  return { kind: 'beyond', distance: maxDistance };
}
