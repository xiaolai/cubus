// Bundle cubing.js into vendor/ so the app solves offline.
//
// This replaces two runtime CDN imports in app.js (cdn.cubing.net/v0/js/cubing/{search,puzzles}).
// Those meant a packaged desktop build could not solve a cube without a network, and failed
// silently, because app.js try/catches the import and simply loses the ability to solve.
//
// Why this is a script rather than one more line in package.json, like every other vendored
// library here: cubing/search runs min2phase in a Web Worker, and builds the worker URL relative
// to its own module. From cubing's worker-workarounds:
//
//   function searchWorkerURLNewURLImportMetaURL() {
//     return new URL("./search-worker-entry.js", import.meta.url);
//   }
//
// So a plain bundle inlines the importer but never emits the worker, and cubing loads fine,
// resolves fine, and then dies the first time you ask it to solve:
//
//   Error: Cannot find module '.../vendor/search-worker-entry.js'
//
// The fix is to bundle the worker as its own entry point, at exactly the sibling path that URL
// resolves to. Copying cubing's dist tree instead does not work either: it ships unbundled ESM
// that imports bare packages (random-uint-below, three, …), which no browser can resolve.
//
// Both outputs are large and reproducible from the pinned dependency, so vendor/cubing.js and
// vendor/search-worker-entry.js are gitignored — the rule the onnxruntime assets already follow.

import { build } from 'esbuild';
import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Resolve through an EXPORTED subpath: pnpm keeps the real files under .pnpm/ and symlinks them,
// so the layout is not ours to guess. It cannot be cubing/package.json — cubing's exports map does
// not expose it, and resolving it throws ERR_PACKAGE_PATH_NOT_EXPORTED.
const searchEntry = fileURLToPath(import.meta.resolve('cubing/search'));
const distRoot = dirname(dirname(searchEntry)); // <pkg>/dist/lib/cubing
const workerEntry = join(distRoot, 'chunks', 'search-worker-entry.js');

if (!existsSync(workerEntry)) {
  throw new Error(
    `vendor-cubing: cubing's worker entry is missing at ${workerEntry}.\n` +
      "  cubing/search builds its worker URL from this file's name; without it the solver\n" +
      '  throws MODULE_NOT_FOUND the first time it runs. Check whether the package layout changed.',
  );
}

const common = { bundle: true, format: 'esm', target: 'es2022', logLevel: 'warning' };

// The library itself. app.js imports search and puzzles, so both are re-exported from one bundle.
await build({
  ...common,
  stdin: {
    contents: [
      "export { experimentalSolve3x3x3IgnoringCenters } from 'cubing/search';",
      "export { cube3x3x3 } from 'cubing/puzzles';",
    ].join('\n'),
    resolveDir: here,
    sourcefile: 'cubing-entry.js',
  },
  outfile: join(here, 'vendor', 'cubing.js'),
});

// The worker, at the sibling filename `new URL("./search-worker-entry.js", import.meta.url)`
// resolves to from vendor/cubing.js. The name is load-bearing — do not rename it.
await build({ ...common, entryPoints: [workerEntry], outfile: join(here, 'vendor', 'search-worker-entry.js') });

for (const f of ['cubing.js', 'search-worker-entry.js']) {
  const p = join(here, 'vendor', f);
  if (!existsSync(p) || statSync(p).size === 0) {
    throw new Error(`vendor-cubing: ${f} was not produced`);
  }
}

const mb = (f) => (statSync(join(here, 'vendor', f)).size / 1e6).toFixed(1);
console.log(
  `vendor-cubing: wrote vendor/cubing.js (${mb('cubing.js')} MB) ` +
    `and vendor/search-worker-entry.js (${mb('search-worker-entry.js')} MB)`,
);
