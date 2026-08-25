// Copy onnxruntime-web's runtime wasm assets into ./vendor/ so the AI scanner can
// fetch them locally (offline, no CDN). These files are large and gitignored;
// regenerate with `npm run copy-ort`. Source of truth is cube-scanner's pinned
// onnxruntime-web install, so the served runtime and the bundled loader stay in lockstep.
//
// Fails loud: non-zero exit if the dependency is missing or nothing was copied — a
// silently empty vendor/ would make the scanner fail at runtime instead of at setup.

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'packages', 'cube-scanner', 'node_modules', 'onnxruntime-web', 'dist');
const dest = join(here, 'vendor');

if (!existsSync(src)) {
  console.error(`onnxruntime-web not found at:\n  ${src}\nRun \`pnpm install\` at the repo root first.`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

// The single-threaded wasm build the scanner uses (onnx-runtime.ts sets numThreads=1,
// wasm EP). The glob covers every ort-wasm-simd-threaded.* variant the runtime may fetch.
const wanted = readdirSync(src).filter((f) => f.startsWith('ort-wasm-simd-threaded.'));
if (wanted.length === 0) {
  console.error(`no ort-wasm-simd-threaded.* assets in:\n  ${src}\nIs onnxruntime-web installed correctly?`);
  process.exit(1);
}

for (const f of wanted) copyFileSync(join(src, f), join(dest, f));

// The ESM runtime itself, shipped as its OWN module rather than bundled into the scanner panel.
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
copyFileSync(join(src, ORT_ESM), join(dest, 'ort.mjs'));
console.log(`copied ${wanted.length} onnxruntime-web wasm asset(s) + ort.mjs into web/vendor/`);
