// SPIKE — "from any state, reach a named state, ignoring the pieces that do not matter".
//
// Throwaway by intent: its deliverable is the measurement table it prints, which feeds Phase 0 of
// dev-docs/solve-to-state-plan.md. Nothing here is wired to a screen, a worker or the app. If it
// survives into the product unchanged, that is a mistake and not a shortcut.
//
// WHAT IT IS SPIKING, and the distinction that decides the whole design:
//
//   * A target that is ONE state needs no new machinery at all. The maneuver taking cube A to cube
//     B is A⁻¹B, so "go from A to B" is "solve the state B⁻¹A" and the app's existing two-phase
//     solver answers it in <= 20 moves today. `pointRoute()` below does exactly that, in four
//     lines, and asserts it lands on B.
//   * A target that is a SET — a pattern where some pieces are free — is the thing that needs this
//     work. The payoff is that the answer is shorter, because there are more places to land. How
//     much shorter is the first thing this spike measures.
//
// The six-sided cross (六面十字花, every face showing a plus of its own colour) is the interesting
// case the owner named, and it is a SET: all twelve edges home and oriented, all eight corners
// free. Its reachable goal set is 8!/2 x 3^7 = 44,089,920 cubes — the halving is the
// permutation-parity constraint, since solved edges are an even permutation, so the corners must be
// even too. That is why it belongs in the same mechanism as the stages rather than beside it.
//
// THE ARCHITECTURAL FINDING THIS SPIKE EXISTS TO CHECK: if a target's predicate is DEFINED as a
// conjunction of "this projection is at one of its goal codes", then the target is exactly the
// preimage of the projected goal BY CONSTRUCTION, for free, for every target. §2 of the plan treats
// that as a per-target obligation to be tested. Defining targets this way makes it unwritable
// instead. The predicate test also collapses to a handful of integer comparisons, so the search
// never needs to carry a full cube.

import { MOVES, MOVE_NAMES, SOLVED, applyAlg, applyMove, movesOf } from '../lib/cube-pieces.js';
import * as tp from '../lib/two-phase.js';
import { createSolver } from '../lib/solver-engine.js';

// ---- the projections, as data ------------------------------------------------------------------
//
// Four tracked pieces, each one cell. An edge cell is slot*2 + flip (24 of them); a corner cell is
// slot*3 + twist (24 of them). Derived from cube-pieces.js's own move tables, never typed, the way
// crates/optimal-solver/src/f2l.rs derives its `Step`.

const N = MOVE_NAMES.length;

const inverse = (perm, n) => {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[perm[i]] = i;
  return out;
};

const EDGE_STEP = MOVE_NAMES.map((m) => {
  const to = inverse(MOVES[m].ep, 12);
  const t = new Uint8Array(24);
  for (let s = 0; s < 12; s++) {
    for (let f = 0; f < 2; f++) t[s * 2 + f] = to[s] * 2 + ((f + MOVES[m].eo[to[s]]) % 2);
  }
  return t;
});

const CORNER_STEP = MOVE_NAMES.map((m) => {
  const to = inverse(MOVES[m].cp, 8);
  const t = new Uint8Array(24);
  for (let s = 0; s < 8; s++) {
    for (let w = 0; w < 3; w++) t[s * 3 + w] = to[s] * 3 + ((w + MOVES[m].co[to[s]]) % 3);
  }
  return t;
});

/**
 * Corner SLOT only, no twist: eight cells rather than twenty-four.
 *
 * This exists because of a measurement, not for tidiness. `corners-home` asks only that each top
 * corner be in its own slot, twist free. Tracking the twist anyway expresses the same target, but it
 * turns ONE projected goal into 81 of them — and an oracle that has to breadth-first search backwards
 * from a goal SET pays for every member. Measured: the radius-5 ball around those 81 tuples blew past
 * JavaScript's 16,777,216-entry Map limit, where the slot-only version's is a single seed.
 *
 * The heuristic is identical either way, which is what makes this free. The distance to "own slot,
 * any twist" in the slot-and-twist projection IS the distance to "own slot" in the slot-only one,
 * because the goal admits whatever twist the path happens to produce. So the twist was pure noise
 * multiplying the goal set by 81 and the table by 81.
 *
 * The general rule, worth carrying into the production module: **never track an attribute the target
 * does not constrain.** It cannot sharpen the bound and it multiplies the goal set.
 */
