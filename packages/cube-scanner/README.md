# cube-scanner

A webcam scanner that reads a physical Rubik's Cube's 6 faces and outputs its
true Kociemba facelet string (`URFDLB`, 54 chars) plus a per-sticker confidence
signal — so the app can show/verify the real cube **without** solving it first.

Built like `gan-driver`: a pure, tested core with a thin browser shell. The scanner is the
trained **YOLOv11** sticker detector; the classical OpenCV scanner and the live tracker were
removed (see git history if you need them).

## Layout

| Layer | Files | Notes |
|---|---|---|
| Pure core (Node-testable, no DOM) | `types`, `facelet-cube`, `onnx-postprocess`, `onnx-detect`, `ai-assemble` | Operates on a plain `Frame = { data; width; height }`, never DOM `ImageData`. The model run is *injected*, so the core imports no wasm runtime. |
| Browser shell | `camera` (getUserMedia), `view/onnx-runtime` (onnxruntime-web), `view/ai-scan-panel` (`<ai-scan-panel>`) | Only these touch the webcam / wasm. |

## How a scan works

1. **`preprocess`** (pure letterbox → 640×640 CHW float) → the panel's onnxruntime-web run
   (`view/onnx-runtime.ts` `createModelRunner`, **injected** so the core stays wasm-free).
2. **`decodeDetections` / `nms` / `fitFace`** pick the front 3×3 grid and **abstain**
   (`NO_FACE` / `PARTIAL_FACE` / `BAD_GEOMETRY`) on a frame that isn't a clean single face.
3. **`assembleColors`** maps the 6 faces' colour classes to a validated `ScanResult`, and
   **solves each face's rotation**: the camera can't know which way is up, so it searches all
   4⁶ per-face rotations and keeps the unique solvable one (guaranteed correct — the true combo
   is always in the solvable set). No solvable rotation ⇒ a colour misread (re-scan); more than
   one ⇒ rotationally ambiguous. **The user can show each side any way up.**

```ts
import { createModelRunner } from 'cube-scanner/view/onnx-runtime';
import { detectFace, assembleColors } from 'cube-scanner';
const run = await createModelRunner('./vendor/cube-yolo.onnx'); // once, reuse
const fit = await detectFace(frame, run);        // FitResult: ok → face.colors/confidence | abstain
// collect the 6 faces (URFDLB) of fit.face, then (per-face rotation is auto-solved):
const result = assembleColors(faces);            // { facelets, valid, confidence, reason?, ambiguous? }
```

- **Colour:** the detector classifies each sticker into the 6 colours (`ml/data.yaml`); robust
  where the classical HSV path failed (red↔orange under lighting). See `ml/MODEL_CARD.md`.
- **Validation:** own facelet-parity math (`facelet-cube`) **and** a cubejs round-trip (an
  independent oracle). cubejs `solve()` is deliberately not used as a validity gate — Kociemba
  solvers assume solvable input and can hang on the unsolvable scans we must reject.
- **Confidence:** the detector's per-sticker score; low-confidence stickers are surfaced for
  re-capture, never silently guessed.

## Scripts

| Command | Does |
|---|---|
| `npm run check` | Strict `tsc` + Biome + type-aware ESLint + vitest (the gate). |
| `npm run coverage` | Coverage over the pure core. |
| `npm run build:panel` | Bundle `view/ai-scan-panel.ts` (+ cubejs) into `../web/vendor/ai-scan-panel.js`, a self-contained ESM the bundler-less SPA loads. Re-run after editing the component. |

## App wiring (in `web/index.html`)

The `<ai-scan-panel>` bundle (`web/vendor/ai-scan-panel.js`), the model
(`cube-yolo.onnx`), and onnxruntime-web's `dist/*.wasm` are all served from `web/vendor/`;
the panel's `scan-complete` is applied to the 3D twin. Two notes:

- **Camera-first:** the panel opens the camera *before* loading the model, so a slow model load
  never blanks the preview.
- **wasm loading:** the SPA is served as static files over an http(s) origin (in dev via
  `cd web && npm run dev`, which also copies the wasm into `web/vendor/`), so the page can
  `fetch()` its own local wasm — the model loads **offline, no CDN**. (`createModelRunner`'s
  `opts.wasmPaths` defaults to `./`; on a plain `file://` page pass an https CDN instead, since
  `file://` can't fetch a local `.wasm`.)
