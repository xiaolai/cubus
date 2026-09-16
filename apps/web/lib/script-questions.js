// The questions a script may ASK BY NAME, and the frame they are asked and answered in.
//
// dev-docs/adr/0005-the-renderer-plays-scripts-methods-choose.md decision 2; plan item 3.1 of
// dev-docs/tutorial-capability-plan.md. `lib/cube-questions.js` answers in the identity frame and
// knows nothing about how a cube is held. A script is written the way a child holds one — "the top
// edges with none of the top colour" — so this is the door between the two: the letters a script
// writes are turned into identity faces on the way in, and every slot the answer names is turned back
// into the letter the child reads it by on the way out (ADR 0004 decision 6).
//
// A NAME, NOT A FUNCTION, because a script is data: a cue says `ask:topEdgesWithoutTopColour` and a
// lesson is still a JSON file that no runtime has to be handed code to read. The registry is what
// makes that checkable — a question a script names and this table does not have is refused when the
// script is checked, not when a child reaches that line.
//
// A QUESTION STILL READS AND NEVER MOVES. Every answer here is a read of ONE cube — a state or a
// painted picture — exactly as `cube-questions.js` is, and the only thing this module adds is
// relabelling. A question that needed a move's result would be a script step, not a question.
import {
  inLayerWithout,
  isHome,
  pairOf,
  pieceIn,
  piecesAway,
  whereIs,
} from './cube-questions.js';
import { CORNERS, EDGES } from './cube-pieces.js';
import { heldFace, identityFace } from './cube-moves.js';

/** A piece or slot's letters, as the cube's own faces, read from the letters the child used. */
const toIdentity = (letters, hold) => [...String(letters).toUpperCase()].map((f) => identityFace(f, hold)).join('');
/** The other way: the letters the child reads a piece or slot by, on a cube held `hold`. */
const toHeld = (letters, hold) => (letters === null || letters === undefined
  ? letters
  : [...String(letters)].map((f) => heldFace(f, hold)).join(''));

const heldList = (names, hold) => Object.freeze(names.map((n) => toHeld(n, hold)));

/** Every answer has the same two fields, so a cue can light one without knowing which question it is. */
const answer = (fields) => Object.freeze({ pieces: Object.freeze([]), unknown: Object.freeze([]), ...fields });

/** A list question's answer, in the child's letters: the same conversion three handlers each spelled out
 *  (Codex audit, 2026-09-16). What differs between them is the QUESTION, which is the argument. */
const listAnswer = (found, hold) =>
  answer({ pieces: heldList([...found.pieces], hold), unknown: heldList([...found.unknown], hold) });

/** The pieces of one kind in the top layer that carry none of the top colour — the recognition both the
 *  middle layer and the tumbled first layer are taught by, asked of edges or of corners. */
const topWithoutTopColour = (kind) => (cube, hold) => {
  const up = identityFace('U', hold);
  return listAnswer(inLayerWithout(cube, up, up, kind), hold);
};

/**
 * The questions, by name. Each takes the cube, the hold in force and the script's argument (`of`),
 * and answers in the child's letters.
 *
 * `pieces` is what a cue lights when it says "light the answer to this question"; `slots` is there for
 * the questions whose answer is a PLACE rather than a piece, and a cue lights those as positions.
 * `unknown` is never dropped: a painted picture that cannot say is a different answer from an empty
 * one, and a lesson that treats them alike will one day point at a piece it cannot see.
 */
