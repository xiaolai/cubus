// The 24 orientations of a cube, as a facelet operation and as a rotation.
//
// An orientation is named by two face letters — which cube face points UP, and which faces the
// VIEWER. That is exactly the 24 a cube has (6 choices of up, 4 of front), and a pair on one axis
// (`U D`, `F F`) is refused rather than resolved to some third thing.
//
// TURNING A CUBE DOES TWO THINGS TO A FACELET STRING, and doing only the first is the classic
// error: the sticker at index i moves to a new index, AND the letter naming its colour changes,
// because that letter names a FACE and the face has moved. A solved cube is solved in every
// orientation, which is only true when both halves happen — so `turnFacelets(SOLVED, …)` returning
// the solved string is the cheapest proof that neither half was dropped.
//
// WHERE THE NUMBERS COME FROM. The geometry below is written out, not remembered, and it is
// checked against something that was not written for it: `ROTATION_PERMS.x` and `.z` in
// `two-phase.js` are facelet rotations DERIVED from cubejs and re-derived by that suite on every
// run. `x` is this module's ('F','D') and `z` is its ('L','F'), so if the sticker layout here had
// a row reversed or an axis un-negated those two comparisons would fail. Composing rotations can
// never produce a reflection, so with the generators validated the whole family is inside the
// rotation group by construction — that is a stronger statement than testing a determinant, and
// the determinant is asserted anyway because it costs nothing.
//
// The relabelling is derived the same way `two-phase.js` derives its own: from where the rotation
// puts the six CENTRES, and asserted to be a bijection. Never typed.

// Which facelet is each face's centre: the layout's one table, not a copy of it. This module kept its
// own until plan item 3.2, when the bundle's guard could not tell the two apart by name.
import { CENTERS, FACE_LETTERS } from './cube-layout.js';

// Re-exported, not re-typed: the letters and the centres are one table's two halves, and this module
// kept its own copy of the letters after taking the centres from the layout (Codex audit, 2026-09-16).
// Callers that read them from here — `cube-questions.js` has them on its allow-list — keep working.
export { FACE_LETTERS };

/** Outward normal of each face, in the renderer's fixed frame. */
// Frozen ROW BY ROW, not just at the top: `Object.freeze` is shallow, so freezing only the map
// left every vector writable — and `orientationMatrix` hands two of them straight back as rows.
// One `m[1][1] = 0` by a caller permanently corrupted the module for every later call, because the
// next call reads the same array. The copies in `orientationMatrix` are the real fix; these
// freezes are the assertion that stops it coming back silently.
const NORMAL = Object.freeze({
  U: Object.freeze([0, 1, 0]), R: Object.freeze([1, 0, 0]), F: Object.freeze([0, 0, 1]),
  D: Object.freeze([0, -1, 0]), L: Object.freeze([-1, 0, 0]), B: Object.freeze([0, 0, -1]),
});

/**
 * The outward normal of a face letter, or null.
 *
 * An OWN-property lookup, and only for the six letters. A bare `NORMAL[x]` is truthy for
 * `constructor`, `toString` and `__proto__` — inherited from `Object.prototype` — so every guard
 * written as `!NORMAL[up]` waved them through and `orientationMatrix('constructor', 'F')` returned
 * a matrix whose determinant was NaN instead of refusing. These are exported entry points, so they
 * defend themselves rather than trusting a caller to have filtered first.
 */
export function isFace(letter) {
  return typeof letter === 'string' && letter.length === 1 && FACE_LETTERS.includes(letter);
}

function normalOf(letter) {
  return isFace(letter) ? NORMAL[letter] : null;
}


/**
 * How each face is READ: the in-plane direction of increasing column ("right" in the view) and of
 * DECREASING row ("up" in the view). This is the standard URFDLB layout — U read with B at the top
 * of the view, D with F at the top, the four sides read upright — and it is the one assumption in
 * this file that could be wrong in a way nothing else would notice, which is why the suite pins it
 * against `ROTATION_PERMS` rather than trusting it.
 */
const READ = Object.freeze({
  U: { right: [1, 0, 0], up: [0, 0, -1] },
  R: { right: [0, 0, -1], up: [0, 1, 0] },
  F: { right: [1, 0, 0], up: [0, 1, 0] },
  D: { right: [1, 0, 0], up: [0, 0, 1] },
  L: { right: [0, 0, 1], up: [0, 1, 0] },
  B: { right: [-1, 0, 0], up: [0, 1, 0] },
});

const cross = (a, b) => Object.freeze([
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]);
const apply = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const key = (v) => v.map((n) => Math.round(n)).join(',');

/** Every sticker, by facelet index: where it sits in space and which way it faces. */
const STICKERS = (() => {
  const out = new Array(54);
  for (let f = 0; f < 6; f++) {
    const letter = FACE_LETTERS[f];
    const n = normalOf(letter);
    const { right, up } = READ[letter];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const c = col - 1;
        const r = 1 - row;
        out[f * 9 + row * 3 + col] = {
          pos: [
            n[0] + right[0] * c + up[0] * r,
            n[1] + right[1] * c + up[1] * r,
            n[2] + right[2] * c + up[2] * r,
          ],
          normal: n,
        };
      }
    }
  }
  return out;
})();

