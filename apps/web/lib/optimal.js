// The optimal-solver seam, webview side (AGENTS.md, fourth accepted exception, 2026-08-29).
//
// The capability is "prove this solution minimal". Where the Tauri commands are injected ON A
// DESKTOP, this module drives them; anywhere else `capability()` is false, the affordance is
// never drawn, and the app keeps saying "the shortest I found" — which is the browser's honest
// answer to the same question. The word "optimal" (or "proved") may reach a screen ONLY through
// `prove()` here, and never survives the oracle check failing.
//
// "On a desktop" is not decoration. The iOS and Android shells inject exactly the same command
// surface, and the first press of the affordance generates 86 MB of pattern databases with a
// rayon fan-out over every core — minutes of work and ~500 MB peak. That is a desktop's job.
// A phone gets the browser's answer, which is the same answer it would get with no native side
// at all, so nothing on any screen depends on which build is running.
//
// The oracle is non-negotiable: every native answer is applied to the cube through cubejs (an
// independent implementation) before anyone sees it. A native solver bug must become a loud
// error at this boundary, not a wrong number wearing the word "proved".

import { isDesktopHost } from './host.js';
// The pipeline's one tokenizer. solver-engine.js is the protocol boundary and imports no engine,
// so this costs the seam nothing; what it buys is that a proof's move count and the app's move
// count cannot come from two different splitters.
import { moveTokens } from './solver-engine.js';

/** The face-turn grammar the proofs are stated in. cubejs would happily apply rotations,
 *  slices and wide moves too — and a native answer using them would "solve" while proving
 *  nothing in the claimed metric. Shared with the challenge library's validator. */
export const HTM_TOKEN = /^[URFDLB](?:2|')?$/;

/** Split an alg into tokens, refusing anything outside the HTM face-turn grammar. */
export function htmMoves(alg, what) {
  const tokens = moveTokens(alg);
  for (const token of tokens) {
    if (!HTM_TOKEN.test(token)) {
      throw new Error(`${what}: "${token}" is not a face turn — wrong metric, refusing`);
    }
  }
  return tokens;
}

/** The injected command surface, or null. A function so tests can stub the global. */
const surface = () => {
  const invoke = globalThis.window?.__TAURI__?.core?.invoke;
  return typeof invoke === 'function' ? invoke : null;
};

/** Is the proof capability present at all? Drawn-nowhere follows from false, like the
 *  orientation row — and on the same two conditions, for the same reason: a command surface,
 *  and a desktop behind it. */
export const capability = () => surface() !== null && isDesktopHost();

/**
 * Ensure the tables exist (generate on first ever run — minutes, reported via the
 * `optimal-progress` event the caller may listen to). Resolves to 'ready' | 'preparing'.
 */
export async function prepare() {
  const invoke = surface();
  if (!invoke) throw new Error('optimal: no native solver here');
  return invoke('optimal_prepare');
}

export async function status() {
  const invoke = surface();
  if (!invoke) return 'absent';
  return invoke('optimal_status');
}

/**
 * Prove the minimal length of `facelets`. Returns `{ moves, alg, nodes, millis }` where
 * `moves` is PROVEN minimal — or throws: 'cancelled', tables-not-ready, or an oracle failure.
 *
 * `Cube` is injected (the vendored cubejs the app already holds) so this module stays free of
 * loading concerns and the test can hand in the real oracle with a fake native side.
 * `upperBound` is the two-phase answer already in hand: optimal ≤ two-phase, ALWAYS, and a
 * claimed minimum above an existing solution is a proof of a bug, refused here rather than
 * shown (§5 check 3 — the one cross-solver invariant, enforced where the two solvers meet).
 */
export async function prove(facelets, { Cube, upperBound = null }) {
  const invoke = surface();
  if (!invoke) throw new Error('optimal: no native solver here');
  // A NaN or Infinity bound would make the cross-solver comparison silently false — the one
  // invariant this seam enforces would just not fire. Refuse it before any native work.
  if (upperBound !== null && (!Number.isSafeInteger(upperBound) || upperBound < 0)) {
    throw new Error('optimal: upperBound must be null or a non-negative integer');
  }
  // Two fences before claiming the native slot. The cancel fence: a cancel issued for the
  // PREVIOUS proof may still be in flight (teardown fires it without awaiting), and claiming
  // before it lands would let the stale cancel kill THIS proof. The prove fence: a cancelled
  // proof releases its slot only when its worker exits, so starting before the previous
  // prove settles would bounce off "a proof is already running" — a loud but pointless
  // refusal. Errors behind either fence belong to their own callers, not to us.
  const fenced = (async () => {
    // Loop until the cancel fence is STABLE: while waiting out the previous proof, another
    // cancel aimed at it may arrive — a single snapshot would leave that one in flight.
    for (;;) {
      const snapshot = pendingCancels;
      await Promise.allSettled([snapshot, lastProve]);
      if (snapshot === pendingCancels) break;
    }
    return invoke('optimal_prove', { facelets });
  })();
  lastProve = fenced.then(
    () => {},
    () => {},
  );
  const proof = await fenced;
  if (!proof || typeof proof.length !== 'number' || typeof proof.solution !== 'string') {
    throw new Error('optimal: malformed proof from the native side');
  }
  // Grammar first: a token outside HTM would still "solve" through cubejs while proving
  // nothing in the claimed metric.
  const tokens = htmMoves(proof.solution, 'optimal');
  const alg = tokens.join(' ');
  const oracle = Cube.fromString(facelets);
  if (alg) oracle.move(alg);
  if (!oracle.isSolved()) {
    throw new Error('optimal: the native solution does not solve the cube — refusing the proof');
  }
  if (tokens.length !== proof.length) {
    throw new Error(`optimal: claimed length ${proof.length} but the solution has ${tokens.length} moves`);
  }
  if (upperBound !== null && tokens.length > upperBound) {
    throw new Error(
      `optimal: a claimed minimum of ${tokens.length} above the ${upperBound}-move solution in hand — a solver is broken`,
    );
  }
  if (!Number.isFinite(proof.nodes) || proof.nodes < 0 || !Number.isFinite(proof.millis) || proof.millis < 0) {
    throw new Error('optimal: malformed proof metadata from the native side');
  }
  // Persistence is a boolean fact the Rust side always states; anything else defaulting to
  // "fine" would suppress the very warning the field exists to carry.
  if (typeof proof.tables_persisted !== 'boolean') {
    throw new Error('optimal: malformed proof metadata from the native side');
  }
  return {
    moves: tokens.length,
    alg,
    nodes: proof.nodes,
    millis: proof.millis,
    tablesPersisted: proof.tables_persisted,
  };
}

/** EVERY outstanding cancellation round trip, aggregated — replacing rather than
 *  accumulating would let an older, slower cancel slip past the fence and land on a proof
 *  it was never aimed at. */
let pendingCancels = Promise.resolve();
/** The most recent proof's settling — the second half of the fence prove() waits behind. */
let lastProve = Promise.resolve();

/** Ask the running proof to stop. Resolves true if one was running. */
export async function cancel() {
  const invoke = surface();
  if (!invoke) return false;
  const flight = invoke('optimal_cancel');
  pendingCancels = Promise.allSettled([pendingCancels, flight]).then(() => {});
  return flight;
}
