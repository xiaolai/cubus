// Where every cubie is and which way it is turned — arithmetic over the cube's state, with no
// three.js and no DOM in sight.
//
// WHY IT EXISTS. The renderer had its own move implementation: `_grab` gathered a layer's meshes
// into a temporary group, `_bake` wrote the result back and rounded the positions, and a cubie's
// rotation was whatever the sequence of turns had left on it. So this repository had two
// implementations of one thing — `lib/cube-pieces.js`, which it publishes as its API, and this
// one, which it actually drew with. A pose that is a FUNCTION of the state is what lets seeking to
// a timestamp and playing into it agree, and it is the whole of A1 in dev-docs/renderer-v2-plan.md.
//
// THE CLAIM UNDERNEATH, re-derived independently before a line of this was written: a cubie's
// rotation follows from (home cubie, slot, twist) alone. Geometry simulated cubie by cubie against
// cube-pieces' own tables, over 200,000 random quarter turns — 192 corner mappings, 288 edge
// mappings, no path-dependent collisions, and exactly 24 distinct rotations, every one with
// determinant +1. `apps/web/test/cube-pose.test.mjs` re-derives it on every run rather than
// trusting a table typed out once.
//
// A MOVE IS A LAYER MASK, not a face letter. `{ axis, layers, angle, turns }` where `layers` is a
// set drawn from -1, 0 and +1 — so a face turn is one outer layer, a wide move two, a slice the
// middle one, and `x y z` all three. One descriptor, and the notation gap the Roofpig comparison
// names (`dev-docs/cubus-im-roofpig-comparison.md`) becomes a parser rather than a redesign.
//
// AND THE FRAME IS AN ARGUMENT, because `x y z` proves the state cannot carry it: a whole-cube
// rotation moves all 26 cubies and leaves {cp,co,ep,eo} identical. So what a move leaves behind is
// a PAIR — the pieces and the frame they are now held in — and `after()` answers both at once so
// they cannot come to disagree.

import { CORNERS, EDGES, applyMove } from '../../../apps/web/lib/cube-pieces.js';
import { faceTurnsOf, turnPieces } from '../../../apps/web/lib/cube-moves.js';
import { FACE_NORMAL } from '../../../apps/web/lib/cube-layout.js';

/** Face letter -> outward normal, the renderer's own axes — the app's one table, so the renderer and
 *  the model cannot come to disagree about which way +x points. */
const NORMAL = FACE_NORMAL;
const CENTRES = ['U', 'R', 'F', 'D', 'L', 'B'];
const AXIS_OF = { x: 0, y: 1, z: 2 };

/**
 * The axis a face's normal lies along, and which end of it the face sits on.
 *
 * Written ONCE. The rotation table's builder, the centres and the move descriptors all need it,
 * and they each spelled it out — `normal[0] ? 'x' : normal[1] ? 'y' : 'z'` three times over (found
 * by audit, 2026-09-14). Three spellings of one convention are three chances for one of them to
 * have the sign the other way round.
 */
const axisOf = (face) => {
  const n = NORMAL[face];
  const axis = n[0] ? 'x' : n[1] ? 'y' : 'z';
  return { axis, sign: n[AXIS_OF[axis]] };
};

/** A slot's home position: the sum of the outward normals of the faces its name lists. */
const posOf = (name) => [...name].reduce(
  (p, letter) => p.map((v, i) => v + NORMAL[letter][i]),
  [0, 0, 0],
);

/**
 * The 26 cubies, in one fixed order: cube-pieces' eight corners, then its twelve edges, then the
 * six centres in URFDLB order. The order is the renderer's index, so a caller may keep a mesh per
 * index and never look a cubie up by name.
 */
export const CUBIES = Object.freeze([
  ...CORNERS.map((name, index) => Object.freeze({ kind: 'corner', index, name })),
  ...EDGES.map((name, index) => Object.freeze({ kind: 'edge', index, name })),
  ...CENTRES.map((name, index) => Object.freeze({ kind: 'centre', index, name })),
]);

/** Each cubie's home position, in the same order. */
export const HOME = Object.freeze(CUBIES.map((c) => Object.freeze(posOf(c.name))));

const CORNER_POS = CORNERS.map(posOf);
const EDGE_POS = EDGES.map(posOf);

const mul = (A, B) => [0, 1, 2].map((i) => [0, 1, 2].map(
  (j) => A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j],
));
const applyTo = (M, v) => [0, 1, 2].map((i) => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]);
const I3 = Object.freeze([Object.freeze([1, 0, 0]), Object.freeze([0, 1, 0]), Object.freeze([0, 0, 1])]);

