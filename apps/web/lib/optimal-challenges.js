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
 *  than no challenge.
 *
 *  `fetch` is injectable so the whole load path — not merely the validator — can be driven by
 *  a test. Node's fetch cannot read a file: URL, so without this seam the one function the app
 *  actually calls would be the one function nothing exercises. */
export async function loadChallenges({ Cube, fetch: get = globalThis.fetch } = {}) {
  const response = await get(new URL('./data/optimal-challenges.json', import.meta.url));
  if (!response.ok) {
    throw new Error(`optimal-challenges: the library did not load (${response.status})`);
  }
  return validateChallenges(await response.json(), { Cube });
}

/**
 * The library as a lookup, keyed by facelets.
 *
 * A Map rather than a scan: the app asks on every solve, and an entry is identified by the
 * exact state it describes. Validation is the caller's — `indexChallenges` never runs it, so
 * that no path can reach a lookup over entries nobody checked.
 */
export function indexChallenges(entries) {
  return new Map(entries.map((entry) => [entry.facelets, entry]));
}

/** The empty index: what the app holds when the library did not load. Every lookup against it
 *  misses, so the app searches exactly as it always did. A missing library costs performance,
 *  never correctness — which is why its absence is not fatal, only loud.
 *
 *  Deliberately NOT `Object.freeze(new Map())`: freezing a Map does nothing to its contents,
 *  so that spelling would have been a mutable "empty" index wearing the word frozen — and the
 *  one thing this value must guarantee is that nothing can quietly put an unvalidated entry
 *  into it. A frozen null-object has no `set` to call and no property to reassign. */
export const NO_CHALLENGES = Object.freeze({ get: () => undefined });

/**
 * The proven answer for this state, or null.
 *
 * Null is the ordinary case — the library holds a handful of states out of 43 quintillion. What
 * matters is the other branch: a hit carries a minimality claim that no search on this device
 * could produce, so it may only ever come from an entry that passed `validateChallenges`. That
 * is why this takes an index rather than raw data: there is no shape of argument that lets an
 * unvalidated entry become an answer.
 */
export function provenAnswer(index, facelets) {
  const entry = index?.get?.(facelets);
  if (!entry) return null;
  // `setupAlg` is the entry's scramble under the app's name for it: solved -> this state. The
  // validator has already applied it to a solved cube and compared, so handing it over saves
  // the OTHER Kociemba search a known state would otherwise pay for — the one deriveCube runs
  // on the UI thread purely to animate the cube into position.
  return { moves: entry.optimalLength, alg: entry.optimalSolution, setupAlg: entry.scramble };
}