const CORNER_SLOT_STEP = MOVE_NAMES.map((m) => {
  const to = inverse(MOVES[m].cp, 8);
  const t = new Uint8Array(8);
  for (let s = 0; s < 8; s++) t[s] = to[s];
  return t;
});

const CELLS = 24;
const CODES = CELLS ** 4;
const pack = (a, b, c, d) => ((a * CELLS + b) * CELLS + c) * CELLS + d;

/**
 * One projection: four tracked cubies, a per-move cell table, and a distance table BFS'd from a
 * goal SET. The goal being a set rather than a point is what lets the same projection serve
 * "corners in their own slots, any twist" and "corners solved" as two different targets.
 */
function projection({ id, kind, cubies, goals }) {
  const step = kind === 'edge' ? EDGE_STEP : kind === 'corner' ? CORNER_STEP : CORNER_SLOT_STEP;
  const span = kind === 'edge' ? 2 : kind === 'corner' ? 3 : 1;
  const width = kind === 'edge' ? 12 : 8;

  const codeOf = (state) => {
    const where = kind === 'edge' ? state.ep : state.cp;
    const turn = kind === 'edge' ? state.eo : state.co;
    // span 1 means the orientation is not tracked, so it must not be ADDED either: `slot * 1 +
    // twist` would silently fold a twist into the next slot's cell and the projection would stop
    // stepping with the cube. Caught by solve-to-state.test.mjs's first assertion, which is the one
    // every other claim here rests on.
    const cell = (cubie) => {
      const slot = where.indexOf(cubie);
      return span === 1 ? slot : slot * span + turn[slot];
    };
    return pack(cell(cubies[0]), cell(cubies[1]), cell(cubies[2]), cell(cubies[3]));
  };

  const goalCodes = new Set(goals.map(([a, b, c, d]) => pack(a, b, c, d)));

  const dist = new Uint8Array(CODES).fill(255);
  let frontier = [];
  for (const g of goalCodes) { dist[g] = 0; frontier.push(g); }
  let depth = 0, reachable = frontier.length;
  const layers = [frontier.length];
  while (frontier.length) {
    const next = [];
    for (const code of frontier) {
      let r = code;
      const a = new Array(4);
      for (let i = 3; i >= 0; i--) { a[i] = r % CELLS; r = (r - a[i]) / CELLS; }
      for (let m = 0; m < N; m++) {
        const s = step[m];
        const nc = pack(s[a[0]], s[a[1]], s[a[2]], s[a[3]]);
        if (dist[nc] === 255) { dist[nc] = depth + 1; next.push(nc); reachable++; }
      }
    }
    depth++;
    if (next.length) layers.push(next.length);
    frontier = next;
  }

  // Cell-level move table for the search, which steps codes and never cubes.
  const stepCode = (code, m) => {
    let r = code;
    const a = new Array(4);
    for (let i = 3; i >= 0; i--) { a[i] = r % CELLS; r = (r - a[i]) / CELLS; }
    const s = step[m];
    return pack(s[a[0]], s[a[1]], s[a[2]], s[a[3]]);
  };

  return { id, kind, cubies, width, codeOf, stepCode, dist, goalCodes,
    reachable, diameter: depth - 1, layers, bytes: CODES };
}

/** Every tracked edge or corner home and correctly turned: cells are slot*span + 0. */
const homeGoal = (kind, cubies) => [cubies.map((c) => c * (kind === 'edge' ? 2 : 3))];

/** Four corners each in their own slot, twist not tracked: one goal code. See CORNER_SLOT_STEP. */
const ownSlot = (cubies) => [cubies.slice()];

// ---- the flip coordinate, which cannot be done four edges at a time ----------------------------
//
// A move's effect on a slot's flip depends on which slot fed it, so the flips of four chosen edges
// are not closed under the move set. All twelve are. This is two-phase's FLIP coordinate.

