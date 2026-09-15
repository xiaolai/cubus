// An oracle for what a child sees, sharing no code with the renderer, the interpreter or
// `lib/cube-orientation.js`.
//
// dev-docs/tutorial-capability-plan.md item 0.2 requires every scenario's expected values to come
// from somewhere the renderer's own pose code cannot contaminate. This is that somewhere: a sticker
// model written from the published facelet layout (URFDLB, each face read row by row as it is seen
// from outside) and plain slab rotations, checked against cubejs — a third-party implementation — on
// every move cubejs knows, from a solved cube and from a scrambled one. The layout and the rotation
// signs are therefore not trusted; they are what reproduces cubejs.
//
// WORLD facelets are what a child sees: position `i` is where the sticker sits in space (U is up, F
// faces the child), and the letter is the colour it carries — the face it belongs to. A whole-cube
// turn or a slice moves the centres, so the centre letters say how the cube is held.
//
// Axes follow the renderer's convention only so a drawn cube can be read back into this model: R is
// +x, U is +y, F is +z. Nothing else is shared.

const FACES = 'URFDLB';

/** Where facelet `i` sits: the cubie position and the outward normal, both integer vectors. */
export const STICKERS = (() => {
  const out = [];
  // For each face: the normal, and (row, col) -> the two free coordinates, as seen from outside with
  // the standard up (U with B at the top, D with F at the top, the four sides with U at the top).
  const layout = {
    U: { n: [0, 1, 0], at: (r, c) => [c - 1, 1, r - 1] },
    R: { n: [1, 0, 0], at: (r, c) => [1, 1 - r, 1 - c] },
    F: { n: [0, 0, 1], at: (r, c) => [c - 1, 1 - r, 1] },
    D: { n: [0, -1, 0], at: (r, c) => [c - 1, -1, 1 - r] },
    L: { n: [-1, 0, 0], at: (r, c) => [-1, 1 - r, c - 1] },
    B: { n: [0, 0, -1], at: (r, c) => [1 - c, 1 - r, -1] },
  };
  for (const f of FACES) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push({ face: f, pos: layout[f].at(r, c), n: layout[f].n });
  }
  return Object.freeze(out.map(Object.freeze));
})();

const key = (pos, n) => `${pos.join(',')}|${n.join(',')}`;
const INDEX = new Map(STICKERS.map((s, i) => [key(s.pos, s.n), i]));

/** The facelet a sticker at `pos` facing `n` is, or -1. For reading a drawn cube back. */
export const faceletAt = (pos, n) => INDEX.get(key(pos, n)) ?? -1;

export const SOLVED_FACELETS = [...FACES].map((f) => f.repeat(9)).join('');

const AXIS = { x: 0, y: 1, z: 2 };

/** Rotate an integer vector a quarter turn about `axis`, `+1` counter-clockwise seen from the axis's
 *  positive end (the right-hand rule), `-1` the other way. */
function quarter(v, axis, dir) {
  const [x, y, z] = v;
  if (axis === 'x') return dir > 0 ? [x, -z, y] : [x, z, -y];
  if (axis === 'y') return dir > 0 ? [z, y, -x] : [-z, y, x];
  return dir > 0 ? [-y, x, z] : [y, -x, z];
}

/**
 * Every token this oracle knows, as (axis, layers, direction of a clockwise quarter). A clockwise turn
 * of a face is clockwise seen from OUTSIDE that face, so a face on the positive side of its axis turns
 * the negative way. Slices follow WCA-community usage — M as L, E as D, S as F; wide moves are the face
 * plus the middle layer; rotations follow WCA Regulations 12a4 — x as R, y as U, z as F.
 */
const TOKENS = Object.freeze({
  R: ['x', [1], -1], L: ['x', [-1], 1], U: ['y', [1], -1], D: ['y', [-1], 1], F: ['z', [1], -1], B: ['z', [-1], 1],
  M: ['x', [0], 1], E: ['y', [0], 1], S: ['z', [0], -1],
  r: ['x', [0, 1], -1], l: ['x', [-1, 0], 1], u: ['y', [0, 1], -1], d: ['y', [-1, 0], 1], f: ['z', [0, 1], -1], b: ['z', [-1, 0], 1],
  Rw: ['x', [0, 1], -1], Lw: ['x', [-1, 0], 1], Uw: ['y', [0, 1], -1], Dw: ['y', [-1, 0], 1], Fw: ['z', [0, 1], -1], Bw: ['z', [-1, 0], 1],
  x: ['x', [-1, 0, 1], -1], y: ['y', [-1, 0, 1], -1], z: ['z', [-1, 0, 1], -1],
});

