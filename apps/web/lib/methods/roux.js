// Roux: the left block, the right block, the top corners, the last six edges (dev-docs/solve-methods-plan.md
// Phase 8; ADR 0012).
//
// No cross and no layers. The first block is a 1x2x3 on the left, built with any face turn; the second is its
// twin on the right, built with R, U and the middle slice M, which leave the first alone; CMLL solves the four
// top corners in one look, keeping both blocks; and the last six edges are finished with M and U alone.
//
// EVERY STAGE BOUNDARY IS UPRIGHT WITH THE CENTRES LINED UP — the second block ends by lining the slice up,
// CMLL turns no slice net, the last edges end solved — and the driver checks it (`solveByMethod`, lib/
// method-solver.js). There the block frame the searches use (lib/methods/roux-tables.js) and the app's piece
// model are the same state, so a stage reads the cube as held, searches, and emits the child's letters; the
// driver replays them through the interpreter, and a stage whose letters do not reach what it returned is
// refused at the seam. INSIDE a stage the slice moves the hold: after `M` the centre on top is another one
// though the child's hands have not moved. So a step after the first in a stage may begin tilted, and the
// pieces it names are named as seen in THAT hold (`heldEdges`) — the lesson reads them back through the hold
// the driver records (`convertSelectors`, lib/cube-subject.js), so a tilted step points at the same pieces.

import { CORNER, EDGE, EDGES, SOLVED } from '../cube-pieces.js';
import { heldFace, run } from '../cube-moves.js';
import { CMLL_ALGS } from '../data/cmll-algs.js';
import { AUF, MethodSolverError, fromRepertoire, repertoire, wholeCubeSolved } from './engine.js';
import {
  FIRST_BLOCK_TABLE, LSE_MOVES, LSE_SOLVED, SECOND_BLOCK_TABLE, TOP_TURNS, sidesHome,
} from './roux-build.js';
import { blocksAndCornersBuilt, bothBlocksBuilt, firstBlockBuilt } from './roux-blocks.js';
import { rouxTables } from './roux-load.js';
import {
  FIRST_BLOCK, SECOND_BLOCK, applyBlockMove, descend, edgesOriented, keepsOrientation, lseCodeOf, lseDecode,
  lseStep, packedAt,
} from './roux-tables.js';


const TOP_CORNERS = Object.freeze([CORNER.URF, CORNER.UFL, CORNER.ULB, CORNER.UBR]);

const UPRIGHT = Object.freeze(['U', 'F']);
const SLICE_EDGES = Object.freeze([EDGE.UF, EDGE.UB, EDGE.DF, EDGE.DB]);
const LSE_EDGES = Object.freeze([EDGE.UR, EDGE.UF, EDGE.UL, EDGE.UB, EDGE.DF, EDGE.DB]);
const EDGE_BY_LETTERS = new Map(EDGES.map((name, i) => [[...name].sort().join(''), i]));

/** Edges, by the cube's own index, as a child holding it `hold` names them: each letter the position its face
 *  is at. The inverse of what the lesson does with them (`convertSelectors`), held to it by test. */
const heldEdges = (edges, hold) => edges.map((e) => EDGE_BY_LETTERS.get([...EDGES[e]].map((f) => heldFace(f, hold)).sort().join('')));

/** The hold `alg` leaves a cube held `hold` in — the interpreter's, never worked out here. */
const holdAfter = (alg, hold) => (alg ? run(alg, hold, SOLVED).hold : hold);

const firstBlock = firstBlockBuilt;
const bothBlocks = bothBlocksBuilt;
const blocksAndCorners = blocksAndCornersBuilt;

/** A shipped table's reader for `descend`. */
const shippedReader = (packed) => ({ value: (code) => packedAt(packed, code), mod: 3, unreached: 3 });
/** An exact table's — the two built on load. */
const exactReader = (bytes) => ({ value: (code) => bytes[code], mod: 256, unreached: 0xff });

/** A route of move indices as the child's letters, and the cube after it in the block frame, with how far the
 *  route turned the slice. */
