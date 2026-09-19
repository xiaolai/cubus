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
  // Linux is the FALLTHROUGH as well as a platform: an agent naming nothing this app knows gets the
  // chrome a desktop gets, which is the safe shape for a window. `deviceNamed` is the same reading
  // without that assumption, for the questions where "I do not know" is a different answer from Linux.
  return deviceNamed(ua, finger) ?? 'linux';
}

/**
 * The platform a user agent NAMES, or null when it names none.
 *
 * Same patterns as `classifyDevice`, one source of truth, minus its fallthrough — because a
 * CAPABILITY must not be inherited by a platform nobody has heard of. An unknown agent read as Linux
 * would be offered the scanner capabilities desktop Linux has, which is exactly the fail-open this
 * gate exists to avoid (audit, 2026-09-19).
 */
export function deviceNamed(ua, finger) {
  if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(ua) && finger)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Mac/.test(ua)) return 'macos';
  if (/Win/.test(ua)) return 'windows';
  if (/Linux|X11|CrOS|BSD/.test(ua)) return 'linux';
  return null;
}

/** What boot() published, or null before it ran (and in a plain Node test). */
export function hostPlatform() {
  return globalThis.document?.documentElement?.dataset?.platform ?? null;
}

/** The native builds whose scanner is EXPECTED to say where each sticker sits: the two Apple ones,
 *  whose plugin speaks cube-vision wire version 2, and Linux, which has no native plugin and scans in
 *  the browser runtime. Named as a capability list, never as the platforms left over: a denylist
 *  answers YES for a platform nobody has thought about yet, and for `null` before boot has published
 *  one — and a row offering a view the scanner cannot feed is worse than a row that is missing
 *  (audit, 2026-09-19). */
const PLACES_STICKERS = Object.freeze(['macos', 'ios', 'linux']);

/**
 * The platform this DEVICE is, from the user agent and a finger — never `<html data-platform>`.
 *
 * That attribute is what a design-review pin writes, and a pin is an answer to "what should this
 * screen look like", not to "what can the scanner on this machine do". Reading it here let a pin
 * claiming macOS offer a view a Windows or Android build's v1 plugin cannot feed (audit, 2026-09-19).
 * The chrome predicates below still read the pin, which is what it is for.
 */
function devicePlatform() {
  const nav = globalThis.navigator;
  if (!nav) return null;
  const finger = nav.maxTouchPoints > 0 || globalThis.matchMedia?.('(any-pointer: coarse)')?.matches === true;
  return deviceNamed(nav.userAgent ?? '', finger);
}

/**
 * What this build's scanner is expected to do, from the device alone: the browser runtime has the
 * frame itself, and the Apple plugin sends its size since cube-vision wire version 2. Windows' and
 * Android's plugins still send version 1 (dev-docs/scan-guidance-plan.md 5) — add them here when they
 * move.
 *
 * A GUESS, and named as one: it says what a build on this kind of machine does, which is the best
 * anyone can say before the scanner has run. `scannerPlacesStickers` prefers the scanner's own
 * answer wherever there is one.
 */
export function platformPlacesStickers(tauri = typeof globalThis.__TAURI__ !== 'undefined', platform = devicePlatform()) {
  return !tauri || PLACES_STICKERS.includes(platform);
}

/** Where what the scanner has shown is kept between visits. Its own key, holding one of two
 *  characters and nothing else: a device capability is not a setting, and nothing may edit it but the
 *  scanner's own reports. */
const OBSERVED_KEY = 'cubusScannerPlaces';

/** What the scanner on this build has been SEEN to do, or null before it has ever shown anything.
 *  Read once, from storage, so a device that has scanned before answers correctly from the first
 *  screen — the platform's guess is then only ever used on a device that never has (audit, 2026-09-19). */
let observed = (() => {
  try {
    const kept = localStorage.getItem(OBSERVED_KEY);
    return kept === '1' ? true : kept === '0' ? false : null;
  } catch {
    return null;
  }
})();

/** Remember it, if the browser will keep it. A refusal is not worth a word on screen: the scanner
 *  answers again on the next scan, and until then the platform's guess stands. */
function remember(places) {
  try {
    localStorage.setItem(OBSERVED_KEY, places ? '1' : '0');
  } catch (err) {
    console.debug('[cubus] what the scanner can do was not kept', err);
  }
}

/**
 * Whether the scanner on this build says where each sticker sits in the picture (`ScanProgress.seen`),
 * which the study's sticker view needs.
 *
 * The scanner's own reports decide it once there has been one: a runtime that placed stickers can, and
 * one that read a side and placed none cannot — whatever platform the page believes it is on. Before
 * any report, the platform's guess stands, so the row is there on a capable build from the first visit
 * rather than after the first scan (audit, 2026-09-19).
 */
export function scannerPlacesStickers() {
  return observed ?? platformPlacesStickers();
}

/**
 * Learn from one scan report. Called for every report the scan screen hears.
 *
 * Evidence, not inference: `seen` present is a scanner that placed stickers; a READ side with no
 * `seen` is one that cannot. A report with neither says nothing, and leaves the answer where it was.
 */
export function noteScanReport(report) {
  const places = report?.seen ? true : observed === null && report?.live ? false : observed;
  if (places === observed) return;
  observed = places;
  remember(places);
}

/** Tests only: forget what the scanner has shown, here and in storage, so a case can start from the
 *  platform's guess. */
export function forgetScannerReports() {
  observed = null;
  try {
    localStorage.removeItem(OBSERVED_KEY);
  } catch { /* nothing kept it, so there is nothing to forget */ }
}

/** Absent platform means NOT desktop: unknown must fall to the side that promises less. */
export function isDesktopHost() {
  return DESKTOP_PLATFORMS.includes(hostPlatform());
}
