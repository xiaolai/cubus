// What a cube LOOKS like, and when two cubes look the same.
//
// The shared geometry for pattern work. A pattern is a picture, and a picture seen from a different
// angle is the same picture — so "the same pattern" means "the same facelets up to one of the 24
// whole-cube rotations", and that cannot be decided at the piece level. It needs each sticker's place
// in space.
//
// WHY THE 24 AND NOT THE 48. The 48 cube symmetries include reflections, and no amount of turning
// produces a mirror image of a cube you are holding. A child cannot rotate their cube into the mirror
// of a picture, so a mirrored pattern is a DIFFERENT pattern to them and the ledger keeps it as one.
//
// EVERY NUMBER IN HERE IS DERIVED AND THEN CHECKED, never typed from memory. The checks are in
// `verify()` and they are the reason this file can be trusted: the 54 stickers must have distinct
// places, the 24 rotations must close under composition, a rotated solved cube must still read solved,
// and the facelet permutation each of the 18 moves induces must agree with the one `cube-pieces.js`
// and `two-phase.js` produce between them. That last one is the real check — it ties this geometry to
// the model the rest of the app solves with, rather than to an idea about how a cube is laid out.

import { MOVE_NAMES, SOLVED, applyMove } from '../lib/cube-pieces.js';
import { toFacelets } from '../lib/two-phase.js';

/** The facelet order the app uses everywhere: U R F D L B, nine each, row-major on that face. */
export const FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];

/**
 * Each facelet's outward normal and its position, in a right-handed frame with +y up, +z toward the
 * viewer and +x to the right. Coordinates are in {-1, 0, 1}.
 *
 * The per-face row and column conventions are the standard ones for this facelet order, and they are
 * what `verify()` checks rather than asserts: get one of them wrong and the move-permutation check
 * fails, because a move would be claimed to take a sticker somewhere the cube model does not.
 */
const PLACE = {
  U: (r, c) => [c - 1, 1, r - 1],
  R: (r, c) => [1, 1 - r, 1 - c],
  F: (r, c) => [c - 1, 1 - r, 1],
  D: (r, c) => [c - 1, -1, 1 - r],
  L: (r, c) => [-1, 1 - r, c - 1],
  B: (r, c) => [1 - c, 1 - r, -1],
};
const NORMAL = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };

/** Facelet index -> { pos, normal }, and the reverse lookup keyed on both. */
const STICKERS = [];
const BY_PLACE = new Map();
for (let f = 0; f < 6; f++) {
  const face = FACE_ORDER[f];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const index = f * 9 + r * 3 + c;
      const pos = PLACE[face](r, c);
      const normal = NORMAL[face];
      STICKERS[index] = { index, face, pos, normal };
      BY_PLACE.set(`${pos.join(',')}|${normal.join(',')}`, index);
    }
  }
}

/** Signed axis permutations with the given determinant: +1 the 24 rotations, -1 the 24 reflections. */
function rotationMatrices(want = 1) {
  const out = [];
  const axes = [0, 1, 2];
  const perms = [];
  const permute = (left, acc) => {
    if (!left.length) { perms.push(acc); return; }
    for (const a of left) permute(left.filter((x) => x !== a), [...acc, a]);
  };
  permute(axes, []);
  for (const p of perms) {
    for (let signs = 0; signs < 8; signs++) {
      const s = [signs & 1 ? -1 : 1, signs & 2 ? -1 : 1, signs & 4 ? -1 : 1];
      // The matrix sends e_j to s[j] * e_{p[j]}. Its determinant is the permutation's sign times
      // the product of the signs; only +1 is a rotation.
      const sign = permSign(p) * s[0] * s[1] * s[2];
      if (sign !== want) continue;
      out.push({ p, s });
    }
  }
  return out;
}
function permSign(p) {
  let swaps = 0;
  const a = [...p];
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) if (a[i] > a[j]) swaps++;
  }
  return swaps % 2 === 0 ? 1 : -1;
}
const applyMatrix = ({ p, s }, v) => {
  const out = [0, 0, 0];
  for (let j = 0; j < 3; j++) out[p[j]] = s[j] * v[j];
  return out;
};