function played(state, moves, route) {
  let s = state;
  let slice = 0;
  for (const m of route) { s = applyBlockMove(s, moves[m]); slice += moves[m].slice; }
  return { state: s, alg: route.map((m) => moves[m].name).join(' '), slice: slice % 4 };
}

// ---- the first block ------------------------------------------------------------------------------------

function buildFirstBlock(view, steps) {
  const table = FIRST_BLOCK_TABLE;
  const goal = table.codeOf(SOLVED);
  const route = descend(table.codeOf(view), {
    ...shippedReader(rouxTables()['first-block']), moveCount: table.moves.length, step: table.step, atGoal: (c) => c === goal,
  });
  const done = played(view, table.moves, route);
  if (done.alg) {
    steps.push({ stage: 'first-block', kind: 'goal', target: 'first-block', alg: done.alg,
      why: { key: 'firstBlock.build', moves: route.length, edges: [...FIRST_BLOCK.edges], corners: [...FIRST_BLOCK.corners] } });
  }
  if (!firstBlock(done.state)) throw new MethodSolverError('first-block', 'block', view);
  return done.state;
}


// ---- the second block -------------------------------------------------------------------------------------

/** The slice turn that lines the centres back up after `k` quarter turns of it. */
const ALIGN = Object.freeze([null, "M'", 'M2', 'M']);

function buildSecondBlock(view, steps) {
  const table = SECOND_BLOCK_TABLE;
  const code = table.codeOf(view);
  if (code < 0) throw new MethodSolverError('second-block', 'reach', view);
  const goal = table.codeOf(SOLVED);
  const route = descend(code, {
    ...shippedReader(rouxTables()['second-block']), moveCount: table.moves.length, step: table.step, atGoal: (c) => c === goal,
  });
  const built = played(view, table.moves, route);
  if (built.alg) {
    steps.push({ stage: 'second-block', kind: 'goal', target: 'second-block', alg: built.alg,
      why: { key: 'secondBlock.build', moves: route.length, edges: [...SECOND_BLOCK.edges], corners: [...SECOND_BLOCK.corners] } });
  }
  let state = built.state;
  const fix = ALIGN[built.slice];
  if (fix) {
    const move = table.moves.find((m) => m.name === fix);
    state = applyBlockMove(state, move);
    // Begun in whatever hold the block left, tilted by the slice: its pieces — the slice's four edges, which
    // carry the centres round — are named in that hold.
    steps.push({ stage: 'second-block', kind: 'goal', target: 'centres', alg: fix,
      why: { key: 'secondBlock.align', edges: heldEdges(SLICE_EDGES, holdAfter(built.alg, UPRIGHT)) } });
  }
  if (!bothBlocks(state)) throw new MethodSolverError('second-block', 'blocks', view);
  return state;
}

// ---- the top corners ------------------------------------------------------------------------------------

/** One look, either side of a turn of the top: each row as the source wrote it, never relabelled — several
 *  carry wide turns, which `repertoire` refuses to turn into another rotation. Built once. */
const CMLL_REPERTOIRE = Object.freeze(repertoire(CMLL_ALGS, { rotations: [0], post: AUF }));
const TOP_ALIGN = Object.freeze(['U', 'U2', "U'"]);

function solveCorners(view, steps) {
  if (blocksAndCorners(view)) return view;
  const turn = TOP_ALIGN.find((alg) => blocksAndCorners(applyTop(view, alg)));
  if (turn) {
    steps.push({ stage: 'cmll', kind: 'goal', target: 'corners', alg: turn, why: { key: 'cmll.align', corners: [...TOP_CORNERS] } });
    return applyTop(view, turn);
  }
  const found = fromRepertoire(view, CMLL_REPERTOIRE, blocksAndCorners);
  if (!found) throw new MethodSolverError('cmll', 'corners', view);
  steps.push({ stage: 'cmll', kind: 'case', target: 'corners', alg: found.alg, caseName: found.used[0].name,
    why: { key: 'cmll.solve', corners: [...TOP_CORNERS] } });
  return found.state;
}

const applyTop = (state, alg) => played(state, LSE_MOVES, [LSE_MOVES.findIndex((m) => m.name === alg)]).state;

// ---- the last six edges ---------------------------------------------------------------------------------

