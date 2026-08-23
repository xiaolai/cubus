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
const src = join(here, '..', 'cube-scanner', 'node_modules', 'onnxruntime-web', 'dist');
const dest = join(here, 'vendor');

if (!existsSync(src)) {
  console.error(`onnxruntime-web not found at:\n  ${src}\nRun \`cd cube-scanner && npm install\` first.`);
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
console.log(`copied ${wanted.length} onnxruntime-web wasm asset(s) into web/vendor/`);
