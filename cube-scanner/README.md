# cube-scanner

A webcam scanner that reads a physical Rubik's Cube's 6 faces and outputs its
true Kociemba facelet string (`URFDLB`, 54 chars) plus a per-sticker confidence
signal — so the app can show/verify the real cube **without** solving it first.

Built like `gan-driver`: a pure, tested core with a thin browser shell.

## Layout

| Layer | Files | Notes |
|---|---|---|
| Pure core (Node-testable, no DOM) | `types`, `color`, `grid`, `classify`, `facelet-cube`, `assemble`, `scanner`, `calibrate` | Operates on a plain `Frame = { data; width; height }`, never DOM `ImageData`. |
| Browser shell | `camera` (getUserMedia), `live-scanner` (`CubeScanner`) | Only these touch the webcam. |
| View | `view/scanner-panel.ts` | Vanilla `<scanner-panel>` web component. |

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
