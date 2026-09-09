// The Cross stage, and its two rungs.
//
// The stage's contract is a STATE — the D cross is solved — and not a procedure. That is what
// lets the rungs be swapped freely under it (dev-docs/method-solver-return-plan.md §2): whichever
// rung ran, the next stage begins from the same cube.
//
//   rung 0  edge by edge — lift it to the top, then drop it in. Two steps a piece, ~6 in all.
//   rung 1  planned whole, and OPTIMAL: one step, descending an exact distance table.

import { MOVES, MOVE_NAMES, applyAlg, edgeSlot, edgeSolved } from '../cube-pieces.js';
import {
  CROSS, MethodSolverError, U_EDGES, crossSolved, fromRepertoire, keeping, repertoire, shortestTo,
} from './engine.js';

/** Dropping a cross edge from the top into DF. */
const CROSS_INSERTS = [
  { name: 'drop-in', alg: 'F2' },
  { name: 'flip-in', alg: "U' R' F R" },
];

/** Built once — see `last-layer.js` at `look`. Rebuilding it per edge rebuilt it four times a
 *  solve, and `repertoire` is not cheap: it rotates and AUF-prefixes every entry. */
const CROSS_REPERTOIRE = Object.freeze(repertoire(CROSS_INSERTS));

export const CROSS_ALGS = CROSS_INSERTS;

// ---- rung 0: one edge at a time ---------------------------------------------------------------

function edgeByEdge(state, steps) {
  const placed = [];
  for (const edge of CROSS) {
    const intact = keeping(placed, []);
    if (edgeSolved(state, edge) && intact(state)) { placed.push(edge); continue; }

    // Intuitive half: get it to the top, any way that does not disturb the cross so far.
    // The reason for these moves is their effect, so they are searched rather than looked up.
    const inTop = (s) => U_EDGES.includes(edgeSlot(s, edge)) && intact(s);
    const lift = shortestTo(state, inTop, 4);
    if (lift === null) throw new MethodSolverError('cross', edge, state);
    if (lift) {
      state = applyAlg(state, lift);
      steps.push({ stage: 'cross', kind: 'goal', target: edge, alg: lift,
        why: { key: 'cross.lift', edge } });
    }

    // Algorithmic half: line it up over its home and drop it in.
    const home = (s) => edgeSolved(s, edge) && intact(s);
    const found = fromRepertoire(state, CROSS_REPERTOIRE, home);
    if (!found) throw new MethodSolverError('cross', edge, state);
    state = found.state;
    steps.push({ stage: 'cross', kind: 'case', target: edge, alg: found.alg,
      caseName: found.used[0].name, why: { key: 'cross.insert', edge } });
    placed.push(edge);
  }
  return state;
}

// ---- rung 1: the whole cross, solved exactly --------------------------------------------------
// A beginner places four cross edges one at a time and spends six steps doing it. Someone past
// that stage plans the cross and executes it in one go, so at this rung the cross is ONE step —
// and an optimal one, because the space it lives in is small enough to solve exactly.
//
// Only the four cross edges matter, so the state projects to (slot, flip) for each of them:
// 24^4 = 331,776 codes, of which the reachable ones are BFS'd from solved. No heuristic, no
// tables to tune — the distance to a solved cross is simply known for every position.

const CROSS_CODES = 24 * 24 * 24 * 24;

/** Where each slot's contents end up under a move: `m.ep[t] === s` means slot t takes from s. */
const INVERSE_EP = (() => {
  const table = {};
  for (const name of MOVE_NAMES) {
    const inverse = new Array(12);
    for (let t = 0; t < 12; t++) inverse[MOVES[name].ep[t]] = t;
    table[name] = inverse;
  }
  return table;
})();

/** The four cross edges as (slot, flip) pairs, packed into one integer. */
function crossCode(places) {
  let code = 0;
  for (let i = 0; i < 4; i++) code = code * 24 + places[i * 2] * 2 + places[i * 2 + 1];
  return code;
}

