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

/**
 * "There is nothing here to fetch FROM" — raised before the fetch, and one line long.
 *
 * `fetch` is specified not to read `file:`, so in Node the library's URL — resolved beside this
 * module — cannot be loaded at all. That is not a defect and not a library problem; it is the
 * app's boot running in a test process. It used to be an undici `TypeError: fetch failed` whose
 * `cause` chain Node prints in full, so every green gate run carried a nine-line stack trace of
 * someone else's internals through a condition nobody can act on.
 *
 * The stack is replaced deliberately, and it costs nothing: the only frames it could hold are
 * this function and its caller, both named in the message. Anything that CAN be fetched — a
 * browser tab on http(s), a WKWebView, Tauri's custom protocol — never reaches here, so the
 * shipped path is untouched. Nor is the refusal quiet: it leaves through `loadIndex`'s one door
 * like every other failure, and yields NO index rather than a partial one.
 */
class NotFetchable extends Error {
  constructor(url) {
    super(
      `optimal-challenges: the library is at a ${url.protocol} URL, which fetch cannot read — ` +
        'this is not a browser, so no proven-library claim is available here',
    );
    this.name = 'NotFetchable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

/** Load and validate the shipped library — oracle included when the caller has cubejs in
 *  hand, which the app always does. A challenge whose numbers cannot be trusted is worse
 *  than no challenge.
 *
 *  `fetch` is injectable so the whole load path — not merely the validator — can be driven by
 *  a test. Node's fetch cannot read a file: URL, so without this seam the one function the app
 *  actually calls would be the one function nothing exercises — and an injected fetch is also
 *  the way to load the library from somewhere else entirely, which is why it is checked for
 *  before the URL is. */
export async function loadChallenges({ Cube, fetch: get } = {}) {
  const url = new URL('./data/optimal-challenges.json', import.meta.url);
  if (typeof get !== 'function') {
    if (url.protocol === 'file:') throw new NotFetchable(url);
    get = globalThis.fetch;
  }
  const response = await get(url);
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
  const index = new Map();
  for (const entry of entries) {
    // A duplicate key is not a near-miss to resolve, it is a library that contradicts
    // itself: two entries for one state can each be internally consistent and still
    // disagree on the minimum. `new Map(pairs)` would have picked the last one silently,
    // and the app would then state a minimality claim chosen by array order.
    if (index.has(entry.facelets)) {
      throw new Error(`optimal-challenges: two entries claim the same state (${entry.facelets})`);
    }
    index.set(entry.facelets, entry);
  }
  return index;
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
  // validator has already applied it to a solved cube and compared. Since 2026-09-05 no screen
  // searches for a setup alg at all — `finishSolve` derives it by inverting the solution and
  // checks it with `reaches()` — so this field is a shortcut the caller may take, not a search
  // it avoids; the assertion that a proved state costs zero UI-thread searches still holds.
  return { moves: entry.optimalLength, alg: entry.optimalSolution, setupAlg: entry.scramble };
}

/**
 * Load, validate and index in one call — or report why not and hand back an empty index.
 *
 * This exists so the app has no way to get the failure path wrong. Doing it inline meant a
 * promise chain where `.then(f, r)` silently does NOT route a throw from `f` to `r`, so the
 * refusal that matters most — a library naming one state twice, thrown by indexChallenges
 * INSIDE the fulfillment handler — became an unhandled rejection rather than the logged
 * fallback. Both failure kinds now leave through the same door: a library that will not load
 * and a library that will not validate are equally "no index, and here is why".
 */
export async function loadIndex({ Cube, fetch, onError } = {}) {
  try {
    return indexChallenges(await loadChallenges({ Cube, fetch }));
  } catch (err) {
    onError?.(err);
    return NO_CHALLENGES;
  }
}
