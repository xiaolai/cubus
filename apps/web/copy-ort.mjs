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
// a given ort entrypoint references exactly one pair by name and can fetch no other. Copying all
// eight put ~50 MB of unreachable wasm in every dist/. The wanted set is DERIVED from the loader's
// own text rather than hardcoded, so a switch of entrypoint or an onnxruntime-web bump that moves
// variants is followed automatically; if the derivation ever finds nothing, that is a loud failure,
// not a silent empty copy. That derivation is what made the WebGPU switch below a one-line change.
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
//
// WHICH ENTRYPOINT, and why it is the WebGPU one.
//
// `ort.bundle.min.mjs` — what we shipped until now — is the wasm-only build. It contains the
// strings "webgpu" and "webnn" because the EP-name registry is shared, which is exactly the sort of
// evidence that looks conclusive and is not: asking it for the `webgpu` EP does not fail, it sits
// in `InferenceSession.create` compiling nothing while the caller waits. In 1.27 WebGPU lives in
// its own entrypoint, backed by the ASYNCIFY wasm rather than the `.jsep` pair (jsep was the
// pre-1.20 mechanism, and its name on our wasm is the reason the old build looked WebGPU-capable).
//
// Measured on this model, 640x640, macOS, Chromium, one page, nothing else running:
//
//     wasm, 6 threads, proxy   198 ms   5.1 fps     <- what we shipped
//     webgpu, real GPU          15 ms    66 fps     <- this entrypoint, headed
//     webgpu, headless        7320 ms   0.1 fps     <- Chromium's software GPU, not a GPU
//
// The headless row is here as a warning, not a result: it is what a CI box measures, and taking it
// at face value says WebGPU is 37x SLOWER. Benchmark the GPU path on a real GPU or not at all.
//
// WINDOWS is confirmed to WORK and is NOT timed. On a Windows laptop running Edge/WebView2 152,
// the shipped path reaches a real hardware adapter (an Intel Xe2 iGPU, reported by name rather
// than inferred) and a compute shader returns the right answer. That says the provider is
// reachable on the runtime Windows users actually have; it says nothing about how fast it is
// there, and the 15 ms above is a macOS number. Two operating systems, one of them timed.
//
// It is also smaller — 23.1 MB against 25.6 for the wasm-only pair, and a 0.1 MB loader against
// 0.4 — so there is no size argument against it either. The same file still serves the wasm path
// wherever WebGPU is absent (measured 216 ms, within noise of the old build's 198), which is what
// makes ONE artifact enough for every target.
const ORT_ESM = 'ort.webgpu.bundle.min.mjs';
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

// ONE predicate for what this script owns, used by both discovery and cleanup.
//
// Cleanup used to hardcode `ort-wasm-simd-threaded.`, while discovery accepted any `ort-wasm*` the
// loader named. A rename inside that family — which is exactly what happens when onnxruntime
// changes SIMD or threading variants — therefore stranded the old multi-megabyte .wasm in vendor/,
// and vendor/ ships, so it reached dist/. Two spellings of "our asset" is how the pruning contract
// stopped holding without anything failing.
const isOwnedAsset = (f) => /^ort-wasm[a-z0-9.\-]*\.(?:wasm|mjs)$/.test(f);

// COPY FIRST, THEN PRUNE. Deleting the live assets before writing their replacements left a window
// where `ort.mjs` referenced files that no longer existed — and if the copy then failed, or the run
// was interrupted, that window never closed and the scanner was broken until someone re-ran this.
// Copying over them is atomic enough for the purpose: a file is either the old bytes or the new
// ones, and both are loadable.
for (const f of wanted) copyFileSync(join(src, f), join(dest, f));
copyFileSync(join(src, ORT_ESM), join(dest, 'ort.mjs'));

// Now that the wanted set is present, remove anything this script previously copied that the
// current loader does not name — nothing reachable is deleted, because `wanted` is on disk above.
for (const f of readdirSync(dest)) {
  if (isOwnedAsset(f) && !wanted.includes(f)) rmSync(join(dest, f));
}
console.log(`copied ${wanted.length} onnxruntime-web runtime asset(s) (${wanted.join(', ')}) + ort.mjs into web/vendor/`);