/** One move — `R`, `M'`, `r2`, `Rw'`, `x2` — applied to world facelets. Throws on anything else. */
export function applyToken(facelets, token) {
  const m = /^(Rw|Lw|Uw|Dw|Fw|Bw|[URFDLBMESrludfbxyz])(2'|2|')?$/.exec(token);
  if (!m || !Object.hasOwn(TOKENS, m[1])) throw new Error(`oracle: unknown move "${token}"`);
  const [axis, layers, cw] = TOKENS[m[1]];
  const turns = m[2] === "'" ? 1 : m[2] ? 2 : 1;
  const dir = m[2] === "'" ? -cw : cw;
  const out = [...facelets];
  STICKERS.forEach((s, i) => {
    if (!layers.includes(s.pos[AXIS[axis]])) return;
    let pos = s.pos, n = s.n;
    for (let t = 0; t < turns; t++) { pos = quarter(pos, axis, dir); n = quarter(n, axis, dir); }
    out[faceletAt(pos, n)] = facelets[i];
  });
  return out.join('');
}

/** A whole sequence, space-separated. */
export const applyMoves = (facelets, moves) =>
  String(moves).trim().split(/\s+/).filter(Boolean).reduce(applyToken, facelets);

/** How the cube is held: which face's colour is up, and which faces the child. */
export const holdOf = (world) => `${world[4]} ${world[22]}`;

/** The 24 whole-cube turns, each as a token sequence, generated rather than listed. */
export const ROTATIONS = (() => {
  const seen = new Map();
  for (const a of ['', 'x', 'x2', "x'", 'z', "z'"]) {
    for (const b of ['', 'y', 'y2', "y'"]) {
      const seq = [a, b].filter(Boolean).join(' ');
      const hold = holdOf(seq ? applyMoves(SOLVED_FACELETS, seq) : SOLVED_FACELETS);
      if (!seen.has(hold)) seen.set(hold, seq);
    }
  }
  if (seen.size !== 24) throw new Error(`oracle: ${seen.size} distinct holds from the rotation grid, not 24`);
  return Object.freeze(Object.fromEntries(seen));
})();

/** World facelets for identity facelets held `up front`: the whole cube turned to that hold. */
export function held(identity, hold) {
  const seq = ROTATIONS[hold];
  if (seq === undefined) throw new Error(`oracle: no hold "${hold}"`);
  return seq ? applyMoves(identity, seq) : identity;
}

/** Identity facelets — the centres back home — for world facelets, and the hold they were in. */
export function identityOf(world) {
  for (const [hold, seq] of Object.entries(ROTATIONS)) {
    const back = seq ? applyMoves(world, invertMoves(seq)) : world;
    if ([4, 13, 22, 31, 40, 49].every((i, k) => back[i] === FACES[k])) return { identity: back, hold };
  }
  throw new Error('oracle: these centres match no hold — not a cube');
}

/** The inverse of a token sequence. */
export function invertMoves(moves) {
  return String(moves).trim().split(/\s+/).filter(Boolean).reverse()
    .map((t) => (t.endsWith("'") ? t.slice(0, -1) : t.endsWith('2') ? t : `${t}'`)).join(' ');
}

/**
 * The child's sequence, from a cube held `hold` whose identity facelets are `identity`: the world
 * facelets at every position, the hold at every position, and the identity facelets at the end.
 * Held letters are the WORLD positions the child names, so the oracle applies them to the world
 * facelets as written — which is exactly what makes it independent of any renaming.
 */
export function play(identity, hold, moves) {
  let world = held(identity, hold);
  const worlds = [world];
  for (const t of String(moves).trim().split(/\s+/).filter(Boolean)) {
    world = applyToken(world, t);
    worlds.push(world);
  }
  return { worlds, holds: worlds.map(holdOf), end: identityOf(world) };
}
