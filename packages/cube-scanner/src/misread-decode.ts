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
//     is unique and it is the right one.
//   * From TWO onward there is no guarantee, ever. A reading two stickers from your cube can sit
//     one sticker from a DIFFERENT legal cube, and a nearest-cube decoder will then "repair" a
//     sticker that was read correctly. So above 1 this module reports a COUNT and refuses to
//     accuse. Measured on random misreads, that undershoot starts appearing at three.
//   * `distance === 1` is therefore NOT the same statement as "one sticker was misread", and the
//     difference is the trap. The first bullet is about the TRUE count, which nothing here can
//     observe; `distance` is a property of the READING. They come apart on exactly the inputs the
//     second bullet describes, and one is constructible by hand: read two of the 3-cycle witness's
//     three stickers and the reading is two from the cube in your hand and one from a legal cube
//     you never held. `decodeMisread` then answers `distance: 1` — honestly, since it is still a
//     lower bound — about a two-sticker misread.
//     So a caller may only accuse when the search itself says the answer is unambiguous:
//     `distance === 1` AND `unique` AND exactly one sticker named. All three, because the search
//     runs over 4^6 rotations and a rotationally symmetric face maps one canonical repair to a
//     different as-shown index under each of its four turns — the witness case above comes back
//     naming FOUR stickers, only one of which repairs the reading as given. `diagnoseMisread`
//     below is the one caller and it checks all three; tests/misread-decode.test.ts pins the
//     reading, tests/ai-assemble.test.ts pins what the app says about it.
//   * The distance is never an OVERSTATEMENT — the true cube is always a legal repair at exactly
//     the true number of misreads, so the minimum can never exceed it. That is what makes
//     "at least N stickers were misread" an honest sentence at every N.
//     PRESUMING THE SIX CENTRES WERE READ RIGHT, and that presumption is load-bearing rather than
//     pedantic. Everything above is proved against the colouring the CENTRES define: `centreOwner`
//     turns a colour into the face that owns it, so a centre read as the wrong colour is not one
//     wrong sticker — it renames every sticker of that colour on all six sides, and the "true
//     cube" the argument leans on is then a cube the user never held. The reachable case is two
//     centres swapped: the true damage is 2 and the reported count is much larger (measured, and
//     pinned in tests/misread-decode.test.ts). Nothing here can see it — the six centres are still
//     six distinct colours, which is the only thing a reading lets us check — so it is a stated
//     limit of the guarantee and not a defect in the search. Detecting it would need a second
//     search over centre permutations, which is 15 more full decodes for a case the camera makes
//     rare; dev-docs/misread-decoding.md carries the argument and the measurement.
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
 *               minimum repair changes. NEVER an accusation, at any distance. `distance === 1`
 *               says the READING is one change from legal, which is not the same as one sticker
 *               having been misread: a reading two stickers from your cube can sit one from a
 *               legal cube you never held, and this then names — uniquely, with `unique` true and
 *               one sticker listed — a sticker that was read correctly. What a caller may say is
 *               "changing this would make the cube solvable", which is exactly what was measured.
 *               See the header, and the counterexample in tests/misread-decode.test.ts.
 * - `beyond`  — no repair exists within `distance` edits, so strictly more than that are wrong.
 *               Still an honest lower bound, just a loose one.
 * - `unknown` — the search hit its work budget. Nothing may be claimed.
 */
export type MisreadDecode =
  | { kind: 'repair'; distance: number; stickers: DecodedSticker[]; unique: boolean }
  | { kind: 'beyond'; distance: number }
  | { kind: 'unknown' };

/**
 * What a refused reading may be TOLD about itself — the decode, reduced to the three claims the
 * argument above licenses, and nothing else.
 *
 * - `misreadCount` — the proven lower bound, so "at least N stickers were misread" is honest at
 *   every N. `null` means a caller deferred the decode and is still waiting for it (see
 *   `assembleColors`'s `diagnose` option); ABSENT means the decode ran and could claim nothing.
 *   Those are opposite states and a caller that cannot tell them apart says "too much of the cube
 *   was read wrong" over a cube nothing has looked at yet, which is why `null` is a value here.
 * - `suspects` — populated only where the search itself says the repair is unambiguous.
 * - `misreadFace` — the one side every minimal repair blames, when they agree on one.
 */
export interface MisreadDiagnosis {
  misreadCount?: number | null;
  suspects?: DecodedSticker[];
  misreadFace?: Face;
}

export interface DecodeOptions {
  /** Largest repair to look for. Past this the answer is `beyond`, which is still truthful.
   *  A non-negative integer; anything else throws rather than producing a nonsense distance. */
  maxDistance?: number;
  /** Hard backstop on search WORK — the DFS walks and the pairings they feed. Exceeding it yields
   *  `unknown` rather than a silent wrong answer. A non-negative integer; anything else throws. */
  nodeBudget?: number;
  /**
   * Take the faces exactly as given instead of searching all 4^6 rotations.
   *
   * The rotation search exists for the CAMERA: a side is photographed however the user held it, so
   * a reading is only meaningful up to rotation. A hand-painted cube has no such freedom — the user
   * authored each sticker in place, and a face painted a quarter-turn off is a genuinely different
   * cube, not the same cube seen sideways.
   *
   * Searching rotations for a painted cube gives a confidently wrong answer rather than a vague
   * one: measured on nine scrambles with one face rotated 90°, `assemblePainted` rejected all nine
   * while the decoder reported `misreadCount: 0` for every one — "nothing is wrong" about a cube
   * that had just been refused, because the decoder was allowed to rotate the face back.
   */
  fixedRotation?: boolean;
}

