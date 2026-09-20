// Drill rounds, generated rather than shipped.
//
// A recognition round is "one slot is lit; which faces does the piece sitting in it belong on?" —
// and every part of that is a FACT ABOUT A CUBE. The position, the slot, and the answer are
// arithmetic, so they can be generated here, endlessly, with no content behind them. That matters
// for three reasons:
//
//   1. **The drill needs no course.** ADR 0006 keeps the narrated course out of this repository;
//      a drill that depended on it would be a feature that exists only in the author's build.
//   2. **It carries no authored words.** The question is asked by the SCREEN, in the app's own
//      copy; the script this builds holds a position and a lit slot and nothing to read. That is
//      ADR 0006 decision 7's line — facts open, words closed — drawn where it is cheapest to hold.
//   3. **The answer is computed from the cube, never written down beside it** (`answerAt` in
//      `script-rounds.js`), so a generated round cannot disagree with the position it generated.
//
// THE POSITION IS NOT A SCRAMBLE, and the distinction is deliberate. A scramble is a puzzle to
// solve and must be drawn uniformly from all legal states (`random-state.js`) or it is easier than
// it looks. This is a position to READ: what it must be is legal, unsolved at the slot in question,
// and different every time. A turn sequence gives that directly, and asking the solver for a
// uniform state would make a drill round cost a search.

import { CORNERS, EDGES, SOLVED, applyAlg } from './cube-pieces.js';
import { CUBE_VIEW } from './cube-view.js';
import { cryptoUint32, randomBelow } from './random-state.js';

/** The six faces, and the three suffixes a quarter turn can carry. */
const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const SUFFIX = ['', "'", '2'];

/** How many turns a drill position is stirred by. Long enough that pieces travel; short enough to draw fast. */
export const DRILL_TURNS = 14;

/**
 * A turn sequence that stirs the cube.
 *
 * Consecutive turns of the SAME face are refused: `R R'` is a wasted pair that makes the sequence
 * shorter than it says it is, and two in a row on one face is never how a position is described.
 */
export function drillAlg(rng = cryptoUint32, turns = DRILL_TURNS) {
  const moves = [];
  let last = -1;
  for (let i = 0; i < turns; i += 1) {
    // CHOSEN FROM THE FIVE OTHER FACES, never drawn-and-rejected. Rejection reads more obviously
    // but it does not terminate: a source that keeps answering the same number — a stub, a broken
    // entropy seam, a test's fake — leaves `while (face === last)` spinning for ever, which is a
    // hang rather than a wrong answer and is the worse of the two. Skipping over `last` is uniform
    // across the remaining five and always finishes.
    let face;
    if (last < 0) face = randomBelow(FACES.length, rng);
    else {
      face = randomBelow(FACES.length - 1, rng);
      if (face >= last) face += 1;
    }
    last = face;
    moves.push(FACES[face] + SUFFIX[randomBelow(SUFFIX.length, rng)]);
  }
  return moves.join(' ');
}

/**
 * A slot worth asking about: one whose occupant is NOT already home.
 *
 * A round about a solved slot is answerable without looking, so it teaches nothing and reads as a
 * trick. Null when the position has none to offer — which a caller must handle rather than assume
 * away, because a stirred cube can in principle come back solved.
 */
export function unsolvedSlot(state, rng = cryptoUint32) {
  // `ep[slot]` / `cp[slot]` is the cubie SITTING IN that slot, so `!== slot` is "a piece that does
  // not live here". Positional only, on purpose: a piece that is home but flipped still belongs on
  // the faces it is already touching, so `pieceIn:` would have a trivial answer.
  const candidates = [
    ...EDGES.map((name, slot) => ({ name, slot, kind: 'edge', home: EDGES[state.ep[slot]] }))
      .filter(({ slot }) => state.ep[slot] !== slot),
    ...CORNERS.map((name, slot) => ({ name, slot, kind: 'corner', home: CORNERS[state.cp[slot]] }))
      .filter(({ slot }) => state.cp[slot] !== slot),
  ];
  if (!candidates.length) return null;
  return candidates[randomBelow(candidates.length, rng)];
}

/**
 * One recognition round, as a script the player can drive.
 *
 * No `say` anywhere: the question is the screen's to ask, in the app's own words. `choose` is the
 * number of faces the piece has, so an edge asks for two and a corner for three.
 */
export function recognitionScript({ alg, slot, home }) {
  return {
    schema: 2,
    start: { scramble: alg },
    steps: [
      // GHOSTS ON, AND THE APP'S OWN CAMERA. A script that names neither gets the driver's bare
      // defaults — `ghosts="none"` — and a drill drawn that way can light a slot at the BACK of the
      // cube and then grade a child right or wrong on a piece whose stickers they were never shown.
      // `CUBE_VIEW` is the tuned look the rest of the app draws with, ghosts included, and it is
      // imported rather than copied so the numbers cannot come to disagree with it.
      { hl: `slot:${slot}`, ghosts: true, cam: [CUBE_VIEW.camLat, CUBE_VIEW.camLon] },
      {
        round: {
          ask: `pieceIn:${slot}`,
          choose: slot.length,
          // THE REVEAL IS THE TEACHING. Without it the drill marks an answer and shows nothing, and
          // a child who guessed wrong learns only that they were wrong. It lights the slot the piece
          // LIVES in, by position, so the answer is somewhere to look rather than a sentence — which
          // is also why it carries no words.
          reveal: home ? [{ hl: `slot:${home}` }] : [],
        },
      },
    ],
  };
}

/**
 * A fresh round: a stirred position and a slot to ask about.
 *
 * Retries rather than returning something unusable — a position with nothing to ask about is
 * vanishingly rare and is a reason to draw again, not a reason for the screen to have a null branch
 * nobody ever exercises. It gives up loudly rather than looping forever.
 */
export function makeRound(rng = cryptoUint32, tries = 8) {
  for (let i = 0; i < tries; i += 1) {
    const alg = drillAlg(rng);
    const chosen = unsolvedSlot(applyAlg(SOLVED, alg), rng);
    if (chosen) {
      const { name: slot, home } = chosen;
      return { alg, slot, home, script: recognitionScript({ alg, slot, home }) };
    }
  }
  throw new Error(`drill-rounds: ${tries} positions in a row had nothing to ask about`);
}
