# cube-scanner

A webcam scanner that reads a physical Rubik's Cube's 6 faces and outputs its
true Kociemba facelet string (`URFDLB`, 54 chars) plus a per-sticker confidence
signal — so the app can show/verify the real cube **without** solving it first.

Built like `gan-driver`: a pure, tested core with a thin browser shell.

## Layout

| Layer | Files | Notes |
|---|---|---|
| Pure core (Node-testable, no DOM) | `types`, `color`, `grid`, `classify`, `facelet-cube`, `assemble`, `scanner`, `calibrate`, `homography`, `stability`, `auto-scanner` | Operates on a plain `Frame = { data; width; height }`, never DOM `ImageData`. |
| Browser shell | `camera` (getUserMedia), `live-scanner` (manual grid `CubeScanner`), `detect` (OpenCV.js face-finding) | Only these touch the webcam / OpenCV. |
| View | `view/scanner-panel.ts` | Vanilla `<scanner-panel>` web component (auto-capture + confirm per side). |

## Three capture modes

- **Auto-capture (default `<scanner-panel>`):** for each side, wait until the frame
  holds still (`stability`), locate the face with **OpenCV.js** (`detect`), warp-sample
  the 9 stickers from that quad (`homography.sampleQuad`), and show them for the user
  to accept or retake (`auto-scanner`). The face can be held roughly however — the
  perspective sampler handles offset/rotation/skew. OpenCV.js is **injected**, not
  bundled: the app loads it and sets `panel.cv = window.cv`; without it the panel
  falls back to sampling a centered square.
- **Manual grid (`live-scanner`, `createCubeScanner`):** the original guided 3×3-grid
  capture, kept as a dependency-free fallback.
- **AI scan (`onnx-detect` + `onnx-postprocess` + `ai-assemble`):** run the trained
  YOLOv11 sticker detector (`app/renderer/vendor/cube-yolo.onnx`, 3.0 MB int8) per face.
  `preprocess` (pure letterbox) → the panel's onnxruntime-web run (`view/onnx-runtime.ts`
  `createModelRunner`, **injected like OpenCV**) → `decodeDetections`/`nms`/`fitFace` picks
  the front 3×3 grid and **abstains** (`NO_FACE`/`PARTIAL_FACE`/`BAD_GEOMETRY`) on a frame
  that isn't a clean single face → `assembleColors` maps the 6 faces' colour classes to a
  validated `ScanResult` through the *same* dual verifier. It also **solves each face's rotation**
  — the camera can't know which way is up, so it searches all 4⁶ per-face rotations and keeps the
  unique solvable one; the user can show each side ANY way up. See `ml/MODEL_CARD.md`.

  ```ts
  import { createModelRunner } from 'cube-scanner/view/onnx-runtime';
  import { detectFace, assembleColors } from 'cube-scanner';
  const run = await createModelRunner('./vendor/cube-yolo.onnx'); // once, reuse
  const fit = await detectFace(frame, run);        // FitResult: ok → face.colors/confidence | abstain
  // collect the 6 faces (URFDLB) of fit.face, then (per-face rotation is auto-solved):
  const result = assembleColors(faces);            // { facelets, valid, confidence, reason?, ambiguous? }
  ```

- **Color:** `culori` (CIELAB + CIEDE2000) — never hand-rolled.
- **Classification:** nearest of the 6 live face-centers by CIEDE2000 — lighting-tolerant, calibration-free.
- **Validation:** own parity math **and** a cubejs round-trip (an independent
  oracle). cubejs `solve()` is deliberately not used as a validity gate — Kociemba
  solvers assume solvable input and can hang on the unsolvable scans we must reject.
- **Confidence:** `1 − nearest/secondNearest` per sticker; low-confidence stickers
  are surfaced for re-capture, never silently guessed.

## Scripts

| Command | Does |
|---|---|
| `npm run check` | Strict `tsc` + Biome + type-aware ESLint + vitest (the gate). |
| `npm run coverage` | Coverage over the pure core (85% gate). |
| `npm run build:panel` | Bundle `view/scanner-panel.ts` (+ culori + cubejs) into `../app/renderer/vendor/scanner-panel.js`, a self-contained ESM the bundler-less Electron renderer loads. Re-run after editing the component. |
| `npm run smoke:detect` | Load OpenCV.js (Node build) and run `detect.ts` against a synthetic square — verifies the OpenCV wiring (not real-world accuracy, which needs a real cube + on-device tuning). |

OpenCV.js itself is a ~13 MB WASM asset. In the app it is loaded from `app/renderer/vendor/opencv.js` (git-ignored; fetch with `cd app && npm run fetch:opencv`); the scanner degrades to a centered-square sample without it.

**AI-scan wiring (done — in `app/renderer/index.html`):** the `<ai-scan-panel>` bundle
(`app/renderer/vendor/ai-scan-panel.js`) and the model (`cube-yolo.onnx`) are loaded, and the
panel's `scan-complete` is applied to the twin exactly like the classical scanner. Two notes:
- **Camera-first:** the panel opens the camera *before* loading the model, so a slow or failed model
  load can never blank the preview.
- **wasm source:** `createModelRunner` loads onnxruntime-web's wasm from the version-matched
  jsDelivr CDN, because Electron's `file://` origin can't `fetch()` a local `.wasm` (same reason the
  app already imports its other libs over https). This needs internet. For a fully-offline build,
  serve the renderer over `http`/a custom protocol and pass `opts.wasmPaths='./'` with the
  onnxruntime-web `dist/*.wasm` vendored into `app/renderer/vendor/`.

## Usage

```ts
import { createCubeScanner } from 'cube-scanner';

const scanner = createCubeScanner();
await scanner.attach(videoEl);
// capture each face the UI asks for:
scanner.captureFace(scanner.next()!);
// once all 6 are in:
const result = scanner.result(); // { facelets, valid, confidence, lowConfidence }
```

The `<scanner-panel>` web component wraps this flow and emits `scan-complete`
(valid cube) or `scan-invalid` (prompt a retake) events.