/** A count that has to be a whole non-negative number, or the caller gets an error, never a guess. */
function whole(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`decodeMisread: ${name} must be a non-negative integer, got ${value}`);
  }
  return value;
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

/**
 * The per-slot cost table for ONE piece kind: `[slot][cubie][orientation] -> stickers that differ`.
 *
 * Corners and edges were written out twice, differing only in the facelet table, the piece count
 * and the number of orientations — one indexing rule with two lifetimes, in the one place where a
 * drift between them would silently corrupt every distance this module reports.
 */
function pieceTensor(
  colors54: number[],
  facelet: readonly (readonly number[])[],
  canon: readonly (readonly number[])[],
  orientations: number,
): number[][][] {
  const stickers = orientations; // a corner has 3 stickers and 3 turns, an edge 2 and 2
  return facelet.map((slot) => {
    const observed = slot.map((x) => colors54[x]!);
    return canon.map((cubie) => {
      const row: number[] = [];
      for (let r = 0; r < orientations; r++) {
        let d = 0;
        for (let t = 0; t < stickers; t++) if (observed[t] !== cubie[(t + r) % stickers]) d++;
        row.push(d);
      }
      return row;
    });
  });
}

function buildTensors(
  colors54: number[],
  canon: { corner: number[][]; edge: number[][] },
): Tensors {
  return {
    corner: pieceTensor(colors54, CORNER_FACELET, canon.corner, CORNER_ORI),
    edge: pieceTensor(colors54, EDGE_FACELET, canon.edge, EDGE_ORI),
    cornerColors: canon.corner,
    edgeColors: canon.edge,
  };
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
 *
 * DISTINCT is not the same as CORRECT, and the distance this returns is a bound on the reading as
 * labelled by those centres. See the header's fourth bullet for what that costs when a centre is
 * itself a misread.
 */
export function decodeMisread(
  faces: Record<Face, ColorFaces>,
  centreOwner: Map<number, Face>,
  options: DecodeOptions = {},
): MisreadDecode {
  // Validated, not trusted. A NaN or negative `maxDistance` walks straight past every `<=` here
  // and comes out as `{ kind: 'beyond', distance: NaN }`, which `diagnose` turns into a misread
  // COUNT and the panel puts in a sentence — a number this module would have invented out of a
  // caller's typo. Loud is the only acceptable answer to input that cannot mean anything.
  const maxDistance = whole('maxDistance', options.maxDistance, DEFAULT_MAX_DISTANCE);
  const counter = { nodes: 0, limit: whole('nodeBudget', options.nodeBudget, DEFAULT_NODE_BUDGET) };
  const faceCentre = FACES.map((f) => faces[f]!.colors[4]!);
  const canon = canonicalColors(faceCentre);

  // Pass 1 — price every rotation cheaply, and keep only those that could still win. With
  // `fixedRotation` there is exactly one candidate: the faces as the caller supplied them.
  const candidates: { rotations: number[]; bound: number }[] = [];
  const combos = options.fixedRotation ? 1 : 4096;
  for (let combo = 0; combo < combos; combo++) {
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
          // Charged to the SAME counter as the search that produced these lists. `nodeBudget` is
          // documented as a hard backstop on the WORK, and it used to cover only the two DFS
          // walks — leaving |corners| x |edges| pairings, each with a `realise` and a cubejs
          // `isLegal`, outside it and on the main thread.
          //
          // Every assignment returned costs at least one DFS node, so |corners| and |edges| are
          // each at most `nodes` and the product is at most `nodes^2` — quadratic in the very
          // quantity the budget is supposed to bound. It is not theoretical: on the reading
          // `misread-decode.test.ts` pins, the DFS spends 3,404 nodes and the pairing loop then
          // wants 3,968 more, so at a budget of 3,500 removing this line turns an honest
          // `unknown` into a distance-4 answer bought with work the caller refused to lend.
          // (Three misreads on a scrambled cube do NOT show it — the DFS dominates there, which
          // is why the first search for a witness came back empty and the comment that went with
          // it claimed more than the search had established.)
          if (++counter.nodes > counter.limit) return { kind: 'unknown' };
          if (c.total + e.total !== budget) continue;
          const repaired = realise(tensors, c, e, observed);
          if (isLegal(repaired, centreOwner)) found.push({ rotations, observed, repaired });
        }
      }
    }
    if (found.length === 0) continue;

    // Every sticker some minimum repair changes, in the coordinates the user taps.
    //
    // Keyed by POSITION, so where two tied repairs disagree about the colour to write, the last
    // one wins. That is safe only because the one caller allowed to act on `to` — `diagnose`, for
    // an accusation — requires `unique` and a single sticker, i.e. exactly the case where no
    // disagreement can exist. Everywhere else `stickers` is read for its FACES, which the merge
    // preserves. Widening who may read `to` means giving this a set, not a winner.
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

