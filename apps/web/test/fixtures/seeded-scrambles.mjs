// Deterministic scrambles, and the pseudo-randomness under them, in ONE place.
//
// Three files had this generator: `test/method-solver.test.mjs`, this directory's
// `regen-method-steps.mjs`, and `bench/method-solver-profile.mjs`. They agreed, which is the only
// reason it mattered — the whole point of a seeded sample is that two runs talk about the same
// cubes, and the fixture the tests compare against is captured by one file and read by another. A
// change to any one copy would have made the comparison quietly meaningless rather than loudly
// wrong.
//
// **The census was wrong, and consolidating one copy at a time is what made it wrong.** Grepping
// the draw itself (the LCG's multiplier) on 2026-09-12 found four more: `seededStates` in
// `method-lesson.test.mjs` — whose comment claimed to be "the same generator the rest of the suite
// uses", a claim nothing checked — the sample search in `browser/method-lesson-render.test.mjs`,
// `randomAlg` in `cube-pieces.test.mjs`, and `randomWalk` in `bench/solver-move-count.mjs`. So the
// primitives are exported too, not just the scramble list: a caller that needs a stream of numbers
// or a single alg now has something to import instead of a reason to retype the draw.
// `test/seeded-scrambles.test.mjs` fails if a sixth copy appears.
//
// cubejs cannot seed its random states, which is why this exists at all rather than being a call
// to it.

import { SOLVED, applyAlg } from '../../lib/cube-pieces.js';

/** The faces and suffixes the draw indexes into. Order is load-bearing: it IS the sample. */
const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const SUFFIX = ['', "'", '2'];

/**
 * The one pseudo-random source. A linear congruential generator with Numerical Recipes' constants,
 * seeded explicitly so a failure is reproducible from its seed alone.
 */
export function lcg(seed) {
  let x = seed >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * One alg of `length` face turns, never two of the same face in a row, drawn from `rnd`.
 *
 * The draw ORDER is the contract, not the output: one face draw, one suffix draw, and a retry that
 * consumes a face draw when the face repeats. Every fixture captured against this — `method-steps.json`
 * above all — is captured against that sequence, so it may not be reordered, only read.
 */
export function randomAlg(rnd, length) {
  const out = [];
  let prev = -1;
  while (out.length < length) {
    const f = Math.floor(rnd() * 6);
    if (f === prev) continue;
    prev = f;
    out.push(FACES[f] + SUFFIX[Math.floor(rnd() * 3)]);
  }
  return out.join(' ');
}

/**
 * `count` scrambles of `length` face turns, all drawn from one stream seeded with `seed`.
 *
 * The length is a parameter because the stage-target fixtures need SHALLOW scrambles — a cube a
 * child could actually have produced by mistake is a handful of turns from where it should be, and
 * a 30-turn scramble is a different population entirely. One generator with an argument rather than
 * a second generator, for the reason this file's header gives.
 *
 * The default of 30 is load-bearing for the same reason the draw order is: `seededScrambles(n, seed)`
 * must keep returning exactly what it returned before the parameter existed.
 */
export function seededScrambles(count, seed, length = 30) {
  const rnd = lcg(seed);
  return Array.from({ length: count }, () => randomAlg(rnd, length));
}

/** The states those scrambles reach. */
export const seededStates = (count, seed, length = 30) =>
  seededScrambles(count, seed, length).map((alg) => applyAlg(SOLVED, alg));

/** The scrambles and the states together, for a fixture that records both. */
export const seededPairs = (count, seed, length = 30) =>
  seededScrambles(count, seed, length).map((scramble) => ({ scramble, state: applyAlg(SOLVED, scramble) }));
