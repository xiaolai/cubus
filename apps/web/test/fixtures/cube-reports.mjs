// What a smart cube REPORTS while a child performs a sequence — for tests that drive a drill as a cube would.
//
// A smart cube's sensor sits in its core, which the centres are fixed to, so it reports turns of the outer
// faces RELATIVE TO THE CENTRES and nothing else: a face turn or a wide turn is one report (`r` arrives as
// `L`, because the core turned with the middle layer), a slice is two (`M` is `R` and `L'`), and a turn of
// the whole cube is none at all. Feeding printed tokens straight to `attempt.move` as if a cube had sent
// them was right while every algorithm was face turns, and stopped being right with the human-speed table.
import { SOLVED, movesOf } from '../../lib/cube-pieces.js';
import { faceTurnsAlg, run } from '../../lib/cube-moves.js';

/**
 * Each token of `alg` with the reports a cube held `hold` sends for it: `[{ token, reports }]`, the reports
 * in the cube's own frame. The hold advances with every token, because after a rotation or a slice the same
 * letter names a different face of the cube.
 */
export function reportsOf(alg, hold = ['U', 'F']) {
  let now = { state: SOLVED, hold };
  return movesOf(alg).map((token) => {
    now = run(token, now.hold, now.state);
    return { token, reports: movesOf(faceTurnsAlg(now.drawn)) };
  });
}

/** Just the reports, in order. */
export const reportStream = (alg, hold) => reportsOf(alg, hold).flatMap((t) => t.reports);

/** Is this token a turn of the whole cube — something no cube reports? */
export const isRotation = (token) => /^[xyz]/.test(token);
