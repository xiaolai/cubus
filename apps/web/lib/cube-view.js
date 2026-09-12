// The cube view the app draws its OWN cubes at — one statement of it, as data.
//
// These were an inline default inside `cubeScreen`, which is where they belong as far as the app
// is concerned. They are here because a second consumer needs them and was reading them out of
// `app.js` WITH A REGULAR EXPRESSION (cubus-im's `pipeline/paths.py::cube_preset`, so its lessons
// draw the cube the app draws rather than keeping a hand-copied look that goes stale in silence).
// A line of an application file is not an API. This is.
//
// The defaults ARE the tuned look, not a starting point. The Restore screen's cube — ghosts
// floating at elevation 9, stickers full-bleed at 1 — is the reference every walking screen must
// match, and a wiped localStorage once reverted them to a look nobody had chosen. A tuning that
// lives only in storage is a tuning waiting to be lost.
//
// Frozen, because an exported mutable object is a new way for one screen to change every other
// screen's defaults at a distance — a failure the inline literal could not have.

/** @type {Readonly<{hintElev: number, camLat: number, camLon: number, facScale: number, ghosts: boolean}>} */
export const CUBE_VIEW = Object.freeze({
  hintElev: 9,
  camLat: 35,
  camLon: 45,
  facScale: 1,
  ghosts: true,
});

/**
 * The same numbers under the names `<cubus-cube>` calls them.
 *
 * Beside the constant on purpose: the mapping was a second copy in the consumer, and a mapping
 * kept away from the thing it maps is how `hintElev` comes to mean two different attributes.
 * `ghosts` is not here — it is a boolean the caller turns into `'on'`/`'none'`, not a number.
 */
export const CUBE_VIEW_ATTRS = Object.freeze({
  'ghost-elevation': CUBE_VIEW.hintElev,
  'camera-latitude': CUBE_VIEW.camLat,
  'camera-longitude': CUBE_VIEW.camLon,
  'facelet-scale': CUBE_VIEW.facScale,
});
