# cube-scanner

A webcam scanner that reads a physical Rubik's Cube's 6 faces and outputs its
true Kociemba facelet string (`URFDLB`, 54 chars) plus a per-sticker confidence
signal — so the app can show/verify the real cube **without** solving it first.

A pure, tested core with a thin browser shell. The scanner is the
trained **YOLOv11** sticker detector; the classical OpenCV scanner and the live tracker were
removed (see git history if you need them).

## Layout

| Layer | Files | Notes |
|---|---|---|
| Pure core (Node-testable, no DOM) | `types`, `facelet-cube`, `onnx-postprocess`, `onnx-detect`, `ai-assemble`, `misread-decode` | Operates on a plain `Frame = { data; width; height }`, never DOM `ImageData`. The model run is *injected*, so the core imports no wasm runtime. |
| The capture seam | `detector` (the interface), `view/web-detector`, `view/native-detector`, `view/pick-detector` | One question — "the model's output for a fresh frame" — behind which either the browser (getUserMedia + `preprocess` + onnxruntime-web) or the native `cube-vision` plugin answers. `pickDetector` also **parks one detector per page**, so a re-mounted panel reuses its InferenceSession instead of building another. |
| Browser shell | `camera` (getUserMedia), `view/onnx-runtime` (onnxruntime-web), `view/camera-session`, `view/stillness`, `view/ai-scan-panel` (`<ai-scan-panel>`) | Only `camera` and `onnx-runtime` touch the webcam / wasm. |

## How a scan works

1. **`preprocess`** (pure letterbox → 640×640 CHW float) → the panel's onnxruntime-web run
   (`view/onnx-runtime.ts` `createModelRunner`, **injected** so the core stays wasm-free).
2. **`decodeDetections` / `nms` / `fitFace`** pick the front 3×3 grid and **abstain**
   (`NO_FACE` / `PARTIAL_FACE` / `BAD_GEOMETRY`) on a frame that isn't a clean single face.
3. **`assembleColors`** maps the 6 faces' colour classes to a validated `ScanResult`, and
   **solves each face's rotation**: the camera can't know which way is up, so it searches all
   4⁶ per-face rotations and keeps the solvable ones. No solvable rotation ⇒ a colour misread
   (re-scan). **The user can show each side any way up.**

### More than one solvable rotation is normal, and is not a failure

Six face photographs with no known up-direction do not determine the cube. Turn the four side
faces of a once-turned cube upside down and *one U turn from solved* reads as *one D turn from
solved* — both legal, both solvable. Measured over random per-face rotations of states a known
distance from solved, the share of scans with a single reading:

| moves from solved | 0 | 1 | 2 | 3 | 4 | 5 | 10 | 20+ |
|---|---|---|---|---|---|---|---|---|
| one reading | 100% | **0%** | 10% | 34% | 50% | 70% | 96% | 100% |

That is the worst possible shape for a beginner's tutor — a nearly-solved cube is the one it
cannot read — and re-scanning cannot help, because the ambiguity belongs to the cube's state, not
to how the faces were held.

So `assembleColors` returns a **`confirm`** request instead of giving up: show one named side
again, held with a named side facing up. Feed that capture back through the `confirmed` argument.
With the confirmations answered, recovery is 196–200 out of 200 at every distance from solved,
needing on average 2 extra looks for a once-turned cube and none for a scrambled one.

**A confirmation is user input, so it can be a lie.** A look held a quarter-turn off eliminates
the true reading and leaves an equally legal impostor — measured, that returned a confidently
wrong cube in ~5% of ambiguous scans. So no reading is discarded on the strength of one look:
every discarded reading must be contradicted by **two** confirmations. An honest look can never
contradict the real cube, so a single mis-hold can no longer eliminate it — the worst it does is
leave the scan ambiguous. When no remaining side could tell two readings apart, `assembleColors`
says so and asks for a face to be turned, rather than guessing.

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
| `npm run check` | Strict `tsc` + Biome + type-aware ESLint + vitest **with coverage** (the gate). The 85% thresholds are part of the gate rather than a number a separate script would have to be remembered. |
| `npm run test` | The same suite without the coverage pass — the fast inner loop. |
| `npm run coverage` | Coverage over the pure core and the hardware-free half of `view/`. |
| `npm run build:panel` | Bundle `view/ai-scan-panel.ts` (+ cubejs) into `apps/web/vendor/ai-scan-panel.js`, a self-contained ESM the bundler-less SPA loads. The bundle is committed, so re-run **and commit it** after editing the component. |

