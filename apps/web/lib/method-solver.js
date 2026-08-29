// A layer-by-layer solver, written for explanation rather than for length.
//
// The two-phase solver (lib/two-phase.js) answers "give me a short way out of here" — a
// compact, bounded answer, not a provable minimum.
// This one answers a different question — "why is this move right" — and the two cannot be the
// same code. A 19-move two-phase solution has no explicable structure: there is no reason move
// seven is R2 beyond "the pruning table said so", and nothing about it transfers to the next
// solve. So this solver is deliberately longer and deliberately staged, because the stages ARE
// the explanation.
//
// The design rule that everything else follows from: **a case table cannot lie here.** Every
// step is produced by proposing candidate algs and keeping only one that provably reaches its
// sub-goal with the already-solved pieces intact. A mistyped algorithm therefore cannot emit a
// wrong step — it can only fail to find one, loudly.
//
// The app used to slice a two-phase solution into CROSS/F2L/OLL/PLL at fixed 16 / 62 / 82 % —
// stage names over an object that has no stages. That was removed, and the move list is now one
// flat grid: honest, and silent. This is what fills that silence without going back to invention.
//
// Two kinds of step, because there are two kinds of "why":
//   'goal'  — an intuitive stage. The reason is what the move ACHIEVES: this brings the piece
//             to the top without disturbing the cross. Found by a shallow search.
//   'case'  — an algorithmic stage. The reason is which case this is and what the whole
//             algorithm does. Per-move reasons do not exist here and pretending otherwise
//             would be inventing them.
//
// Convention: the cross goes on D. Slot index equals cubie index, so `EDGE.DF` is both "the
// DF slot" and "the cubie that belongs there".

import {
  CORNER, CORNERS, EDGE, EDGES, MOVES, MOVE_NAMES, allSolved, applyAlg, applyMove,
  cornerSlot, cornerSolved, edgeSlot, edgeSolved, rotateAlg, rotateState,
} from './cube-pieces.js';

/** U-layer slots. "In the top layer" is the staging area every stage lifts pieces into. */
const U_EDGES = [EDGE.UR, EDGE.UF, EDGE.UL, EDGE.UB];
const U_CORNERS = [CORNER.URF, CORNER.UFL, CORNER.ULB, CORNER.UBR];

/** The cross edges and first-layer corners, in the order they are placed. */
const CROSS = [EDGE.DF, EDGE.DR, EDGE.DB, EDGE.DL];
const F1L = [CORNER.DFR, CORNER.DRB, CORNER.DBL, CORNER.DLF];
const MIDDLE = [EDGE.FR, EDGE.BR, EDGE.BL, EDGE.FL];

// The whole-cube turn lives in cube-pieces.js: relabelling an algorithm and rotating a state
// are two halves of the same thing, and separating them is how the flip convention got missed.

/** The four U turns, as the "line it up" prefix every algorithmic step may need. */
const AUF = ['', 'U', 'U2', "U'"];

const joinAlg = (...parts) => parts.filter(Boolean).join(' ').trim();

/**
 * Merge consecutive turns of the same face.
 *
 * Steps are built by stringing triggers together, and where two of them meet the seam shows:
 * `R U R'` then `R U' R'` really means `R U R2 U' R'`, and `L L` is not a move anybody
 * makes. Only adjacent faces are merged — reordering commuting turns would shorten it further
 * but would also stop the alg being the thing the step said it was doing.
 */
function simplify(alg) {
  const runs = [];
  for (const move of String(alg).trim().split(/\s+/).filter(Boolean)) {
    const face = move[0];
    const turns = move.endsWith('2') ? 2 : move.endsWith("'") ? 3 : 1;
    const last = runs[runs.length - 1];
    if (last && last.face === face) {
      last.turns = (last.turns + turns) % 4;
      if (last.turns === 0) runs.pop();
    } else {
      runs.push({ face, turns });
    }
  }
  return runs.map(({ face, turns }) => face + (turns === 1 ? '' : turns === 2 ? '2' : "'")).join(' ');
}
const algLength = (alg) => (alg.trim() ? alg.trim().split(/\s+/).length : 0);