/**
 * The 24 rotations, each as a facelet index map and a colour relabelling.
 *
 * `to[i]` is where sticker `i` ends up. `colour[f]` is the face letter that face `f`'s colour becomes
 * — a rotation carries the colours with the cube, so a sticker reading `U` on a cube turned so that U
 * faces right now reads `R`.
 */
function facemap(m) {
  const to = new Array(54);
  for (const st of STICKERS) {
    const pos = applyMatrix(m, st.pos);
    const normal = applyMatrix(m, st.normal);
    const dest = BY_PLACE.get(`${pos.join(',')}|${normal.join(',')}`);
    if (dest === undefined) throw new Error('rotation sent a sticker off the cube — the geometry is wrong');
    to[st.index] = dest;
  }
  const colour = {};
  for (const face of FACE_ORDER) {
    const n = applyMatrix(m, NORMAL[face]);
    const landed = FACE_ORDER.find((g) => NORMAL[g].every((v, i) => v === n[i]));
    colour[face] = landed;
  }
  return { to, colour };
}

/** The 24 rotations: what you can do to a cube by turning it in your hands. */
export const ROTATIONS = rotationMatrices(1).map(facemap);

/**
 * All 48 cube symmetries: the 24 rotations and the 24 REFLECTIONS.
 *
 * A reflection is not something you can do to a cube — it turns a right-handed cube into a
 * left-handed one — but it is something you can do to a PICTURE, and two designs that differ only by
 * a mirror are the same design to anybody looking at them. Which of the two notions the ledger should
 * dedupe by is a judgement, so both are available and `bench/pattern-classes.mjs` measures the gap.
 */
export const SYMMETRIES = [...ROTATIONS, ...rotationMatrices(-1).map(facemap)];

/** `facelets` under symmetry `s` of a given table — rotation or reflection alike. */
export function applySymmetry(facelets, s) {
  const { to, colour } = s;
  const out = new Array(54);
  for (let i = 0; i < 54; i++) out[to[i]] = colour[facelets[i]];
  return out.join('');
}

/** The smallest of a picture's 48 views: its identity as a DESIGN, mirror included. */
export function canonicalDesign(facelets) {
  let best = null;
  for (const s of SYMMETRIES) {
    const view = applySymmetry(facelets, s);
    if (best === null || view < best) best = view;
  }
  return best;
}

/** `facelets` as seen after turning the whole cube by rotation `r`. */
export function rotateFacelets(facelets, r) {
  const { to, colour } = ROTATIONS[r];
  const out = new Array(54);
  for (let i = 0; i < 54; i++) out[to[i]] = colour[facelets[i]];
  return out.join('');
}

/** The smallest of a picture's 24 views: its identity, independent of how it is held. */
export function canonicalLook(facelets) {
  let best = null;
  for (let r = 0; r < ROTATIONS.length; r++) {
    const view = rotateFacelets(facelets, r);
    if (best === null || view < best) best = view;
  }
  return best;
}

/** How many of the 24 views leave a picture unchanged. 1 is asymmetric; 24 is every angle alike. */
export function symmetryOrder(facelets) {
  let n = 0;
  for (let r = 0; r < ROTATIONS.length; r++) if (rotateFacelets(facelets, r) === facelets) n++;
  return n;
}

// ---- the checks --------------------------------------------------------------------------------

