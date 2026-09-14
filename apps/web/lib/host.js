// Which host is this, really.
//
// `window.__TAURI__` used to answer that question on its own: the only native build was the
// desktop one, so "the commands are injected" and "there is a desktop behind them" were the
// same fact. The iOS and Android shells (2026-08-30) ended that — a phone injects the very
// same API — and every capability that is desktop-only has to say so itself now. The
// orientation row already did, inline; this is that predicate, named once so the next seam
// cannot get it subtly different.
//
// The platform string is detectPlatform()'s, published on <html data-platform> before the
// first screen renders. Read from there rather than sniffing again, so `?platform=ios` pins
// this too — a desktop-only affordance must disappear under the pin that claims a phone, or
// design review is reviewing a screen no phone will ever show.

/** The platforms that have a desktop behind them. Not a UA list — a capability list. */
export const DESKTOP_PLATFORMS = Object.freeze(['macos', 'windows', 'linux']);

/** Every platform the app draws chrome for, and so the only values a design-review pin may name —
 *  from the URL or from storage. */
export const PLATFORMS = Object.freeze(['macos', 'windows', 'linux', 'ios', 'android']);

/**
 * The platform a user agent and a finger describe, when nothing has pinned one. Pure, so the table
 * of cases is a test rather than a browser (lifted out of window-chrome.js's detectPlatform, where
 * it shared a function with storage and the URL; found by audit, 2026-09-13).
 *
 * iPadOS calls itself a Mac; a finger gives it away — the touch points (5 on a real iPad), or a
 * coarse pointer (what a touch-emulating WebKit reports, with no touch points at all). No Mac has
 * either, which is why the iPad test comes before the plain Mac one. A phone or tablet gets plain
 * bars: no traffic-light gap, no caption buttons — there is no window to drive.
 */
export function classifyDevice(ua, finger) {
  if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(ua) && finger)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Mac/.test(ua)) return 'macos';
  if (/Win/.test(ua)) return 'windows';
  return 'linux';
}

/** What boot() published, or null before it ran (and in a plain Node test). */
export function hostPlatform() {
  return globalThis.document?.documentElement?.dataset?.platform ?? null;
}

/** Absent platform means NOT desktop: unknown must fall to the side that promises less. */
export function isDesktopHost() {
  return DESKTOP_PLATFORMS.includes(hostPlatform());
}