/**
 * Shortest sequence of face turns, up to `maxDepth`, after which `goal` holds.
 *
 * Used only for the intuitive stages, where the honest reason for a move is what it achieves
 * rather than which case it is. Iterative deepening, so the answer is the shortest one; no two
 * consecutive turns of the same face, since those are always expressible as one.
 *
 * Returns null rather than throwing: the caller knows what it was looking for and can say so.
 */
function shortestTo(state, goal, maxDepth) {
  if (goal(state)) return '';
  for (let depth = 1; depth <= maxDepth; depth++) {
    const found = descend(state, goal, depth, '');
    if (found !== null) return found;
  }
  return null;
}

function descend(state, goal, depth, lastFace) {
  for (const move of MOVE_NAMES) {
    const face = move[0];
    if (face === lastFace) continue;
    const next = applyMove(state, move);
    if (depth === 1) {
      if (goal(next)) return move;
      continue;
    }
    const rest = descend(next, goal, depth - 1, face);
    if (rest !== null) return joinAlg(move, rest);
  }
  return null;
}

/**
 * The first candidate alg that reaches `goal`, searched breadth-first over the repertoire.
 *
 * `plies` lets a stage say "two algorithms from this list, if one will not do" — which is what
 * two-look OLL and two-look PLL actually are. The search is over NAMED algorithms rather than
 * over raw moves, so whatever it finds is still a sequence of things a learner was taught.
 */
function fromRepertoire(state, candidates, goal, plies = 1, keyOf = stateKey, rank = (alg) => alg) {
  let frontier = [{ state, alg: '', used: [] }];
  // Different runs of triggers land on the same cube constantly — `R U R'` then `R U' R'` is
  // where it started. Without this the frontier squares every ply and the budget is spent
  // re-examining positions already seen, which is what made the pair search look unreachable
  // when it was merely wasteful.
  const seen = new Set([keyOf(state, '')]);
  for (let ply = 0; ply < plies; ply++) {
    const next = [];
    const hits = [];
    for (const node of frontier) {
      for (const candidate of candidates) {
        const after = applyAlg(node.state, candidate.alg);
        const alg = joinAlg(node.alg, candidate.alg);
        if (goal(after, alg)) {
          hits.push({ state: after, alg, used: [...node.used, candidate] });
          continue;
        }
        const key = keyOf(after, alg);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ state: after, alg, used: [...node.used, candidate] });
      }
    }
    // Finish the ply before choosing, and choose by the algorithm rather than by whichever
    // branch happened to be reached first. Returning the first hit made the answer depend on the
    // order the frontier was built in — which is not the same order in every working slot, so
    // one F2L case came out with a different algorithm depending on which slot it turned up in.
    // `rank` is what lets the caller compare candidates in ONE frame; the default compares them
    // as written.
    if (hits.length) {
      const key = (h) => `${String(algLength(h.alg)).padStart(3, '0')} ${rank(h.alg)}`;
      hits.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
      return hits[0];
    }
    frontier = next;
  }
  return null;
}

/** A cube as one string, for the visited set. Permutation and orientation both matter, so all
 *  four arrays go in — a key that ignored orientation would call two different cubes equal. */
function stateKey(s) {
  return `${s.cp.join('')}|${s.co.join('')}|${s.ep.join(',')}|${s.eo.join('')}`;
}

/** Every rotation of an algorithm, each with the AUF that lines the case up in front of it. */
function repertoire(algs, { rotations = [0, 1, 2, 3], auf = AUF, post = [''] } = {}) {
  const out = [];
  for (const entry of algs) {
    for (const k of rotations) {
      const body = rotateAlg(entry.alg, k);
      for (const pre of auf) {
        for (const tail of post) {
          out.push({ name: entry.name, alg: joinAlg(pre, body, tail), rotation: k, auf: pre });
        }
      }
    }
  }
  // Shortest first, so a step that needs no setup is preferred over one that does.
  return out.sort((a, b) => algLength(a.alg) - algLength(b.alg));
}

