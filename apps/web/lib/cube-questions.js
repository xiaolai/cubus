// Questions a tutorial asks of ONE cube: which pieces are home, where a piece is, what is in a slot,
// which pieces of a layer carry none of a face's colour.
//
// dev-docs/adr/0005-the-renderer-plays-scripts-methods-choose.md, decision 2; plan item 1.4 of
// dev-docs/tutorial-capability-plan.md.
//
// A QUESTION READS; IT NEVER APPLIES A MOVE. That is the line between an oracle and a solver, and it is
// kept by what this module is allowed to import — read-only tables and predicates only, held by the
// renderer boundary test (plan item 1.5). A question that needs a move's result is not a question: a script
// applies the author's move through the interpreter and asks about the cube it leaves. What a STAGE is
// ("the cross is done") belongs to a method and is composed from these answers.
//
// Every question is in the identity frame. A child's position — "the top layer" — is read into identity
// letters by the interpreter first (`identityFace` in `lib/cube-moves.js`).
//
// A cube is either a piece state (`lib/cube-pieces.js`) or a PAINTED PICTURE: a 54-character facelet
// string whose `?` stickers are unknown (a stage target, a half-read scan). A picture is not a state:
// a piece is answered only when every one of its stickers is painted AND they spell a real piece in a
// real twist; everything else is unknown, and a list answer says which slots it could not read rather
// than leaving them out.
import { CORNERS, EDGES, pieceStateError } from './cube-pieces.js';
import { CENTERS, CORNER_FACELETS, EDGE_FACELETS, FACE_LETTERS as FACE_LETTER } from './cube-layout.js';
import { pieceKey } from './cube-highlight.js';

const sorted = (letters) => [...letters].sort().join('');

/** Which named piece a set of sticker letters spells, and in which twist — or null. */
function identify(letters, names) {
  if (letters.includes('?')) return null;
  const key = sorted(letters.join(''));
  const name = names.find((n) => sorted(n) === key);
  if (!name) return null;
  // Twist: the offset at which the piece's first letter sits, and the rest must follow it round.
  // A picture that spells the right letters the wrong way round (a mirror) is not this piece.
  const twist = letters.indexOf(name[0]);
  const fits = [...name].every((ch, k) => letters[(k + twist) % letters.length] === ch);
  return fits ? { piece: name, twist } : null;
}

/**
 * A cube as slot records: `{ slot, piece, twist }` for each corner and edge slot, `piece` and `twist`
 * null where a picture does not say. Throws on something that is neither a state nor a picture.
 */
export function readCube(cube) {
  if (typeof cube === 'string' || typeof cube?.facelets === 'string') {
    const facelets = typeof cube === 'string' ? cube : cube.facelets;
    if (facelets.length !== 54) throw new Error(`cube-questions: a picture is 54 stickers, not ${facelets.length}`);
    const read = (layout, names) => layout.map((at, i) => {
      const found = identify(at.map((f) => facelets[f]), names);
      return Object.freeze({ slot: names[i], piece: found?.piece ?? null, twist: found?.twist ?? null });
    });
    return Object.freeze({ corners: Object.freeze(read(CORNER_FACELETS, CORNERS)), edges: Object.freeze(read(EDGE_FACELETS, EDGES)) });
  }
  // ALL FOUR ARRAYS, their lengths, their ranges and their permutations — through the model's own
  // checker, so a state is well-formed by one definition rather than by whichever fields a reader
  // happened to look at. This checked that all four were arrays and then only `cp` and `ep` for length:
  // `{...SOLVED, co: []}` answered `twist: undefined` and reported a piece not home (Codex audit,
  // 2026-09-16), and an out-of-range edge index crashed `inLayerWithout` a few frames later.
  const wrong = pieceStateError(cube);
  if (wrong) throw new Error(`cube-questions: expected a piece state or a 54-sticker picture — ${wrong}`);
  const { cp, co, ep, eo } = cube;
  return Object.freeze({
    corners: Object.freeze(cp.map((p, i) => Object.freeze({ slot: CORNERS[i], piece: CORNERS[p], twist: co[i] }))),
    edges: Object.freeze(ep.map((p, i) => Object.freeze({ slot: EDGES[i], piece: EDGES[p], twist: eo[i] }))),
  });
}

/**
 * What is wrong with `text` as a complete cube, or null when nothing is.
 *
 * THREE THINGS, in the order a reader meets them: 54 letters of URFDLB; centres that spell the frame a
 * cube is stated in; and stickers that spell a real piece in a real twist at every slot. A checker that
 * asked only the first accepted `'U'.repeat(54)` and the reader downstream threw instead, in a place
 * that no longer knew which step it came from (Codex audit, 2026-09-16). Legality — whether the pieces
 * could be reached by turning — is a further question, and `isCubeState` in `lib/cube-trust.js` asks it.
 */
