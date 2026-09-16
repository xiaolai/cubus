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
  const { whole } = faceTurnsOf(move);
  const next = turnPieces(move, state);
  if (!whole) return { state: next, hold: [...hold] };
  // The cube turned by `angle` about its own `axis`: each world axis's identity vector turns the other
  // way (rows of frame · Q are rows of frame turned by Q⁻¹).
  const q = quartersOf(move.angle);
  const turned = rows.map((r) => turnVector([...r], move.axis, -q));
  return { state: next, hold: holdOfRows(turned) };
}

/**
 * The outer faces an identity-frame layer move turns, relative to the centres, and whether it turns the
 * whole cube: `{ whole, turns: [{ face, sign, name, angle }] }`, `name` the piece-model move (`R`, `L'`)
 * or null for no net turn, `angle` the geometry's.
 *
 * The rule, uniform over every mask: a mask that includes the middle layer turns the WHOLE CUBE and turns
 * the layers outside the mask back. So a face turn is the plain case, a wide move the whole cube with one
 * face turned back, a slice the whole cube with both faces turned back, a rotation nothing turned back.
 * Exported for the renderer's pose module, which moves centres' stickers by the same faces.
 */
export function faceTurnsOf(move) {
  const { axis, layers, angle } = move;
  if (!AXES.includes(axis)) throw new Error(`cube-moves: no axis "${axis}"`);
  const whole = layers.includes(0);
  const outers = whole ? [1, -1].filter((s) => !layers.includes(s)) : layers.filter((s) => s !== 0);
  const turned = whole ? -angle : angle;
  return {
    whole,
    turns: outers.map((sign) => ({ face: faceAt(axis, sign), sign, angle: turned, name: faceTurnName(axis, sign, turned) })),
  };
}

/** The pieces an identity-frame layer move leaves, relative to the centres. */
export function turnPieces(move, state) {
  let next = state;
  for (const { name } of faceTurnsOf(move).turns) if (name) next = applyMove(next, name);
  return next;
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

/**
 * An identity-frame move, as the move the child makes on a cube held `hold` — the inverse of `toIdentity`.
 *
 * What a display needs: a walk is stored in the cube's own letters and shown in the child's (ADR 0003), and a
 * regrip or a slice is a move like any other there. The identity axis lies along one world axis; the child's
 * move is about that world axis, its layers and angle signed by which way round the identity axis lies along
 * it — exactly `toIdentity`'s arithmetic read the other way.
 */
export function heldMove(move, hold) {
  const rows = checkHold(hold);
  const index = AXES.indexOf(move.axis);
  if (index < 0) throw new Error(`cube-moves: no axis "${move.axis}"`);
  const worldAxis = rows.findIndex((row) => row[index] !== 0);
  const sign = rows[worldAxis][index];
  return {
    axis: AXES[worldAxis],
    layers: [...move.layers].map((l) => l * sign).sort((a, b) => a - b),
    angle: move.angle * sign,
    turns: move.turns,
  };
}

/** An identity-frame token, as the token the child reads on a cube held `hold`. */
export const heldToken = (token, hold) => {
  const { move, why } = readToken(token);
  if (!move) throw new Error(`cube-moves: "${token}" is ${why}`);
  return tokenOf(heldMove(move, hold));
};

/**
 * Identity-frame tokens as the FACE TURNS they are to the pieces: a rotation is none, a wide move its one
 * face, a slice its two. What a caller that replays with face turns only — cubejs, the piece model's
 * `applyAlg`, a move count in the half-turn metric — can take.
 */
export function faceTurnsAlg(tokens) {
  const list = typeof tokens === 'string' ? tokens.trim().split(/\s+/).filter(Boolean) : tokens;
  return list.flatMap((token) => {
    const { move, why } = readToken(token);
    if (!move) throw new Error(`cube-moves: "${token}" is ${why}`);
    return faceTurnsOf(move).turns.map((t) => t.name).filter(Boolean);
  }).join(' ');
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

const SELECTOR = /\b(layer|slot|piece):([URFDLB]{1,3})(?:\/([URFDLB]))?(?![\w/])/gi;

/**
 * A highlight or focus spec with every face letter relabelled by `faceOf` — the ONE rewriting both
 * directions share.
 *
 * Every letter of `slot:`, `layer:` and `piece:` names a face, as a move letter does (ADR 0004
 * decision 6), and so does a sticker's suffix — `slot:UF/U` is the sticker facing the child's top (plan
 * item 4.1). The bare kinds — `centers`, `edges`, `corners` — are the same set in every frame and pass
 * through. Shared because the two directions had drifted: the display's renaming (`renameSelectors` in
 * lib/solving-hold.js) kept its own copy without the suffix, so a round trip turned `slot:DF/D` into
 * `slot:UB/D` — a sticker of a piece that does not carry it.
 */
export function relabelSelectors(spec, faceOf) {
  const relabel = (letters) => [...letters.toUpperCase()].map(faceOf).join('');
  return String(spec ?? '').replace(
    SELECTOR,
    (_, kind, letters, face) => `${kind}:${relabel(letters)}${face ? `/${relabel(face)}` : ''}`,
  );
}

/** A spec written the way the child holds the cube, in the cube's own letters. */
export function convertSelectors(spec, hold) {
  checkHold(hold);
  return relabelSelectors(spec, (c) => identityFace(c, hold));
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
