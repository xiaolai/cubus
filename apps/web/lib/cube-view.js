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
 * Saved key to the attribute `<cubus-cube>` reads it under. THE one mapping.
 *
 * It was written out twice — here as attribute-to-default, and again inside `cubeScreen` as
 * key-to-attribute — which is the shape this file's own comment warns about: a mapping kept away
 * from the thing it maps is how `hintElev` comes to mean two different attributes. Everything
 * below is derived from this, and `lib/cube-drawing.js` applies it to every cube the app draws.
 *
 * `ghosts` is not here: it is a boolean a caller turns into `'floating'`/`'none'`, not a number.
 */
export const VIEW_ATTRS = Object.freeze([
  // Each PAIR is frozen too, not only the array holding them. `Object.freeze` is shallow, so an
  // outer freeze leaves `VIEW_ATTRS[0][1] = 'whatever'` succeeding silently — and `applyCubeView`
  // would then write the corrupted attribute while `CUBE_VIEW_ATTRS`, built once at load, kept the
  // original. Two mappings again, which is the exact failure this file exists to end.
  Object.freeze(['hintElev', 'ghost-elevation']),
  Object.freeze(['camLat', 'camera-latitude']),
  Object.freeze(['camLon', 'camera-longitude']),
  Object.freeze(['facScale', 'facelet-scale']),
]);

/**
 * HOW FAST A TURN IS DRAWN, and the storage key the choice is kept under.
 *
 * The renderer divides a 190ms base by `tempo-scale`, so a LARGER number is FASTER and the
 * renderer's own default of 1 is 190ms — a quarter turn in a fifth of a second, which reads as a
 * snap rather than a turn. None of the speeds below is quick: Fast is 0.95s per quarter turn, still
 * slower than the 760ms that used to be the only speed and was the complaint that prompted the
 * menu.
 *
 * THIS IS HERE, NOT IN THE MENU, BECAUSE IT IS NOT THE MENU'S. It lived in
 * `lib/screens/cube/speed-menu.js` and was written to exactly one cube — the cube screen's — so
 * every other cube the app draws animated at the renderer's raw 190ms: measured 2026-09-30 on the
 * Drill page at 200ms against 1620ms for the same turn once `tempo-scale` was set to Normal.
 *
 * THAT IS THE SECOND TIME THIS SHAPE HAS SHIPPED. The first was ghost faces and the camera, which
 * `cubeScreen` also owned alone — "which is why both drill screens came out with no ghost faces at
 * all" (`lib/screens/cube.js`) — and `applyCubeView` exists because of it. A property of how the
 * app's cubes LOOK belongs to the one place that draws them all; a screen may override it, but no
 * screen may be the only place it is set.
 *
 * `tempo` is not part of `CUBE_VIEW`: that object is a published surface (`lib/cube-kit.js`,
 * re-read by cubus-im's `pipeline/paths.py::cube_preset`) describing a STILL cube's look, and
 * animation tempo is no business of a drawing that does not move.
 */
export const WALK_SPEEDS = Object.freeze([
  Object.freeze({ id: 'slow', label: 'Slow', tempo: 0.05 }),     // 3.8s per quarter turn
  Object.freeze({ id: 'normal', label: 'Normal', tempo: 0.1 }),  // 1.9s
  Object.freeze({ id: 'fast', label: 'Fast', tempo: 0.2 }),      // 0.95s
]);

/** The speed a cube is drawn at when nobody has chosen one. */
export const DEFAULT_WALK_SPEED = 'normal';

/** The key the chosen speed is stored under. Named once, because two spellings is two settings. */
export const WALK_SPEED_KEY = 'walkSpeed';

/**
 * The tempo for a saved speed id — the DEFAULT's tempo for anything else.
 *
 * localStorage is untrusted input, so an id no longer in `WALK_SPEEDS` (a renamed speed, a hand
 * edit, a half-finished migration) must not reach `setAttribute`: the renderer would fall back to
 * its own 190ms, which is the very failure this table exists to prevent and would be invisible.
 */
export function tempoFor(id) {
  const found = WALK_SPEEDS.find((o) => o.id === id);
  return (found ?? WALK_SPEEDS.find((o) => o.id === DEFAULT_WALK_SPEED)).tempo;
}

/** The same numbers under the names `<cubus-cube>` calls them, derived from the one mapping. */
export const CUBE_VIEW_ATTRS = Object.freeze(
  Object.fromEntries(VIEW_ATTRS.map(([key, attr]) => [attr, CUBE_VIEW[key]])),
);
