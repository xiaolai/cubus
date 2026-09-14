// The OS safe-area insets the app pads by: what the design-review override and the Android
// shell's bridge actually say.
//
// Pure, no DOM. lib/app.js reads the URL and the bridge and writes the CSS properties; this
// decides what those inputs mean, so each answer is checked with real inputs and no browser,
// phone or boot (test/os-insets-read.test.mjs). Lifted out of lib/app.js on 2026-09-13.

const SIDES = ['t', 'r', 'b', 'l'];

/**
 * `?insets=59,0,34,0` (top, right, bottom, left; px) as `{ t, r, b, l }`, or null when the
 * parameter is absent. Throws on anything that is not four non-negative numbers.
 */
export function parseInsetOverride(raw) {
  if (raw === null || raw === undefined) return null;
  // Whole tokens only: parseFloat reads the number a token STARTS with, so `59oops` was 59 and
  // a fixture ran on insets nobody wrote (found by audit, 2026-09-13). And finite: a run of digits
  // too long for a double is Infinity, which whole tokens alone let through (verification,
  // 2026-09-14).
  const tokens = String(raw).split(',').map((v) => v.trim());
  const px = tokens.map(Number);
  if (tokens.length !== 4 || tokens.some((v) => !/^\d+(?:\.\d+)?$/.test(v)) || px.some((v) => !Number.isFinite(v))) {
    throw new Error(`?insets= wants four non-negative numbers, got "${raw}"`);
  }
  return Object.fromEntries(SIDES.map((side, i) => [side, px[i]]));
}

/**
 * What the Android shell's `cubusInsets` bridge says, as `{ t, r, b, l }` in CSS px, or null.
 *
 * Null and silent when there is no bridge, or it answers `"null"` (the honest answer before
 * the first dispatch: with nothing written, env()'s fallback stands). Null with a warning when
 * it throws or its answer is not four finite non-negative numbers.
 *
 * Zero trust at the boundary, even though the other side is ours: this crosses a JNI bridge
 * as text, and a malformed number reaching setProperty is a silently broken layout rather
 * than an error.
 */
export function readAndroidInsets(bridge, warn = () => {}) {
  if (typeof bridge?.get !== 'function') return null;
  let raw;
  try { raw = bridge.get(); } catch (err) { warn('android insets: the bridge would not answer', err); return null; }
  if (typeof raw !== 'string' || raw === 'null') return null;
  let px;
  try { px = JSON.parse(raw); } catch (err) { warn('android insets: unreadable payload', raw, err); return null; }
  if (!px || typeof px !== 'object' || SIDES.some((k) => !Number.isFinite(px[k]) || px[k] < 0)) {
    warn('android insets: not four non-negative numbers', raw);
    return null;
  }
  return Object.fromEntries(SIDES.map((k) => [k, px[k]]));
}
