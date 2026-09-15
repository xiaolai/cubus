// The interpreter: the one place a letter the child reads becomes a move of the cube's own faces.
//
// dev-docs/adr/0004-orientation-notation-and-colour-are-three-things.md, decision 5; plan item 1.2 of
// dev-docs/tutorial-capability-plan.md.
//
//   run(moves, hold, state) -> { state, hold, drawn }
//
// `hold` is `[up, front]`, two identity faces: the scan frame's letters, white-up green-front being
// `['U', 'F']`. `state` is the piece model (`lib/cube-pieces.js`) in that identity frame. `moves` are
// read in the HOLD IN FORCE when each is made — `R` is the face on the child's right — and `drawn` is
// the same sequence as identity-frame tokens, the spelling `<cubus-cube>`'s `alg` takes.
//
// THE THREE RULES, each checked against an oracle that shares no code with this file
// (`test/cube-moves.test.mjs`):
//
//   A held face letter names the identity face now in that position, turning the same way — a rotation
//   is not a reflection, so clockwise seen from outside a face stays clockwise wherever it has gone.
//
//   A held whole-cube turn rotates about the WORLD axis: `x` is always toward the child's right-hand
//   face, whichever face that is. In the cube's own axes that is the conjugate `frame⁻¹ · R · frame`,
//   which is what an identity-frame executor then composes on the right.
//
//   A held wide move or slice is the identity layer mask on the identity axis now lying along the held
//   one, with its layers and its angle both signed by which way round that axis lies. It moves pieces
//   AND the hold, because it moves centres: relative to the centres `M` is `R L'`, and `Rw` is `L`.
//
// The identity-frame executor is `applyIdentity`, exported so the renderer's pose module runs the same
// arithmetic rather than a second copy of it.
import { applyMove } from './cube-pieces.js';
import { parse, readToken } from './cube-notation.js';
import { FACE_LETTERS, orientationMatrix } from './cube-orientation.js';

const QUARTER = Math.PI / 2;
const AXES = ['x', 'y', 'z'];

/** Face letter -> outward normal, identity frame (R = +x, U = +y, F = +z). */
const NORMAL = Object.freeze({
  R: [1, 0, 0], L: [-1, 0, 0], U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1], B: [0, 0, -1],
});

const faceOf = (v) => FACE_LETTERS.split('').find((f) => NORMAL[f].every((c, i) => c === v[i]));
const faceAt = (axis, sign) => faceOf(AXES.map((a) => (a === axis ? sign : 0)));

/** A quarter turn of an integer vector about `axis`, counter-clockwise seen from its positive end. */
function quarter(v, axis, dir) {
  const [x, y, z] = v;
  if (axis === 'x') return dir > 0 ? [x, -z, y] : [x, z, -y];
  if (axis === 'y') return dir > 0 ? [z, y, -x] : [-z, y, x];
  return dir > 0 ? [-y, x, z] : [y, -x, z];
}

const turnVector = (v, axis, quarters) => {
  let out = v;
  for (let i = 0; i < Math.abs(quarters); i++) out = quarter(out, axis, Math.sign(quarters));
  return out;
};

const quartersOf = (angle) => Math.round(angle / QUARTER);

/** The piece-model name of a turn of the face on `sign` of `axis` by `angle` — `R`, `R2`, `R'` — or null. */
function faceTurnName(axis, sign, angle) {
  const face = faceAt(axis, sign);
  // A clockwise quarter of a face on the positive side is a negative angle.
  const clockwise = (((-sign * quartersOf(angle)) % 4) + 4) % 4;
  return [null, face, `${face}2`, `${face}'`][clockwise];
}

function checkHold(hold) {
  if (!Array.isArray(hold) || hold.length !== 2) throw new Error('cube-moves: a hold is [up, front]');
  return orientationMatrix(hold[0], hold[1]); // throws on a pair that is not one
}

/** The hold a frame matrix (rows: world right, up, front, as identity vectors) shows. */
const holdOfRows = (rows) => [faceOf(rows[1]), faceOf(rows[2])];

/**
 * An identity-frame layer move applied to a cube held `hold`: the pieces it moves, relative to the
 * centres, and the hold it leaves.
 *
 * A mask that includes the middle layer turns the whole cube and turns the layers outside the mask
 * back: so a slice is two outer faces turned the other way, a wide move one, a rotation none — and the
 * whole-cube part changes the hold.
 */
export function applyIdentity(move, hold, state) {
  const rows = checkHold(hold);
  const { axis, layers, angle } = move;
  if (!AXES.includes(axis)) throw new Error(`cube-moves: no axis "${axis}"`);
  const whole = layers.includes(0);
  const outers = whole ? [1, -1].filter((s) => !layers.includes(s)) : layers.filter((s) => s !== 0);
  let next = state;
  for (const sign of outers) {
    const name = faceTurnName(axis, sign, whole ? -angle : angle);
    if (name) next = applyMove(next, name);
  }
  if (!whole) return { state: next, hold: [...hold] };
  // The cube turned by `angle` about its own `axis`: each world axis's identity vector turns the other
  // way (rows of frame · Q are rows of frame turned by Q⁻¹).
  const q = quartersOf(angle);
  const turned = rows.map((r) => turnVector([...r], axis, -q));
  return { state: next, hold: holdOfRows(turned) };
}

