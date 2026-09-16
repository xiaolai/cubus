// Drill rounds: the EVENT driver — a script moved on by a child's answers.
//
// dev-docs/tutorial-capability-plan.md item 3.4; ADR 0005 decision 3. The third driver beside the clock
// and the stops (`lib/script-drive.js`). A round is a question the child answers by picking faces — "where
// does this piece live?", "where will this piece be after R?" — and everything about it that can be WRONG
// is here, where a test can reach it: what the answer is, how picks are counted, when the round locks,
// whether it was right, and what the reveal shows.
//
// THE ROUND NEVER READS THE DOM. The page keeps its controls — today, six swatches read off the live cube —
// and calls `select(face)`. It decides its own delays and calls `next()`. That line is what lets one round
// serve a page of swatches, a touch on the cube itself, or a test, and it is the line ADR 0005's risk list
// says to hold: if a second drill kind needs this module to know about swatches or sentences, the round's
// contract is wrong.
//
// THE ANSWER IS COMPUTED, NEVER WRITTEN DOWN. For a prediction the author's turn is applied through the
// interpreter and the question is asked of the cube that leaves; for recognition the question is asked of
// the cube as it is. An answer carried in the data is an answer that can disagree with the cube it is about,
// and cubus-im's drill verifiers exist because a drill that marks a right answer wrong teaches a child to
// distrust themselves.
import { toFacelets } from './cube-pieces.js';
import { parse } from './cube-notation.js';
import { heldFace, identityFace, relabelSelectors, run } from './cube-moves.js';
import { ask } from './script-questions.js';
import { buildScript, viewAtPosition } from './script-view.js';
import { createStopDriver, createElementWriter } from './script-drive.js';

const holdPair = (hold) => String(hold).split(' ');
const sortFaces = (letters) => [...letters].sort().join('');

/** A question's argument, carried from the hold it was WRITTEN in to the hold `to`: the same piece. */
const carry = (text, from, to) => {
  const [name, of] = String(text).split(':');
  return of ? `${name}:${[...of].map((c) => heldFace(identityFace(c, from), to)).join('')}` : text;
};

/** The round at `position`, or null when the step there is not one. */
function roundStep(built, position) {
  const at = built.positions[position];
  const step = at && at.step >= 0 ? built.script.steps[at.step] : null;
  return step?.round ? { at, round: step.round } : null;
}

/**
 * What the child should pick at a round: the faces, in the child's letters, and the question's answer.
 *
 * A prediction's turn is applied to the cube in front of the child — never to a picture, which the format
 * refuses — and the question is asked of what it leaves.
 */
export function answerAt(built, position) {
  const found = roundStep(built, position);
  if (!found) throw new Error(`script-rounds: position ${position} is not a round`);
  const { at, round } = found;
  // The hold the question is asked in is the one the turn LEAVES: a prediction's turn may include a regrip,
  // and "where will it be" is asked the way the child will then be holding the cube.
  const imagined = round.turn ? run(parse(round.turn), holdPair(at.hold), at.cube) : { state: at.cube, hold: holdPair(at.hold) };
  // THE PIECE IS NAMED WHEN THE ROUND IS ASKED. A prediction's turn may regrip, and the same letters then
  // name a different piece: `whereIs:UF` after `y R` answered about the piece at the child's NEW UF, not
  // the one they were shown (found by a Codex audit, 2026-09-16). So the argument is carried into the hold
  // the turn leaves, and the answer comes back in that hold, which is how the child is holding it.
  const answer = ask(carry(round.ask, holdPair(at.hold), [...imagined.hold]), imagined.state, [...imagined.hold]);
  const letters = answer.slot ?? answer.piece ?? null;
  return Object.freeze({ faces: letters === null ? null : sortFaces(letters), answer, choose: round.choose });
}

/**
 * A round as rules: picks, locking and the verdict. Pure — no element, no DOM, no clock.
 *
 * Picking a face toggles it. The round LOCKS when as many faces are picked as it asks for, and is marked
 * then; anything picked after that is ignored. An answer the cube cannot give (a picture that does not
 * show the piece) locks as `unknown` rather than marking the child wrong about something nobody can see.
 */