function flipProjection() {
  const codeOf = (s) => { let c = 0; for (let i = 0; i < 12; i++) c |= s.eo[i] << i; return c; };
  const stepCode = (code, m) => {
    let nc = 0;
    for (let i = 0; i < 12; i++) nc |= (((code >> MOVES[MOVE_NAMES[m]].ep[i]) & 1) ^ MOVES[MOVE_NAMES[m]].eo[i]) << i;
    return nc;
  };
  const dist = new Uint8Array(4096).fill(255);
  dist[0] = 0;
  let frontier = [0], depth = 0, reachable = 1;
  const layers = [1];
  while (frontier.length) {
    const next = [];
    for (const code of frontier) {
      for (let m = 0; m < N; m++) {
        const nc = stepCode(code, m);
        if (dist[nc] === 255) { dist[nc] = depth + 1; next.push(nc); reachable++; }
      }
    }
    depth++;
    if (next.length) layers.push(next.length);
    frontier = next;
  }
  return { id: 'flip', codeOf, stepCode, dist, goalCodes: new Set([0]),
    reachable, diameter: depth - 1, layers, bytes: 4096 };
}

// ---- the projections this spike builds ---------------------------------------------------------

const CROSS_E = [4, 5, 6, 7];      // DR DF DL DB
const MID_E = [8, 9, 10, 11];      // FR FL BL BR
const TOP_E = [0, 1, 2, 3];        // UR UF UL UB
const D_C = [4, 5, 6, 7];          // DFR DLF DBL DRB
const U_C = [0, 1, 2, 3];          // URF UFL ULB UBR

const t0 = Date.now();
const P = {
  crossEdges: projection({ id: 'crossEdges', kind: 'edge', cubies: CROSS_E, goals: homeGoal('edge', CROSS_E) }),
  midEdges: projection({ id: 'midEdges', kind: 'edge', cubies: MID_E, goals: homeGoal('edge', MID_E) }),
  topEdges: projection({ id: 'topEdges', kind: 'edge', cubies: TOP_E, goals: homeGoal('edge', TOP_E) }),
  dCorners: projection({ id: 'dCorners', kind: 'corner', cubies: D_C, goals: homeGoal('corner', D_C) }),
  uCorners: projection({ id: 'uCorners', kind: 'corner', cubies: U_C, goals: homeGoal('corner', U_C) }),
  uCornerSlots: projection({ id: 'uCornerSlots', kind: 'cornerSlot', cubies: U_C, goals: ownSlot(U_C) }),
  flip: flipProjection(),
};
const BUILD_MS = Date.now() - t0;

// ---- a target is a conjunction of projection goals ---------------------------------------------
//
// Defined this way, the predicate and the heuristic read the SAME projections, so "the target is
// exactly the preimage of the projected goal" is true by construction rather than by a test. A
// target cannot acquire a clause its projections cannot see, because a clause IS a projection.

const TARGETS = [
  { id: 'cross', name: 'cross', parts: ['crossEdges'] },
  { id: 'first-layer', name: 'first layer', parts: ['crossEdges', 'dCorners'] },
  { id: 'two-layers', name: 'two bottom layers', parts: ['crossEdges', 'dCorners', 'midEdges'] },
  { id: 'top-cross', name: 'top cross', parts: ['crossEdges', 'dCorners', 'midEdges', 'flip'] },
  { id: 'corners-home', name: 'top corners home', parts: ['crossEdges', 'dCorners', 'midEdges', 'flip', 'uCornerSlots'] },
  // The owner's example. Every edge home and oriented, every corner free.
  { id: 'six-cross', name: 'six-sided cross 六面十字花', parts: ['crossEdges', 'midEdges', 'topEdges'] },
  // The control, and the answer to "can solved be one of these?" — yes, with the U-corner table.
  { id: 'solved', name: 'solved', parts: ['crossEdges', 'midEdges', 'topEdges', 'dCorners', 'uCorners'] },
];