export const QUESTIONS = Object.freeze({
  __proto__: null,

  /** Every piece not in its own place, the right way round. */
  piecesAway: (cube, hold) => listAnswer(piecesAway(cube), hold),

  /** The edges of the top layer carrying none of the top colour — the middle layer's recognition. */
  topEdgesWithoutTopColour: topWithoutTopColour('edges'),

  /** The same question of the corners — the first layer's, once the cube is tumbled. */
  topCornersWithoutTopColour: topWithoutTopColour('corners'),

  /** Where a piece is: the slot it sits in and how it is twisted, or unknown. */
  whereIs: (cube, hold, of) => {
    const at = whereIs(cube, toIdentity(of, hold));
    if (at === null) return answer({ slot: null, twist: null, unknown: Object.freeze(['?']) });
    return answer({ pieces: Object.freeze([String(of).toUpperCase()]), slot: toHeld(at.slot, hold), twist: at.twist });
  },

  /** What is in a slot: the piece and its twist, or unknown. */
  pieceIn: (cube, hold, of) => {
    const slot = String(of).toUpperCase();
    const found = pieceIn(cube, toIdentity(slot, hold));
    if (found === null) return answer({ piece: null, twist: null, slots: Object.freeze([slot]), unknown: Object.freeze([slot]) });
    const piece = toHeld(found.piece, hold);
    return answer({ pieces: Object.freeze([piece]), piece, twist: found.twist, slots: Object.freeze([slot]) });
  },

  /** Is a piece home, the right way round? `home` is null when a picture does not say. */
  isHome: (cube, hold, of) => {
    const piece = String(of).toUpperCase();
    const home = isHome(cube, toIdentity(piece, hold));
    return answer({ pieces: Object.freeze([piece]), home, unknown: home === null ? Object.freeze([piece]) : Object.freeze([]) });
  },

  /**
   * A first-two-layers pair: the corner slot a script names and the middle-layer edge slot beside it.
   *
   * ASKED IN THE CHILD'S FRAME. "The middle layer" is the layer between the child's top and bottom, so the
   * edge is the corner's two faces that are neither — read `cube-questions.js`'s rule in the letters the
   * script wrote. Converting the corner to identity letters first and stripping the CUBE's U and D named
   * the wrong edge under any hold that is not upright: `pairOf:DFR` held `R F` answered `FD`.
   */
  pairOf: (cube, hold, of) => {
    const [corner, edge] = pairOf(String(of).toUpperCase());
    return answer({ slots: Object.freeze([corner, edge].map((slot) => String(slot).toUpperCase())) });
  },
});

/** Which questions take an argument, and so must be written `name:ARG`. */
export const TAKES_ARGUMENT = Object.freeze(['whereIs', 'pieceIn', 'isHome', 'pairOf']);

/** Every piece of a cube, by its letters in any order — what an argument has to name. */
const PIECES = new Set([...CORNERS, ...EDGES].map((name) => [...name].sort().join('')));
const lettersOf = (text) => [...text].sort().join('');

/**
 * Read `"name"` or `"name:ARG"` into `{ name, of }`, or `{ why }` saying what is wrong with it.
 *
 * A refusal rather than a throw, so the format check can name the step it came from and a cue can be
 * validated without a cube in hand.
 */
export function readAsk(text) {
  const [name, of, ...rest] = String(text ?? '').trim().split(':');
  if (!Object.hasOwn(QUESTIONS, name)) return { why: `no question is named "${name}"` };
  if (rest.length) return { why: `"${text}" has more than one argument` };
  const wants = TAKES_ARGUMENT.includes(name);
  if (wants && !of) return { why: `"${name}" needs a piece or a slot, as in "${name}:UR"` };
  if (!wants && of !== undefined) return { why: `"${name}" takes no argument, and was given "${of}"` };
  if (of !== undefined && !/^[URFDLB]{2,3}$/.test(of.toUpperCase())) {
    return { why: `"${of}" is not a piece or a slot — two or three of URFDLB` };
  }
  // AND THE LETTERS MUST MEET ON A CUBE. `UU` and `UD` are two of URFDLB and neither is a piece: they
  // passed the check above, `checkScript` accepted the lesson, and the throw arrived when a child reached
  // that line (found by a Codex audit, 2026-09-16).
  if (of !== undefined && !PIECES.has(lettersOf(of.toUpperCase()))) {
    return { why: `"${of}" is not a piece of a cube — its faces do not meet` };
  }
  // `pairOf` is asked of a CORNER: it answers with the corner's slot and the middle-layer edge beside it,
  // and an edge has no such pair.
  if (name === 'pairOf' && of.length !== 3) {
    return { why: `"${of}" is an edge — a pair is a corner and the edge beside it, as in "pairOf:DFR"` };
  }
  return { name, of: of === undefined ? null : of.toUpperCase() };
}

/**
 * Ask `text` of one cube held `hold`.
 *
 * `cube` is a piece state or a painted picture, and which one it is decides the answer: inside a
 * picture segment a script's questions are answered from the picture, unknowns and all, rather than
 * from the model the picture replaced (plan item 3.1).
 */
export function ask(text, cube, hold) {
  const read = readAsk(text);
  if (read.why) throw new Error(`script-questions: ${read.why}`);
  return QUESTIONS[read.name](cube, hold, read.of);
}
