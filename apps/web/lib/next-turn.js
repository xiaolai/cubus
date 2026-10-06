// THE ONE NEXT TURN, and nothing else about it.
//
// The loop (dev-docs/adr/0008-the-loop-is-a-screen-beside-the-shelf.md) shows a child ONE turn at a
// time and never a condition: `dev-docs/teaching-a-five-year-old.md` §4 — "if the app can see the
// state, it should resolve the antecedent itself and issue a plain imperative" — and §1.1 is why,
// because neither the child nor the adult can say which step a cube is on.
//
// A MODULE, NOT A SCREEN (ADR 0008 decision 3). A value a screen owns alone never reaches the others;
// this repository has learned that twice, with the ghost faces and then with `tempo-scale`.
//
// AND IT IS A REDUCTION, NOT A SECOND PATH TO THE SOLVER. `lessonFor` already turns a cube into a
// walk — in the scan frame, cached on the subject, `null` rather than throwing on a cube the method
// cannot finish — and `walk-session.js` and `walk-resolver.js` already ask it. So this takes the
// lesson and answers one question about it. Writing a second route from a cube to a method solution
// is the duplication ADR 0008 exists to avoid, and would be two answers about where a cube is.
import { readToken } from './cube-notation.js';

/**
 * The turn to make after `done` of the lesson's moves, or `null` when there is none.
 *
 * `null` means NOTHING TO DO — a solved cube, a cube the method cannot finish (`lessonFor` answers
 * null for one), or a walk already at its end. The loop shows no turn in every one of those, which is
 * the same picture for three different reasons, and the caller is the one that may distinguish them.
 *
 * What comes back:
 *
 * - `token` — the move in the child's own letters, as the walk spells it. The renderer's `arrow`
 *   takes exactly this.
 * - `kind` — `'face'`, `'wide'`, `'slice'` or `'rotation'`. **A rotation is not a turn of a face**:
 *   the child picks the whole cube up and turns it over, and a loop that drew an arrow on a face for
 *   one would be pointing at a layer nobody is being asked to move.
 * - `turns` — 1 or 2. A half turn has no wrong way round, which is the one property the first
 *   solving lesson is built on; a quarter turn does.
 * - `hold` — `[up, front]` as the cube is held when this move is made. `moveHolds[k]` is the hold
 *   once `k` moves are made, so the k-th move is made in `moveHolds[k]` and a regrip renames the
 *   moves after it rather than its own.
 * - `stepIndex` — which of the lesson's steps this move belongs to, so a caller can tell when one
 *   ends. **Not copy**: ADR 0008 decision 2 says the screen names no stage.
 * - `remaining` — how many moves are left, this one included. For the app, not for the child: a
 *   number counting down is a progress bar, and the loop has none.
 */
export function nextTurn(lesson, done = 0) {
  if (!lesson || !Array.isArray(lesson.moves)) return null;
  // A NUMBER, and a whole one in range. `done` arrives from a caller holding a count across presses,
  // and a fractional or negative one would index the array to `undefined` and read as "nothing to do"
  // — the same answer a solved cube gives, which is the one answer that must not be returned wrongly.
  if (!Number.isInteger(done) || done < 0) return null;
  if (done >= lesson.moves.length) return null;

  const token = lesson.moves[done];
  const read = readToken(String(token ?? ''));
  // A walk whose move this file cannot read is a walk nobody should be shown. Loud, because the
  // alternative is an arrow drawn for a move that does not exist.
  if (!read.move) throw new Error(`next-turn: move ${done} of the walk is "${token}" — ${read.why}`);

  const holds = Array.isArray(lesson.moveHolds) ? lesson.moveHolds : [];
  const steps = Array.isArray(lesson.moveStep) ? lesson.moveStep : [];
  return Object.freeze({
    token: read.move.token,
    kind: read.move.kind,
    turns: read.move.turns,
    hold: holds[done] ?? null,
    stepIndex: steps[done] ?? null,
    remaining: lesson.moves.length - done,
  });
}

/** Is there anything at all to do? `nextTurn(...) !== null`, named, so a caller does not spell the
 *  comparison itself and quietly treat a thrown refusal as "done". */
export const hasATurn = (lesson, done = 0) => nextTurn(lesson, done) !== null;