/** The projected codes a target reads, and whether they are all at a goal. */
const codesFor = (target, state) => target.parts.map((p) => P[p].codeOf(state));
const atGoal = (target, codes) => target.parts.every((p, i) => P[p].goalCodes.has(codes[i]));
const heuristic = (target, codes) => {
  let h = 0;
  for (let i = 0; i < target.parts.length; i++) {
    const d = P[target.parts[i]].dist[codes[i]];
    if (d > h) h = d;
  }
  return h;
};

// ---- IDA* over the projected codes only --------------------------------------------------------
//
// The search never carries a cube. Every node is the target's own list of projection codes, which
// is between one and five integers, and the goal test is integer equality against a goal set.

const AXIS = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
const FACE = MOVE_NAMES.map((m) => m[0]);

function searchExact(target, state, { maxDepth = 14, nodeBudget = 4_000_000 } = {}) {
  const start = codesFor(target, state);
  if (atGoal(target, start)) return { alg: '', moves: 0, nodes: 0, exact: true };
  let nodes = 0;
  const path = [];

  const descend = (codes, g, bound, lastFace, lastAxis) => {
    const h = heuristic(target, codes);
    if (g + h > bound) return false;
    if (atGoal(target, codes)) return true;
    if (nodes >= nodeBudget) return null;
    for (let m = 0; m < N; m++) {
      const face = FACE[m];
      if (face === lastFace) continue;                       // never twice on one face
      if (AXIS[face] === lastAxis && face < lastFace) continue; // one order for commuting faces
      nodes++;
      const next = target.parts.map((p, i) => P[p].stepCode(codes[i], m));
      path.push(MOVE_NAMES[m]);
      const got = descend(next, g + 1, bound, face, AXIS[face]);
      if (got === true) return true;
      if (got === null) return null;
      path.pop();
    }
    return false;
  };

  for (let bound = heuristic(target, start); bound <= maxDepth; bound++) {
    path.length = 0;
    const got = descend(start, 0, bound, '', -1);
    if (got === true) return { alg: path.join(' '), moves: path.length, nodes, exact: true };
    if (got === null) return { alg: null, moves: null, nodes, exact: false, why: 'budget' };
  }
  return { alg: null, moves: null, nodes, exact: false, why: `no answer within ${maxDepth}` };
}

// ---- the point route: no new machinery at all --------------------------------------------------

const invertState = (s) => {
  const cp = new Array(8), co = new Array(8), ep = new Array(12), eo = new Array(12);
  for (let i = 0; i < 8; i++) { cp[s.cp[i]] = i; co[s.cp[i]] = (3 - s.co[i]) % 3; }
  for (let i = 0; i < 12; i++) { ep[s.ep[i]] = i; eo[s.ep[i]] = s.eo[i]; }
  return { cp, co, ep, eo };
};
const composeStates = (a, b) => applyStateAfter(a, b);
function applyStateAfter(a, b) {
  const cp = new Array(8), co = new Array(8), ep = new Array(12), eo = new Array(12);
  for (let i = 0; i < 8; i++) { cp[i] = a.cp[b.cp[i]]; co[i] = (a.co[b.cp[i]] + b.co[i]) % 3; }
  for (let i = 0; i < 12; i++) { ep[i] = a.ep[b.ep[i]]; eo[i] = (a.eo[b.ep[i]] + b.eo[i]) % 2; }
  return { cp, co, ep, eo };
}

tp.initialize();
const solve = createSolver(tp);

/**
 * The maneuver from A to the single state B: solve B⁻¹A, and the answer is A⁻¹B.
 *
 * This is the whole of "go from any state to any ONE state", and it is four lines because the
 * existing solver already does it. Asserted rather than argued: the returned alg is applied to A
 * and the result must equal B.
 */
function pointRoute(A, B, bounds = { solLen: 21, probeMax: 50_000_000 }) {
  const alg = solve(tp.toFacelets(composeStates(invertState(B), A)), bounds);
  if (typeof alg !== 'string') return { alg: null, moves: null };
  const landed = applyAlg(A, alg);
  const same = ['cp', 'co', 'ep', 'eo'].every((k) => landed[k].every((v, i) => v === B[k][i]));
  if (!same) throw new Error('pointRoute: the alg did not land on B — the composition is wrong');
  return { alg, moves: movesOf(alg).length };
}

