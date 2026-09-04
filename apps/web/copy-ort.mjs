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

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', '..', 'packages', 'cube-scanner', 'node_modules', 'onnxruntime-web', 'dist');
const DEST = join(here, 'vendor');

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
// It was read as ONLY a benchmarking hazard, and that was the mistake. The software rasteriser a
// headless box has is the same one a USER gets whenever the real GPU is blocklisted, its driver is
// broken, or the app runs in a VM or over remote desktop — and `requestAdapter()` hands it out
// without being asked. Re-measured through the shipped code: 86 s to load the model and 6184 ms a
// frame, against 57 ms for the wasm path those machines had before this switch. So the provider is
// now VALIDATED and not merely chosen — `preferredProviders` refuses a software adapter, and
// `createModelRunner` times the one it kept and hands it back for wasm if it cannot earn its place
// (view/onnx-runtime.ts; gated by apps/web/test/scanner-gpu.test.mjs, which forces SwiftShader).
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
export const ORT_ESM = 'ort.webgpu.bundle.min.mjs';

// ONE grammar for what this script owns, used by discovery, by cleanup, and by nothing else.
//
// Written once as a source string because the two uses need different anchoring — a global scan of
// the loader's text, and an exact test of a filename — and writing the pattern out twice is how the
// previous version of this contract broke. Cleanup then said `ort-wasm-simd-threaded.` while
// discovery said any `ort-wasm*` the loader named, so a rename inside that family stranded the old
// multi-megabyte .wasm in vendor/, and vendor/ ships. The comment below already claimed "ONE
// predicate"; it was two spellings agreeing by hand, which is the same defect with a note on it.
const OWNED_ASSET = 'ort-wasm[a-z0-9.\\-]*\\.(?:wasm|mjs)';
/** Every asset the loader names, anywhere in its text. */
const ownedAssetsIn = (text) => [...new Set([...text.matchAll(new RegExp(OWNED_ASSET, 'g'))].map((m) => m[0]))];
/** Is this filename one of ours? Anchored, so it matches a whole name and not a substring. */
const isOwnedAsset = (f) => new RegExp(`^${OWNED_ASSET}$`).test(f);

/**
 * Publish the runtime from `src` into `dest`, and return the asset names published.
 *
 * A FUNCTION, and one that throws rather than calling `process.exit`, so the contract this script
 * exists to keep can be tested against temporary directories instead of only read. What was tested
 * before was the script's SOURCE TEXT — `indexOf('copyFileSync(...)') < indexOf('rmSync(')` — which
 * is green for any arrangement of those two strings, including a broken one, and goes red for a
 * correct rewrite that spells them differently. It did: this refactor turned that assertion red
 * while the behaviour it was guarding got strictly safer.
 */
export function publishRuntime({ src, dest, ortEsm = ORT_ESM } = { src: SRC, dest: DEST }) {
  if (!existsSync(src)) {
    throw new Error(`onnxruntime-web not found at:\n  ${src}\nRun \`pnpm install\` at the repo root first.`);
  }
  if (!existsSync(join(src, ortEsm))) {
    throw new Error(`onnxruntime-web is missing ${ortEsm} in:\n  ${src}`);
  }

  // The exact wasm assets this loader can request, read off its own text. A bundle cannot fetch a
  // filename it does not contain, so the referenced set is the complete set — nothing else is
  // reachable at runtime.
  const loaderText = readFileSync(join(src, ortEsm), 'utf8');
  const wanted = ownedAssetsIn(loaderText);
  if (wanted.length === 0) {
    throw new Error(
      `${ortEsm} references no ort-wasm-*.{wasm,mjs} assets by name.\n` +
        'onnxruntime-web may have changed how it names its runtime — copy-ort can no longer tell which\n' +
        'variant to ship, and copying nothing would fail at scan time. Inspect the loader and update this.',
    );
  }

  const missing = wanted.filter((f) => !existsSync(join(src, f)));
  if (missing.length > 0) {
    throw new Error(`${ortEsm} references assets that are not installed:\n  ${missing.join('\n  ')}`);
  }

  mkdirSync(dest, { recursive: true });

// COPY FIRST, THEN PRUNE. Deleting the live assets before writing their replacements left a window
// where `ort.mjs` referenced files that no longer existed — and if the copy then failed, or the run
// was interrupted, that window never closed and the scanner was broken until someone re-ran this.
//
// STAGE AND RENAME, because copying over them is NOT the "either the old bytes or the new ones"
// this comment used to promise. `copyFileSync` truncates the destination and then writes it, so a
// run interrupted at the wrong moment — Ctrl-C, a full disk, a killed CI step — leaves a truncated
// multi-megabyte .wasm that is neither. `rename` within the same directory is atomic on every
// filesystem this runs on, so each asset flips from old to new in one step, and a temp file left
// behind by a failed run is inert (nothing loads it, and `.tmp-` is not an owned asset name).
  // STAGE THE WHOLE SET, THEN COMMIT IT. Staging each file and renaming it immediately made each
  // FILE atomic and left the SET able to tear: the wasm renamed into place, the loader's copy then
  // failing, and vendor/ holding new wasm beside the old glue and the old loader — a pairing that
  // never shipped and cannot load. Copying is where failures actually happen (a bad source, a full
  // disk, an interrupted run); renaming a file that is already written, into the directory it is
  // already in, is the part that does not. So every copy happens first, and nothing in vendor/ is
  // touched until all of them have succeeded.
  const staged = [];
  try {
    for (const [from, to] of [...wanted.map((f) => [join(src, f), f]), [join(src, ortEsm), 'ort.mjs']]) {
      const at = join(dest, `.tmp-${process.pid}-${to}`);
      copyFileSync(from, at);
      staged.push([at, join(dest, to)]);
    }
    for (const [at, to] of staged) renameSync(at, to);
  } finally {
    // Whatever happened: no staging file survives. On success they have all been renamed away; on
    // failure they must not be left for a later run to publish by accident.
    for (const [at] of staged) rmSync(at, { force: true });
  }

  // Now that the wanted set is present, remove anything this script previously copied that the
  // current loader does not name — nothing reachable is deleted, because `wanted` is on disk above.
  for (const f of readdirSync(dest)) {
    if (isOwnedAsset(f) && !wanted.includes(f)) rmSync(join(dest, f));
  }
  return wanted;
}

// Run only when invoked as a script, so a test can import `publishRuntime` without publishing
// anything as a side effect of the import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const wanted = publishRuntime({ src: SRC, dest: DEST });
    console.log(
      `copied ${wanted.length} onnxruntime-web runtime asset(s) (${wanted.join(', ')}) + ort.mjs into web/vendor/`,
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