## The `<ai-scan-panel>` element

The element owns the camera, the model and the capture state machine. Two attributes decide how
much UI it owns on top of that:

| Attribute | Effect |
|---|---|
| `autostart` | Opens the camera as soon as the element connects — no click. Deferred by one microtask, so a host that inserts the element and attaches its listeners in the same synchronous block still sees the first report. |
| `headless` | Draws nothing: no preview, no dots, no buttons. The host draws the scan from `scan-progress`. The `<video>` is still laid out (clipped to 1px) because a `display:none` video stops delivering frames in some browsers. |

| Event | Detail | When |
|---|---|---|
| `scan-progress` | `ScanProgress` — see below | Every state change. The built-in status line and this event always agree — they go through one code path. |
| `scan-complete` | `AiScanResult` | A validated, solvable six-face read. The element releases the camera and reports `complete: true`. |
| `scan-invalid` | `AiScanResult` | The read did not validate. **The captures are kept** — `restart()` is the only thing that wipes a scan — and the loop keeps running, so re-showing a side replaces its reading. The explanation arrives as the `notice` on the next `scan-progress`. |

`ScanProgress` carries `{ phase, message, captured, live, device, confirm, runtime, notice, suspects,
complete }`:

| Field | Meaning |
|---|---|
| `phase` | `starting` / `loading` / `scanning` / `painting` / `confirm` / `checking` / `done` / `error` |
| `message` | The transient per-tick line — a finished sentence, safe to show verbatim |
| `captured` | `{ face, colors }[]` in URFDLB order |
| `live` | The 9 colour classes in view right now, or `null` |
| `device` | The camera actually in use, or `null` — a host showing no preview needs it |
| `confirm` | The one side being asked for, and the way up to hold it, or `null` |
| `runtime` | `native` (the cube-vision plugin) or `web` (onnxruntime-web), or `null` before one is chosen |
| `notice` | The **pinned** explanation: `{ title, body, params?, tone }`, standing until the situation changes. Distinct from `message`, which the next tick overwrites — that is how a refused scan used to look like a crash. `body` may carry `%1..%9` placeholders that `params` fills, so a host translates the sentence *first* and substitutes after |
| `suspects` | Stickers a colour misread most plausibly landed on — tap targets. Populated **only** when exactly one sticker is wrong, because that is the only distance at which the repair is provably unique (`dev-docs/misread-decoding.md`) |
| `complete` | The scan has delivered a valid cube and stands finished — a state, not the `done` moment |

Methods: `start()` (open the camera / retry after an error), `restart()` (drop the captured sides,
keep the camera), `stop()` (release the camera; also runs on disconnect), `cameras()` (the
selectable devices), `setSticker(face, index, colour)` (overrule one sticker of a side already
READ and re-check — index is into the capture *as shown*; the centre is refused, and so is a side
with nothing read yet), `rescanFace(face)` (drop one side's reading and resume the loop so it is
read again — what a centre sticker does, since a centre cannot be recoloured), `setPainting(on)`
(hand-painting mode: releases the camera, lets `setSticker` author a side from nothing, and
validates through `assemblePainted` with no rotation search — the two are exclusive because one
authors the cube and the other reads it).

## App wiring (in `apps/web/index.html`)

The `<ai-scan-panel>` bundle (`apps/web/vendor/ai-scan-panel.js`), the model (`cube-yolo.onnx`),
and onnxruntime-web's `dist/*.wasm` are all served from `apps/web/vendor/`. The app mounts the
element **headless + autostart** on its Restore screen (named Camera scan in the design kit): the camera opens with the screen, the
screen draws the six-face flow itself from `scan-progress`, and the raw camera picture is
deliberately never shown — what a user needs to see is what the scanner *read*. `scan-complete` is
applied to the 3D twin. Two notes:

- **Camera-first:** the panel opens the camera *before* loading the model, so a slow model load
  never blanks the scan.
- **wasm loading:** the SPA is served as static files over an http(s) origin (in dev via
  `pnpm --filter cubus-web dev`, which also copies the wasm into `apps/web/vendor/`), so the page
  can `fetch()` its own local wasm — the model loads **offline, no CDN**. (`createModelRunner`'s
  `opts.wasmPaths` defaults to `./`; on a plain `file://` page pass an https CDN instead, since
  `file://` can't fetch a local `.wasm`.)
