// esbuild entry for cubejs — bundled into vendor/cubejs.js by `pnpm build:cubejs`.
//
// cubejs is CommonJS with no ESM build, so the browser cannot load it directly; esbuild converts
// it. It has no workers and no dynamic imports, so a plain bundle is safe here — unlike cubing,
// which spawns a worker and is copied wholesale instead (see vendor-cubing.mjs).
//
// This replaces a runtime fetch of cubejs@1.3.2 from esm.sh. The dependency is pinned in
// package.json now, so the version is reviewable and the app works offline.
//
// Written without a literal remote import expression on purpose: solver-offline.test.mjs greps
// these sources for one, and a quoted example in a comment would trip it. Weakening the grep to
// skip comments would be worse — `//` occurs inside URLs, so stripping them can hide a real hit.
export { default } from 'cubejs';
