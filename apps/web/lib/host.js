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

/** What boot() published, or null before it ran (and in a plain Node test). */
export function hostPlatform() {
  return globalThis.document?.documentElement?.dataset?.platform ?? null;
}

/** Absent platform means NOT desktop: unknown must fall to the side that promises less. */
export function isDesktopHost() {
  return DESKTOP_PLATFORMS.includes(hostPlatform());
}