/** Every claim this file makes about the cube's geometry, checked. Throws on the first failure. */
export function verify() {
  // 1. The 54 stickers occupy 54 distinct places.
  if (BY_PLACE.size !== 54) throw new Error(`${BY_PLACE.size} distinct sticker places, expected 54`);

  // 2. There are exactly 24 rotations and they close under composition.
  if (ROTATIONS.length !== 24) throw new Error(`${ROTATIONS.length} rotations, expected 24`);
  if (SYMMETRIES.length !== 48) throw new Error(`${SYMMETRIES.length} symmetries, expected 48`);
  if (new Set(SYMMETRIES.map((s) => s.to.join(','))).size !== 48) throw new Error('the 48 are not distinct');
  // A solved cube is symmetric under all 48 too: a mirror of a solid colour is the same solid colour.
  for (const s of SYMMETRIES) {
    if (applySymmetry(toFacelets(SOLVED), s) !== toFacelets(SOLVED)) throw new Error('a symmetry unsolves a solved cube');
  }
  const keys = new Set(ROTATIONS.map((r) => r.to.join(',')));
  if (keys.size !== 24) throw new Error('two rotations have the same facelet map');
  for (let a = 0; a < 24; a++) {
    for (let b = 0; b < 24; b++) {
      const composed = new Array(54);
      for (let i = 0; i < 54; i++) composed[i] = ROTATIONS[b].to[ROTATIONS[a].to[i]];
      if (!keys.has(composed.join(','))) throw new Error(`rotations ${a} and ${b} compose outside the set`);
    }
  }
  // The SAME check over all 48, which the first version of this file skipped — it verified the 24 and
  // then added 24 reflections that nothing closed over. An audit showed a hand-corrupted reflection
  // passing verification, and the ledger's whole dedup rests on those 24 being right.
  const allKeys = new Set(SYMMETRIES.map((r) => r.to.join(',')));
  if (allKeys.size !== 48) throw new Error('two symmetries have the same facelet map');
  for (let a = 0; a < 48; a++) {
    for (let b = 0; b < 48; b++) {
      const composed = new Array(54);
      for (let i = 0; i < 54; i++) composed[i] = SYMMETRIES[b].to[SYMMETRIES[a].to[i]];
      if (!allKeys.has(composed.join(','))) throw new Error(`symmetries ${a} and ${b} compose outside the set`);
    }
  }
  // And each must be a bijection on the 54 places, which a swapped pair of entries breaks.
  for (let a = 0; a < 48; a++) {
    if (new Set(SYMMETRIES[a].to).size !== 54) throw new Error(`symmetry ${a} is not a bijection`);
  }

  // 3. A solved cube looks solved from all 24 angles. This is what makes `colour` load-bearing: the
  //    index map alone would scramble the letters.
  const solved = toFacelets(SOLVED);
  for (let r = 0; r < 24; r++) {
    if (rotateFacelets(solved, r) !== solved) throw new Error(`rotation ${r} makes a solved cube read unsolved`);
  }
  if (symmetryOrder(solved) !== 24) throw new Error('a solved cube must be symmetric under all 24');

  // 4. THE REAL CHECK, and the reason this file can be trusted at all: every one of the 18 moves is
  //    PREDICTED from the geometry alone — rotate the named layer about the named axis — and the
  //    prediction must reproduce what `cube-pieces.js` and `two-phase.js` produce between them, on
  //    scrambled cubes where the answer is not mostly constant.
  //
  //    The handedness is not assumed. A face turn is clockwise seen from outside that face, and which
  //    signed rotation that is depends on the frame, so the sign is DERIVED per face from the model
  //    and then all six are required to agree. Six faces independently demanding the same handedness
  //    is the evidence; one face fitted to the data would be none.
  const FACE_SIDE = { U: 1, D: -1, R: 1, L: -1, F: 1, B: -1 };
  const FACE_AXIS = { U: 1, D: 1, R: 0, L: 0, F: 2, B: 2 };

  /** Rotate the layer of `face` by `quarters`, with `sign` fixing the handedness. */
  const layerMap = (face, quarters, sign) => {
    const axis = FACE_AXIS[face];
    const side = FACE_SIDE[face];
    // A quarter rotation about `axis` sending the other two axes into each other.
    const [a, b] = [0, 1, 2].filter((x) => x !== axis);
    const map = new Array(54);
    for (let i = 0; i < 54; i++) map[i] = i;
    for (const st of STICKERS) {
      if (st.pos[axis] !== side) continue;
      let pos = [...st.pos], normal = [...st.normal];
      for (let q = 0; q < quarters; q++) {
        const turn = (v) => {
          const out = [...v];
          out[a] = sign * v[b];
          out[b] = -sign * v[a];
          return out;
        };
        pos = turn(pos);
        normal = turn(normal);
      }
      const dest = BY_PLACE.get(`${pos.join(',')}|${normal.join(',')}`);
      if (dest === undefined) throw new Error(`${face}: a layer turn sent a sticker off the cube`);
      map[st.index] = dest;
    }
    return map;
  };

  const probes = [];
  let s = SOLVED;
  for (let i = 0; i < 12; i++) {
    s = applyMove(s, MOVE_NAMES[(i * 7 + 3) % MOVE_NAMES.length]);
    probes.push(s);
  }

  const predicts = (face, quarters, sign) => {
    const map = layerMap(face, quarters, sign);
    return probes.every((state) => {
      const before = toFacelets(state);
      const after = toFacelets(applyMove(state, quarters === 1 ? face : quarters === 2 ? `${face}2` : `${face}'`));
      const out = new Array(54);
      for (let i = 0; i < 54; i++) out[map[i]] = before[i];
      return out.join('') === after;
    });
  };

  // The sign each face needs is PREDICTED, not fitted, from two facts and one unknown bit.
  //
  //   * `layerMap` turns the two non-axis coordinates in INDEX order, and (axis, a, b) is an even
  //     permutation of (0,1,2) for the x and z axes and an odd one for y. So a "positive" turn as
  //     written runs backwards about y. That is EPS.
  //   * A face turn is clockwise seen from OUTSIDE, so the two faces on one axis turn in opposite
  //     global senses. That is the face's side.
  //
  // Everything else is one global handedness bit, which the model decides and which all six faces
  // must then agree on. Six independent agreements on one bit is the evidence; a sign fitted per face
  // would be none, which is what the first version of this check did.
  const EPS = [1, -1, 1];
  const predicted = (face, h) => -FACE_SIDE[face] * EPS[FACE_AXIS[face]] * h;
  const fits = (h) => FACE_ORDER.every((face) => predicts(face, 1, predicted(face, h)));
  const plusFits = fits(1);
  const minusFits = fits(-1);
  if (plusFits === minusFits) {
    throw new Error(`the geometry does not determine a handedness — ${plusFits ? 'both' : 'neither'} bit predicts all six faces`);
  }
  const h = plusFits ? 1 : -1;
  for (const face of FACE_ORDER) {
    for (const quarters of [1, 2, 3]) {
      if (!predicts(face, quarters, predicted(face, h))) {
        throw new Error(`the geometry's prediction for ${face} x${quarters} disagrees with the cube model`);
      }
    }
  }

  // 5. A rotation of a SCRAMBLED cube preserves its symmetry order, and the order divides 24.
  let t = SOLVED;
  for (const m of ['R', 'U', "F'", 'L2', 'D']) t = applyMove(t, m);
  const f = toFacelets(t);
  const order = symmetryOrder(f);
  if (24 % order !== 0) throw new Error(`symmetry order ${order} does not divide 24`);
  for (let r = 0; r < 24; r++) {
    if (symmetryOrder(rotateFacelets(f, r)) !== order) throw new Error('symmetry order changed under rotation');
  }
  if (canonicalLook(f) !== canonicalLook(rotateFacelets(f, 7))) {
    throw new Error('two views of one cube canonicalise differently');
  }

  return { stickers: 54, rotations: 24, symmetries: 48, movesChecked: MOVE_NAMES.length };
}

if (process.argv[1]?.endsWith('cube-look.mjs')) {
  console.log('cube-look geometry:', verify());
  const solved = toFacelets(SOLVED);
  console.log('solved symmetry order:', symmetryOrder(solved));
  for (const [name, alg] of [['checkerboard', 'U2 D2 F2 B2 L2 R2'], ['superflip', "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2"]]) {
    let s = SOLVED;
    for (const m of alg.split(/\s+/)) s = applyMove(s, m);
    console.log(`${name.padEnd(14)} symmetry order ${symmetryOrder(toFacelets(s))}`);
  }
}