const lseRun = (code, m) => lseStep(code, LSE_MOVES[m]);
const keeping = (code, m) => keepsOrientation(LSE_MOVES[m], lseDecode(code).k);

/** The three steps every Roux solver learns, each the shortest to its own goal from where the last left it:
 *  orient the six edges, bring the left and right top edges home, finish the middle. */
const LSE_STEPS = Object.freeze([
  Object.freeze({ key: 'lse.orient', edges: LSE_EDGES, table: (t) => shippedReader(t['lse-orient']), allowed: undefined, atGoal: (c) => edgesOriented(lseDecode(c)) }),
  Object.freeze({ key: 'lse.sides', edges: Object.freeze([EDGE.UL, EDGE.UR]), table: (t) => exactReader(t.sides), allowed: keeping, atGoal: sidesHome }),
  Object.freeze({ key: 'lse.finish', edges: SLICE_EDGES, table: (t) => exactReader(t.finish), allowed: keeping, atGoal: (c) => c === LSE_SOLVED }),
]);

function finishEdges(view, steps) {
  let code = lseCodeOf(view, 0, TOP_TURNS);
  if (code < 0) throw new MethodSolverError('lse', 'reach', view);
  const tables = rouxTables();
  let state = view;
  let hold = UPRIGHT;
  for (const part of LSE_STEPS) {
    const route = descend(code, { ...part.table(tables), moveCount: LSE_MOVES.length, step: lseRun, allowed: part.allowed, atGoal: part.atGoal });
    if (route.length === 0) continue;
    const done = played(state, LSE_MOVES, route);
    for (const m of route) code = lseRun(code, m);
    state = done.state;
    // After the first, a step may begin with the slice turned, and so the hold tilted: its pieces are named in
    // the hold it begins in.
    steps.push({ stage: 'lse', kind: 'goal', target: part.key, alg: done.alg, why: { key: part.key, moves: route.length, edges: heldEdges(part.edges, hold) } });
    hold = holdAfter(done.alg, hold);
  }
  if (!wholeCubeSolved(state)) throw new MethodSolverError('lse', 'solved', view);
  return state;
}

// ---- the stages, as the driver takes them -----------------------------------------------------------------

const stage = (fields) => Object.freeze({ rung: 0, ...fields });

export const ROUX_STAGES = Object.freeze([
  stage({
    id: 'first-block', label: 'first block', blurb: 'A 1x2x3 block on the left, built in the fewest turns there are',
    targets: Object.freeze({ edges: FIRST_BLOCK.edges, corners: FIRST_BLOCK.corners }),
    keep: () => true, contract: firstBlock, why: 'stage.first-block', run: buildFirstBlock,
  }),
  stage({
    id: 'second-block', label: 'second block', blurb: 'Its twin on the right, with R, U and the middle slice, then the centres lined up',
    targets: Object.freeze({ edges: SECOND_BLOCK.edges, corners: SECOND_BLOCK.corners }),
    keep: firstBlock, contract: bothBlocks, why: 'stage.second-block', run: buildSecondBlock,
  }),
  stage({
    id: 'cmll', label: 'CMLL', blurb: 'The four top corners in one look, keeping both blocks',
    targets: Object.freeze({ edges: Object.freeze([]), corners: TOP_CORNERS }),
    keep: bothBlocks, contract: blocksAndCorners, why: 'stage.cmll', run: solveCorners,
  }),
  stage({
    id: 'lse', label: 'last six edges', blurb: 'The six edges left, with M and U: orient them, the two sides, then the middle',
    targets: Object.freeze({ edges: Object.freeze([EDGE.UR, EDGE.UF, EDGE.UL, EDGE.UB, EDGE.DF, EDGE.DB]), corners: Object.freeze([]) }),
    keep: blocksAndCorners, contract: wholeCubeSolved, why: 'stage.lse', run: finishEdges,
  }),
]);

/** The Roux method as the driver takes it: its stages, and the hold rule its entry declares. */
export const ROUX_METHOD = Object.freeze({
  id: 'roux', lastLayer: null, rungs: null, stages: ROUX_STAGES,
});