/**
 * Turn a failed scan into what can honestly be said about it.
 *
 * This replaced a colour-COUNTING diagnosis, which could only ever speak when exactly one sticker
 * was wrong — and was blind in two ways that mattered for this detector, whose weak pair is
 * red/orange: a balanced swap (one red read as orange AND one orange read as red) leaves every
 * colour count at nine, and partial cancellation makes the counts UNDERSTATE the damage, sending
 * the search after a single-sticker repair that does not exist.
 *
 * The decoder answers both, and reports a count that is a proven lower bound. What it does NOT
 * license is pointing: above one misread the nearest legal cube is not necessarily the user's
 * cube, so only `distance === 1` becomes a suspect. dev-docs/misread-decoding.md has the whole
 * argument and the measurements.
 *
 * It lives HERE, beside the search whose guarantees it spends, rather than in `ai-assemble.ts`
 * where it was written (moved 2026-09-05). Two reasons, and the second is the load-bearing one.
 * The rule it enforces — point only at `distance === 1` AND `unique` AND one sticker — is stated
 * in this file's header as the decoder's own contract, and a rule and its enforcement one import
 * apart is how the header came to describe a check that lived somewhere else. And the misread
 * worker (`view/misread-worker.ts`) needs the diagnosis WITHOUT the assembler: bundling
 * `ai-assemble.ts` to reach it would drag the whole rotation search, the confirmation logic and
 * every refusal sentence into a thread that answers exactly one question.
 *
 * NEVER THROWS. Every caller is on a path that has ALREADY refused a scan, and the refusal is a
 * sentence shown to a child about their cube; replacing it with a crash would be a strictly worse
 * answer than "nothing more can be said". A defect still has to be visible, so it is logged and
 * the diagnosis comes back empty — which every caller already handles, because an exhausted work
 * budget produces the same empty answer.
 */
export function diagnoseMisread(
  faces: Record<Face, ColorFaces>,
  options: DecodeOptions = {},
): MisreadDiagnosis {
  let decoded: MisreadDecode;
  try {
    // Centre colour -> the face it names. `decodeMisread` proves everything against the colouring
    // these define, so six DISTINCT centres is the precondition rather than a nicety; a reading
    // whose centres collide is a different failure with a different answer (name the two sides)
    // and no amount of decoding improves it. `assembleColors` refuses that reading before it ever
    // gets here, so this is a guard on a public function and not a second copy of that policy —
    // it claims nothing rather than deciding anything.
    const centreOwner = new Map<number, Face>();
    for (const face of FACES) centreOwner.set(faces[face]!.colors[4]!, face);
    if (centreOwner.size !== FACES.length) return {};
    decoded = decodeMisread(faces, centreOwner, options);
  } catch (err) {
    console.error('[cubus] misread diagnosis failed, so nothing is claimed about the scan', err);
    return {};
  }
  if (decoded.kind === 'unknown') return {};
  // No repair within the cap means strictly more than the cap are wrong, which is still a floor.
  if (decoded.kind === 'beyond') return { misreadCount: decoded.distance + 1 };
  // Pointing takes THREE facts, not one, and this used to check only the first.
  //
  //   * `distance === 1` — the reading is one sticker from legal.
  //   * `unique` — there is only ONE such legal cube. The decoder already computes this and
  //     nothing consumed it, which is exactly how the gap got in: the guarantee was assumed from
  //     the minimum-distance argument instead of read off the search that had just measured it.
  //   * exactly one sticker — a repair can be one CHANGE and still name several stickers, because
  //     the search runs over 4^6 rotations and a rotationally symmetric face maps the same
  //     canonical position to a different as-shown index under each of its four turns.
  //
  // Measured: a solved cube read with two of the U-layer 3-cycle's three stickers comes back at
  // distance 1, `unique: false`, naming FOUR stickers — and the app said "One sticker looks
  // wrong" over all four, three of which had been read correctly. `misread-decode.test.ts` pins
  // that reading. Above one misread the nearest legal cube need not be the user's cube, so the
  // decoder may report a COUNT and nothing more.
  const pointable = decoded.distance === 1 && decoded.unique && decoded.stickers.length === 1;
  const suspects: DecodedSticker[] = pointable
    ? decoded.stickers.map((s) => ({ face: s.face, index: s.index, to: s.to }))
    : [];
  // A side to re-show, but only when every minimal repair blames that one side. Otherwise the
  // honest instruction is "show the sides again", not a guess dressed as a lead.
  const blamed = new Set(decoded.stickers.map((s) => s.face));
  return {
    misreadCount: decoded.distance,
    ...(suspects.length > 0 ? { suspects } : {}),
    ...(blamed.size === 1 ? { misreadFace: [...blamed][0]! } : {}),
  };
}