/**
 * A rotation of `angle` about one of the three axes.
 *
 * Written out per axis rather than through a general Rodrigues formula: at the quarter turns that
 * settle a cube these are exact — `cos(π/2)` is 6.1e-17, not 0 — and a position that is 1e-17 off
 * an integer is one a later `Math.round` has to rescue, which is the rounding this module exists
 * to delete. Exact for every multiple of a quarter turn, and ordinary trigonometry in between.
 */
function rotation(axis, angle) {
  const quarters = angle / (Math.PI / 2);
  const exact = Number.isInteger(quarters);
  const c = exact ? [1, 0, -1, 0][((quarters % 4) + 4) % 4] : Math.cos(angle);
  const s = exact ? [0, 1, 0, -1][((quarters % 4) + 4) % 4] : Math.sin(angle);
  if (axis === 'x') return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === 'y') return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  if (axis === 'z') return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
  throw new Error(`pose: unknown axis "${axis}" — one of x, y, z`);
}

/**
 * The rotation table's key: which kind of cubie, which one, in which slot, twisted how far.
 *
 * At module scope because two places use it — the table's builder writes by it and `settled()`
 * reads by it — and each had its own spelling (found by audit, 2026-09-14). A key written two ways
 * is a lookup that can start missing every row the day one of them changes.
 */
const tableKey = (kind, home, slot, twist) => `${kind}${home},${slot},${twist}`;

/**
 * `geo` with the layer `face` names given one quarter turn, in the direction cube-pieces turns it.
 * `-sign` is what the independent derivation found for all six faces (measurements/pose-derivation).
 */
const turnGeometry = (geo, face) => {
  const { axis, sign } = axisOf(face);
  const M = rotation(axis, -sign * (Math.PI / 2));
  return geo.map((c) => (c.pos[AXIS_OF[axis]] * sign === 1
    ? { ...c, pos: applyTo(M, c.pos), m: mul(M, c.m) }
    : c));
};

/**
 * The rotation a cubie of `home` wears when it sits in `slot`, for corners and edges.
 *
 * DERIVED, never typed: the tables are built by walking the cube group once at load and reading
 * each cubie's accumulated rotation beside the {cp,co,ep,eo} that cube-pieces reports. A typed
 * table of 480 signed matrices is a table with a typo in it, and the failure a wrong entry causes
 * is one cubie drawn a quarter turn out on one state in a thousand.
 */
const TURNED = (() => {
  const table = new Map();
  /** The geometric cube: every cubie at home, turned by nothing. */
  const solved = [
    ...CORNER_POS.map((pos) => ({ kind: 'c', pos, m: I3 })),
    ...EDGE_POS.map((pos) => ({ kind: 'e', pos, m: I3 })),
  ];
  /** Whichever cubie of `geo` is standing at `pos`. Geometry is a PARAMETER: it used to be one
   *  captured array that every branch of the walk had to empty and refill before recording, so
   *  whether a row was right depended on that sequencing rather than on the arguments. */
  const at = (geo, kind, pos) => geo.find(
    (c) => c.kind === kind && c.pos[0] === pos[0] && c.pos[1] === pos[1] && c.pos[2] === pos[2],
  );
  const note = (geo, state) => {
    for (let slot = 0; slot < 8; slot++) table.set(tableKey('c', state.cp[slot], slot, state.co[slot]), at(geo, 'c', CORNER_POS[slot]).m);
    for (let slot = 0; slot < 12; slot++) table.set(tableKey('e', state.ep[slot], slot, state.eo[slot]), at(geo, 'e', EDGE_POS[slot]).m);
  };
  // Breadth-first over quarter turns, carrying geometry and piece state side by side. The keyspace
  // is 480 entries and every state visited fills 20 of them, so this closes quickly; the walk
  // stops when a whole sweep of moves adds nothing.
  let frontier = [{
    state: { cp: [...Array(8).keys()], co: Array(8).fill(0), ep: [...Array(12).keys()], eo: Array(12).fill(0) },
    geo: solved,
  }];
  note(solved, frontier[0].state);
  const faces = Object.keys(NORMAL);
  for (let depth = 0; depth < 12 && table.size < 480; depth++) {
    const next = [];
    for (const { state, geo } of frontier) {
      for (const face of faces) {
        const moved = turnGeometry(geo, face);
        const before = table.size;
        const landed = applyMove(state, face);
        note(moved, landed);
        if (table.size > before) next.push({ state: landed, geo: moved });
      }
    }
    frontier = next;
  }
  if (table.size !== 480) throw new Error(`pose: the rotation table closed at ${table.size} of 480 entries`);
  return table;
})();

