// The proven challenge library (optimal-solver-plan.md §4.6): states whose minimal length was
// PROVED offline by crates/optimal-solver, shipped as data so every build — including the
// browser, which has no prover — can pose "solve this in N, and N is the minimum".
//
// The word "minimum" here rests on the offline proof plus the checks applied to every entry
// (the scramble reaches the state; the solution solves it; the lengths agree). What the
// browser cannot re-verify — minimality itself — is exactly what the artifact's provenance
// carries, which is why entries are never edited by hand and the file says so.
//
// fetch(), not a JSON import: import attributes miss this app's platform floor (macOS 13 /
// iOS 16 WKWebView), and a loader that only works on new engines is a loader that quietly
// strands the floor.

import { htmMoves } from './optimal.js';

/**
 * Refuse anything that is not a well-formed, self-consistent library. Pure, so the node test
 * can drive it on file bytes while the app drives it on fetched ones. With `Cube` (the
 * vendored cubejs) supplied, every entry is verified against the independent oracle: the
 * scramble really reaches the state, the proved-minimal solution really solves it, and every
 * alg is strict HTM — hand-edited numbers have nowhere to hide, in production, not only in a
 * test that might skip.
 */
export function validateChallenges(data, { Cube } = {}) {
  // The oracle is mandatory here too, not only in the loader: a structural-only pass has no
  // caller today, and an optional oracle is exactly the kind of default that quietly skips.
  if (!Cube) throw new Error('optimal-challenges: validateChallenges requires the cubejs oracle');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('optimal-challenges: the library is missing or empty');
  }
  for (const [i, entry] of data.entries()) {
    const { facelets, scramble, optimalLength, optimalSolution } = entry ?? {};
    if (
      typeof facelets !== 'string' || facelets.length !== 54 ||
      typeof scramble !== 'string' || typeof optimalSolution !== 'string' ||
      !Number.isInteger(optimalLength) || optimalLength < 0 || optimalLength > 20
    ) {
      throw new Error(`optimal-challenges: entry ${i} is malformed`);
    }
    const solutionMoves = htmMoves(optimalSolution, `optimal-challenges entry ${i}`);
    const scrambleMoves = htmMoves(scramble, `optimal-challenges entry ${i}`);
    if (solutionMoves.length !== optimalLength || scrambleMoves.length !== optimalLength) {
      throw new Error(`optimal-challenges: entry ${i} claims ${optimalLength} but its algs disagree`);
    }
    const scrambled = new Cube();
    if (scramble.trim()) scrambled.move(scramble);
    if (scrambled.asString() !== facelets) {
      throw new Error(`optimal-challenges: entry ${i}'s scramble does not reach its state`);
    }
    const oracle = Cube.fromString(facelets);
    if (optimalSolution.trim()) oracle.move(optimalSolution);
    if (!oracle.isSolved()) {
      throw new Error(`optimal-challenges: entry ${i}'s "minimal" solution does not solve the cube`);
    }
  }
  return data;
}

/** Load and validate the shipped library — oracle included when the caller has cubejs in
 *  hand, which the app always does. A challenge whose numbers cannot be trusted is worse
 *  than no challenge. */
export async function loadChallenges({ Cube } = {}) {
  const response = await fetch(new URL('./data/optimal-challenges.json', import.meta.url));
  if (!response.ok) {
    throw new Error(`optimal-challenges: the library did not load (${response.status})`);
  }
  return validateChallenges(await response.json(), { Cube });
}