/** A held move, as the identity-frame move it is on a cube held `hold`. */
export function toIdentity(move, hold) {
  const rows = checkHold(hold);
  const worldAxis = AXES.indexOf(move.axis);
  if (worldAxis < 0) throw new Error(`cube-moves: no axis "${move.axis}"`);
  // The identity vector lying along the world axis: its one non-zero component is the identity axis,
  // and its sign says which way round that axis lies.
  const along = rows[worldAxis];
  const index = along.findIndex((c) => c !== 0);
  const sign = along[index];
  return {
    axis: AXES[index],
    layers: [...move.layers].map((l) => l * sign).sort((a, b) => a - b),
    angle: move.angle * sign,
    turns: move.turns,
  };
}

/** The identity face at the position `face` names — the face the child means — on a cube held `hold`. */
export function identityFace(face, hold) {
  const rows = checkHold(hold);
  const world = NORMAL[face];
  if (!world || !Object.hasOwn(NORMAL, face)) throw new Error(`cube-moves: "${face}" is not a face`);
  // The identity vector lying along a world vector is the rows weighted by its components.
  return faceOf([0, 1, 2].map((j) => rows.reduce((sum, row, i) => sum + world[i] * row[j], 0)));
}

/** The position identity face `face` is at — the letter the child reads it by — on a cube held `hold`. */
export function heldFace(face, hold) {
  const rows = checkHold(hold);
  const identity = NORMAL[face];
  if (!identity || !Object.hasOwn(NORMAL, face)) throw new Error(`cube-moves: "${face}" is not a face`);
  return faceOf(rows.map((row) => row.reduce((sum, c, j) => sum + c * identity[j], 0)));
}

const SELECTOR = /\b(layer|slot|piece):([URFDLB]{1,3})\b/gi;

/**
 * A highlight or focus spec written the way the child holds the cube, in identity letters.
 *
 * Every letter of `slot:`, `layer:` and `piece:` names a position in the hold in force, as a move letter
 * does (ADR 0004 decision 6); the bare kinds — `centers`, `edges`, `corners` — are the same set in
 * every frame and pass through.
 */
export function convertSelectors(spec, hold) {
  checkHold(hold);
  return String(spec ?? '').replace(
    SELECTOR,
    (_, kind, letters) => `${kind}:${[...letters.toUpperCase()].map((c) => identityFace(c, hold)).join('')}`,
  );
}

/** Identity layer masks -> the letter that names them, per axis. */
const LETTER = Object.freeze({
  x: { '1': 'R', '-1': 'L', '0': 'M', '0,1': 'r', '-1,0': 'l', '-1,0,1': 'x' },
  y: { '1': 'U', '-1': 'D', '0': 'E', '0,1': 'u', '-1,0': 'd', '-1,0,1': 'y' },
  z: { '1': 'F', '-1': 'B', '0': 'S', '0,1': 'f', '-1,0': 'b', '-1,0,1': 'z' },
});

/** The token an identity-frame move is written as — the inverse of `readToken` on its descriptor. */
export function tokenOf(move) {
  const key = [...move.layers].sort((a, b) => a - b).join(',');
  const letter = LETTER[move.axis]?.[key];
  if (!letter) throw new Error(`cube-moves: no token for axis ${move.axis}, layers ${key}`);
  const clockwiseAngle = readToken(letter).move.angle;
  const count = quartersOf(move.angle) / quartersOf(clockwiseAngle);
  const amount = { 1: '', [-1]: "'", 2: '2', [-2]: "2'" }[count];
  if (amount === undefined) throw new Error(`cube-moves: ${count} quarter turns is not an amount`);
  return `${letter}${amount}`;
}

/**
 * The child's moves, read in the hold in force as each is made, applied to `state` held `hold`.
 *
 * `moves` is `parse()`'s output, or text for it. Returns the pieces, the hold after the last move, and
 * the identity-frame tokens that draw the same sequence on an element whose `orientation` is `hold`.
 */
export function run(moves, hold, state) {
  const list = typeof moves === 'string' ? parse(moves) : moves;
  checkHold(hold);
  let now = { state, hold: [...hold] };
  const drawn = [];
  for (const move of list) {
    const identity = toIdentity(move, now.hold);
    drawn.push(tokenOf(identity));
    now = applyIdentity(identity, now.hold, now.state);
  }
  return Object.freeze({ state: now.state, hold: Object.freeze(now.hold), drawn: Object.freeze(drawn) });
}