// ---- the corpus --------------------------------------------------------------------------------

const randomMoves = (k) => Array.from({ length: k }, () => MOVE_NAMES[Math.floor(Math.random() * N)]).join(' ');

function corpus() {
  const out = [];
  for (let k = 1; k <= 10; k++) {
    for (let rep = 0; rep < 3; rep++) out.push({ label: `${k} random turns`, k, state: applyAlg(SOLVED, randomMoves(k)) });
  }
  for (let rep = 0; rep < 3; rep++) out.push({ label: 'random 25 turns', k: 25, state: applyAlg(SOLVED, randomMoves(25)) });
  return out;
}

// Exported so an oracle script can grade this without the report running on import. A spike whose
// answers nothing else can check is a demo, not a measurement.
export { P, TARGETS, searchExact, codesFor, atGoal, heuristic, pointRoute, corpus, BUILD_MS };

// ---- run ---------------------------------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

const RUN_DIRECTLY = Boolean(process.argv[1]?.endsWith('solve-to-state-spike.mjs'));
if (!RUN_DIRECTLY) {
  // Imported for grading. The tables are built (that is the import's whole point); the report is not.
} else {

console.log('=== the projections =========================================================');
console.log(`${pad('id', 16)} ${num('goals', 6)} ${num('reachable', 10)} ${num('diam', 5)}  layers`);
let bytes = 0;
for (const p of Object.values(P)) {
  bytes += p.bytes;
  console.log(`${pad(p.id, 16)} ${num(p.goalCodes.size, 6)} ${num(p.reachable, 10)} ${num(p.diameter, 5)}  ${p.layers.join(' ')}`);
}
console.log(`\nseven tables: ${bytes} bytes = ${(bytes / 1024 / 1024).toFixed(3)} MiB, built in ${BUILD_MS} ms`);

console.log('\n=== set versus point, per target ============================================');
console.log('"set" = the shortest route into the target, proved. "point" = the existing solver');
console.log('taking the cube to one chosen member of it. The gap is what ignoring free pieces buys.\n');
console.log(`${pad('target', 26)} ${pad('case', 17)} ${num('set', 4)} ${num('point', 6)} ${num('saved', 6)} ${num('nodes', 11)} ${num('ms', 7)}`);

const cases = corpus();
const summary = new Map();
for (const target of TARGETS) {
  const saved = [];
  for (const c of cases) {
    const t = Date.now();
    const got = searchExact(target, c.state);
    const ms = Date.now() - t;
    // The runtime replay of plan §9a: a route is only believed if applying it reaches the target.
    if (got.alg !== null) {
      const landed = applyAlg(c.state, got.alg);
      if (!atGoal(target, codesFor(target, landed))) {
        throw new Error(`${target.id}: returned a route that does not reach the target`);
      }
    }
    const point = pointRoute(c.state, SOLVED);
    const gap = got.moves === null ? null : point.moves - got.moves;
    if (gap !== null) saved.push(gap);
    console.log(`${pad(target.name, 26)} ${pad(c.label, 17)} ${num(got.moves ?? `-(${got.why})`, 4)} ${num(point.moves ?? '-', 6)} ${num(gap ?? '-', 6)} ${num(got.nodes, 11)} ${num(ms, 7)}`);
  }
  summary.set(target.id, saved);
}

console.log('\n=== what ignoring the free pieces bought ====================================');
console.log('CAVEAT, and it matters: the "point" column is the raw engine at solLen 21 with no');
console.log('refinement pass, so it answers a 3-move cube with 10. The app ships `refine`, which');
console.log('shortens. These savings are therefore an OVERSTATEMENT and must be re-measured');
console.log('through solveWithinGodsNumber before any of them is quoted.\n');
for (const target of TARGETS) {
  const s = summary.get(target.id);
  const answered = s.length;
  const mean = answered ? (s.reduce((a, b) => a + b, 0) / answered).toFixed(1) : '-';
  console.log(`${pad(target.name, 26)} answered ${num(answered, 2)}/${cases.length}  mean moves saved ${num(mean, 6)}`);
}

}