export function faceletsError(text) {
  // Said apart, because they are different mistakes: a value that is not text at all (and `String(value)`
  // would have hidden it), and text that is not 54 letters of the alphabet a cube is written in.
  if (typeof text !== 'string') return `must be written as text, not ${Array.isArray(text) ? 'a list' : typeof text}`;
  if (!/^[URFDLB]{54}$/.test(text)) return 'expected 54 facelets of URFDLB';
  const centres = [...FACE_LETTER].map((_, i) => text[CENTERS[i]]).join('');
  if (centres !== FACE_LETTER) return `the centres read ${centres}, not ${FACE_LETTER}`;
  const read = readCube(text);
  const unknown = [...read.corners, ...read.edges].filter((r) => r.piece === null).map((r) => r.slot);
  if (unknown.length) return `these slots do not spell a piece: ${unknown.join(', ')}`;
  // AND NO PIECE TWICE. Every slot spelling a real piece is not the same as every piece being in one slot:
  // a cube with two URF corners passed all of the above, and only threw later, out of `ep names one cubie
  // twice`, in a place that no longer knew which script had written it (audit, 2026-09-16). Said here, the
  // reason arrives with the step that wrote it — the same argument the `cube` step's check was added on.
  for (const [kind, records] of [['corner', read.corners], ['edge', read.edges]]) {
    const seen = new Map();
    for (const r of records) {
      const first = seen.get(r.piece);
      if (first) return `the ${kind} ${r.piece} is in two places: ${first} and ${r.slot}`;
      seen.set(r.piece, r.slot);
    }
  }
  return null;
}

const allSlots = (read) => [...read.corners, ...read.edges];
const kindOf = (name) => (String(name).length === 3 ? 'corners' : 'edges');

/** The record of the slot `slot` names, in any letter order. */
function slotRecord(read, slot) {
  const key = pieceKey(slot);
  const record = key && allSlots(read).find((r) => pieceKey(r.slot) === key);
  if (!record) throw new Error(`cube-questions: "${slot}" is not a slot`);
  return record;
}

/** What is in `slot`: `{ piece, twist }`, or null when a picture does not show it. */
export function pieceIn(cube, slot) {
  const r = slotRecord(readCube(cube), slot);
  return r.piece === null ? null : { piece: r.piece, twist: r.twist };
}

/** Where `piece` is: `{ slot, twist }`, or null when a picture does not show it. */
export function whereIs(cube, piece) {
  const read = readCube(cube);
  const key = pieceKey(piece);
  if (!key || !(kindOf(piece) === 'corners' ? CORNERS : EDGES).some((n) => pieceKey(n) === key)) {
    throw new Error(`cube-questions: "${piece}" is not a piece`);
  }
  const r = allSlots(read).find((s) => s.piece !== null && pieceKey(s.piece) === key);
  return r ? { slot: r.slot, twist: r.twist } : null;
}

/** Is `piece` in its own slot, the right way round? `null` when a picture does not say. */
export function isHome(cube, piece) {
  const at = whereIs(cube, piece);
  if (at === null) return null;
  return pieceKey(at.slot) === pieceKey(piece) && at.twist === 0;
}

/** Every identified piece that is not home, and every slot a picture could not read. */
export function piecesAway(cube) {
  const read = readCube(cube);
  const away = allSlots(read).filter((r) => r.piece !== null && !(r.piece === r.slot && r.twist === 0)).map((r) => r.piece);
  const unknown = allSlots(read).filter((r) => r.piece === null).map((r) => r.slot);
  return Object.freeze({ pieces: Object.freeze(away), unknown: Object.freeze(unknown) });
}

/** The slots of the layer on face `face`, of one kind (`corners` or `edges`) or both. */
export function layerSlots(face, kind = null) {
  if (!FACE_LETTER.includes(face)) throw new Error(`cube-questions: "${face}" is not a face`);
  // A KIND THAT IS NOT A KIND IS A REFUSAL, not "both". `layerSlots('U', 'edge')` — singular — quietly
  // answered with the corners as well, which is a wrong answer wearing a right one's shape (Codex audit,
  // 2026-09-16). `null` still means both, because that is a caller saying so rather than mistyping.
  if (kind !== null && kind !== 'corners' && kind !== 'edges') {
    throw new Error(`cube-questions: "${kind}" is not a kind — corners, edges, or null for both`);
  }
  const names = kind === 'corners' ? CORNERS : kind === 'edges' ? EDGES : [...CORNERS, ...EDGES];
  return Object.freeze(names.filter((n) => n.includes(face)));
}

/**
 * The pieces sitting in layer `layer` that carry no sticker of face `without`'s colour — "the top edges
 * with none of the top colour" is `inLayerWithout(cube, top, top, 'edges')`.
 */
export function inLayerWithout(cube, layer, without, kind) {
  // `without` IS A FACE, and one that is not was compared against piece names it could never match — so
  // "the top edges with none of the Q colour" answered with every top edge, as though the question had
  // been asked and answered (Codex audit, 2026-09-16).
  if (!FACE_LETTER.includes(without)) throw new Error(`cube-questions: "${without}" is not a face`);
  const read = readCube(cube);
  const slots = new Set(layerSlots(layer, kind));
  const inLayer = allSlots(read).filter((r) => slots.has(r.slot));
  return Object.freeze({
    pieces: Object.freeze(inLayer.filter((r) => r.piece !== null && !r.piece.includes(without)).map((r) => r.piece)),
    unknown: Object.freeze(inLayer.filter((r) => r.piece === null).map((r) => r.slot)),
  });
}

export const edgesInLayerWithout = (cube, layer, without) => inLayerWithout(cube, layer, without, 'edges');

/** A first-two-layers pair: the corner slot and the middle-layer edge slot beside it. */
export function pairOf(cornerSlot) {
  const key = pieceKey(cornerSlot);
  const corner = key && CORNERS.find((n) => pieceKey(n) === key);
  if (!corner) throw new Error(`cube-questions: "${cornerSlot}" is not a corner slot`);
  const rest = [...corner].filter((c) => c !== 'U' && c !== 'D');
  const edge = EDGES.find((n) => sorted(n) === sorted(rest.join('')));
  return Object.freeze([corner, edge]);
}
