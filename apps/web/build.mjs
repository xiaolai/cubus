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

import { readFileSync, rmSync, mkdirSync, cpSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');

// Whole directories, so a new import never silently misses the bundle. lib/ is
// source (app.js and cube-transport.js load as ES modules directly); vendor/ is
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

// The solver bundles are reached by dynamic import from app.js, so they appear nowhere in
// index.html and the scan above cannot see them. They are also gitignored and regenerated, so a
// fresh checkout that skips `pnpm vendor:libs` would produce a dist/ that looks complete and
// silently cannot solve a cube — app.js try/catches the import. Assert them explicitly.
//
// search-worker-entry.js is not imported by anything: cubing resolves it from import.meta.url at
// runtime, so nothing statically references it and only this check keeps it honest.
const SOLVER = ['vendor/cubejs.js', 'vendor/cubing.js', 'vendor/search-worker-entry.js'];
const absentSolver = SOLVER.filter((f) => !existsSync(join(dist, f)));
if (absentSolver.length) {
  throw new Error(
    `build: dist/ is missing vendored solver files:\n  ${absentSolver.join('\n  ')}\n` +
      '  Run `pnpm vendor:libs` first — without these the app loads but cannot solve.',
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
