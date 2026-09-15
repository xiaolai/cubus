// Replaying the method solver's steps the way the solver itself does.
//
// dev-docs/tutorial-capability-plan.md item 6.1: a step is written in the child's letters for the hold
// it records, and may turn the whole cube. A test that replays one with `applyAlg(state, step.alg)` is
// right only while no step regrips, and goes wrong silently the day one does — so every replay of a
// method step in the tests goes through here, where the hold is honoured.
import { SOLVED } from '../../lib/cube-pieces.js';
import { faceTurnsAlg, run } from '../../lib/cube-moves.js';

/** A method step as the identity-frame moves it draws — a regrip included — played in its hold. */
export const drawnOf = (step) => run(step.alg, step.hold, SOLVED).drawn.join(' ');

/** A method step as the face turns it makes to the pieces, in the method frame: a regrip is none. */
export const turnsOf = (step) => faceTurnsAlg(run(step.alg, step.hold, SOLVED).drawn);

/**
 * Steps a STAGE emitted, replayed from `state` held `hold` — the driver's replay, for a stage run on its
 * own, whose steps do not carry their holds yet. Returns `{ state, hold }`.
 */
export function replayStage(state, steps, hold = ['U', 'F']) {
  let now = { state, hold };
  for (const step of steps) now = run(step.alg, now.hold, now.state);
  return now;
}