/** Reverse lookup: "position|normal" to facelet index. */
const INDEX_OF = new Map(STICKERS.map((s, i) => [`${key(s.pos)}|${key(s.normal)}`, i]));

/** The 24 legal orientations, as `[up, front]` pairs, in a stable order. */
export const ORIENTATIONS = Object.freeze(
  [...FACE_LETTERS].flatMap((up) =>
    [...FACE_LETTERS]
      .filter((front) => !sameAxis(up, front))
      .map((front) => Object.freeze([up, front])),
  ),
);

/** Are these two face letters on one axis — the pairs an orientation may not name? */
export function sameAxis(a, b) {
  const u = normalOf(a);
  const v = normalOf(b);
  if (!u || !v) return false;
  return Math.abs(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) === 1;
}

function checkPair(up, front) {
  if (!normalOf(up) || !normalOf(front)) {
    throw new Error(`cube-orientation: expected two of URFDLB, got "${up}" and "${front}"`);
  }
  if (sameAxis(up, front)) {
    throw new Error(
      `cube-orientation: "${up} ${front}" names one axis twice — up and front must be perpendicular`,
    );
  }
}

/**
 * The rotation that brings face `up` to the top and face `front` to the viewer, as three rows.
 *
 * `right = up × front` is the handedness, and it is the single sign that decides whether this
 * draws a cube or its mirror image. The suite checks the determinant, but what actually pins it is
 * the comparison against the cubejs-derived permutations: a mirror satisfies every count, every
 * multiset and every centre check ever written.
 */
export function orientationMatrix(up, front) {
  checkPair(up, front);
  const u = normalOf(up);
  const f = normalOf(front);
  // COPIES, and frozen. `cross` builds a fresh array, but `u` and `f` are the module's own
  // vectors, so returning them made every caller a co-owner of this module's state — one
  // `m[1][1] = 0` corrupted it permanently. Copies fix that; freezing turns a caller who writes to
  // the result from silently-working into a loud TypeError, which is the honest outcome for code
  // that is confused about who owns the value.
  return Object.freeze([cross(u, f), Object.freeze([...u]), Object.freeze([...f])]);
}

/** The determinant of a 3×3 given as rows. +1 for a rotation, −1 for a reflection. */
export function determinant(m) {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

const permCache = new Map();

/**
 * Where each facelet's contents COME FROM: `turned[i] = original[perm[i]]`, the same convention as
 * `ROTATION_PERMS` in `two-phase.js` so the two can be compared directly.
 */
export function orientationPerm(up, front) {
  checkPair(up, front);
  const cached = permCache.get(`${up}${front}`);
  if (cached) return cached;
  const m = orientationMatrix(up, front);
  const perm = new Array(54).fill(-1);
  for (let i = 0; i < 54; i++) {
    const s = STICKERS[i];
    const to = INDEX_OF.get(`${key(apply(m, s.pos))}|${key(apply(m, s.normal))}`);
    if (to === undefined) throw new Error(`cube-orientation: sticker ${i} left the cube`);
    perm[to] = i;
  }
  if (perm.includes(-1)) throw new Error('cube-orientation: rotation is not a bijection');
  const frozen = Object.freeze(perm);
  permCache.set(`${up}${front}`, frozen);
  return frozen;
}

/**
 * Which face letter each old letter becomes, derived from where the rotation puts the centres.
 *
 * Derived rather than tabulated for the reason `two-phase.js` gives at the same derivation: a
 * relabelling typed by hand is six chances to transpose two letters, and five of the six ways to
 * get it wrong still leave nine of each colour.
 */
export function orientationRelabel(up, front) {
  const perm = orientationPerm(up, front);
  const relabel = {};
  for (let c = 0; c < 6; c++) {
    relabel[FACE_LETTERS[Math.floor(perm[CENTERS[c]] / 9)]] = FACE_LETTERS[c];
  }
  if (new Set(Object.values(relabel)).size !== 6) {
    throw new Error(`cube-orientation: "${up} ${front}" relabelling is not a bijection`);
  }
  return relabel;
}

/**
 * `facelets` as the same cube physically turned so `up` points up and `front` faces the viewer.
 *
 * Both halves: the stickers move, and the letters are renamed to the faces they now sit on. A
 * solved cube comes back solved, which is the property that catches half an implementation.
 */
export function turnFacelets(facelets, up, front) {
  const fl = String(facelets);
  if (fl.length !== 54) {
    throw new Error(`cube-orientation: expected 54 facelets, got ${fl.length}`);
  }
  const perm = orientationPerm(up, front);
  const relabel = orientationRelabel(up, front);
  let out = '';
  for (let i = 0; i < 54; i++) {
    const c = fl[perm[i]];
    // A scan can hand over '?' for a sticker it could not read. It is not a face, so it has no new
    // face name — it travels with its position and stays unreadable, rather than being refused
    // here and turning an honest gap into a thrown error halfway up the stack.
    out += relabel[c] ?? c;
  }
  return out;
}
