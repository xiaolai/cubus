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
| `npm run check` | Strict `tsc` + Biome + type-aware ESLint + vitest (the gate). |
| `npm run coverage` | Coverage over the pure core. |
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
| `scan-progress` | `{ phase, message, captured, live, device, confirm }` — `phase` is `starting`/`loading`/`scanning`/`confirm`/`checking`/`done`/`error`, `message` is a finished sentence, `captured` is `{ face, colors }[]` in URFDLB order, `live` is the 9 colour classes in view or `null`, `confirm` names the side being asked for | Every state change. The built-in status line and this event always agree — they go through one code path. |
| `scan-complete` | `ScanResult` | A validated, solvable six-face read. The element stops itself. |
| `scan-invalid` | `ScanResult` | The read did not validate. The element resets and keeps scanning; the reason arrives as the next `scan-progress`. |

Methods: `start()` (open the camera / retry after an error), `restart()` (drop the captured sides,
keep the camera), `stop()` (release the camera; also runs on disconnect), `cameras()` (the
selectable devices), `setSticker(face, index, colour)` (overrule one sticker and re-check — index
is into the capture *as shown*, the centre is refused, and a side with nothing read yet is started
from its centre colour and left open to a later camera read).

## App wiring (in `apps/web/index.html`)

The `<ai-scan-panel>` bundle (`apps/web/vendor/ai-scan-panel.js`), the model (`cube-yolo.onnx`),
and onnxruntime-web's `dist/*.wasm` are all served from `apps/web/vendor/`. The app mounts the
element **headless + autostart** on its Camera scan screen: the camera opens with the screen, the
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
