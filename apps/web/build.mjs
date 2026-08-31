// Assemble apps/web/dist/ — the isolated web-asset folder Tauri bundles.
//
// Why this exists: tauri.conf.json's frontendDist used to point at apps/web
// itself, which also holds node_modules, package.json, serve.mjs and the tests.
// Tauri refuses that outright:
//
//   The configured frontendDist includes the `["node_modules"]` folder.
//   Please isolate your web assets on a separate folder.
//
// So `pnpm tauri build` could never produce a bundle. dist/ is that isolated
// folder: only what the browser actually loads, nothing else.
//
// Run AFTER the esbuild steps and copy-ort, because both write into vendor/ and
// this copies vendor/ wholesale. tauri.conf.json's beforeBuildCommand sequences
// them; the freshness check below fails loud if that order is ever broken.
//
// dist/ is generated and gitignored — never edit it, edit lib/ or index.html.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');

// Whole directories, so a new import never silently misses the bundle. lib/ is
// source (app.js and its siblings load as ES modules directly); vendor/ is
// esbuild output plus the onnxruntime wasm and the YOLO model.
const DIRS = ['lib', 'vendor', 'icons'];
const FILES = ['index.html', 'tokens.css', 'manifest.webmanifest'];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const f of FILES) {
  const src = join(here, f);
  if (!existsSync(src)) throw new Error(`build: missing required file ${f}`);
  cpSync(src, join(dist, f));
}
for (const d of DIRS) {
  const src = join(here, d);
  if (!existsSync(src)) throw new Error(`build: missing required directory ${d}/`);
  cpSync(src, join(dist, d), { recursive: true });
}

// Assert every asset the app actually references resolves inside dist. A copy
// step that quietly drops a file looks exactly like one that worked, and the
// failure would surface only as a blank window in a packaged app.
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const referenced = new Set(
  [...html.matchAll(/(?:href|src)="\.\/([^"]+)"/g)].map((m) => m[1]),
);
for (const icon of JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8')).icons ?? []) {
  referenced.add(icon.src.replace(/^\.\//, ''));
}

const missing = [...referenced].filter((r) => !existsSync(join(dist, r)));
if (missing.length) {
  throw new Error(`build: dist/ is missing referenced assets:\n  ${missing.join('\n  ')}`);
}

// The solving path is reached by dynamic import from app.js, so none of it appears in
// index.html and the scan above cannot see it. cubejs is also gitignored and regenerated, so a
// fresh checkout that skips `pnpm vendor:libs` would produce a dist/ that looks complete and
// silently cannot solve a cube — app.js try/catches the import. Assert the whole chain
// explicitly: the lib/ files ride the DIRS copy, but a dist/ missing any of them ships an app
// that loads and cannot solve, which is the one failure nothing else here would catch.
const SOLVER = [
  'vendor/cubejs.js',
  'lib/two-phase.js',
  'lib/solver-engine.js',
  'lib/solve-worker.js',
  'lib/solve-client.js',
  'lib/cube-pieces.js',
];
const absentSolver = SOLVER.filter((f) => !existsSync(join(dist, f)));
if (absentSolver.length) {
  throw new Error(
    `build: dist/ is missing vendored solver files:\n  ${absentSolver.join('\n  ')}\n` +
      '  Run `pnpm vendor:libs` first — without it the app loads but cannot solve.',
  );
}

// Same problem, the scanner's half. ort.mjs is reached by a COMPUTED url (`${wasmPaths}ort.mjs`),
// the .wasm by onnxruntime from its own import.meta.url, and the model by an attribute the panel
// reads — so none of them appears in index.html and the scan above is blind to all three. They are
// gitignored too, so a checkout that skips `pnpm copy-ort` builds a dist/ that looks complete and
// silently cannot scan.
//
// ort.mjs in particular must stay a SEPARATE file: onnxruntime spawns its inference worker from
// its own import.meta.url, so bundling it into the panel puts inference back on the main thread.
const SCANNER = ['vendor/ort.mjs', 'vendor/cube-yolo.onnx'];
// The wasm binaries need TWO checks, because either one alone is vacuous.
//
// onnxruntime picks its binary at runtime from inside its own worker, so which variant it wants is
// not knowable from here; naming one would risk asserting a file the app never loads. So: every
// file copy-ort placed in vendor/ must survive into dist/ — AND dist/ must hold at least one, or a
// checkout that never ran copy-ort passes trivially. The first check derives its expectation from
// vendor/, so on its own it cannot see a file that was never copied there in the first place.
const wasmInVendor = readdirSync(join(here, 'vendor'))
  .filter((f) => f.startsWith('ort-wasm-simd-threaded.') && f.endsWith('.wasm'))
  .map((f) => `vendor/${f}`);
const absentScanner = [...SCANNER, ...wasmInVendor].filter((f) => !existsSync(join(dist, f)));
const wasmInDist = existsSync(join(dist, 'vendor'))
  ? readdirSync(join(dist, 'vendor')).filter((f) => f.startsWith('ort-wasm-simd-threaded.') && f.endsWith('.wasm'))
  : [];
if (wasmInDist.length === 0) absentScanner.push('vendor/ort-wasm-simd-threaded*.wasm (none present)');
if (absentScanner.length) {
  throw new Error(
    `build: dist/ is missing vendored scanner files:\n  ${absentScanner.join('\n  ')}\n` +
      '  Run `pnpm --filter cubus-web copy-ort` first — without these the app loads but cannot scan.',
  );
}

// The esbuild bundle must be newer than its source, or beforeBuildCommand ran
// out of order and we would ship a stale renderer that still looks fine.
//
// Compare the SOURCE tree, never the copies in dist/: cpSync does not preserve
// timestamps, so a copied file always looks freshly modified and the comparison
// could never fail. That mistake made this check decorative until a negative
// test (touch the source, expect a throw) caught it returning success.
const built = statSync(join(here, 'vendor', 'cubus-cube.js')).mtimeMs;
const source = statSync(join(here, 'lib', 'cubus-cube.js')).mtimeMs;
if (built < source) {
  throw new Error(
    'build: vendor/cubus-cube.js is older than lib/cubus-cube.js — run build:cube first',
  );
}

console.log(`build: dist/ assembled — ${referenced.size} referenced assets verified present`);
