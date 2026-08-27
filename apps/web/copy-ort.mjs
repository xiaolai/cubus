// Copy onnxruntime-web's runtime into ./vendor/ so the AI scanner can fetch it locally (offline,
// no CDN). These files are large and gitignored; regenerate with `npm run copy-ort`. The source of
// truth is cube-scanner's pinned onnxruntime-web install, so the served runtime and the bundled
// loader stay in lockstep.
//
// Fails loud: non-zero exit if the dependency is missing or nothing was copied — a silently empty
// vendor/ would make the scanner fail at runtime instead of at setup.
//
// Only the ONE wasm variant the loader can actually request is copied. onnxruntime-web ships eight
// `ort-wasm-simd-threaded.*` files (plain / jsep / asyncify / jspi, each a .wasm + a .mjs), ~90 MB;
// a given ort entrypoint references exactly one pair by name and can fetch no other. We ship
// `ort.bundle.min.mjs`, which references only the `.jsep` pair, so copying all eight put ~50 MB of
// unreachable wasm in every dist/. The wanted set is DERIVED from the loader's own text rather than
// hardcoded, so an onnxruntime-web bump that switches variants is followed automatically; if the
// derivation ever finds nothing, that is a loud failure, not a silent empty copy.
// `apps/web/test/vendor-bundles.test.mjs` pins that the loader references exactly one variant and
// that this script copies exactly it.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'packages', 'cube-scanner', 'node_modules', 'onnxruntime-web', 'dist');
const dest = join(here, 'vendor');

if (!existsSync(src)) {
  console.error(`onnxruntime-web not found at:\n  ${src}\nRun \`pnpm install\` at the repo root first.`);
  process.exit(1);
}

// The ESM runtime the scanner loads, shipped as its OWN module rather than bundled into the panel.
//
// This is not a packaging preference, it is what makes off-main-thread inference possible.
// onnxruntime resolves both its .wasm and its proxy Worker from `import.meta.url`. Inlined into
// ai-scan-panel.js by esbuild, that URL becomes the PANEL — so `new Worker(import.meta.url)` boots
// a custom-element bundle inside a worker, which throws on `document`, and the run falls back to
// "no available backend found". Loaded as its own file, import.meta.url points at ort.mjs and the
// worker is the runtime, which is what it expects to be.
const ORT_ESM = 'ort.bundle.min.mjs';
if (!existsSync(join(src, ORT_ESM))) {
  console.error(`onnxruntime-web is missing ${ORT_ESM} in:\n  ${src}`);
  process.exit(1);
}

// The exact wasm assets this loader can request, read off its own text. A bundle cannot fetch a
// filename it does not contain, so the referenced set is the complete set — nothing else is
// reachable at runtime.
const loaderText = readFileSync(join(src, ORT_ESM), 'utf8');
const wanted = [...new Set([...loaderText.matchAll(/ort-wasm[a-z0-9.\-]*\.(?:wasm|mjs)/g)].map((m) => m[0]))];
if (wanted.length === 0) {
  console.error(
    `${ORT_ESM} references no ort-wasm-*.{wasm,mjs} assets by name.\n` +
      'onnxruntime-web may have changed how it names its runtime — copy-ort can no longer tell which\n' +
      'variant to ship, and copying nothing would fail at scan time. Inspect the loader and update this.',
  );
  process.exit(1);
}

const missing = wanted.filter((f) => !existsSync(join(src, f)));
if (missing.length > 0) {
  console.error(`${ORT_ESM} references assets that are not installed:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

// Remove any variant a previous run copied that the current loader does not want, so trimming does
// not leave megabytes of stale wasm behind in vendor/.
for (const f of readdirSync(dest)) {
  if (f.startsWith('ort-wasm-simd-threaded.') && !wanted.includes(f)) rmSync(join(dest, f));
}

for (const f of wanted) copyFileSync(join(src, f), join(dest, f));
copyFileSync(join(src, ORT_ESM), join(dest, 'ort.mjs'));
console.log(`copied ${wanted.length} onnxruntime-web runtime asset(s) (${wanted.join(', ')}) + ort.mjs into web/vendor/`);
