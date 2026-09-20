// The app's version — the one number the About card and the updater show.
//
// Its own module since 2026-09-13, when app.js was split into modules: the Settings screen and
// the updater UI both show it, and a module that imported it from the entry would import the
// entry that imports it. app.js re-exports it, so a test reading VERSION off the app reads this.

/** Written HERE and nowhere else by hand. `pnpm bump` rewrites this line (scripts/bump-version.mjs)
 *  together with every manifest that carries the same number, a test fails when any of them drifts
 *  from it — the About card once spent months claiming 0.4.2 over manifests that all said 0.1.0 —
 *  and release.yml reads it to refuse a tag that does not match. */
export const VERSION = '0.6.3';
