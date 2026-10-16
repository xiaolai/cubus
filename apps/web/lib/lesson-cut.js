// A method's lesson, CUT at the stage end where a Restore chip first holds (ADR 0011; plan Phase 4).
//
// A lesson is many parallel records of one walk — its steps (each carrying its cues), the sections the
// move list is headed by, the step each move belongs to, the hold each move is made in, the moves
// themselves and the cube after each. Truncating them one at a time, in the caller, is how two of them
// come to describe different walks. So the cut is ONE function, and it cuts all of them at one position.
//
// WHERE TO CUT is decided by the chip's own predicate at the method's STAGE ENDS, never by a stage name:
// dev-docs/solve-methods-plan.md Phase 0 (1) measured that a chip can first hold at an earlier stage end
// than the stage it is named for (the top cross formed during the middle layer, say), and that once it
// holds at a stage end it holds at every later one. Inside a stage it may come and go — the corner twists
// take the first two layers apart and give them back — which is why only stage ends are asked.
//
// Pure: no DOM, no solver, no frame. The caller supplies `holds(facelets)`, the chip's predicate on a
// walk state as the lesson stores it.

import { moveCount } from './cube-pieces.js';
import { lessonSections } from './method-lesson.js';
import { holdAfter } from './solving-hold.js';

/**
 * `lesson` cut at the first stage end where `holds` is true, or null when there is nothing to teach:
 * the chip already holds on the cube the lesson starts from, or no stage end reaches it.
 *
 * @param {object} lesson what `lessonFor` builds: `steps`, `sections`, `moveStep`, `moves`, `alg`,
 *   `moveHolds` (one more than the moves) and `stepFacelets` (one more than the moves).
 * @param {(facelets: string) => boolean} holds the chip's predicate on a state of the walk.
 * @returns {object|null} the same shape, every record ending at the cut, with `cutAt` the step index of
 *   the stage end it stopped at.
 */
export function cutLesson(lesson, holds) {
  const { steps, moves, moveHolds, stepFacelets, moveStep } = lesson;
  if (stepFacelets.length !== moves.length + 1 || moveHolds.length !== moves.length + 1 || moveStep.length !== moves.length) {
    throw new Error('lesson-cut: the lesson\'s records disagree about its length before any cut');
  }
  if (holds(stepFacelets[0])) return null;
  let position = 0;
  for (const [i, step] of steps.entries()) {
    position += moveCount(step.alg);
    if (steps[i + 1]?.stage === step.stage) continue; // not a stage end
    if (!holds(stepFacelets[position])) continue;
    if (position === 0) return null;
    const kept = steps.slice(0, i + 1);
    const cutMoves = moves.slice(0, position);
    return Object.freeze({
      ...lesson,
      steps: Object.freeze(kept),
      sections: lessonSections(kept),
      moveStep: moveStep.slice(0, position),
      moves: cutMoves,
      alg: cutMoves.join(' '),
      // The hold AFTER the last kept move — never the next record's, which is the following stage's hold
      // (the tumble after the first layer, say): a walk cut there must end held as its last move left it.
      moveHolds: Object.freeze([...moveHolds.slice(0, position), holdAfter(moves[position - 1], moveHolds[position - 1])]),
      stepFacelets: stepFacelets.slice(0, position + 1),
      cutAt: i,
    });
  }
  return null;
}
