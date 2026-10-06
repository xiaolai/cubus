// A uniformly random cube, drawn from a cryptographic source.
//
// A "random-state" scramble means the STATE is drawn uniformly from all 43,252,003,274,489,856,000
// legal positions and then solved — not that some number of random turns were applied. The
// difference is the whole reason WCA scrambles are trusted: random turns leave a distribution
// with structure, and cubes that are systematically easier than they look.
//
// cubejs can already do this, and correctly — Fisher-Yates with rejection sampling on parity.
// What it draws from is `Math.random()`, which is fine for a toy and is not what the WCA uses.
// TNoodle draws from a cryptographic source, and so does this.
//
// Two differences from cubejs's version beyond the source, both of which make it exact rather
// than approximate:
//
//   * **Parity is fixed, not re-rolled.** Where the two permutations disagree, one transposition
//     repairs it. That is a bijection from the mismatched pairs onto the matched ones, so the
//     result is still uniform — and it terminates, where re-rolling only terminates with
//     probability one.
//   * **Orientation is constructed, not rejected.** The last piece's twist is whatever makes the
//     sum come out, so every draw is valid first time.
//
// The generator is injected, so tests can drive it with a scripted sequence and get an exact
// expected answer rather than a statistical one.

/** One uniform 32-bit value from the platform's cryptographic source. */
const scratch = new Uint32Array(1);
export function cryptoUint32() {
  // `crypto` is global in browsers, in workers and in Node 18+. If it is ever missing, that is
  // worth failing on rather than falling back to Math.random(): a silent downgrade to a
  // predictable source is exactly the thing this module exists to prevent.
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('random-state: no cryptographic random source; refusing to fall back to Math.random()');
  }
  crypto.getRandomValues(scratch);
  return scratch[0];
}

/**
 * How many rejected draws are a broken source rather than bad luck.
 *
 * The rejected tail is at most `n` values out of 2^32, so for every `n` this module uses the chance
 * of one rejection is under one in 350 million and the chance of thirty-two in a row is zero for any
 * practical purpose. Reaching this number does not mean the loop was unlucky; it means the source
 * stopped varying.
 */
export const MAX_REJECTIONS = 32;

/**
 * A uniform integer in [0, n), with the modulo bias removed.
 *
 * Taking `rng() % n` directly is biased towards the low values whenever n does not divide 2^32.
 * The bias is small — for n = 12 it is about one part in 350 million — but it is a bias in
 * exactly the place the whole module is about, so the tail is rejected instead.
 *
 * **THE REJECTION IS BOUNDED, AND EXHAUSTION THROWS.** A source that keeps answering the same
 * value in the rejected tail — a stub, a fake in a test, a broken entropy seam — left
 * `while (draw >= limit)` spinning for ever: a HANG rather than a wrong answer, on the UI thread,
 * which is the worse of the two. `drillAlg` in `lib/drill-rounds.js` already names this hazard in
 * its own comment and avoids it in the one place it is visible, then delegated straight into it
 * here (Codex audit, 2026-10-04); `makeRound`'s retry budget cannot help, because the loop never
 * returns to it. Throwing is the same stance `cryptoUint32` takes about a missing source: a random
 * generator that cannot produce a uniform value says so rather than stalling.
 */
export function randomBelow(n, rng = cryptoUint32) {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError(`randomBelow: ${n} is not a positive integer`);
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  let draw = rng();
  // `rejected` starts at ONE, because reaching the loop means the first draw was itself rejected.
  // Starting at zero spent 33 draws under a constant called 32 — a number in a name that the code
  // does not keep (verify pass, 2026-10-04).
  for (let rejected = 1; draw >= limit; rejected += 1) {
    if (rejected >= MAX_REJECTIONS) {
      throw new Error(
        `random-state: ${MAX_REJECTIONS} draws in a row fell in the rejected tail for n = ${n} — `
        + 'the random source is not varying, and a uniform value cannot be drawn from it',
      );
    }
    draw = rng();
  }
  return draw % n;
}

/** Fisher-Yates, in place, with unbiased draws. */
function shuffle(array, rng) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1, rng);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/** Even or odd, by cycle decomposition. */
export function permutationParity(perm) {
  const seen = new Array(perm.length).fill(false);
  let swaps = 0;
  for (let start = 0; start < perm.length; start++) {
    if (seen[start]) continue;
    let length = 0;
    for (let at = start; !seen[at]; at = perm[at]) { seen[at] = true; length++; }
    swaps += length - 1; // a cycle of length L is L-1 transpositions
  }
  return swaps % 2;
}

/** Twists that sum to zero: the last piece takes whatever is left over. */
function orientations(count, modulus, rng) {
  const out = new Array(count);
  let total = 0;
  for (let i = 0; i < count - 1; i++) {
    out[i] = randomBelow(modulus, rng);
    total += out[i];
  }
  out[count - 1] = (modulus - (total % modulus)) % modulus;
  return out;
}

/**
 * A uniformly random legal cube state, as `{ cp, co, ep, eo }`.
 *
 * Uniform over all 43,252,003,274,489,856,000 of them: 8! corner arrangements x 12!/2 edge
 * arrangements x 3^7 twists x 2^11 flips.
 */
export function randomState(rng = cryptoUint32) {
  const cp = shuffle([0, 1, 2, 3, 4, 5, 6, 7], rng);
  const ep = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], rng);
  // Half of all draws land on the unreachable parity. One transposition repairs it, and doing
  // so is a bijection onto the legal half, so nothing is skewed by the repair.
  if (permutationParity(cp) !== permutationParity(ep)) [ep[0], ep[1]] = [ep[1], ep[0]];
  return { cp, co: orientations(8, 3, rng), ep, eo: orientations(12, 2, rng) };
}

/**
 * The same, as a cubejs `Cube` — which is what turns it into a facelet string.
 *
 * Writes cubejs's internal arrays directly. That coupling is pinned by cube-pieces.test.mjs,
 * which re-derives every move table from cubejs on each run and fails if the layout moves.
 */
export function randomCube(Cube, rng = cryptoUint32) {
  const state = randomState(rng);
  const cube = new Cube();
  cube.cp = state.cp;
  cube.co = state.co;
  cube.ep = state.ep;
  cube.eo = state.eo;
  return cube;
}
