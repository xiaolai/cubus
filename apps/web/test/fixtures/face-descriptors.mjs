// The eighteen face turns as move descriptors, derived INDEPENDENTLY of the notation parser.
//
// This table lived in the renderer's `pose.js` as `MOVE_DESCRIPTORS` — a bridge for callers that still
// spoke in face letters. The renderer stopped using it when `readToken` became the one parser (ADR 0004
// decision 5), so it had no production consumer and its initializer still shipped in the vendor bundle
// (Codex audit, 2026-09-16). Its VALUE was never production: it is what `cube-notation.test.mjs` checks
// the parser against, and the check is worth having precisely because the two are derived differently —
// this one from the piece model's move names and the app's geometry table, the parser from the token's
// letters. Two derivations agreeing is evidence; a parser agreeing with itself is not.
//
// NO PROTOTYPE, kept from the original: a move token is whatever an author typed, and on an ordinary
// object `constructor`, `toString` and `__proto__` are all present. The renderer's parser looked one up
// in a table like this, got a function back, and turned `alg="toString"` into an empty descriptor that
// threw at play time instead of being refused (found by verification, 2026-09-14). `readToken` refuses
// those by its own grammar now, which `cube-notation.test.mjs` asserts directly — this table keeps the
// shape so a reader of the fixture cannot reintroduce the lesson by copying it.
import { MOVES } from '../../lib/cube-pieces.js';
import { FACE_NORMAL } from '../../lib/cube-layout.js';

/** The axis a face's normal lies along, and which end of it the face sits on — read off the app's one
 *  geometry table rather than typed out again. */
const axisOf = (face) => {
  const n = FACE_NORMAL[face];
  const index = n.findIndex((c) => c !== 0);
  return { axis: ['x', 'y', 'z'][index], sign: n[index] };
};

export const FACE_DESCRIPTORS = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(
  Object.keys(MOVES).map((name) => {
    const { axis, sign } = axisOf(name[0]);
    const turns = name.endsWith('2') ? 2 : 1;
    const dir = name.endsWith("'") ? -1 : 1;
    return [name, Object.freeze({ axis, layers: Object.freeze([sign]), turns, angle: -dir * sign * turns * (Math.PI / 2) })];
  }),
)));
