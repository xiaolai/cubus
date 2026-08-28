// Reconnecting a known cube — the readings, and the two-side spot check.
//
// A cube that was paired before wakes up nearby and connects, and the app cannot see which of two
// worlds it is in: untouched since it disconnected (its report is the arrangement in the hand) or
// turned since (its report is confidently wrong). The readings below choose the PICTURE and the
// WORDS — never the trust. No reading grants trust: a restarted counter plus one turn can
// reproduce a remembered report exactly, and a forged record in storage would otherwise have been
// a forged trust. Every reading ends at the user, who confirms the STATE, never the identity
// (dev-docs/cube-trust-design.md §0; dev-docs/smart-cube-ux-prd.md, "Reconnecting a known cube").
//
// The GAN16's serial is a per-connection count (measured with the driver's CLI — the runs are
// recorded in the PRD): it says nothing across a break, so classification is decided by the
// state alone. The serial is accepted in the record and deliberately ignored here — a reading
// that leaned on it would call every real reconnect of an untouched cube "turned", because a
// fresh connection restarts the count.
//
// Pure: no DOM, no storage; cubejs injected, the same convention as cube-trust.js.

import { applyOffset, deriveOffset, isCubeState, looksLikeCubeState } from './cube-trust.js';

/** Every reading, in evidence order — the first that matches wins, so each connection has
 *  exactly one. Exported so the screens and the tests enumerate the same set. */
export const READINGS = ['no-report', 'nothing-remembered', 'unchanged', 'turned'];

const FACES = 'URFDLB';

const state = (s, Cube) => (typeof s === 'string' && isCubeState(s, Cube) ? s : null);

/** The remembered record, or null when it cannot be used whole. Validated HERE as well as in the
 *  registry parse: storage is writable by anything on the origin, and the registry's structural
 *  check runs without cubejs at boot — a forged arrangement must fail at the door of the one
 *  function that turns it into a picture. */
function usableLast(last, Cube) {
  if (!last || typeof last !== 'object' || Array.isArray(last)) return null;
  const facelets = state(last.facelets, Cube);
  const reported = state(last.reported, Cube);
  if (!facelets || !reported) return null;
  return { facelets, reported };
}

/**
 * Which world is this reconnect in, as far as the evidence can say?
 *
 * @param {{report?: string|null, last?: object|null}} evidence — the cube's raw report on
 *   reconnect (uncorrected), and the remembered record `{facelets, reported, …}` where
 *   `facelets` is the truth the app was last sure of and `reported` the cube's own raw claim at
 *   that same moment. Raw-to-raw on purpose: after a camera repair the truth and the report
 *   differ by an offset that died with the disconnect, so comparing the fresh report against the
 *   remembered TRUTH would call an untouched, repaired cube "turned".
 * @param {Function} Cube cubejs constructor, injected
 * @returns {{reading: string, candidate: string|null}} the reading, and the picture to show —
 *   never a trust claim. For 'turned' the candidate is the remembered relationship applied to
 *   the fresh report: offset = facelets · reported⁻¹, candidate = offset · report — the very
 *   derivation a camera repair makes, with the memory standing in for the scan.
 */
export function classifyReconnect({ report = null, last = null } = {}, Cube) {
  const memory = usableLast(last, Cube);
  // A report that cannot be validated is a cube that has not usably said where it is — the same
  // door as silence, and the message is said rather than swallowed.
  if (!state(report, Cube)) return { reading: 'no-report', candidate: memory ? memory.facelets : null };
  if (!memory) return { reading: 'nothing-remembered', candidate: null };
  if (report === memory.reported) return { reading: 'unchanged', candidate: memory.facelets };
  const offset = deriveOffset(memory.facelets, memory.reported, Cube);
  const candidate = offset === null ? null : applyOffset(offset, report, Cube);
  return { reading: 'turned', candidate };
}

// ---- the two-side spot check ------------------------------------------------------------------
//
// A child cannot compare 54 stickers against a net, so the camera does it a side at a time. What
// a partial check can and cannot catch is measured, not assumed
// (apps/web/test/reconnect-confirmation.test.mjs): one side, compared any way up, misses a single
// untracked quarter turn about a third of the time; two OPPOSITE sides fail together the same
// way; two ADJACENT sides catch it under 1% — whichever face turned, at least one of the pair
// gains a row or a column it did not have. And only compared EXACTLY: the scanner's usual
// two-sticker tolerance is one sticker short of a quarter turn's three, so a misread costs a full
// scan here — the safe direction — and never a false yes. No partial check is a proof (a legal
// 17-move drift hides from three adjacent sides); the check supports the user's answer, it does
// not establish trust on its own.

