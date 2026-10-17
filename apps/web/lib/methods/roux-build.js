// Roux's tables as DEFINITIONS: each one's coordinate, moves and goal, and the build that makes it.
//
// The four the device would spend seconds on are built by `regen-roux-tables.mjs` and shipped
// (lib/data/roux/); the two over the 5,760 oriented positions of the last six edges are built here when the
// method is first prepared, in milliseconds. One definition serves both, so the shipped tables and the ones
// a stage descends cannot be about different things.

import { SOLVED, applyAlg } from '../cube-pieces.js';
import {
  FACE_TURNS, FIRST_BLOCK, LSE_SIZE, LSE_SLOTS, MU_TURNS, RUM_TURNS, SECOND_BLOCK, blockCoordinate, blockMoves,
  buildDistances, edgesOriented, fnv1a, keepsOrientation, lseDecode, lseEncode, lseMoves, lseStep, pack,
} from './roux-tables.js';

const ALL_EDGES = [...Array(12).keys()];
const ALL_CORNERS = [...Array(8).keys()];

/** The first block over every face turn: any slot, so all 5,322,240 positions. */
export const FIRST_BLOCK_TABLE = blockCoordinate({
  ...FIRST_BLOCK, edgeSlots: ALL_EDGES, cornerSlots: ALL_CORNERS, moves: blockMoves(FACE_TURNS),
});

/** The second block over R, U and M, with the first block built: the nine edge slots and six corner slots
 *  those moves reach, so 1,088,640 positions. */
export const SECOND_BLOCK_TABLE = blockCoordinate({
  ...SECOND_BLOCK,
  edgeSlots: [0, 1, 2, 3, 4, 5, 7, 8, 11],
  cornerSlots: [0, 1, 2, 3, 4, 7],
  moves: blockMoves(RUM_TURNS),
});

/** The last six edges' moves, in the block frame. */
export const LSE_MOVES = lseMoves(blockMoves(MU_TURNS));

/** Solved, as a last-six-edges code: every edge home, nothing flipped, the slice and the top straight. */
export const LSE_SOLVED = lseEncode({ perm: [0, 1, 2, 3, 4, 5], flips: 0, k: 0, u: 0 });

/** Where the left and right top edges stand when the third step is done: each home, the top straight. */
const UL_AT = LSE_SLOTS.indexOf(2);
const UR_AT = LSE_SLOTS.indexOf(0);

/** The last six edges with the edges oriented, the two side edges home and the top straight — 4b's end. */
export const sidesHome = (code) => {
  const d = lseDecode(code);
  return edgesOriented(d) && d.u === 0 && d.perm[UL_AT] === UL_AT && d.perm[UR_AT] === UR_AT;
};

const lseStepIndex = (code, m) => lseStep(code, LSE_MOVES[m]);
const keeping = (code, m) => keepsOrientation(LSE_MOVES[m], lseDecode(code).k);

/** Every reachable last-six-edges code, from solved over every M and U turn. */
function lseReachable() {
  const dist = buildDistances(LSE_SIZE, [LSE_SOLVED], LSE_MOVES.length, lseStepIndex);
  const out = [];
  for (let c = 0; c < LSE_SIZE; c++) if (dist[c] !== 0xff) out.push(c);
  return out;
}

/** What one table is: its id, how many codes, how to step one, and its goal. */
function shipped(id, size, goals, moveCount, step) {
  const dist = buildDistances(size, goals, moveCount, step);
  let reached = 0;
  let deepest = 0;
  for (let i = 0; i < size; i++) if (dist[i] !== 0xff) { reached++; if (dist[i] > deepest) deepest = dist[i]; }
  const packed = pack(dist);
  return { id, codes: size, reached, deepest, packed, fnv: fnv1a(packed), dist };
}

/** The shipped tables, built from nothing. What `regen-roux-tables.mjs` writes and the test rebuilds. */
export function buildRouxTables() {
  const fb = FIRST_BLOCK_TABLE;
  const sb = SECOND_BLOCK_TABLE;
  const reachable = lseReachable();
  return [
    shipped('first-block', fb.size, [fb.codeOf(SOLVED)], fb.moves.length, fb.step),
    shipped('second-block', sb.size, [sb.codeOf(SOLVED)], sb.moves.length, sb.step),
    // Every reachable oriented position is a goal: the orient step is done the moment the edges are good.
    shipped('lse-orient', LSE_SIZE, reachable.filter((c) => edgesOriented(lseDecode(c))), LSE_MOVES.length, lseStepIndex),
  ];
}

/**
 * The two last-six-edges tables built on load: distances over the oriented positions only, by the moves that
 * keep them oriented, to `sidesHome` (4b) and to solved (4c). Exact bytes, not packed — they are small.
 * Returns `{ sides, finish, oriented }`, `oriented` the number of positions they cover.
 */
export function buildSideTables() {
  const solvedOnly = [LSE_SOLVED];
  const finish = buildDistances(LSE_SIZE, solvedOnly, LSE_MOVES.length, lseStepIndex, keeping);
  const oriented = [];
  for (let c = 0; c < LSE_SIZE; c++) if (finish[c] !== 0xff) oriented.push(c);
  const sides = buildDistances(LSE_SIZE, oriented.filter(sidesHome), LSE_MOVES.length, lseStepIndex, keeping);
  return { sides, finish, oriented: oriented.length };
}

/** The four arrangements of the corners a turn of the top makes from solved, `u` turns each — how a last-six-
 *  edges code reads the top's turn off the corners. */
export const TOP_TURNS = Object.freeze(['', 'U', 'U2', "U'"].map((alg) => Object.freeze(applyAlg(SOLVED, alg))));