export function createRound(built, position) {
  const { faces, choose } = answerAt(built, position);
  let picked = [];
  let verdict = null;
  const state = () => Object.freeze({ picked: Object.freeze([...picked]), locked: verdict !== null, verdict, faces, choose });
  return Object.freeze({
    get state() { return state(); },
    select(face) {
      if (verdict !== null) return state();                          // input after locking is ignored
      const f = String(face).toUpperCase();
      if (!/^[URFDLB]$/.test(f)) throw new Error(`script-rounds: "${face}" is not a face`);
      picked = picked.includes(f) ? picked.filter((x) => x !== f) : [...picked, f];
      if (picked.length === choose) verdict = faces === null ? 'unknown' : sortFaces(picked.join('')) === faces ? 'right' : 'wrong';
      return state();
    },
  });
}

/**
 * The reveal at a round, as a SCRIPT: the cube the round was asked about, held as it was, with the cues
 * then in force — and then the author's reveal steps.
 *
 * A script segment rather than a hard-coded animation, so a prediction's reveal is "play the turn" and a
 * recognition's is "light the home slot" in the same vocabulary as everything else, and a cue lit by
 * identity travels with its piece while one lit by position stays in its slot (plan item 3.4).
 */
export function revealScript(built, position) {
  const found = roundStep(built, position);
  if (!found) throw new Error(`script-rounds: position ${position} is not a round`);
  const { at, round } = found;
  // THE CUES AS THEY WERE BOUND, not as they were written. A cue takes effect where it appears (ADR 0004
  // R9): the view carries `focus` already bound to the pieces it named there, and `hl`'s question already
  // answered. Re-reading the raw selectors against the cube the reveal starts from re-bound them — a
  // `slot:` focus written before a turn lit whatever had arrived there (Codex audit, 2026-09-16). Renamed
  // back into the child's letters, because a script's cues are written the way the child holds the cube.
  const bound = viewAtPosition(built, position).cues;
  const inForce = Object.fromEntries(Object.entries(at.cues).map(([key, cue]) => [
    key,
    key === 'hl' || key === 'focus' ? relabelSelectors(bound[key], (c) => heldFace(c, holdPair(at.hold))) : cue.value,
  ]));
  const first = at.isPicture
    ? { paint: at.cube, ...inForce }
    : { ...inForce };
  if (!Object.keys(first).length) first.say = round.say ?? '';
  const start = at.isPicture ? { hold: at.hold } : { facelets: toFacelets(at.cube), hold: at.hold };
  return { schema: 2, start, steps: [first, ...(round.reveal ?? [])] };
}

/**
 * The event driver: a script whose rounds are answered by a child.
 *
 * `select(face)` picks; `reveal()` plays the reveal on the element, stop by stop, and says how many stops
 * it has; `next()` moves on to the next position. The page owns every delay between them.
 */
export function createEventDriver(built, { cube = null } = {}) {
  let writer = cube ? createElementWriter(cube) : null;
  let position = 0;
  let round = null;
  let reveal = null;
  const go = (k) => {
    // Rounded, as `viewAtPosition` rounds: a fractional seek showed the round at position 2 while the
    // driver still held 1.5 and answered `round: null`, so answering it threw (Codex audit, 2026-09-16).
    position = Math.max(0, Math.min(Math.round(Number(k) || 0), built.positions.length - 1));
    round = roundStep(built, position) ? createRound(built, position) : null;
    // A reveal loaded its own segment onto the element, so what this writer last wrote is no longer what
    // is there: the next position is a cold landing, and a fresh writer is how it is told so.
    if (reveal && cube) writer = createElementWriter(cube);
    reveal = null;
    const view = viewAtPosition(built, position);
    if (writer) writer.show(view, { how: 'jump' });
    return view;
  };
  go(0);
  return Object.freeze({
    get position() { return position; },
    get round() { return round?.state ?? null; },
    select(face) {
      if (!round) throw new Error(`script-rounds: position ${position} asks nothing`);
      return round.select(face);
    },
    /** Play the reveal, one stop at a time: returns the stops left, 0 when it has finished. */
    reveal() {
      if (!round) throw new Error(`script-rounds: position ${position} has nothing to reveal`);
      if (!round.state.locked) throw new Error('script-rounds: a round is revealed after it is answered, not before');
      if (!reveal) {
        reveal = createStopDriver(buildScript(revealScript(built, position)), { cube });
        // Position 1 of a reveal is the round as it was asked — the cube and its cues, already on screen —
        // so the first call plays the author's first step rather than re-drawing what is there.
        reveal.seek(1);
      }
      const last = reveal.view.last;
      if (reveal.position < last) reveal.next();
      return last - reveal.position;
    },
    next: () => go(position + 1),
    seek: (k) => go(k),
  });
}
