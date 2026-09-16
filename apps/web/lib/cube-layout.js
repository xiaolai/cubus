// Which sticker of the 54-character facelet string belongs to which slot — the layout, and nothing else.
//
// Lifted out of `lib/two-phase.js` on 2026-09-15 (plan item 1.4 of dev-docs/tutorial-capability-plan.md).
// The tables were private to the solver, and two readers need them without needing a solver: the
// stage pictures, which blank the stickers a target leaves free, and the questions a tutorial asks of a
// painted picture (`lib/cube-questions.js`), which may import only read-only modules
// (dev-docs/adr/0005-the-renderer-plays-scripts-methods-choose.md, decision 2). One copy, so the layout
// has one place to be wrong.
//
// The facelet string is in the standard order every solver and cubejs share: faces U R F D L B, nine
// stickers each, row-major with the face held as the published convention holds it. Colours are named
// by their home face's letter. cube-pieces' CORNERS/EDGES names double as the colour sequences — letter
// k of 'URF' is the colour at the cubie's k-th sticker — and `two-phase.test.mjs` pins the convention to
// cubejs by round-tripping random states.

/** Facelet indices of each corner slot's three stickers, U/D sticker first. */
export const CORNER_FACELETS = Object.freeze([
  [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
  [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
].map((f) => Object.freeze(f)));

/** Facelet indices of each edge slot's two stickers, the EDGES-name order first. */
export const EDGE_FACELETS = Object.freeze([
  [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25], [30, 43], [34, 52],
  [23, 12], [21, 41], [50, 39], [48, 14],
].map((f) => Object.freeze(f)));

/** The centre sticker of each face, in U R F D L B order. */
export const CENTERS = Object.freeze([4, 13, 22, 31, 40, 49]);

/** The face letters, in facelet order. */
export const FACE_LETTERS = 'URFDLB';

/**
 * Face letter -> outward normal, in the fixed frame every part of this app shares: R = +x, U = +y, F = +z.
 *
 * ONE TABLE. It was typed out in three production modules — `cube-orientation.js`, `cube-moves.js` and
 * the renderer's `pose.js` — each maintaining the same coordinate convention independently (Codex audit,
 * 2026-09-16). Three spellings of one convention are three chances for one of them to have a sign the
 * other way round, and the one that did would be found by a drawing looking wrong rather than by a test.
 *
 * Frozen ROW BY ROW, not just at the top: `Object.freeze` is shallow, and `orientationMatrix` hands two
 * of these vectors straight back as rows of its matrix — one `m[1][1] = 0` by a caller corrupted the
 * module for every later call, because the next call read the same array.
 */
export const FACE_NORMAL = Object.freeze({
  U: Object.freeze([0, 1, 0]), R: Object.freeze([1, 0, 0]), F: Object.freeze([0, 0, 1]),
  D: Object.freeze([0, -1, 0]), L: Object.freeze([-1, 0, 0]), B: Object.freeze([0, 0, -1]),
});

/**
 * Which facelet indices belong to which slot, and which letter each face's centre carries, as one value.
 *
 * READ-ONLY BY CONSTRUCTION: the arrays inside are frozen too, because `Object.freeze` is shallow and
 * these are the tables every facelet string in the app is built from.
 */
export const SLOT_FACELETS = Object.freeze({
  corners: CORNER_FACELETS,
  edges: EDGE_FACELETS,
  centers: CENTERS,
  faces: FACE_LETTERS,
});