/** Raised when the repertoire cannot reach a sub-goal. Never swallowed: an unsolvable stage
 *  means the tables are wrong, and a solver that quietly returned a partial solution would be
 *  handing a learner moves that do not lead anywhere. */
export class MethodSolverError extends Error {
  constructor(stage, target, state) {
    super(`method solver: no step reaches ${stage}/${target}`);
    this.name = 'MethodSolverError';
    this.stage = stage;
    this.target = target;
    this.state = state;
  }
}

// ---- the algorithm repertoire -----------------------------------------------------------
// Every alg is written for the front-right working position and rotated by `repertoire`.
// None of these is trusted: each is proposed and then checked against the stage's goal, so an
// entry that is wrong or misremembered costs a failed lookup, never a wrong instruction.

/** Dropping a cross edge from the top into DF. */
const CROSS_INSERTS = [
  { name: 'drop-in', alg: 'F2' },
  { name: 'flip-in', alg: "U' R' F R" },
];

/** Putting a first-layer corner from the top into DFR. The three orientations it can be in,
 *  plus the trigger repeated, which is what the beginner method actually teaches. */
const F1L_INSERTS = [
  { name: 'right-hand', alg: "R U R'" },
  { name: 'left-hand', alg: "F' U' F" },
  { name: 'facing-up', alg: "R U2 R' U' R U R'" },
];

/** Middle-layer edges. The same pair of algs both inserts a correct edge and ejects a wrong
 *  one — which is exactly how it is taught, and why no separate "eject" table exists. */
const MIDDLE_INSERTS = [
  { name: 'insert-right', alg: "U R U' R' U' F' U F" },
  { name: 'insert-left', alg: "U' F' U F U R U' R'" },
];

/** Orienting the last-layer edges. One alg, applied up to three times. */
const EOLL = [{ name: 'edge-orient', alg: "F R U R' U' F'" }];

/** Orienting the last-layer corners — the seven cases of two-look OLL, in face turns only
 *  (no wide or slice moves, because the renderer and the move list only speak face turns). */
const OCLL = [
  { name: 'sune', alg: "R U R' U R U2 R'" },
  { name: 'antisune', alg: "R U2 R' U' R U' R'" },
  { name: 'headlights', alg: "R2 D R' U2 R D' R' U2 R'" },
  { name: 'double-sune', alg: "R U R' U R U' R' U R U2 R'" },
  { name: 'pi', alg: "R U2 R2 U' R2 U' R2 U2 R" },
];

/** Permuting the last-layer corners. Adjacent swap both ways round, plus the diagonal. */
const CPLL = [
  { name: 'corner-cycle', alg: "R' F R' B2 R F' R' B2 R2" },
  { name: 'corner-cycle-back', alg: "R2 B2 R F R' B2 R F' R" },
  { name: 'diagonal', alg: "F R U' R' U' R U R' F' R U R' U' R' F R F'" },
];

/** Permuting the last-layer edges. Two U-perms; Z and H fall out of applying two of them. */
const EPLL = [
  { name: 'u-perm-a', alg: "R U' R U R U R U' R' U' R2" },
  { name: 'u-perm-b', alg: "R2 U R U R' U' R' U' R' U R'" },
];