function crossPlaces(state) {
  const places = new Array(8);
  for (let i = 0; i < 4; i++) {
    const slot = state.ep.indexOf(CROSS[i]);
    places[i * 2] = slot;
    places[i * 2 + 1] = state.eo[slot];
  }
  return places;
}

function crossAfter(places, move) {
  const inverse = INVERSE_EP[move];
  const eo = MOVES[move].eo;
  const next = new Array(8);
  for (let i = 0; i < 4; i++) {
    const to = inverse[places[i * 2]];
    next[i * 2] = to;
    next[i * 2 + 1] = (places[i * 2 + 1] + eo[to]) % 2;
  }
  return next;
}

/** Distance to a solved cross for every reachable cross position, built once on first use. */
let crossDistance = null;
export function crossTable() {
  if (crossDistance) return crossDistance;
  const distance = new Uint8Array(CROSS_CODES).fill(0xff);
  const solved = [];
  for (let i = 0; i < 4; i++) { solved[i * 2] = CROSS[i]; solved[i * 2 + 1] = 0; }
  distance[crossCode(solved)] = 0;
  let frontier = [solved];
  for (let depth = 1; frontier.length; depth++) {
    const next = [];
    for (const places of frontier) {
      for (const move of MOVE_NAMES) {
        const after = crossAfter(places, move);
        const code = crossCode(after);
        if (distance[code] !== 0xff) continue;
        distance[code] = depth;
        next.push(after);
      }
    }
    frontier = next;
  }
  crossDistance = distance;
  return distance;
}

/** The whole cross in one alg, shortest there is. Descends the exact distance table, so this
 *  is optimal by construction rather than by search budget. */
export function solveCrossWhole(state) {
  const distance = crossTable();
  let places = crossPlaces(state);
  let remaining = distance[crossCode(places)];
  if (remaining === 0xff) throw new MethodSolverError('cross', 'whole', state);
  const alg = [];
  while (remaining > 0) {
    let stepped = false;
    for (const move of MOVE_NAMES) {
      const after = crossAfter(places, move);
      if (distance[crossCode(after)] !== remaining - 1) continue;
      alg.push(move);
      places = after;
      remaining--;
      stepped = true;
      break;
    }
    // The table is exact, so a position with no descending move cannot exist. If one ever
    // does, the table is wrong and every cross above it was wrong too.
    if (!stepped) throw new MethodSolverError('cross', 'whole', state);
  }
  return alg.join(' ');
}

function wholeCross(state, steps) {
  const alg = solveCrossWhole(state);
  if (alg) {
    state = applyAlg(state, alg);
    steps.push({ stage: 'cross', kind: 'goal', target: 'cross', alg,
      why: { key: 'cross.whole', moves: alg.split(' ').length } });
  }
  if (!crossSolved(state)) throw new MethodSolverError('cross', 'whole', state);
  return state;
}

// ---- the rungs, as data ----------------------------------------------------------------------
// `rung` is here for reporting and for the Lessons ladder. Nothing in the engine reads it — that
// is the property that makes a new rung a new entry in this array rather than an engine change.

/** @type {ReadonlyArray<import('./index.js').Stage>} */
export const CROSS_RUNGS = Object.freeze([
  Object.freeze({
    id: 'cross',
    rung: 0,
    label: 'edge by edge',
    blurb: 'Each cross edge lifted to the top and dropped in, one at a time',
    targets: Object.freeze({ edges: CROSS, corners: Object.freeze([]) }),
    keep: () => true,
    contract: crossSolved,
    why: 'stage.cross',
    run: edgeByEdge,
  }),
  Object.freeze({
    id: 'cross',
    rung: 1,
    label: 'planned whole',
    blurb: 'The whole cross planned as one thing, and solved in the fewest moves there are',
    targets: Object.freeze({ edges: CROSS, corners: Object.freeze([]) }),
    keep: () => true,
    contract: crossSolved,
    why: 'stage.cross',
    run: wholeCross,
  }),
]);