/** The axis a centre spins about: its own outward normal. */
const CENTRE_AXIS = CENTRES.map((f) => axisOf(f).axis);

/** Where cubie `i` sits and how it is turned, on a cube in `state`, in the cube's own frame. */
function settled(state, i) {
  const c = CUBIES[i];
  // A CENTRE CARRIES ITS OWN SPIN. `{cp,co,ep,eo}` has no centres, so it cannot say that `B2`
  // turned the B centre half way round — and the cube is invisible about it, because a centre
  // sticker is a rounded square that looks the same every quarter turn. Invisible is not the same
  // as absent: without this, a turn finished is NOT the cube the turn leaves behind, and the
  // whole point of a pose that is a function of the state goes with it. Six small integers, in
  // URFDLB order, counted in quarter turns of this module's own angle direction.
  if (c.kind === 'centre') {
    const twist = state.ct?.[c.index] ?? 0;
    return { pos: HOME[i], m: twist ? rotation(CENTRE_AXIS[c.index], twist * (Math.PI / 2)) : I3 };
  }
  const kind = c.kind === 'corner' ? 'c' : 'e';
  const [perm, orient, slots] = kind === 'c'
    ? [state.cp, state.co, CORNER_POS]
    : [state.ep, state.eo, EDGE_POS];
  // Which slot holds this cubie, and how it is twisted there.
  const slot = perm.indexOf(c.index);
  if (slot < 0) throw new Error(`pose: no slot holds ${c.name} — the state is not a permutation`);
  const m = TURNED.get(tableKey(kind, c.index, slot, orient[slot]));
  if (!m) throw new Error(`pose: no rotation for ${c.name} in slot ${slot} twisted ${orient[slot]}`);
  return { pos: slots[slot], m };
}

/** Is the cubie at `pos` in the layers this move turns? */
const inMove = (move, pos) => move.layers.includes(pos[AXIS_OF[move.axis]]);

/**
 * Every cubie's position and rotation, in world space.
 *
 * @param {number[][]} frame  How the whole cube is held — a rotation applied on top of everything.
 * @param {{cp:number[],co:number[],ep:number[],eo:number[]}} state  The pieces (lib/cube-pieces.js).
 * @param {{axis:string,layers:number[],angle:number,turns:number}|null} move  The turn in flight.
 * @param {number} phase  0 at the start of that turn, 1 at its end.
 * @returns {{pos:number[], m:number[][]}[]}  One entry per cubie, in CUBIES order.
 */
export function poseAll(frame, state, move = null, phase = 1) {
  const turning = move ? rotation(move.axis, move.angle * phase) : null;
  return CUBIES.map((_, i) => {
    const base = settled(state, i);
    const inFlight = turning && inMove(move, base.pos);
    const pos = inFlight ? applyTo(turning, base.pos) : base.pos;
    const m = inFlight ? mul(turning, base.m) : base.m;
    return { pos: applyTo(frame, pos), m: mul(frame, m) };
  });
}

/**
 * What a move leaves behind: the pieces, and the frame they are now held in.
 *
 * ONE function for both halves, so nothing can advance one without the other.
 *
 * The rule is uniform over every layer mask. Turning the middle layer of an axis is not something
 * the piece model can say — its slots are named in a fixed frame and it carries no centres — so a
 * mask that includes the middle is taken as turning the WHOLE CUBE and turning the layers outside
 * the mask back. A face turn is then the plain case, a wide move is the whole cube with one face
 * turned back, a slice is the whole cube with both faces turned back, and `x y z` is the whole
 * cube with nothing turned back.
 */
export function after(frame, state, move) {
  if (!move) return { frame, state };
  const { axis, angle } = move;
  const quarters = Math.round(angle / (Math.PI / 2));
  // WHICH faces turn, and the pieces they leave, are the interpreter's arithmetic
  // (`faceTurnsOf`/`turnPieces` in apps/web/lib/cube-moves.js), so the renderer draws with the rule the
  // model is tested against rather than a copy of it. What stays here is what only a picture needs:
  // each turned face's centre spins with it, in the geometry's direction.
  const { whole, turns } = faceTurnsOf(move);
  const ct = [...(state.ct ?? [0, 0, 0, 0, 0, 0])];
  const spin = whole ? -quarters : quarters;
  for (const { face } of turns) {
    ct[CENTRES.indexOf(face)] = (((ct[CENTRES.indexOf(face)] + spin) % 4) + 4) % 4;
  }
  return {
    frame: whole ? mul(frame, rotation(axis, quarters * (Math.PI / 2))) : frame,
    state: { ...turnPieces(move, state), ct },
  };
}

