// esbuild entry for smartcube-web-bluetooth — bundled into vendor/smartcube.js by
// `pnpm build:smartcube`.
//
// This is the app's protocol layer: every smart-cube decoder (GAN Gen1-4, Giiker, GoCube,
// MoYu v1/MHC/32, QiYi), brand matching, handshakes and command building. We link it rather than
// copy it; the reasoning and the measurement behind that are in
// dev-docs/universal-cube-driver.md §1-2.
//
// It is pinned to a FORK (xiaolai/smartcube-web-bluetooth, branch `integration`), which is a
// deliberate narrowing of the link-vs-copy decision rather than a reversal of it: the fork keeps
// `upstream` as a remote and is intended to stay a strict superset, with its work going back to
// poliva/smartcube-web-bluetooth. A fork that diverges becomes the copy §1 measured and rejected —
// so the thing to watch is not the fork's existence but its distance from upstream.
//
// Two defects reported against the pinned upstream rev are already fixed here: `aes-js` is a
// default import, so the published ESM build is Node-importable again, and the Gen4 driver
// selection is table-driven rather than a chain that could validate a packet and then throw
// decoding it.
//
// It is bundled because it is an unpublished git dependency: the bundle committed beside this
// file is the artifact that actually ships, reviewable in a diff whenever the pinned rev moves.
//
// (It was ALSO bundled to work around the ESM interop defect above — `dist/esm/index.mjs` could
// not be imported under Node at the pinned upstream rev. That is fixed on the fork and verified,
// so bundling now rests on the vendoring argument alone.)
//
// The library talks to `navigator.bluetooth`, which exists on none of the packaged targets
// (WKWebView, Android WebView, WebView2, WebKitGTK). The polyfill in ble-polyfill.js is what makes
// this bundle work everywhere; see §3-4.

/** The upstream commit this bundle was built from.
 *
 *  Not decoration: a third-party bundle has no sources of ours for the staleness guard to compare
 *  against, so this constant IS the guard. smartcube-pin.test.mjs asserts three things agree — the
 *  rev here, the rev pinned in package.json, and the rev baked into the built bundle. Bump the dep
 *  without rebuilding, or rebuild without bumping, and one of them goes red. */
export const SMARTCUBE_REV = '95bda9a0c528d9565e2ac0e4e72fdb630b6cf415';

export { connectSmartCube, getRegisteredProtocols } from 'smartcube-web-bluetooth';