const OPPOSITE = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };

/** Do two faces share an edge? Every distinct pair does except the three opposite ones.
 *  Object.hasOwn, not `in`: `in` walks the prototype chain, so an inherited name like
 *  `constructor` would count as a face adjacent to every real one. */
export function facesAdjacent(a, b) {
  return Object.hasOwn(OPPOSITE, a) && Object.hasOwn(OPPOSITE, b) && a !== b && OPPOSITE[a] !== b;
}

/** One face of a facelet string, as its nine stickers. */
const sideOf = (facelets, face) => {
  const i = FACES.indexOf(face);
  return i < 0 ? null : facelets.slice(i * 9, i * 9 + 9);
};

/** A side turned 90° clockwise. */
const rot = (s) => s[6] + s[3] + s[0] + s[7] + s[4] + s[1] + s[8] + s[5] + s[2];

/**
 * Does a captured side match the candidate's — any way up, and EXACTLY?
 *
 * Up to rotation because a side is captured whichever way it is held, and the app learns a side's
 * true rotation only from a full six-side scan. That costs: a turn only rotates its own face's
 * stickers, which is precisely why one side is not a confirmation and the check wants two that
 * share an edge. Which face to compare against is the capture's own — the scanner names a side by
 * its centre colour, and the centre is the one sticker a turn cannot move.
 *
 * @param {string} candidate 54-char facelet string (already validated by the caller's reading)
 * @param {string} face      which side the capture is, per its centre — one of URFDLB
 * @param {string} seen      the nine stickers as captured, any way up
 */
export function sideMatches(candidate, face, seen) {
  const want = typeof candidate === 'string' && candidate.length === 54 ? sideOf(candidate, face) : null;
  if (!want || typeof seen !== 'string' || seen.length !== 9) return false;
  let s = seen;
  for (let i = 0; i < 4; i++) {
    if (s === want) return true;
    s = rot(s);
  }
  return false;
}

/**
 * The confirmation's verdict over everything captured so far.
 *
 * - 'mismatch'  — some side is not the candidate's: the full repair scan continues from the
 *                 sides already captured. Any unusable input lands here too, because the safe
 *                 direction is always the scan, never the yes.
 * - 'confirmed' — every side matches and two of them share an edge: the user's yes is well
 *                 founded and is taken.
 * - 'pending'   — everything matches but no adjacent pair yet (one side, or an opposite pair —
 *                 which fails exactly like one side, so it cannot confirm).
 *
 * @param {string} candidate 54-char facelet string
 * @param {Array<{face: string, stickers: string}>} sides captured so far
 * @param {Function} [Cube] cubejs constructor; with it, the candidate must also pass the full
 *   reachability round-trip — without it, the structural gate alone
 * @returns {{verdict: 'confirmed'|'mismatch'|'pending', matched: string[], mismatched: string[]}}
 */
export function confirmCheck(candidate, sides, Cube) {
  const matched = [];
  const mismatched = [];
  // The candidate is re-validated on this trust-granting path, not merely length-checked: 54
  // sticker-shaped characters that are not a cube state must not be confirmable. Structurally
  // always; by full reachability when the library is injected — and an injected value that is
  // not the library refuses rather than silently downgrading to the weaker check.
  const candidateOk = looksLikeCubeState(candidate)
    && (Cube === null || Cube === undefined ? true : isCubeState(candidate, Cube));
  if (!candidateOk || !Array.isArray(sides)) return { verdict: 'mismatch', matched, mismatched };
  for (const s of sides) {
    // A malformed entry is a MISMATCH, never a skip: silently dropping one let two valid
    // matches confirm past it, and the safe direction is always the scan.
    const face = s && typeof s === 'object' && typeof s.face === 'string' ? s.face : '?';
    const ok = Boolean(s) && typeof s === 'object' && sideMatches(candidate, s.face, s.stickers);
    (ok ? matched : mismatched).push(face);
  }
  if (mismatched.length) return { verdict: 'mismatch', matched, mismatched };
  for (let i = 0; i < matched.length; i++) {
    for (let j = i + 1; j < matched.length; j++) {
      if (facesAdjacent(matched[i], matched[j])) return { verdict: 'confirmed', matched, mismatched };
    }
  }
  return { verdict: 'pending', matched, mismatched };
}