// ---- the cross, solved whole ----------------------------------------------------------------
// A beginner places four cross edges one at a time and spends six steps doing it. Someone past
// that stage plans the cross and executes it in one go, so at higher layers the cross is ONE
// step — and an optimal one, because the space it lives in is small enough to solve exactly.
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
function crossTable() {
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
function solveCrossWhole(state) {
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

function crossWholeStage(state, steps) {
  const alg = solveCrossWhole(state);
  if (alg) {
    state = applyAlg(state, alg);
    steps.push({ stage: 'cross', kind: 'goal', target: 'cross', alg,
      why: { key: 'cross.whole', moves: alg.split(' ').length } });
  }
  if (!allSolved(state, { edges: CROSS })) throw new MethodSolverError('cross', 'whole', state);
  return state;
}

// ---- F2L: the corner and its edge, together --------------------------------------------------
// The beginner method puts the corner in, then goes back for the edge that belongs beside it —
// two steps, and the second one has to undo part of the first. Pairing them is the single
// largest step reduction available: ten steps become four.
//
// No memorised case list. The moves are the same triggers the beginner method already uses, and
// the step is whichever short sequence of them provably places the pair. That keeps the reason
// intact — pair them up, then insert the pair — and keeps the table from being a list of 41
// algorithms nobody checked.

const F2L_TRIGGERS = [
  { name: 'right', alg: "R U R'" },
  { name: 'right-back', alg: "R U' R'" },
  { name: 'right-half', alg: "R U2 R'" },
  { name: 'left', alg: "F' U' F" },
  { name: 'left-back', alg: "F' U F" },
  { name: 'left-half', alg: "F' U2 F" },
];

/**
 * The name of the F2L case: where the corner and its edge are, seen from the working slot.
 *
 * Deliberately NOT the sequence of triggers that solves it. A learner recognises a position and
 * recalls what to do; naming the step after the moves would name it after the answer, and would
 * produce a different "case" every time the search took a different route to the same place.
 *
 * The whole STATE is turned until the slot being worked on is at the front right, and the pair is
 * read there. An earlier version relabelled the slot names instead and read the flip where it
 * stood — which describes a situation that does not exist, because edge orientation is measured
 * against the F/B axis and is not invariant under the turn (see `rotateState`). That is exactly
 * why one case used to come out with a different algorithm depending on which slot it was in.
 */
function f2lPosition(state, pair, turns) {
  // Turning the cube `4 - turns` brings slot `turns` to the front right, and carries the pair's
  // own cubies onto the front-right pair: corner DFR, edge FR.
  const inFrame = rotateState(state, (4 - (turns % 4)) % 4);
  const cornerAt = cornerSlot(inFrame, CORNER.DFR);
  const edgeAt = edgeSlot(inFrame, EDGE.FR);
  return `${CORNERS[cornerAt]}${inFrame.co[cornerAt]}/${EDGES[edgeAt]}${inFrame.eo[edgeAt]}`;
}

/**
 * The case, and how far to turn the top before it looks like the case.
 *
 * "Turn U until it matches" is not part of a case — it is what you do before you recognise one.
 * Folding the four alignments together is what takes the count from 287 positions down to the
 * 41 cases F2L is actually taught as, and it is verified to be faithful: no name covers two
 * different positions, only the four rotations of one.
 */
function f2lAlignment(state, pair, turns) {
  let best = null;
  let bestTurns = 0;
  let aligned = state;
  for (let u = 0; u < 4; u++) {
    const name = f2lPosition(aligned, pair, turns);
    if (best === null || name < best) { best = name; bestTurns = u; }
    aligned = applyMove(aligned, 'U');
  }
  return { turns: bestTurns, name: best };
}

/** The case name alone, for tests and for anything that only wants to know which one it is. */
const f2lCaseName = (state, pair, turns) => f2lAlignment(state, pair, turns).name;

/** The four pairs, each a corner and the edge that belongs beside it. Same order as the
 *  beginner stages, so slot k is reached by rotating the front-right algorithms k times. */
const F2L_PAIRS = [
  { corner: CORNER.DFR, edge: EDGE.FR },
  { corner: CORNER.DRB, edge: EDGE.BR },
  { corner: CORNER.DBL, edge: EDGE.BL },
  { corner: CORNER.DLF, edge: EDGE.FL },
];

/**
 * Does this algorithm leave every slot but one exactly as it found it?
 *
 * Asked of the ALGORITHM, on a solved cube — not of the position it happens to be used in.
 * That distinction is the whole reason the stage is teachable. Asking "did anything already
 * solved break" makes the answer depend on how far through the solve you are: the search found
 * a three-move answer for a position early on and a ten-move answer for the SAME position
 * later, because by then there was more in the way. A learner cannot memorise that. A case has
 * to have one answer, so the constraint has to be a property of the algorithm alone.
 */
const slotSafeCache = new Map();
function slotSafe(alg, keepCorners, keepEdges, cacheKey) {
  const key = `${cacheKey}|${alg}`;
  const cached = slotSafeCache.get(key);
  if (cached !== undefined) return cached;
  const after = applyAlg(SOLVED_STATE, alg);
  let safe = true;
  for (const slot of keepCorners) if (after.cp[slot] !== slot || after.co[slot] !== 0) { safe = false; break; }
  if (safe) for (const slot of keepEdges) if (after.ep[slot] !== slot || after.eo[slot] !== 0) { safe = false; break; }
  slotSafeCache.set(key, safe);
  return safe;
}

/** A solved cube, for asking questions about an algorithm rather than about a position. */
const SOLVED_STATE = Object.freeze({
  cp: [0, 1, 2, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0],
  ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
});

function f2lStage(state, steps) {
  const placedCorners = [];
  const placedEdges = [];
  for (const [slot, pair] of F2L_PAIRS.entries()) {
    const intact = keeping([...CROSS, ...placedEdges], placedCorners);
    // Every slot but this pair's, whether or not it happens to be solved yet.
    const otherCorners = F1L.filter((c) => c !== pair.corner);
    const otherEdges = [...CROSS, ...MIDDLE.filter((e) => e !== pair.edge)];
    const done = (s, alg) =>
      cornerSolved(s, pair.corner) && edgeSolved(s, pair.edge) &&
      slotSafe(alg, otherCorners, otherEdges, slot);
    // The empty algorithm is trivially slot-safe, so an already-placed pair short-circuits.
    if (done(state, '')) { placedCorners.push(pair.corner); placedEdges.push(pair.edge); continue; }

    const candidates = repertoire(F2L_TRIGGERS, { rotations: [slot] });
    const { turns, name: caseName } = f2lAlignment(state, pair, slot);
    // Line the top up first, then solve the case. That is the order a learner works in, and it
    // is also what makes the algorithm depend on the case rather than on where the top happened
    // to be — the difference between something memorable and a different answer every time.
    // Not applied to `state`: if no case reaches this pair we fall back to the layer below,
    // and that path starts from where the learner actually is, not from a turn we made for a
    // lookup that then failed.
    const align = AUF[turns];
    const aligned = align ? applyAlg(state, align) : state;
    // Two nodes are the same when this pair is in the same place and the route so far is
    // equally slot-safe. Deduplicating on the WHOLE cube instead made the search's choice
    // depend on the other 18 pieces, which is how one case ended up with three algorithms.
    const keyOf = (s, alg) => {
      const c = cornerSlot(s, pair.corner);
      const e = edgeSlot(s, pair.edge);
      return `${c}.${s.co[c]}|${e}.${s.eo[e]}|${slotSafe(alg, otherCorners, otherEdges, slot) ? 1 : 0}`;
    };
    // Fast path: the pair is already loose, so a short run of triggers places it.
    // Rank in the front-right frame: the same case must get the same algorithm whichever slot
    // it appears in, or there is nothing to learn.
    const inFrontRightFrame = (alg) => rotateAlg(alg, (4 - slot) % 4);
    let found = fromRepertoire(aligned, candidates, done, 3, keyOf, inFrontRightFrame);
    let ejected = null;
    if (!found) {
      // One or both pieces are buried in a slot. Taking them out first is the thing a learner
      // is taught before any pair case, and it is also what turns one unreachable search into
      // two reachable ones.
      const loose = (s, alg) =>
        U_CORNERS.includes(cornerSlot(s, pair.corner)) && U_EDGES.includes(edgeSlot(s, pair.edge)) &&
        slotSafe(alg, otherCorners, otherEdges, slot);
      ejected = fromRepertoire(aligned, candidates, loose, 2, keyOf, inFrontRightFrame);
      // Both halves slot-safe means the whole thing is, so the pair still has one answer.
      if (ejected) found = fromRepertoire(ejected.state, candidates, done, 3, keyOf, inFrontRightFrame);
    }

    if (!found) {
      // No pair case reaches this one. Rather than fail, do the pair the way the layer below
      // does — corner first, then its edge. This is not a workaround, it is what a learner
      // actually does with a case they have not met yet, and it keeps the step honest: it
      // says which one it is. The rung above removes these; see the design note.
      state = placeCorner(state, pair.corner, intact, steps, 'f2l');
      const withCorner = keeping([...CROSS, ...placedEdges], [...placedCorners, pair.corner]);
      state = placeEdge(state, pair.edge, withCorner, steps, 'f2l');
      placedCorners.push(pair.corner);
      placedEdges.push(pair.edge);
      continue;
    }

    const used = ejected ? [...ejected.used, ...found.used] : found.used;
    const alg = joinAlg(align, ejected ? `${ejected.alg} ${found.alg}` : found.alg);
    state = found.state;
    // One step, not three: the pair is the unit a learner recognises at this layer. The
    // triggers stay attached so the step can be opened up when it is still unfamiliar.
    steps.push({ stage: 'f2l', kind: 'case', target: pair.corner, alg, caseName,
      // The triggers stay attached: the case is what you recognise, the parts are how you get
      // out of it, and a learner meeting the case for the first time needs both.
      parts: used.map((u) => ({ name: u.name, alg: u.alg })),
      why: { key: 'f2l.pair', corner: pair.corner, edge: pair.edge, ejected: Boolean(ejected) } });
    placedCorners.push(pair.corner);
    placedEdges.push(pair.edge);
  }
  return state;
}

// ---- the stages ---------------------------------------------------------------------------
// Each stage places one piece at a time and never breaks what came before. That invariant is
// checked, not assumed: it is half of every goal predicate in this file.

/** Everything solved so far, as the "do not disturb" set for the next sub-goal. */
const keeping = (edges, corners) => (state) => allSolved(state, { edges, corners });

function crossStage(state, steps) {
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
    const found = fromRepertoire(state, repertoire(CROSS_INSERTS), home);
    if (!found) throw new MethodSolverError('cross', edge, state);
    state = found.state;
    steps.push({ stage: 'cross', kind: 'case', target: edge, alg: found.alg,
      caseName: found.used[0].name, why: { key: 'cross.insert', edge } });
    placed.push(edge);
  }
  return state;
}

/** Lift a corner to the top and drop it into its slot: two steps, the beginner's way. Shared
 *  with the F2L stage, which falls back to it for a pair case it has no algorithm for. */
function placeCorner(state, corner, intact, steps, stage) {
  const inTop = (s) => U_CORNERS.includes(cornerSlot(s, corner)) && intact(s);
  const lift = shortestTo(state, inTop, 4);
  if (lift === null) throw new MethodSolverError(stage, corner, state);
  if (lift) {
    state = applyAlg(state, lift);
    steps.push({ stage, kind: 'goal', target: corner, alg: lift, why: { key: 'firstLayer.lift', corner } });
  }
  const home = (s) => cornerSolved(s, corner) && intact(s);
  const found = fromRepertoire(state, repertoire(F1L_INSERTS), home);
  if (!found) throw new MethodSolverError(stage, corner, state);
  steps.push({ stage, kind: 'case', target: corner, alg: found.alg,
    caseName: found.used[0].name, why: { key: 'firstLayer.insert', corner } });
  return found.state;
}

/** Put a middle-layer edge in its slot. The same algorithm ejects a wrong edge and inserts the
 *  right one, which is why this may take two of them. */
function placeEdge(state, edge, intact, steps, stage) {
  const home = (s) => edgeSolved(s, edge) && intact(s);
  const found = fromRepertoire(state, repertoire(MIDDLE_INSERTS), home, 2);
  if (!found) throw new MethodSolverError(stage, edge, state);
  for (const used of found.used) {
    steps.push({ stage, kind: 'case', target: edge, alg: used.alg,
      caseName: used.name, why: { key: 'middleLayer.insert', edge } });
  }
  return found.state;
}

function firstLayerStage(state, steps) {
  const placed = [];
  for (const corner of F1L) {
    const intact = keeping(CROSS, placed);
    if (cornerSolved(state, corner) && intact(state)) { placed.push(corner); continue; }
    state = placeCorner(state, corner, intact, steps, 'first-layer');
    placed.push(corner);
  }
  return state;
}

function middleLayerStage(state, steps) {
  const placed = [];
  for (const edge of MIDDLE) {
    const intact = keeping([...CROSS, ...placed], F1L);
    if (edgeSolved(state, edge) && intact(state)) { placed.push(edge); continue; }
    state = placeEdge(state, edge, intact, steps, 'middle-layer');
    placed.push(edge);
  }
  return state;
}

/** A last-layer edge is oriented when its top sticker is the top colour, which in this
 *  representation is exactly `eo === 0` for a U slot. */
const topEdgesOriented = (s) => U_EDGES.every((slot) => s.eo[slot] === 0);
/** Likewise for corners, untwisted in place. */
const topCornersOriented = (s) => U_CORNERS.every((slot) => s.co[slot] === 0);

function lastLayerStage(state, steps) {
  const firstTwoLayers = keeping([...CROSS, ...MIDDLE], F1L);
  const guard = (extra) => (s) => firstTwoLayers(s) && extra(s);

  // 1. Orient the edges — the cross on top. Up to three applications; each one is its own
  //    step, because each one is a case a learner recognises on its own.
  if (!topEdgesOriented(state)) {
    const found = fromRepertoire(state, repertoire(EOLL), guard(topEdgesOriented), 3);
    if (!found) throw new MethodSolverError('top-cross', 'edges', state);
    state = found.state;
    for (const used of found.used) {
      steps.push({ stage: 'top-cross', kind: 'case', target: 'edges', alg: used.alg,
        caseName: used.name, why: { key: 'topCross.orient' } });
    }
  }

  // 2. Orient the corners — the whole top face one colour. Edges must stay oriented.
  if (!topCornersOriented(state)) {
    const goal = guard((s) => topCornersOriented(s) && topEdgesOriented(s));
    const found = fromRepertoire(state, repertoire(OCLL), goal, 2);
    if (!found) throw new MethodSolverError('top-face', 'corners', state);
    state = found.state;
    for (const used of found.used) {
      steps.push({ stage: 'top-face', kind: 'case', target: 'corners', alg: used.alg,
        caseName: used.name, why: { key: 'topFace.orient' } });
    }
  }

  // 3. Permute the corners, then the edges. The trailing U is part of the candidate, because
  //    "turn the top until it matches" is a move a learner makes and must be shown.
  const cornersHome = guard((s) => U_CORNERS.every((c) => s.cp[c] === c && s.co[c] === 0));
  if (!cornersHome(state)) {
    const found = fromRepertoire(state, repertoire(CPLL, { post: AUF }), cornersHome, 2);
    if (!found) throw new MethodSolverError('top-corners', 'permute', state);
    state = found.state;
    for (const used of found.used) {
      steps.push({ stage: 'top-corners', kind: 'case', target: 'permute', alg: used.alg,
        caseName: used.name, why: { key: 'topCorners.permute' } });
    }
  }

  const solved = (s) => allSolved(s, { edges: [...Array(12).keys()], corners: [...Array(8).keys()] });
  if (!solved(state)) {
    const found = fromRepertoire(state, repertoire(EPLL, { post: AUF }), solved, 2);
    if (!found) throw new MethodSolverError('top-edges', 'permute', state);
    state = found.state;
    for (const used of found.used) {
      steps.push({ stage: 'top-edges', kind: 'case', target: 'permute', alg: used.alg,
        caseName: used.name, why: { key: 'topEdges.permute' } });
    }
  }
  return state;
}

/**
 * The layers. A learner does not get better by being shown shorter moves; they get better by
 * needing fewer steps to describe the same solve, because what used to be several things they
 * had to think about has become one thing they recognise. So the ladder is measured in STEPS,
 * and every rung has to stay explicable — a rung that saves a step by hiding a reason is not
 * progress, it is a shortcut we cannot teach.
 *
 * `beginner`      places every piece on its own: four cross edges, four corners, four edges.
 * `intermediate`  plans the cross as one thing and pairs each corner with its edge.
 *
 * The rungs above these are in dev-docs/method-solver-design.md; each one is another repertoire
 * behind this same interface.
 */
export const LEVELS = Object.freeze(['beginner', 'intermediate']);

/**
 * Solve `state` by a layer-by-layer method at the given level.
 *
 * Returns the steps, the whole alg, and the move count. Throws `MethodSolverError` rather than
 * returning a partial solution: a stage that cannot be reached means the repertoire is wrong,
 * and half a solution is worse than none for someone following along.
 */
export function solveByMethod(state, { level = 'beginner' } = {}) {
  if (!LEVELS.includes(level)) throw new Error(`unknown level: ${level}`);
  const steps = [];
  let s = { cp: [...state.cp], co: [...state.co], ep: [...state.ep], eo: [...state.eo] };
  if (level === 'beginner') {
    s = crossStage(s, steps);
    s = firstLayerStage(s, steps);
    s = middleLayerStage(s, steps);
  } else {
    s = crossWholeStage(s, steps);
    s = f2lStage(s, steps);
  }
  s = lastLayerStage(s, steps);

  // Per step, never across them: a step is a thing the learner performs as a unit, and merging
  // over a boundary would make the move list disagree with the lesson.
  const simplified = steps
    .map((step) => ({ ...step, alg: simplify(step.alg) }))
    .filter((step) => step.alg.length > 0);
  steps.length = 0;
  steps.push(...simplified);

  const alg = joinAlg(...steps.map((step) => step.alg));
  // The last guard: the concatenation must actually solve the cube we were given. Every stage
  // already checked its own goal, so this can only fail if a stage's invariant was too weak —
  // which is precisely the bug a per-stage check cannot see.
  const end = applyAlg(state, alg);
  const solved = allSolved(end, { edges: [...Array(12).keys()], corners: [...Array(8).keys()] });
  if (!solved) throw new MethodSolverError('assembly', 'whole-cube', state);

  return { steps, alg, moveCount: algLength(alg) };
}

/**
 * Every named algorithm in the repertoire.
 *
 * Exported so a test can prove each one earns its place: an entry no state ever needs is a
 * case we would claim to teach and never show. Four entries were removed this way — a second
 * Sune reaches those positions in fewer moves, so the table was larger than the method.
 */
export const CASE_NAMES = Object.freeze([
  ...CROSS_INSERTS, ...F1L_INSERTS, ...MIDDLE_INSERTS, ...F2L_TRIGGERS,
  ...EOLL, ...OCLL, ...CPLL, ...EPLL,
].map((entry) => entry.name));

export const __testing = {
  rotateAlg, shortestTo, fromRepertoire, repertoire, simplify, solveCrossWhole, crossTable, f2lCaseName, slotSafe,
};
