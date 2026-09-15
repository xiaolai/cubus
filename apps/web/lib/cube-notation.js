// Move notation, as syntax and nothing else: text in, moves out, with no hold and no colour anywhere.
//
// dev-docs/adr/0004-orientation-notation-and-colour-are-three-things.md, decision 4. A letter names a
// POSITION — `R` is whatever face is on the right — so what a move does to a particular cube is the
// interpreter's business (plan item 1.2 of dev-docs/tutorial-capability-plan.md), never this file's.
//
// WHAT IS READ, and where each spelling comes from:
//   face turns        U R F D L B                      WCA Regulations 12a1
//   outer-block       Rw, 2Rw (two layers)             WCA 12a2 — on a 3×3 only n = 2 is a wide move
//   wide, lower case  r l u d f b                      community usage for the same two layers
//   slices            M (as L), E (as D), S (as F)     community usage; WCA defines no slice moves
//   rotations         x (as R), y (as U), z (as F)     WCA 12a4
//   amounts           none, ', 2, 2'
//
// A MOVE IS A LAYER MASK, exactly the descriptor `packages/cubus-cube/src/pose.js` executes:
// `{ axis, layers, angle, turns }`, `layers` drawn from -1, 0, +1 along the axis, `angle` signed the way
// the picture turns (a clockwise turn of a face on the positive side of its axis is a NEGATIVE angle).
// A face turn is one outer layer, a wide move two, a slice the middle one, a rotation all three.
//
// Refusal is whole and loud: a text with one token this file cannot read is refused, naming the token,
// its place in the sequence and its character offset. A sequence that silently skipped a move would
// draw a wrong cube with full confidence.

const QUARTER = Math.PI / 2;

/** The axis a letter turns about, the layers it moves, and the side of the axis its clockwise is seen
 *  from (+1 for the face on the axis's positive end). */
const BASES = Object.freeze(Object.assign(Object.create(null), {
  R: { axis: 'x', layers: [1], side: 1, kind: 'face' },
  L: { axis: 'x', layers: [-1], side: -1, kind: 'face' },
  U: { axis: 'y', layers: [1], side: 1, kind: 'face' },
  D: { axis: 'y', layers: [-1], side: -1, kind: 'face' },
  F: { axis: 'z', layers: [1], side: 1, kind: 'face' },
  B: { axis: 'z', layers: [-1], side: -1, kind: 'face' },
  M: { axis: 'x', layers: [0], side: -1, kind: 'slice' },
  E: { axis: 'y', layers: [0], side: -1, kind: 'slice' },
  S: { axis: 'z', layers: [0], side: 1, kind: 'slice' },
  r: { axis: 'x', layers: [0, 1], side: 1, kind: 'wide' },
  l: { axis: 'x', layers: [-1, 0], side: -1, kind: 'wide' },
  u: { axis: 'y', layers: [0, 1], side: 1, kind: 'wide' },
  d: { axis: 'y', layers: [-1, 0], side: -1, kind: 'wide' },
  f: { axis: 'z', layers: [0, 1], side: 1, kind: 'wide' },
  b: { axis: 'z', layers: [-1, 0], side: -1, kind: 'wide' },
  x: { axis: 'x', layers: [-1, 0, 1], side: 1, kind: 'rotation' },
  y: { axis: 'y', layers: [-1, 0, 1], side: 1, kind: 'rotation' },
  z: { axis: 'z', layers: [-1, 0, 1], side: 1, kind: 'rotation' },
}));

/** `2Rw'` -> the optional layer count, the base, the w, the amount. Anchored: the whole token or nothing. */
const TOKEN = /^(\d)?([URFDLBMESrludfbxyz])(w)?(2'|2|')?$/;

/**
 * Read one token, or explain why not. Returns `{ move }` or `{ why }`.
 *
 * Exported for the element, which reads its `alg` one token at a time.
 */
export function readToken(token) {
  const m = TOKEN.exec(token);
  if (!m) return { why: 'not a move' };
  const [, count, letter, w, amount = ''] = m;
  if (!Object.hasOwn(BASES, letter)) return { why: 'not a move' };
  let base = BASES[letter];
  if (w || count) {
    // `Rw` and `2Rw` are the only outer-block moves a 3×3 has; `r` already is one, and a slice or a
    // rotation has no outer block to widen.
    if (base.kind !== 'face') return { why: `"${letter}" cannot be written as an outer-block move` };
    if (!w) return { why: 'a layer count needs a w, as in 2Rw' };
    if (count !== undefined && count !== '2') {
      return { why: `a 3×3 has outer blocks of 2 layers only (${count}${letter}w)${count === '3' ? ' — write the rotation instead' : ''}` };
    }
    base = BASES[letter.toLowerCase()];
  }
  const turns = amount.startsWith('2') ? 2 : 1;
  const clockwise = amount === "'" || amount === "2'" ? -1 : 1;
  // A clockwise turn, seen from outside the face on side `side`, is a negative angle on that side's axis.
  const angle = -clockwise * base.side * turns * QUARTER;
  const name = `${w || count ? `${letter}w` : letter}${amount}`;
  return {
    move: Object.freeze({
      token: name, kind: base.kind, axis: base.axis, layers: Object.freeze([...base.layers]), angle, turns,
    }),
  };
}

/**
 * Text to moves. Whitespace separates tokens; an empty text is no moves.
 *
 * Throws on the first token that is not a move, naming it, its position (1-based) and its character
 * offset, and returns nothing partial.
 */
export function parse(text) {
  const src = String(text ?? '');
  const moves = [];
  const pattern = /\S+/g;
  let hit;
  let position = 0;
  while ((hit = pattern.exec(src)) !== null) {
    position += 1;
    const read = readToken(hit[0]);
    if (!read.move) {
      throw new Error(`notation: "${hit[0]}" at move ${position} (character ${hit.index}) — ${read.why}`);
    }
    moves.push(read.move);
  }
  return Object.freeze(moves);
}

/** Moves back to text, in their own spellings. */
export const formatMoves = (moves) => moves.map((m) => m.token).join(' ');
