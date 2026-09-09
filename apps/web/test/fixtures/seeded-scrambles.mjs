// Deterministic scrambles, in ONE place.
//
// Three files had this generator: `test/method-solver.test.mjs`, this directory's
// `regen-method-steps.mjs`, and `bench/method-solver-profile.mjs`. They agreed, which is the only
// reason it mattered — the whole point of a seeded sample is that two runs talk about the same
// cubes, and the fixture the tests compare against is captured by one file and read by another. A
// change to any one copy would have made the comparison quietly meaningless rather than loudly
// wrong.
//
// cubejs cannot seed its random states, which is why this exists at all rather than being a call
// to it.

import { SOLVED, applyAlg } from '../../lib/cube-pieces.js';

/** 30 face turns, never two of the same face in a row. */
export function seededScrambles(count, seed) {
  let x = seed >>> 0;
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
  const faces = ['U', 'R', 'F', 'D', 'L', 'B'];
  const suffix = ['', "'", '2'];
  const out = [];
  for (let i = 0; i < count; i++) {
    const alg = [];
    let prev = -1;
    while (alg.length < 30) {
      const f = Math.floor(rnd() * 6);
      if (f === prev) continue;
      prev = f;
      alg.push(faces[f] + suffix[Math.floor(rnd() * 3)]);
    }
    out.push(alg.join(' '));
  }
  return out;
}

/** The states those scrambles reach. */
export const seededStates = (count, seed) =>
  seededScrambles(count, seed).map((alg) => applyAlg(SOLVED, alg));

/** The scrambles and the states together, for a fixture that records both. */
export const seededPairs = (count, seed) =>
  seededScrambles(count, seed).map((scramble) => ({ scramble, state: applyAlg(SOLVED, scramble) }));
