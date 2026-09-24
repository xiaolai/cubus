// <ai-scan-panel> — the cube scanner: show the six sides in ANY order and each is captured
// automatically. Driven by the v3 sticker detector, robust where the old classical HSV path
// failed (red↔orange under lighting). It is the only scanner (the OpenCV path was removed).
//
// Capture and inference sit behind ONE seam, the `Detector`: the panel asks it for the model's
// output for a fresh frame and does not know or care whether a browser (getUserMedia + onnxruntime-
// web, off the main thread) or a native plugin produced it. `makeDetector()` is the single place
// that choice is made. Everything after `next()` — decode → NMS → fitFace → assembleColors — is
// this file's, shared by every runtime. Each face is read as 9 colour classes; the model ABSTAINS
// on a frame that isn't a clean single face. A face's CENTRE colour is its identity (centres never
// move), so a stable read is filed under the face it belongs to — no fixed order, no per-side
// confirm. After all six, `assembleColors` runs the dual verifier. Emits 'scan-complete' (valid
// cube) / 'scan-invalid' (the scan is refused but NOT thrown away — see below), and 'scan-capture'
// once per accepted capture (`ScanCapture`).
//
// A refusal keeps the captures. The six sides are the user's work, and every way out of a refusal
// needs them: tap a sticker to correct it (suspects mark where a misread most likely is), show a
// side again to replace its reading, or press restart — the ONLY thing that wipes a scan. The old
// behaviour reset everything and explained why in a message the next tick overwrote, which read as
// the app breaking; now the explanation is a `notice` that rides on every progress report and
// stays until the situation changes, while the transient per-tick hints stay in `message`.
//
// Attributes:
//   autostart — open the camera as soon as the element connects, with no click.
//   device-id — pin a specific camera (from `cameras()`); re-read on every start().
//   facing    — 'user' | 'environment'. UNSET by default, on purpose: see CameraOptions.
//   headless  — draw nothing at all: the host draws the scan from the 'scan-progress' events
//               this emits on every state change, and the element only owns the camera, the
//               model and the capture state machine. The <video> is still laid out (clipped to
//               1px), because a display:none video stops delivering frames in some browsers.
//
// Browser shell — verified by typecheck + esbuild bundle, exercised manually in the app.

import {
  type AiScanResult,
  assembleColors,
  assemblePainted,
  type ColorFace,
  type Confirmation,
  type ConfirmRequest,
  matchingRotations,
  rotateFace,
  SAME_SIDE_BY_CENTRE,
  type StickerSuspect,
  sameSide,
  withCentre,
} from '../src/ai-assemble.js';
import { type CameraDevice, facingOf } from '../src/camera.js';
import type { Detector, ModelOutput } from '../src/detector.js';
import { traceFrame } from '../src/fit-trace.js';
import type { MisreadDiagnosis } from '../src/misread-decode.js';
import { detectionsFromOutput, IMG_SIZE } from '../src/onnx-detect.js';
import {
  type Detection,
  type FaceFit,
  type FitResult,
  fitFace,
  MIN_STICKER_CONFIDENCE,
} from '../src/onnx-postprocess.js';
import {
  colourOf,
  colourOfSlot,
  isColour,
  positionOf,
  SCHEMES,
  type Scheme,
  slotOf,
} from '../src/scheme.js';
import { NEAR_FLOOR_RECORD } from '../src/session-record.js';
import { stickerLab, toFrameBox } from '../src/sticker-pixels.js';
import { FACES, type Face, type Frame } from '../src/types.js';
import { CameraSession } from './camera-session.js';
import { INFERENCE_WORKER_LOST } from './inference-client.js';
import { MisreadDecoder } from './misread-client.js';
import type { ScanRuntime } from './pick-detector.js';
import {
  frameNote,
  ScanTrace,
  type TickNote,
  type TraceEvent,
  traceEnabled,
} from './scan-trace.js';
import { recordEnabled, SessionRecorder } from './session-recorder.js';
import { Stillness } from './stillness.js';

// The scan pipeline's pure stages, re-exported so anything holding this bundle can run them.
// They are already compiled in — the panel itself calls all three — so this costs no bytes; it
// only makes them reachable. The reason they need to be: this bundle is the app's ONLY door into
// the scanner package, and `ml/golden_frames.py` pins onnx, onnx-int8, coreml, tflite and the
// native plugin but has no web leg, so nothing anywhere could check that the runtime Windows,
// Linux and Android actually run reads the fixtures the way the pinned one does.
export { preprocess } from '../src/onnx-detect.js';
export { decodeDetections, fitFace, nms } from '../src/onnx-postprocess.js';
// The runtime factory and the provider choice, for the same reason and one more. `apps/web/test/
// scanner-gpu.test.mjs` drives them in a real browser to prove the vendored runtime can reach a
// GPU and that both providers read a frame identically — and it has to reach them THROUGH this
// bundle, because the bundle is what ships. Importing the TypeScript source instead would test a
// file no build consumes, which is exactly how the wasm-only runtime came to look GPU-capable.
export { createModelRunner, defaultThreadCount, preferredProviders } from './onnx-runtime.js';

// Re-exported so the panel's public surface is unchanged; the type belongs with the choice.
export type { ScanRuntime } from './pick-detector.js';
// The page-level detector park, for the same reason as the three above: this bundle is the app's
// only door into the scanner package. `disposeParkedDetector` is how a host gives the model's
// memory back when it knows no scan is coming; `parkedDetector` is how anything can ASK what the
// page is keeping, which is what makes "two mounts, one InferenceSession" an assertion rather than
// a hope.
export { disposeParkedDetector, parkedDetector } from './pick-detector.js';

/**
 * The per-side re-read, as one sentence: the idle line once all six sides are in, and word for
 * word the last sentence of the notice that recommends starting over — so the host's duplicate
 * check draws it once, under the notice, rather than twice.
 */
const RE_READ_LINE = 'Show one side to the camera to re-read just that side.';

/** Small counts as words, for a sentence: "fits them four ways". Larger ones stay digits. */
const COUNT_WORDS = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];

/**
 * How the scanner names each SLOT — a colour, and the swatch that shows it.
 *
 * The positional labels ("Up", "Down", "Back") that used to sit here are gone with the last
 * sentence that used one (2026-09-07): a slot is a colour, and where that colour sits is the
 * scan's to decide, so calling the blue capture "Back" is right on most cubes and wrong on an
 * older one. Keeping the field would have left six labels in the vocabulary this file exists to
 * retire, ready for the next sentence to reach for.
 */
const GUIDE: Record<Face, { color: string; swatch: string }> = {
  U: { color: 'WHITE', swatch: '#f6f7f8' },
  R: { color: 'RED', swatch: '#d0202a' },
  F: { color: 'GREEN', swatch: '#049e4a' },
  D: { color: 'YELLOW', swatch: '#ffd400' },
  L: { color: 'ORANGE', swatch: '#ff6a00' },
  B: { color: 'BLUE', swatch: '#0057c8' },
};
/** Colour-class index → swatch, DERIVED from GUIDE so the face/colour map has one source
 *  (class i ↔ FACES[i], 0 white … 5 blue — matching ml/data.yaml). */
const CLASS_SWATCH = FACES.map((f) => GUIDE[f].swatch);
// The capture cadence, MEASURED rather than assumed per runtime.
//
// There were two constants, 200 ms for "web" and 60 ms for "native", and the 200 was justified by a
// ~400 ms wasm run that no longer exists: on this model six-thread wasm is ~59 ms and a real GPU
// ~15 ms, so a fixed 200 ms tick had become the bottleneck on the path it was chosen for
// — and it was chosen for a runtime label rather than for a speed, so a Windows machine with a GPU
// and a phone on the ANE were told apart by which class built them.
// The ladder itself is measured and dated in ONE place, `view/onnx-runtime.ts` above
// `softwareAdapter` — three copies of one measurement is three chances to go stale, and this file
// has already been the one carrying the stale copy.
//
// The rule instead is "as fast as the run actually comes back, and no faster than the floor". The
// floor is 60 ms (~16 fps), which is comfortably inside a camera's frame rate and leaves the ANE and
// the wasm worker idle time; above it, a slow machine paces itself, because asking again while the
// previous answer is still being computed only queues work the `busy` guard then drops.
const TICK_FLOOR_MS = 60;
const STABLE = 3; // identical reads in a row before we auto-capture a face
// A face must also have held still this long, measured from the FIRST read of the run. Counting
// reads alone made the stillness bar depend on the tick rate: 3 fast reads can span 180 ms — fast
// enough to capture a cube still being turned into position. Time is what stillness is, so require
// both, and with the tick now following the runtime it is the CLOCK that decides on every machine:
// at the 60 ms floor the real gate is 9 reads, at a 200 ms run it is 4. The count is only a floor
// against a runtime that answers implausibly fast.
const STABLE_MS = 500;
/**
 * How long a failing tick may stay silent before it becomes an error.
 *
 * `detector.next()` throws while the camera is still warming up — a 0x0 video element — and that
 * is genuinely transient, resolving within a tick or two. It also throws when the model failed to
 * load, when a native tensor comes back malformed, or when post-processing has a defect, and none
 * of those ever resolve. The old code could not tell them apart because it caught everything and
 * commented that it was the first kind, so a broken scanner looped forever showing "hold still"
 * and the project's fail-loud rule was quietly suspended for its most important surface.
 *
 * Wall clock rather than a tick count, because the tick follows whatever the runtime measures at —
 * a count would mean three seconds of patience on one machine and half a second on another.
 *
 * MONOTONIC, and read from `performance.now()`. `Date.now()` follows an NTP correction or a manual
 * clock change, so a step forward of a few seconds declares a healthy scanner dead, and a step
 * backwards makes a dead one immortal. `Stillness` already measures its own duration this way and
 * says why; this is the same claim about elapsed time.
 */
const TICK_FAIL_MS = 3000;
/**
 * How long one `detector.next()` may take before the tick stops waiting for it.
 *
 * The failure this exists for is an inference that never settles AT ALL — a native plugin call
 * lost on the bridge, a runtime worker that died mid-run. Nothing in the loop could see it: the
 * busy guard stayed set forever, so every later tick returned immediately, BOTH failure clocks
 * stopped advancing (they are only touched by a tick that gets somewhere), and even stop() then
 * start() could not recover, because the flag outlived the scan it belonged to. The panel sat on
 * its last message with a live lens — the shape of a hung app rather than of a slow one.
 *
 * It ABANDONS THE WAIT, not the inference, exactly as `loadModel` does for the model download: the
 * abandoned promise is dropped on arrival by the epoch check, and this rejection joins the same
 * failure clock as every other tick error, so a wedged runtime is reported through `tickFail`
 * rather than in silence.
 *
 * Generous against any real runtime, and deliberately not a budget for slowness — TICK_FLOOR_MS
 * already lets a slow machine pace itself. The ladder in `view/onnx-runtime.ts` measures 15 ms on
 * a GPU and 59 ms on six-thread wasm, and even a software rasteriser answers in ~6 s. This is a
 * limit on SILENCE.
 */
const INFERENCE_TIMEOUT_MS = 15_000;
/** The name on the error the deadline above rejects with — one of the two failures `tickFail`
 *  treats as a lost runtime rather than a broken frame (the other is `INFERENCE_WORKER_LOST`). */
const INFERENCE_TIMEOUT = 'InferenceTimeoutError';
// The beat between "captured/corrected" and the verdict. Assembly itself is ~5 ms; this exists so
// the capture that triggered the check — the sixth tile going green, a corrected sticker — paints
// before any refusal lands. Everything used to run in one task, so the browser painted once,
// after the wipe: the user showed a sixth side and watched the board go blank, unexplained.
const CHECK_BEAT_MS = 350;
/**
 * Every kept box of a frame, placed in the camera picture — or null when the frame's size is not
 * known. The boxes are in MODEL space (the letterboxed square); `toFrameBox` undoes the letterbox
 * with the same arithmetic that made it (`src/letterbox.ts`).
 */
/**
 * Which side a read CLAIMS to be: the slot its centre's colour names, or undefined when the centre is
 * not a colour at all.
 *
 * Its own function so the rule can be asked directly. Unreachable through the camera — `fitFace` keeps
 * colour classes only, so a fitted centre is always a colour — and kept because a read that names no
 * side must never be filed; the test for it used to reach past the class into a private method, which
 * is a test of the implementation rather than of the rule (audit, 2026-09-19).
 */
export function sideClaimed(colors: readonly number[]): Face | undefined {
  const centre = colors[4];
  return centre !== undefined && isColour(centre) ? slotOf(centre) : undefined;
}

export function seenIn(
  output: ModelOutput,
  dets: readonly Detection[],
  faceBoxes: readonly (readonly number[])[] | undefined,
): SeenFrame | null {
  // The browser runtime hands over the frame itself; a native one says only its size.
  const picture = output.frame ?? output.picture;
  if (!picture) return null;
  const stickers = dets.flatMap((d) => {
    const [x, y, w, h] = toFrameBox([d.cx, d.cy, d.w, d.h], picture, IMG_SIZE);
    // A box centred in the letterbox's padding is not in the picture, so it is not reported: every
    // centre here lies inside the picture (0–1), which is what `SeenSticker` promises. Its size may
    // still carry it past an edge — a sticker the camera caught half of is where it is.
    if (x < 0 || y < 0 || x > picture.width || y > picture.height) return [];
    return {
      x: x / picture.width,
      y: y / picture.height,
      w: w / picture.width,
      h: h / picture.height,
      colour: d.classId,
      confidence: d.confidence,
      // The face's boxes are in corner form (`FaceFit.boxes`), made from these very detections by
      // the same arithmetic, so equality is exact.
      inFace:
        faceBoxes?.some(
          (b) => b[0] === d.cx - d.w / 2 && b[1] === d.cy - d.h / 2 && b[2] === d.w && b[3] === d.h,
        ) ?? false,
    };
  });
  return { width: picture.width, height: picture.height, stickers };
}

/** Colour-class pairs, ascending, whose confusion is measured to follow the light: red/orange and
 *  orange/yellow (class i ↔ FACES[i]: 1 red, 3 yellow, 4 orange). See `flickerLine`. */
const LIGHT_CONFUSED: ReadonlySet<string> = new Set(['1,4', '3,4']);
const OPENING = 'Show any side of your cube to the camera.';
const PAINTING = 'Painting by hand — tap any sticker and pick its colour.';
// A permission prompt can sit unanswered for a long time, and a host that never answers one
// (a WKWebView with no camera entitlement, say) looks identical from here: getUserMedia simply
// never settles. After this long, stop showing 'Opening the camera…' as if it were progress.
const SLOW_OPEN_MS = 8000;
const SLOW_OPEN = 'The camera has not opened. Allow camera access for this app, then try again.';
const PINNED_GONE = 'The camera you chose is unavailable — using the default one.';
// The model is fetched once and is several megabytes, so a slow connection is a legitimate wait —
// and an indefinite one is not. `load()` had neither a notice nor a limit, so a fetch that stalled
// left "Camera ready — loading the model…" on screen for as long as the user was willing to look at
// it, with a live camera behind it and nothing to press. After SLOW_LOAD_MS say what is happening;
// after LOAD_TIMEOUT_MS stop waiting and offer the two things that actually help.
const SLOW_LOAD_MS = 8000;
const LOAD_TIMEOUT_MS = 60_000;
// How the scanner names each of the nine positions, for a hint that has to point at one of them.
// Reading order, matching the capture indices a host draws and a user taps.
const CELL_NAMES = [
  'top left',
  'top middle',
  'top right',
  'middle left',
  'centre',
  'middle right',
  'bottom left',
  'bottom middle',
  'bottom right',
];

/**
 * The four ways a camera refuses, as sentences a child can act on — or null for anything else.
 *
 * `getUserMedia` rejects with a DOMException whose NAME is the diagnosis and whose message is
 * whatever the engine felt like saying: "Permission denied", "The request is not allowed by the
 * user agent or the platform in the current context", "Could not start video source". The panel
 * used to show that text verbatim behind "Cannot start:", which tells a beginner nothing they can
 * do — and the four causes need four different actions, which is exactly what the raw string
 * conceals. The name is the part that is specified, so the name is what is mapped.
 *
 * Anything unrecognised falls through to the raw message on purpose: a wording nobody predicted
 * must reach a person intact rather than be flattened into a guess.
 */
function cameraRefusalWords(name: string | undefined): string | null {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'The camera is blocked for this app. Allow the camera in your browser or system settings, then press Start.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found. Plug one in or connect one, then press Start. You can also paint the cube by hand.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Another app is using the camera. Close it, then press Start.';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'That camera cannot be used for scanning. Press Start to try the default one instead.';
    default:
      return null;
  }
}

/** Where a scan is. Coarse on purpose: enough for a host to style around, no more. */
export type ScanPhase =
  | 'starting'
  | 'loading'
  | 'scanning'
  | 'painting'
  | 'confirm'
  | 'checking'
  | 'done'
  | 'error';

/**
 * One captured side: its SLOT — the colour's name, `FACES[colour]`, never its position (ADR 0001,
 * `scheme.ts`) — and the 9 colours read off it. Where the side sits on the cube is
 * `positionOf(colourOfSlot(face), scheme)` for the scheme in `ScanProgress.scheme`, or for
 * whatever a host assumes while that is null.
 */
export interface CapturedFace {
  face: Face;
  /** 9 colour-class indices in reading order; class i ↔ FACES[i]. */
  colors: number[];
}

/**
 * The pinned half of what the scanner has to say: what it needs from the user and why, standing
 * until the situation changes. Distinct from `message`, which is the transient per-tick line
 * ("hold still…", "show the whole face…") that used to overwrite refusal explanations within one
 * tick — 60 ms on the native path — which is exactly how a refused scan came to look like a crash.
 */
export interface ScanNotice {
  /** Short heading, e.g. "One more look". */
  title: string;
  /**
   * A finished sentence or two, safe to show verbatim. May carry %1..%9 placeholders, in which
   * case `params` fills them — a host translates the sentence FIRST and substitutes after, so a
   * count or a side name never bakes itself into the string and out of reach of a catalog.
   */
  body: string;
  /** Values for the body's %1..%9, in order. Absent when the sentence has no placeholders. */
  params?: (string | number)[];
  tone: 'info' | 'ok' | 'err';
  /**
   * The one action the notice recommends, for the host to draw as a button IN the card. Added
   * 2026-09-06 for the refusal that can name no sticker: its instruction is "start the scan
   * over", and an instruction whose button sits in a toolbar the sentence does not point at is
   * a sentence, not an instruction. `kind` is what the host calls; the label is what it says.
   */
  action?: { label: string; kind: 'restart' };
}

/**
 * `scan-capture` detail — ONE accepted capture, dispatched exactly once, at the moment a side is
 * filed: a new side (`side`, `face` null while its centre is shared with another side), a side
 * shown again over its old reading (`reread`), or the look a confirm asked for (`confirm`). Its own
 * event rather than something a host diffs out of `captured`, because a re-read does not change
 * the count and a moment that must be heard once cannot be reconstructed from states
 * (`dev-docs/scan-guidance-plan.md` 3.1). `sides` is how many sides are held after it.
 */
export interface ScanCapture {
  kind: 'side' | 'reread' | 'confirm';
  /**
   * The side this capture was filed under. NEVER null since 2026-09-23: a side is its centre, so a
   * capture the panel cannot name is refused rather than held, and every one of the three callers
   * passes a slot. It was nullable while a colliding centre could be held UNNAMED, and a host that
   * still branches on null is reading for a state the scan can no longer be in.
   */
  face: Face;
  sides: number;
}

/**
 * Where an accepted cube came from — `scan-complete`'s `origin` (2026-09-20).
 *
 * `'camera'` is six sides read by the camera and assembled; `'correction'` is the in-place re-check
 * after a sticker of an already-settled reading was corrected by hand; `'painted'` is a cube
 * authored in painting mode. A host with a smart cube connected needs the difference: a correction
 * RETRACTS the previous verdict rather than contradicting it, and a painting is not an observation
 * of the cube in the hand at all (`dev-docs/scanner-audit-2026-09-20.md` §1.3, §2.5).
 */
export type ScanOrigin = 'camera' | 'correction' | 'painted';

/** `scan-complete` detail: the accepted result, and where it came from. */
export type ScanCompleteDetail = AiScanResult & { origin: ScanOrigin };

/**
 * How far the current read has come towards capture: `run` identical reads of the `needed`, held
 * `heldMs` of the `neededMs`. A STATE, and a promise of nothing — a settled read can still be
 * refused ("already have that side", a twin) — which is why capture is a separate event.
 */
export interface ScanSettling {
  run: number;
  needed: number;
  heldMs: number;
  neededMs: number;
}

/**
 * One sticker box the detector reported on the latest frame, placed in the CAMERA PICTURE: its
 * centre as fractions of the picture's width and height (always within 0–1 — a box centred in the
 * letterbox's padding is not reported) and its size in the same units (a box may reach past an
 * edge), its colour class and
 * confidence, and whether it is one of the nine the face was fitted to. Every kept box, before any
 * fit — so a host can draw where the cube is and what is being read even while no side fits,
 * which is exactly when `live` is null (dev-docs/scan-guidance-plan.md 4.1).
 */
export interface SeenSticker {
  x: number;
  y: number;
  w: number;
  h: number;
  colour: number;
  confidence: number;
  inFace: boolean;
}

/** The latest frame's stickers, and the size of the picture they were placed in (its shape). */
export interface SeenFrame {
  width: number;
  height: number;
  stickers: SeenSticker[];
}

/**
 * `scan-progress` detail — everything a host needs to draw the scan itself. Emitted on every
 * state change, so a headless host is never left guessing what the scanner is doing.
 */
export interface ScanProgress {
  phase: ScanPhase;
  /** A finished sentence, safe to show verbatim. */
  message: string;
  /** Sides captured so far, in URFDLB order. */
  captured: CapturedFace[];
  /**
   * Sides in hand. The same sides `captured` lists — every capture is named, since a side is its
   * centre — counted without copying them, and kept as its own field because a host reads it on
   * every report. It only ever falls when sides are thrown away.
   */
  sides: number;
  /** The 9 colour classes in view right now, or null when no clean side is. */
  live: number[] | null;
  /** The read under way, or null when there is none — every failed fit and every capture resets it. */
  settling: ScanSettling | null;
  /**
   * The latest frame's sticker boxes in the camera picture's own coordinates, or null when there is
   * no frame or its size is unknown. Empty is an observation: a frame in which nothing was found.
   */
  seen: SeenFrame | null;
  /**
   * The side in view is one already captured, so this settled read was refused as a repeat. A
   * STATE of the report, structured so a host that speaks it never has to read the sentence
   * (dev-docs/scan-guidance-plan.md 6); true on every report of that refusal and on no other.
   */
  shownAgain: boolean;
  /** The camera actually in use, or null before one opens. A host showing no preview needs it. */
  device: CameraDevice | null;
  /**
   * Set while the scan is waiting for one specific side, held a specific way up, to settle a
   * reading it cannot settle alone. Null at every other moment.
   */
  confirm: ConfirmRequest | null;
  /**
   * Which runtime is doing inference — 'native' (the cube-vision plugin: CoreML on Apple, LiteRT
   * on Android) or 'web' (onnxruntime-web, on a GPU where there is one and wasm otherwise), or
   * null before one is chosen. A host can show it so the fast path is visible rather than guessed
   * at. Deliberately no per-frame timing: that is a property of the machine, and the numbers that
   * used to be written here outlived the runtimes they were measured on by three regimes.
   */
  runtime: ScanRuntime | null;
  /** The pinned explanation/instruction, or null when nothing needs saying beyond `message`. */
  notice: ScanNotice | null;
  /** Stickers a colour misread most plausibly landed on — tap targets; empty otherwise. */
  suspects: StickerSuspect[];
  /**
   * The scan has delivered a valid cube and stands finished — a state, not the 'done' moment: it
   * stays true while the user looks the result over, even if the camera is reopened. The host
   * owns what to say over it ("press Solve this cube" names the HOST's button), which is why this
   * is a flag rather than panel copy.
   */
  complete: boolean;
  /**
   * Which colour arrangement the cube has, as far as the scan has ESTABLISHED it (ADR 0001):
   * a scheme when a verdict decided one, `'undetermined'` when a verdict found the same state
   * under both, null while no verdict has spoken this scan. A host places each captured slot on
   * its tile through `positionOf`, using this or — while null — its own assumption; it never
   * learns the scheme from a refusal, because a refused reading says nothing about it.
   */
  scheme: Scheme | 'undetermined' | null;
}

const TEMPLATE = `
<style>
  :host { display: block; font: 14px/1.5 -apple-system, system-ui, sans-serif; color: #e6edf3; }
  .stage { position: relative; aspect-ratio: 1; background: #000; border-radius: 12px; overflow: hidden; }
  .stage.flash { animation: cap .5s ease; }
  @keyframes cap {
    0% { box-shadow: inset 0 0 0 0 rgba(63,185,80,0); }
    30% { box-shadow: inset 0 0 0 6px #3fb950; }
    100% { box-shadow: inset 0 0 0 0 rgba(63,185,80,0); }
  }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .status { margin: 12px 0 4px; min-height: 22px; } .status b { color: #fff; }
  .dots { display: flex; gap: 6px; margin: 8px 0; }
  .dots span { width: 26px; height: 14px; border-radius: 3px; border: 1px solid rgba(0,0,0,.4); opacity: .28; }
  .dots span.done { opacity: 1; box-shadow: 0 0 0 2px rgba(63,185,80,.45); }
  .preview { display: none; grid-template-columns: repeat(3, 36px); gap: 4px; margin: 10px 0; }
  .preview[data-show='1'] { display: grid; }
  .preview i { width: 36px; height: 36px; border-radius: 6px; border: 1px solid rgba(0,0,0,.4); }
  .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
  button { font: inherit; border: 0; border-radius: 7px; padding: 8px 16px; font-weight: 600; cursor: pointer; }
  button.primary { background: #58a6ff; color: #06122b; }
  button.ghost { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }
  button[hidden] { display: none; }
  .err { color: #f85149; } .ok { color: #3fb950; } .muted { color: #8b949e; }
</style>
<div class="stage"><video id="video" playsinline muted></video></div>
<div class="dots" id="dots"></div>
<div class="status" id="status">Click <b>Start camera</b>, then show each side to the camera.</div>
<div class="preview" id="preview"></div>
<div class="row">
  <button class="primary" id="start">Start camera</button>
  <button class="ghost" id="restart" hidden>Start over</button>
</div>
`;

// Headless: the host draws the scan from 'scan-progress'; this element only owns the camera.
// The <video> stays laid out — a display:none video stops delivering frames in some browsers —
// so it is clipped to a 1px box instead of hidden.
const HEADLESS_TEMPLATE = `
<style>
  :host {
    position: fixed; left: 0; top: 0; width: 1px; height: 1px;
    overflow: hidden; clip-path: inset(50%); pointer-events: none;
  }
</style>
<video id="video" playsinline muted></video>
`;

/** Detectors whose runtime has already been announced — see `announceRuntime`. */
const announced = new WeakSet<Detector>();

export class AiScanPanel extends HTMLElement {
  private readonly root: ShadowRoot;
  /** Model URL; the app can override before the element renders. */
  modelUrl = './vendor/cubedet.onnx';

  /**
   * The frame EPOCH of the tick that is mid-inference, or null when none is.
   *
   * A number rather than a flag, because the flag outlived the thing it was guarding. An inference
   * that never settles left it set for the life of the page: `stop()` and `start()` bump the epoch
   * and rebuild the loop, but the flag survived both, so every tick of the new scan returned at the
   * first line and the scanner could not be recovered by anything short of a reload. Scoped to the
   * epoch, a stale inference blocks only the scan it belongs to — and the `finally` below clears
   * the guard only when it is still the one it set, so an abandoned tick landing late cannot let a
   * second inference into the current epoch.
   */
  private busy: number | null = null;
  /** `headless`: draw nothing, and let the host draw from 'scan-progress'. */
  private headless = false;

  private readonly faces = {} as Record<Face, ColorFace>;
  /** The 9 colour classes in view right now, or null when no clean side is; rides on every report. */
  private live: number[] | null = null;
  /** The latest frame's boxes in picture coordinates, for `ScanProgress.seen`. */
  private seen: SeenFrame | null = null;
  /** Set just before the report that refuses a side already held, and taken by that report. */
  private shownAgain = false;
  /**
   * Moved by everything that changes what a queued capture announcement would be about — `reset()`
   * (the scan thrown away), `stop()` (the camera released: painting, a finished scan, the element
   * leaving the page) and `rescanFace()` (a side taken back) — so an announcement queued before one
   * of them can tell it is stale (see `captured`).
   */
  private captureEpoch = 0;
  /**
   * The count-and-duration gate that decides a read is worth capturing.
   *
   * It replaces three fields that FOUR different sites reset by hand, three of them clearing only
   * two of the three. That was harmless — clearing the key forces the "new run" branch, which
   * reassigns the timestamp — but harmless by a coincidence of control flow two branches away is
   * not the same as correct, and it is what makes the next edit to that branch dangerous. One
   * object with one reset needs no coincidence, and the timing rule becomes testable without a
   * camera, a detector, a timer and a DOM element.
   */
  private readonly still = new Stillness(STABLE, STABLE_MS);
  /**
   * The scan trace (see scan-trace.ts): off unless `localStorage.cubusScanTrace` is '1', decided
   * once per loop. `tickNote` collects what one tick learned — `readFrame` knows the outcome,
   * `onTick` knows the timing — and is committed once per tick, so a record is never half a tick.
   */
  private readonly trace = new ScanTrace();
  /**
   * The centre resolution's thread (D3, `dev-docs/scan-pipeline-audit-2026-09-23.md` §3).
   *
   * One per panel, like the misread decoder and for the same reason: it is a module that parses in
   * about a millisecond and is spawned only by a centre collision, which most scans never reach.
   */
  /**
   * The session recorder (D9/P2, `dev-docs/scan-pipeline-audit-2026-09-23.md` §3 and §4 Stage 0.1).
   *
   * OFF unless `localStorage.cubusScanRecord` is '1', read once per loop exactly as the trace's
   * switch is. The trace could never become a fixture — rounded boxes, capped at sixteen, scores
   * only for the centre probe — so a bug report could not be turned into a replayable case. This
   * keeps what a replay needs, and `__cubusScanRecord.finish({cube, conditions, truth})` hands back
   * a session `parseSession` accepts.
   */
  private readonly recorder = new SessionRecorder();
  private recording = false;
  private tracing = false;
  private tickNote: Partial<TickNote> = {};
  /** The words last put on screen, which the trace records as what the person scanning saw. */
  private lastLine = '';
  /**
   * The camera, its detector, its loop, and the two counters that keep a stale attempt or a
   * stale frame from speaking. It never speaks itself — see CameraSession.
   */
  private readonly cam = new CameraSession();
  /** When the current run of failing ticks began, or null when the last tick completed. */
  private tickFailingSince: number | null = null;
  /**
   * When the current run of frameless ticks began, or null when a frame last arrived.
   *
   * A SECOND clock, because "the tick threw" and "the tick answered, with no frame" are different
   * facts and only one of them was watched. A camera that opens and never delivers answers every
   * tick with `null` — which cleared the failure clock above, on the reasoning that a tick which
   * got an answer at all is a working scanner. It is not: the panel idled on "Show any side" for
   * as long as the screen was open, with a live lens and nothing to say. Both clocks route to the
   * same `tickFail`, whose wording ("the camera opened but no frame could be read") was already
   * describing this case while being unreachable from it.
   */
  private noFrameSince: number | null = null;
  /** How long the last inference took, so the tick can follow the runtime — see TICK_FLOOR_MS. */
  private lastInferenceMs = 0;
  /**
   * Faces whose rotation is KNOWN to be the canonical one — painted in place, or settled by an
   * accepted scan (`finishAccepted` rotates the captures and then says so here).
   *
   * A camera capture is at whatever rotation the user held the side, and nothing about the capture
   * itself says which. Two places need that distinction and both were getting it wrong:
   * hand-painting, which edits stickers by index and therefore cannot edit a face whose index
   * mapping is unknown; and a re-check after a settle, which was searching 4^6 rotations it had
   * already solved and asking for confirmations all over again.
   */
  private readonly settled = new Set<Face>();
  /**
   * What `loop()` was about to say when it found the camera dark, so `start()` can say it once the
   * lens answers. Without this the instruction was simply lost: `rescanFace` says "Show the ORANGE
   * side again", a finished scan has released the camera, and the reopen replaced that sentence
   * with "Opening the camera…" and then the generic idle line — so the one side the scanner was
   * waiting for was never named.
   */
  private pendingOpening: { phase: ScanPhase; words: (string | Node)[] } | null = null;
  /** Sides handed back by `rescanFace` since the loop last spoke — named together when it does. */
  private rescanQueue: Face[] = [];
  /** Captures known to be in canonical rotation, from answering a `confirm` request. */
  /** Each confirmation with the hold it answered: the assembler projects it into every scheme's
   *  frame from `up`, so a capture without its hold is not a confirmation (ADR 0001). */
  private confirmed: Partial<Record<Face, Confirmation[]>> = {};
  /**
   * How long the scan may look at a cube and capture NOTHING before it says so and offers the way
   * out (`dev-docs/scan-recording-session-2026-09-23.md`).
   *
   * MEASURED, on a recording of the cube this exists for. Over 108 seconds and 1,552 frames the scan
   * made ZERO captures and said "hold still" throughout: the detector found two or three of that
   * face's nine stickers and scattered the rest below the confidence floor, so there was never a
   * face to read. Lowering the floor to 0.05 recovers nothing — the most boxes surviving isolation
   * in the whole stretch is eight, median five.
   *
   * So the honest thing is not another way to arbitrate readings that do not exist; it is to stop
   * spending a person's time. Twelve seconds is several times the 2–4 seconds a side takes when the
   * detector can see it at all, so a slow-but-working scan is never interrupted, and it is far short
   * of the 108 seconds this cube cost.
   *
   * THE BOUND IS ABOUT PROGRESS, NOT ABOUT TIME. It runs from the last capture, so a scan that is
   * getting somewhere — five sides in, one to go — never trips it.
   */
  private static readonly STUCK_AFTER_MS = 12_000;

  /**
   * How recently the detector must have seen SOMETHING for a stall to be claimed.
   *
   * A second and a half — several ticks on either runtime, so a frame or two with nothing on it
   * does not retract the claim mid-sentence, and a cube actually put down stops it quickly.
   */
  private static readonly SIGHTING_FRESH_MS = 1_500;
  /**
   * How long "Reading a side — hold still…" survives a frame the fit refused.
   *
   * MEASURED, 2026-09-24. The screen's sentence was changing every 124 ms at the median, and 81% of
   * the sentences it showed lasted under half a second — unreadable by anyone. The cause was not the
   * words but the RATE: a fit that succeeds and fails on alternate frames made "Reading a side" and
   * "Show any side to the camera." alternate at the tick rate, and those two were 77 of the 134
   * sentences shown across three sessions. They are one situation to the person holding the cube.
   *
   * So a fit is remembered for a moment rather than asked of this frame alone. It is the same idiom
   * `SIGHTING_FRESH_MS` already uses for "an empty frame is not a stall", and it states something
   * true: a side IS being read, across a run the gate itself measures over several frames. Half a
   * second is comfortably longer than the dropouts (one or two frames, 60–130 ms) and far shorter
   * than the time it takes to turn a cube, so putting the cube down still falls back at once.
   *
   * IT CONTINUES A READING CAPTION AND NEVER REVIVES ONE, which is the whole of why it is safe.
   * Unconditionally, it painted "Reading a side" back over whatever the card had just been given —
   * a side filed, the ask for one more look, a finished scan — because those are all followed by a
   * frame that fits nothing while the cube is still in view. Requiring the caption to ALREADY be
   * the reading line makes it hysteresis on one state rather than an override of every other, and
   * it needs no exception for the no-frame path: a withdrawal writes the idle line first, so there
   * is nothing left for the grace to continue.
   */
  private static readonly READING_GRACE_MS = 500;
  /** The caption the grace continues. One literal, so the test and the two sites cannot drift. */
  private static readonly READING_LINE = 'Reading a side — hold still…';
  /** When a frame last fitted a face — what `READING_GRACE_MS` is measured from. */
  private lastFitAt = 0;

  /**
   * When this scan last CAPTURED something, on the monotonic clock — or when the loop began.
   *
   * `performance.now()`, like every other duration here: `Date.now()` follows an NTP correction, and
   * a clock step of twelve seconds would announce a stall that never happened.
   */
  private lastProgressAt = 0;

  /**
   * When the detector last produced ANY candidate, on the monotonic clock.
   *
   * The stall claim is "something is in front of the camera and it is not being read". Without this
   * the same sentence fires at an empty room: a person who puts the cube down for twelve seconds
   * would be told their cube cannot be read, which is false and is exactly the kind of unmeasured
   * claim `scan-sentences.test.mjs` exists to refuse.
   */
  private lastSightingAt = 0;

  private awaiting: ConfirmRequest | null = null;
  /**
   * The cube's colour scheme as the LAST VERDICT established it — `ScanProgress.scheme`. Null
   * until a verdict speaks; set by an accepted scan and by an accepted painting (whose authored
   * centres ARE its scheme); cleared by `reset()`, because the next cube is a different cube. A
   * refusal never sets it. Corrections keep it: a tap re-decides a sticker, not the cube.
   */
  private scheme: Scheme | 'undetermined' | null = null;
  /** Hand-painting mode: the camera is off and every non-centre sticker is settable. */
  private painting = false;
  /** Contradictory confirmations this scan; past one, the notice starts offering restart too. */
  private mismatches = 0;
  /**
   * The scan reached a valid cube and delivered it. A finished scan is a state, not a moment:
   * the camera can be reopened over it (picking a camera from the host's menu does exactly that),
   * and without this flag the loop would hungrily nag "show a side" over a complete cube — and a
   * side idly held in view would REPLACE part of an accepted scan. While finished, ticks guide
   * instead of capture; any re-check (a correction, a rescan, a restart) clears it.
   */
  private finished = false;
  /** The pinned explanation riding on every report; null when nothing needs saying. */
  private notice: ScanNotice | null = null;
  /**
   * The notice a CAMERA OR STARTUP FAILURE pinned, so a start that works can take exactly it down.
   *
   * A notice stands until the situation changes, and a working scanner IS the situation changing —
   * but nothing cleared these three ("The camera did not open", "The model did not load", "The
   * scanner stopped"), so a user who pressed Start again and got a live camera and a running scan
   * kept reading that the scanner had stopped. The transient status line said one thing and the
   * pinned sentence the opposite, which is the state this field exists to make impossible.
   *
   * Held BY IDENTITY rather than as a flag: the clear only fires if the notice on screen is still
   * the very object the failure pinned, so a refusal, a confirm request, or any other guidance
   * raised in between is left exactly where it is. Capture guidance is not a camera fault and must
   * survive a restart.
   */
  private cameraFault: ScanNotice | null = null;
  /** Where a colour misread most plausibly is; rides on every report so a host can mark them. */
  private suspects: StickerSuspect[] = [];
  /** The pending deferred assembly (see CHECK_BEAT_MS); epoch-guarded and cleared on stop(). */
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  /** The misread decode, off this thread where the page has one to spare. */
  private misread = new MisreadDecoder();
  /**
   * Serial number of the READING a diagnosis is about.
   *
   * Bumped by everything that re-decides the verdict — a capture, a correction, a paint stroke, a
   * mode change, a restart — so an answer that arrives seconds later can be recognised as being
   * about a cube that is no longer on screen. Not the camera's `frameEpoch`: that moves when the
   * camera does, and a tap on a sticker changes the reading without touching the camera at all.
   */
  private diagnosisEpoch = 0;
  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.headless = this.hasAttribute('headless');
    this.root.innerHTML = this.headless ? HEADLESS_TEMPLATE : TEMPLATE;
    if (!this.headless) {
      this.buildDots();
      this.buildPreview();
      this.maybe<HTMLButtonElement>('start')?.addEventListener('click', () => void this.start());
      this.maybe<HTMLButtonElement>('restart')?.addEventListener('click', () => this.restart());
    }
    // Deferred by a microtask on purpose: a host that inserts this element and attaches its
    // 'scan-progress' listener in the same synchronous block would otherwise miss the very
    // first report, because connectedCallback runs during the insertion.
    if (this.hasAttribute('autostart')) queueMicrotask(() => void this.start());
  }

  disconnectedCallback(): void {
    this.stop();
    // PARK the detector rather than dropping it on the floor. Every visit to the scan screen
    // rebuilds this element, and a dropped detector takes its InferenceSession with it — nothing
    // else holds a reference, so nothing can ever release it, and the page accumulated one live
    // wasm heap or GPU device per visit plus a 1–5 s model load. `park()` releases the camera and
    // keeps the model, which is the whole distinction stop() and dispose() exist to draw; see
    // `pickDetector` for the page-wide slot and why exactly one is kept.
    this.cam.park();
    // The decoder worker is NOT parked, for the reason the detector is: a model load is seconds
    // and megabytes, a worker spawn is a module parse, and only a refusal ever creates one.
    this.dropDiagnosis();
    this.misread.dispose();
    // Same reasoning for the centre resolver (D3): a worker spawn is a module parse, and only a
    // centre collision ever creates one. Given back with the decoder so a disconnected panel leaves
    // no thread behind it.
  }

  /**
   * Everything decided about the current reading is stale from here on.
   *
   * A diagnosis in flight is about the six faces AS THEY WERE when it was posted, and the decode
   * that produces it can take seconds; bumping the epoch is what stops that answer landing on top
   * of a cube the user has since corrected, re-shown or thrown away. Called from every site that
   * clears `suspects` — those are exactly the moments the verdict is re-opened.
   */
  private dropDiagnosis(): void {
    this.diagnosisEpoch++;
  }

  /**
   * The reading has changed: everything decided ABOUT it is void.
   *
   * One operation, because it always was one and was written out three times — `rescanFace`,
   * `setSticker` and `reset` each carried the same seven lines, and the panel's state is coupled
   * enough that a caller which remembers six of them leaves a real defect: a confirmation that
   * answers a question about a reading that no longer exists, a suspect list pointing at stickers
   * that have moved, a `finished` that keeps the Solve button lit over a cube the panel is about
   * to refuse. Every one of those has been a bug here.
   *
   * What is NOT here is deliberate: the captures themselves, the rotations, and the dots. Which
   * sides survive an invalidation is exactly what distinguishes its three callers — a rescan drops
   * one face, a reset drops all six, a correction drops none — so folding that in would make this
   * a switch on its caller rather than an operation.
   */
  private invalidateReading(): void {
    this.confirmed = {};
    this.awaiting = null;
    this.mismatches = 0;
    this.finished = false;
    this.notice = null;
    this.suspects = [];
    this.dropDiagnosis();
  }

  /**
   * Why the camera must not open right now — one answer, consulted by every entry point.
   *
   * This replaces three half-guards that each protected one caller and left the others. `start()`
   * had a generation counter, which defends against a LATER start superseding an in-flight one and
   * cannot see that the element has been removed: it takes a fresh generation, so the
   * `queueMicrotask(() => start())` queued by connectedCallback still opened the camera on an
   * element that disconnectedCallback had already stopped. And nothing at all stopped `start()`
   * while painting, though setPainting's own comment calls the modes "exclusive by nature" — so
   * the Start button that `stop()` helpfully re-revealed would open a camera whose captures
   * overwrite the stickers the user had just painted.
   *
   * Both are the same absence: the two facts that gate the camera were never asked in one place.
   */
  private cameraRefusal(): 'detached' | 'painting' | null {
    if (!this.isConnected) return 'detached';
    if (this.painting) return 'painting';
    return null;
  }

  /** Release the camera + stop the loop. Safe repeatedly and before first render. The detector
   *  itself is kept, so the loaded model survives a stop()/start() (only the camera is released). */
  stop(): void {
    this.captureEpoch += 1;
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
    // close(), not releaseCamera(): stopping must ALSO supersede an attempt still opening and any
    // inference in flight. Migrating this to the session dropped those two bumps, and the
    // superseded-start test — written half an hour earlier precisely to protect this refactor —
    // caught it: a stop() during an open left the late attempt free to install its camera, so the
    // stream stayed live with nothing showing it.
    this.cam.close();
    // The preview is the LAST camera frame. Leaving it set means a report published after stop()
    // carries a `live` face that no camera is producing — setPainting(true) calls stop() and then
    // reports immediately, so painting began by claiming a live lens it had just released.
    this.forgetObservation();
    const start = this.maybe<HTMLButtonElement>('start');
    if (start) {
      start.disabled = false;
      // Not while painting: start() refuses then, and a button that does nothing when pressed is
      // worse than an absent one. stop() used to reveal it unconditionally, which is how painting
      // came to offer the one control that could destroy the work.
      start.hidden = this.painting;
    }
    const restart = this.maybe<HTMLButtonElement>('restart');
    if (restart) restart.hidden = true;
  }

  private el<T extends HTMLElement>(id: string): T {
    const node = this.root.getElementById(id);
    if (!node) throw new Error(`ai-scan-panel: missing #${id}`);
    return node as T;
  }
  /** Same lookup, but tolerant: headless renders none of the status/preview chrome. */
  private maybe<T extends HTMLElement>(id: string): T | null {
    return this.root.getElementById(id) as T | null;
  }

  /**
   * Open the camera and begin scanning. Public so a host can autostart it, or retry an error.
   * Deliberately does NOT clear captured sides: switching cameras mid-scan, or reopening after
   * painting, must not cost the user the sides they already showed. `restart()` is the wipe.
   *
   * WHO OWNS THE CAMERA. The detector is ONE object shared by every attempt, so `detector.stop()`
   * closes whatever camera is open right now — not "this attempt's camera", which does not exist
   * as a separate thing. A superseded attempt therefore cleans up NOTHING and simply returns: the
   * only two things that can supersede one are a newer `start()` and `close()`, and both call
   * `releaseCamera()` themselves before opening anything. Tidying up on the way out looked
   * obviously right and closed the newer attempt's camera — a start superseded while awaiting a
   * permission prompt would land afterwards and shut off the lens that had just been granted.
   */
  async start(): Promise<void> {
    const refusal = this.cameraRefusal();
    if (refusal !== null) {
      // Detached: the element is gone, there is no host listening and nothing to show a lens in,
      // so returning is the whole of the correct behaviour. Painting: the user is authoring the
      // cube and a camera would overwrite it — say so, because unlike the detached case somebody
      // pressed something and is owed an answer.
      if (refusal === 'painting') this.report('painting', PAINTING);
      return;
    }
    const startBtn = this.maybe<HTMLButtonElement>('start');
    if (startBtn) startBtn.disabled = true;
    const gen = this.cam.beginAttempt();
    this.report('starting', 'Opening the camera…');
    // Release any camera a prior attempt left open (e.g. a failed model load under the
    // camera-first design) before opening a fresh one, so streams can't accumulate.
    this.cam.releaseCamera();
    // The frame numbering goes with the camera (D2). A reopened camera or a switched device may
    // restart its counter, and a genuinely new frame that happened to reuse the last id would be
    // thrown away as a repeat — for exactly one frame, silently, which is the kind of fault nobody
    // ever finds. The RUN is reset by the paths that already do; this forgets only the numbering.
    this.still.forgetFrames();
    // A new camera is a new subject as far as the flicker history goes (D8).
    this.still.forgetFlicker();
    // Choosing the detector is async on the first call (it probes for the native plugin); a stop()
    // during that probe supersedes this attempt, so re-check the generation before going on.
    const detector = await this.ensureDetector();
    // Superseded: return, and do NOT touch the detector — see "WHO OWNS THE CAMERA" above.
    if (!this.cam.current(gen)) return;
    // Deliberately does NOT abort the open: a user answering a permission prompt slowly must not
    // be cut off. It only stops the silence — and a late grant still resolves, reports 'scanning'
    // and overwrites this. Cleared in the finally below, so it can only fire while still opening.
    const slowOpen = setTimeout(() => {
      if (this.cam.current(gen) && this.cam.device === null) {
        this.report('error', this.tinted('err', SLOW_OPEN));
      }
    }, SLOW_OPEN_MS);
    try {
      // Camera FIRST — it must never wait on the model download. The model loads over the network,
      // so gating the camera behind it means a slow/failed/offline load leaves a dead panel with no
      // camera at all. Open the camera, THEN load the model behind the live preview.
      const facing = this.getAttribute('facing');
      const facingMode = facingOf(facing);
      const pinned = this.getAttribute('device-id') || undefined;
      // The pinned-camera fallback lives in CameraSession, which is the only implementation of it.
      // This method used to carry a second copy, comment and all, while the session's went unused
      // — two lifetimes of one policy, free to drift, and the session's copy silently dropped a
      // caller's width/height on the way down.
      const { fellBack } = await this.cam.open(detector, { deviceId: pinned, facingMode }, gen);
      // Cancelled (stop()/restart bumped the generation) while opening → the attempt that
      // superseded this one has already released the camera. See "WHO OWNS THE CAMERA" above.
      if (!this.cam.current(gen)) return;
      this.cam.device = detector.device;
      if (startBtn) startBtn.hidden = true;
      if (!this.cam.modelLoaded) {
        this.report('loading', 'Camera ready — loading the model…');
        // The detector owns the model: for the browser that is onnxruntime-web (loaded as its own
        // module, off the main thread); for the native builds it is the plugin. Either way the
        // panel only waits for load() and reports progress — the wasm-path and worker subtleties
        // live in WebDetector, behind the seam.
        await this.loadModel(detector, gen);
        // The GENERATION FIRST, then the flag. Setting it before the check let a superseded
        // attempt mark the session's model loaded — and `use()` may have replaced the detector in
        // the meantime, in which case the flag was about a different model entirely and the next
        // tick called `next()` on a runtime that had never loaded one.
        if (!this.cam.current(gen)) return; // stop() already released the camera
        this.cam.modelLoaded = true;
        this.announceRuntime(detector);
      }
      // A CAMERA AND A MODEL: whatever failure was pinned about getting here is over. Only the
      // notice a failure raised is taken down, and only if it is still the one on screen — see
      // `cameraFault`. Before the loop below, so the report it sends already carries the clear.
      this.clearCameraFault();
      // The instruction `loop()` could not give because the camera was dark, given now. A camera
      // reopening mid-flow (after painting, after a done-scan correction) otherwise resumes where
      // the scan was: a pending confirm request keeps its phase and its ask.
      const pending = this.pendingOpening;
      this.pendingOpening = null;
      const phase = pending?.phase ?? (this.awaiting ? 'confirm' : 'scanning');
      const opening =
        pending?.words ?? (this.awaiting ? this.confirmWords(this.awaiting) : [OPENING]);
      if (fellBack) this.loop(phase, this.tinted('err', PINNED_GONE), ' ', ...opening);
      else this.loop(phase, ...opening);
    } catch (err) {
      this.startFailed(err, gen, startBtn);
    } finally {
      clearTimeout(slowOpen);
    }
  }

  /**
   * Wait for the model, but not forever, and say so while waiting.
   *
   * The load is a multi-megabyte fetch plus a compile, so several seconds is normal and a minute
   * on a bad connection is not a fault. What was wrong is that there was no upper bound at all: a
   * stalled fetch left "Camera ready — loading the model…" standing for the life of the screen,
   * with the lens on and no control to press, which is the shape of a hung app rather than of a
   * slow one.
   *
   * The timeout ABANDONS THE WAIT, not the load — `Detector.load` is idempotent and now guards its
   * own in-flight promise, so a load that eventually finishes is still there for the next Start
   * rather than being started a second time.
   *
   * EVERY WRITE TO `notice` HERE IS GENERATION-GUARDED (2026-09-05). This attempt's load can settle
   * long after a stop() or a newer start() — a minute later, in the timeout's case — and the notice
   * is the panel's one pinned sentence, so a superseded attempt writing to it replaces whatever the
   * CURRENT state is saying: "the model did not load" over a scanner that is running, or a cleared
   * notice over a camera refusal the user still needs to read. It is the same rule the rest of
   * start() follows, and this method was the one place that did not.
   */
  private async loadModel(detector: Detector, gen: number): Promise<void> {
    // Whether the "taking a while" notice was pinned, so it can be TAKEN DOWN again. A notice
    // stands until the situation changes, and the situation changing is exactly what a finished
    // load is — leaving it up means a working scanner explaining that it is still downloading.
    let waiting = false;
    const slow = setTimeout(() => {
      if (!this.cam.current(gen) || this.cam.modelLoaded) return;
      waiting = true;
      this.notice = {
        title: 'The model is taking a while',
        tone: 'info',
        body: 'The scanner downloads its model once, and this connection is slow. It will start on its own when the download finishes — or paint the cube by hand instead.',
      };
      this.report('loading', 'Still loading the model…');
    }, SLOW_LOAD_MS);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      await Promise.race([
        detector.load(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(
              new Error(
                `the model did not load within ${Math.round(LOAD_TIMEOUT_MS / 1000)} seconds`,
              ),
            );
          }, LOAD_TIMEOUT_MS);
        }),
      ]);
      if (waiting && this.cam.current(gen)) this.notice = null; // it arrived after all
    } catch (err) {
      if (!this.cam.current(gen)) throw err; // superseded: not ours to say anything about
      if (timedOut) {
        // A REMEDY, not just a diagnosis. `startFailed` puts the underlying message on the status
        // line and re-offers Start; this is the part that says what to do about it, including the
        // way forward that needs no model at all.
        this.cameraFault = {
          title: 'The model did not load',
          tone: 'err',
          body: 'The scanner could not finish downloading its model. Check the connection and press Start to try again — or paint the cube by hand, which needs no model.',
        };
        this.notice = this.cameraFault;
      } else if (waiting) {
        this.notice = null;
      }
      throw err;
    } finally {
      clearTimeout(slow);
      clearTimeout(timer);
    }
  }

  /** Take down the notice a camera/startup failure pinned, if it is still the one showing. */
  private clearCameraFault(): void {
    if (this.cameraFault === null) return;
    if (this.notice === this.cameraFault) this.notice = null;
    this.cameraFault = null;
  }

  /**
   * A camera that would not open: re-offer Start, and say which of the several causes it was.
   *
   * Lifted out of start(), which was 100 lines of which a quarter was this. The happy path and the
   * failure path share nothing but their variables, and reading either meant scrolling past the
   * other. The generation is passed rather than re-read because it is the caller's attempt that is
   * being judged, not whatever attempt is current by the time this runs.
   */
  private startFailed(err: unknown, gen: number, startBtn: HTMLButtonElement | null): void {
    // Superseded — not ours to clean up; see start()'s "WHO OWNS THE CAMERA".
    if (!this.cam.current(gen)) return;

    // Keep the camera preview alive (camera-first) but re-offer Start so the user can retry.
    if (startBtn) {
      startBtn.hidden = false;
      startBtn.disabled = false;
    }
    const raw = String((err as Error)?.message ?? err);
    const said = cameraRefusalWords((err as Error)?.name);
    if (said) {
      // The browser's own message is kept — on the console, where whoever has to fix it will look.
      // It is the ONLY record of which of several causes it was, and the sentence shown instead is
      // deliberately not a translation of it.
      console.warn('[ai-scan-panel] the camera would not open', err);
      this.cameraFault = { title: 'The camera did not open', tone: 'err', body: said };
      this.notice = this.cameraFault;
      this.report('error', this.tinted('err', said));
      return;
    }
    this.report('error', this.tinted('err', `Cannot start: ${raw}`));
  }

  /**
   * The detector, chosen once and kept for the element's life (so the model survives a stop()/
   * start(), and so the probe runs only once). Cached as a promise because the choice is async — it
   * asks the plugin whether it is there.
   */
  private ensureDetector(): Promise<Detector> {
    return this.cam.ensureDetector(
      () => this.el<HTMLVideoElement>('video'),
      () => this.modelUrl,
    );
  }

  /**
   * Adopt a ready Detector and skip the async probe. A test seam: driving the full capture loop
   * in a DOM test needs a fake detector in place before start(), and the probe would race it.
   * Production hosts never call this — the panel chooses its own detector.
   */
  useDetector(detector: Detector, runtime: ScanRuntime): void {
    this.cam.use(detector, runtime);
  }

  /**
   * Say which runtime won, and what it is running on — once per detector, on the console.
   *
   * TWO defects in one line. It was called only from `useDetector`, the test seam, so the question
   * it exists to answer ("is this build on the fast native path, or has it silently demoted itself
   * to wasm?") had no answer in any production build — the only place it ever printed was a test.
   * And its text carried three stale numbers: "~400 ms/frame" for a wasm run measured at 57 ms,
   * and a per-frame figure for the native path that is a claim about one machine's ANE.
   *
   * So it prints what is actually KNOWN here: the runtime that was chosen, and the provider list
   * the loaded runner was created with. No timings — a number that was true on the machine the
   * comment was written on is worse than no number, because it reads as a measurement of THIS
   * machine. `ModelRunner.providers` documents the one thing the list does not say: which provider
   * executed each node, which onnxruntime exposes no way to ask.
   *
   * Once per DETECTOR, not per panel: the detector is parked and reused across screen visits, so
   * per-panel would print the same line on every visit to the scan screen, and per-page would miss
   * a runner rebuilt on wasm after the GPU was judged too slow.
   */
  private announceRuntime(detector: Detector): void {
    if (announced.has(detector)) return;
    announced.add(detector);
    const providers = detector.providers;
    const on = providers && providers.length > 0 ? ` — providers: ${providers.join(', ')}` : '';
    // Deliberately NOT spelling the runtime's package name: `vendor-bundles.test.mjs` uses that
    // exact string as the marker for "onnxruntime got inlined into the panel bundle", which is the
    // regression that quietly puts inference back on the page's thread. A message of ours carrying
    // the marker would make that gate pass on any bundle at all.
    const where =
      this.cam.runtime === 'native'
        ? 'native (the cube-vision plugin — CoreML on Apple, LiteRT on Android)'
        : `web (the browser runtime${on})`;
    console.info(`[cubus] scanner runtime: ${where}`);
  }

  private reset(): void {
    this.captureEpoch += 1;
    this.forgetObservation();
    this.invalidateReading();
    this.settled.clear();
    this.pendingOpening = null;
    for (const f of FACES) delete (this.faces as Partial<Record<Face, ColorFace>>)[f];
    // The next cube is a different cube; what the last verdict said about this one's colours
    // must not outlive it.
    this.scheme = null;
    this.buildDots();
  }

  /**
   * (Re)start the capture loop. `opening` replaces the standard prompt, so a message explaining
   * why we are starting over survives instead of being overwritten within one tick.
   */
  private loop(phase: ScanPhase, ...opening: (string | Node)[]): void {
    this.cam.stopLoop();
    this.forgetObservation();
    // A fresh loop starts with a clean failure clock. Without this the "try Start again" the
    // fatal-tick notice offers was a lie: the timestamp survived the restart, so the FIRST failing
    // tick of the new loop was already past TICK_FAIL_MS and stopped it again immediately.
    this.tickFailingSince = null;
    this.noFrameSince = null;
    const restart = this.maybe<HTMLButtonElement>('restart');
    if (restart) restart.hidden = false;
    // Asking for a side with no camera open is a promise nothing can keep — and it reads exactly
    // like a scan that is working, because the ticks just return. Reachable when a host stays on
    // the screen after a scan finishes (the camera is released on 'done') and a correction then
    // needs another look. Reopen the camera rather than dead-ending: start() keeps the captures
    // and resumes this loop — including a pending confirm — once the camera answers.
    if (this.cam.device === null) {
      // CARRY THE WORDS ACROSS THE REOPEN. They were dropped here, so `rescanFace`'s "Show the
      // ORANGE side again" — the whole point of pressing a centre sticker — was replaced by
      // "Opening the camera…" and then by the generic idle line, in exactly the case that needs
      // it: after a finished scan, where the camera has been released.
      if (opening.length > 0) this.pendingOpening = { phase, words: opening };
      void this.start();
      return;
    }
    this.report(phase, ...(opening.length > 0 ? opening : [OPENING]));
    // Said, so the sides handed back so far have been named; the next hand-back starts a new list.
    this.rescanQueue = [];
    // The trace switch is read HERE, once per loop, never per frame: a scan must not change how it
    // reads halfway through a side because a developer flipped a flag.
    this.tracing = traceEnabled();
    if (this.tracing) {
      this.trace.begin({
        runtime: this.cam.runtime ?? 'unknown',
        providers: this.cam.chosen?.providers ?? undefined,
        phase,
        floorMs: STABLE_MS,
      });
      (globalThis as { __cubusScanTrace?: ScanTrace }).__cubusScanTrace = this.trace;
    }
    // The stall bound runs from here when there is nothing captured yet, so a scan that is reopened
    // after a pause is not immediately declared stuck on the strength of the pause.
    this.lastProgressAt = performance.now();
    // Read HERE for the trace's reason: a scan must not start recording halfway through a side.
    this.recording = recordEnabled();
    if (this.recording) {
      this.recorder.begin({
        id: `scan-${new Date().toISOString()}`,
        // What the scan knows. The cube, the conditions and the TRUTH are a person's to supply at
        // `finish()` — a corpus labelled by the detector measures nothing (§4.1), and one labelled
        // `cube: 'unknown'` is worse than no entry because it looks like a measurement.
        model: {
          hash: this.cam.chosen?.loadedModel ?? 'unknown',
          name: this.cam.chosen?.loadedModel ?? 'bundled',
          runtime: this.cam.runtime ?? 'unknown',
        },
      });
      (globalThis as { __cubusScanRecord?: SessionRecorder }).__cubusScanRecord = this.recorder;
    }
    // Tick as fast as the runtime actually answers, floored — see TICK_FLOOR_MS. The busy guard in
    // onTick still prevents overlap if a frame ever runs long.
    this.cam.beginLoop(
      () => Math.max(TICK_FLOOR_MS, Math.round(this.lastInferenceMs)),
      () => void this.onTick(),
    );
  }

  private stopLoop(): void {
    this.cam.stopLoop();
  }

  /**
   * One frame: ask the detector, then hand the answer to whichever of the three outcomes it is.
   *
   * What is left here is the INFERENCE's lifetime — its guard, its deadline, its freshness and the
   * cadence measurement — and nothing about cubes. Three outcomes moved out with the branching
   * they carried (`noFrameTick`, `readFrame`, `failingTick`), which is the same split
   * `fileSettledRead` was made by and for the same reason: whether a frame arrived is a question
   * about the camera, what it shows is a question about the cube.
   */
  private async onTick(): Promise<void> {
    if (this.cam.device === null || !this.cam.chosen || !this.cam.modelLoaded) return;
    const epoch = this.cam.frameEpoch();
    // Only a tick of THIS epoch holds the guard — see `busy`.
    if (this.busy === epoch) return;
    this.busy = epoch;
    const started = performance.now();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      // Raced against a clock, because an inference that never settles is invisible to every other
      // check here — see INFERENCE_TIMEOUT_MS.
      const output = await Promise.race([
        this.cam.chosen.next(),
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => {
            const timedOut = new Error(
              `the detector did not answer within ${Math.round(INFERENCE_TIMEOUT_MS / 1000)} seconds`,
            );
            timedOut.name = INFERENCE_TIMEOUT; // so `tickFail` can tell it from a runtime's own error
            reject(timedOut);
          }, INFERENCE_TIMEOUT_MS);
        }),
      ]);
      // Reject a stale result: stop()/restart() between grab and here bumps the session epoch, so an
      // in-flight inference can't bleed into a new scan (or land after the loop was stopped).
      if (!this.cam.freshFrame(epoch)) return;
      // How long this runtime actually takes, which is what the next tick's delay is made of.
      this.lastInferenceMs = performance.now() - started;
      this.tickNote = {};
      if (output === null) {
        this.commitTick({ outcome: 'no-frame' });
        // A tick that got an ANSWER at all is a working detector, even an empty one — `noFrameTick`
        // has its own clock for a camera that never delivers. This used to be cleared only where a
        // BRAND NEW face was filed, so every other outcome left the timestamp of some long-past
        // hiccup lying around, and the next single transient failure measured itself against that
        // and killed a scanner that was fine.
        this.tickFailingSince = null;
        this.noFrameTick(); // camera opened but no frame yet — try again next tick
        return;
      }
      this.noFrameSince = null;
      await this.readFrame(output, epoch);
      // RE-CHECKED, because `readFrame` can now await (D7: it asks the plugin for the frame behind
      // a settled read). A stop, a restart or a switch to painting in that window leaves this tick
      // describing a scan that is over, and recording it would put a settled read into the trace of
      // a scan that never filed it. The same guard every other awaiting path here keeps.
      if (!this.cam.freshFrame(epoch)) return;
      this.commitTick({});
      // CLEARED AFTER THE FRAME WAS PROCESSED, NOT BEFORE IT (2026-09-05). `readFrame` runs the
      // whole post-processing tail — decode, NMS, fitFace, and on the sixth side an assemble — and
      // every one of those can throw: `detectionsFromOutput` refuses a head with the wrong row count, and
      // the native bridge can hand back a tensor that disagrees with its own header. Clearing the
      // clock first meant `failingTick` always started a FRESH run, so a scanner throwing on every
      // single frame never reached TICK_FAIL_MS and never stopped — it reported a transient error
      // forever, over a camera that was working and a model that was not. The one failure with no
      // way out was the one the fatal threshold exists for.
      this.tickFailingSince = null;
    } catch (err) {
      // A rejection can land after the scan it belonged to is over — a stop(), a restart, painting
      // switched on — exactly as a successful result can, and the success path has always said so.
      // Without the same guard, a late rejection restarted the failure clock and could report an
      // error into a scan that had already moved on, or over a panel that is now painting.
      if (!this.cam.freshFrame(epoch)) return;
      // Its own elapsed time: a tick that threw never reached the line that sets lastInferenceMs,
      // so that field still holds the PREVIOUS tick's, and the record would lie about this one.
      this.commitTick({
        outcome: 'error',
        error: err instanceof Error ? err.message : String(err),
        inferMs: performance.now() - started,
      });
      this.failingTick(err);
    } finally {
      clearTimeout(deadline);
      // Only if it is still ours: an abandoned inference landing late must not open the current
      // epoch to a second one.
      if (this.busy === epoch) this.busy = null;
    }
  }

  /**
   * The tick answered, with no frame.
   *
   * No frame is not a still cube — it is no observation at all. An abstaining frame already reset
   * the streak; leaving a missing one alone meant identical reads either side of a stall could
   * satisfy both the count and the duration without the cube having been watched in between.
   *
   * And it is not a working scanner either, which is the half that was missing. A camera that opens
   * and never delivers answers `null` on every tick, and `null` clears the failure clock in
   * `onTick` — so the one failure that needs no exception to happen was the one failure nothing
   * watched. Its own clock, same limit, same fail-loud exit.
   */
  private noFrameTick(): void {
    this.withdrawObservation();
    const now = performance.now();
    this.noFrameSince ??= now;
    if (now - this.noFrameSince >= TICK_FAIL_MS) {
      this.tickFail(
        new Error(
          `the camera has been open for ${Math.round(now - this.noFrameSince)} ms without delivering a frame`,
        ),
      );
    }
  }

  /** A frame arrived: decide whether there is a read worth acting on, and hand it on if so. */
  private async readFrame(output: ModelOutput, epoch: number): Promise<void> {
    // Decoded ONCE, and the same boxes go to the fit and the trace. `fitFace` of
    // `detectionsFromOutput` is exactly `fitFromOutput`, so the scan reads the same whether it is
    // being watched or not; the trace only adds what it records beside the verdict.
    const began = performance.now();
    // WHILE RECORDING, DECODE AT THE RECORDER'S FLOOR AND FILTER BACK — because a recording that
    // cannot hold the sub-threshold candidates cannot answer the question it exists for.
    //
    // `detectionsFromOutput` defaults to MIN_STICKER_CONFIDENCE (0.25), so until 2026-09-23 the
    // recorder was handed an already-filtered list and `NEAR_FLOOR_RECORD` (0.05) could never keep
    // anything: every recording said "no candidate below the floor" no matter what the model
    // emitted. The live trace of §1.2 had seen the logo centre scoring 0.20–0.25, and the one
    // instrument built to capture that was structurally unable to.
    //
    // THE SCAN MUST READ THE SAME WHETHER OR NOT IT IS BEING RECORDED, which is why the fit gets
    // the filtered list rather than the wide one. That the two are identical is a property of NMS —
    // it keeps boxes in descending confidence and a lower-scoring candidate can never displace a
    // higher-scoring one — and it is asserted on the golden frames rather than assumed
    // (`tests/record-floor.test.ts`).
    const wide = this.recording
      ? detectionsFromOutput(output, { confThreshold: NEAR_FLOOR_RECORD })
      : null;
    const dets = wide
      ? wide.filter((d) => d.confidence >= MIN_STICKER_CONFIDENCE)
      : detectionsFromOutput(output);
    // EVERY candidate this frame produced, unrounded and with all six scores — what a replay needs
    // and what the trace discards (D9). A no-op with recording off.
    if (wide) {
      this.recorder.frame(wide, {
        ...(output.frameId === undefined ? {} : { frameId: output.frameId }),
        inferMs: this.lastInferenceMs,
      });
    }
    let fit: FitResult;
    if (this.tracing) {
      const frame = traceFrame(output, {}, dets);
      fit = frame.fit;
      this.note({
        ...frameNote(frame),
        traceMs: Math.round((performance.now() - began) * 10) / 10,
      });
    } else {
      fit = fitFace(dets);
    }
    if (dets.length > 0) this.lastSightingAt = performance.now();
    this.seen = seenIn(output, dets, fit.ok ? fit.face.boxes : undefined);
    if (!fit.ok) {
      this.still.reset();
      this.showPreview(null);
      // Keep the confirm phase while a confirm is pending: reporting 'scanning' here used to
      // flip the host back to its idle heading the moment the cube left the frame — which it
      // always does, because the user is turning it to find the side that was asked for.
      // The idle line alone, whatever the reason. There used to be a hint per reason, and every
      // one has gone: NO_FACE's repeated what the idle line says; PARTIAL_FACE's ("Get the whole
      // side in the frame") was usually false — the detector had missed a sticker, most often a
      // logo centre — and asked a child to do the scanner's job (owner's call, 2026-09-18); and
      // BAD_GEOMETRY's ("Hold it flatter and steadier.") fired on the recorded scan only mid-turn and
      // on fingers, because nothing measures a side's angle or a hand's shake. No sentence names a
      // cause the scanner did not measure (`dev-docs/scan-guidance-plan.md` §1;
      // `apps/web/test/scan-sentences.test.mjs` refuses the words).
      // A FIT THAT DROPPED OUT FOR A FRAME IS STILL A SIDE BEING READ (2026-09-24). Falling straight
      // back to the idle line here is what made the caption flicker: see `READING_GRACE_MS`. The
      // grace covers only the ordinary caption — a stall, a confirm and every toned verdict are
      // decided by `idleLine` as before, so nothing that has something to SAY is held back by it.
      const reading =
        this.lastLine === AiScanPanel.READING_LINE &&
        !this.stuck() &&
        performance.now() - this.lastFitAt < AiScanPanel.READING_GRACE_MS;
      this.report(
        this.awaiting ? 'confirm' : 'scanning',
        reading ? AiScanPanel.READING_LINE : this.idleLine(),
      );
      this.note({ outcome: 'abstain', reason: fit.reason, geometry: fit.geometry });
      return;
    }
    // Both a count and a duration; see Stillness for why either alone is wrong — and WHICH FRAME
    // this read came from, so one physical frame served to several ticks cannot count as several
    // looks at the cube (D2, `dev-docs/scan-pipeline-audit-2026-09-23.md` §3). A runtime that
    // cannot say sends nothing and is counted exactly as it was.
    const settled = this.still.offer(fit.face.colors, performance.now(), output.frameId);
    // A face fitted on THIS frame, which is what the reading caption's grace is measured from.
    this.lastFitAt = performance.now();
    this.showPreview(fit.face.colors);
    if (!settled) {
      // WHY it is not settling, when the answer is one sticker. The gate keys on all nine
      // colours, so a single sticker flickering between red and orange — the detector's known
      // weak pair — means no run ever completes and this line repeats forever with nothing to
      // act on. The settle rule is unchanged (a majority vote would let a cube still being
      // turned settle); what is added is the missing sentence.
      const flicker = this.still.flickering();
      this.report(
        this.awaiting ? 'confirm' : 'scanning',
        this.stuck()
          ? this.stuckLine()
          : flicker === null
            ? AiScanPanel.READING_LINE
            : this.flickerLine(flicker),
      );
      this.note({ outcome: 'reading', ...this.readNote(fit.face), flicker });
      return;
    }
    this.note({ outcome: 'settled', ...this.readNote(fit.face) });
    // A face's CENTRE colour is its identity (centres never move): colour class i ↔ FACES[i].
    // So sides can be shown in any order — file each stable read under the face it belongs to.
    // Everything above decides whether there is a read worth acting on; this decides what
    // the read MEANS and where it goes. Separated because the first half is about the
    // camera and the second is about the cube, and only the second can capture anything.
    // The paint, while the frame is still in hand. The assembly uses it only where the detector's own
    // reading has been refused (`paint-groups.ts`).
    //
    // NATIVE PARITY (D7, `dev-docs/scan-pipeline-audit-2026-09-23.md` §3). `WebDetector` ships its
    // frame with every tensor; the native plugin never does, because a 3.7 MB copy per tick across
    // the bridge is exactly what that design avoids — so the Mac, the primary platform, had one
    // recovery path fewer than the browser. It is asked for HERE and nowhere else: this line runs
    // only on a read that has settled, which is six times in a scan against sixteen a second, so
    // the cost is paid only where it buys something. A runtime that offers neither leaves this
    // undefined and the scan behaves exactly as it did before.
    //
    // ONE implementation of what a sticker's paint IS: both paths end in the same `stickerLab`,
    // over a frame of the same shape, so the two cannot come to disagree about a colour.
    const frame = output.frame ?? (await this.framePixels(output, epoch));
    const lab =
      frame && fit.face.boxes
        ? (stickerLab(frame, fit.face.boxes, IMG_SIZE) ?? undefined)
        : undefined;
    // RE-CHECKED AFTER THE AWAIT. Fetching the pixels crosses a bridge, and a stop, a restart or a
    // switch to painting in that window leaves this read describing a scan that is over — the same
    // rule every awaiting path here keeps, and the one the 2026-09-21 audit found missing in four
    // places at once.
    if (!this.cam.freshFrame(epoch)) return;
    // WHETHER THE ORDER WAS PROVEN travels with the capture (D6): a face the fit had to group by
    // the y-sort may be scrambled, and the assembly must not blame a COLOUR for that. Only marked
    // where the fit actually guessed — `'lattice'` is left off, so a capture built any other way
    // reads exactly as it did.
    const read =
      fit.face.ordering === 'sorted' ? { ...fit.face, ordering: 'sorted' as const } : fit.face;
    this.fileSettledRead(lab ? { ...read, lab } : read);
  }

  /**
   * The pixels of the frame a fit was made on, from a detector that did not ship them (D7).
   *
   * Null whenever it cannot be had — no `framePixels` on this runtime, no frame identity to ask by,
   * or a plugin that no longer holds that frame — and null on a failure, loudly on the console but
   * not into the scan: the paint path is the assembly's LAST resort before refusing, so losing it
   * costs a recovery that did not exist here at all until today, while letting the error through
   * would turn a working scan into a failed tick.
   *
   * BY ID, never "the latest": the grid was fitted to one particular picture, and pixels from a
   * later frame would place every sticker box over paint that has since moved.
   */
  private async framePixels(output: ModelOutput, epoch: number): Promise<Frame | null> {
    const detector = this.cam.chosen;
    if (!detector?.framePixels || output.frameId === undefined) return null;
    try {
      const frame = await detector.framePixels(output.frameId);
      return this.cam.freshFrame(epoch) ? frame : null;
    } catch (cause) {
      console.warn('[ai-scan-panel] the frame behind a settled read could not be read', cause);
      return null;
    }
  }

  /** Record a decision that is not a frame, for the trace. A no-op with the trace off. */
  private traceEvent(kind: TraceEvent['kind'], detail: Record<string, unknown>): void {
    if (this.tracing) this.trace.event(kind, detail);
    // The same decisions, against the FRAME they were decided on rather than a timestamp: on a path
    // that re-serves frames a timestamp does not say which read was the cause (D9).
    if (this.recording) this.recorder.decision(kind, detail);
  }

  /** Add to what this tick has learned, for the trace. A no-op with the trace off. */
  private note(fields: Partial<TickNote>): void {
    if (this.tracing) Object.assign(this.tickNote, fields);
  }

  /** A read's colours and confidences, and where the stillness run stands after it. */
  private readNote(face: FaceFit): Partial<TickNote> {
    const { run, heldMs } = this.still.status();
    return {
      colors: [...face.colors],
      conf: face.confidence.map((c) => Math.round(c * 1000) / 1000),
      run,
      heldMs: Math.round(heldMs),
    };
  }

  /**
   * File this tick with the trace, then start the next one clean. A no-op with the trace off.
   *
   * A tick that reaches here without an outcome is recorded as an ERROR that says so, not given a
   * plausible one: every path through `readFrame` names its outcome, and a path that stops doing so
   * is a bug in this wiring that the trace should show rather than paper over.
   */
  private commitTick(extra: Partial<TickNote>): void {
    if (!this.tracing) return;
    const note = { ...this.tickNote, ...extra };
    this.tickNote = {};
    this.trace.record({
      ...note,
      outcome: note.outcome ?? 'error',
      ...(note.outcome === undefined
        ? { error: 'the tick ended without telling the trace how' }
        : {}),
      inferMs: Math.round((note.inferMs ?? this.lastInferenceMs) * 10) / 10,
      line: this.lastLine,
    });
  }

  /**
   * The tick failed: transient at first, an error if it persists.
   *
   * The distinction is duration, not type: the camera-not-ready case clears in a tick or two, and
   * nothing else does. `performance.now()`, because this is a claim about ELAPSED time — see
   * TICK_FAIL_MS.
   *
   * A FAILED FRAME BREAKS THE STILLNESS RUN, and that was missing. Every other way a tick can end
   * without a usable read resets it — a frameless tick, an abstain, a bad geometry — but a frame
   * that THREW left the run standing, so two matching reads, a failure, and a third matching read
   * half a second later satisfied both halves of the capture gate over an observation that had a
   * hole in it. Stillness is a claim about what was watched continuously; a frame nobody could read
   * is not a frame that showed the cube unmoved.
   */
  private failingTick(err: unknown): void {
    this.withdrawObservation();
    const now = performance.now();
    this.tickFailingSince ??= now;
    if (now - this.tickFailingSince >= TICK_FAIL_MS) {
      this.tickFail(err);
    }
  }

  /**
   * Ticks have failed for TICK_FAIL_MS: stop, say so, and leave a way back on.
   *
   * The way back is the part that was missing. This used to call `stopLoop()` and nothing else,
   * while the notice it wrote told the user to press Start — a button `start()` had hidden the
   * moment the camera opened. The camera is released too: the failure is in reading from it, and a
   * lens left live under a dead loop is a light on for nothing.
   */
  private tickFail(err: unknown): void {
    this.cam.close();
    this.forgetObservation();
    this.tickFailingSince = null;
    this.noFrameSince = null;
    // AN INFERENCE THAT NEVER SETTLED IS NOT SOMETHING START CAN GET PAST (2026-09-20). The
    // notice below says "Try Start again", and Start kept the same runner: `modelLoaded` stayed
    // true, the detector's `load()` short-circuited, and the next `next()` queued behind the hung
    // promise on the runtime's per-module chain — so every Start after a wedged run was the same
    // fifteen seconds and the same notice, until a reload. The runner is given up here, so Start
    // builds a fresh session; the chain itself stops waiting on a run past its own limit
    // (`onnx-runtime.ts`, RUN_CHAIN_TIMEOUT_MS), which is what makes the rebuild reachable.
    //
    // A WORKER THAT DIED TOOK ITS MODEL WITH IT (2026-09-22), and is the same case from the other
    // side: the runtime did not stall, it is gone (`inference-client.ts`). Start rebuilds it the
    // same way, in a new worker.
    if (
      err instanceof Error &&
      (err.name === INFERENCE_TIMEOUT || err.name === INFERENCE_WORKER_LOST)
    ) {
      this.cam.chosen?.dispose?.();
      this.cam.modelLoaded = false;
    }
    // A DIAGNOSIS IN FLIGHT MUST NOT SPEAK AFTER THIS (2026-09-05). A refusal published seconds ago
    // has its misread decode running on another thread, and its answer republishes — `notice` and
    // all, at phase 'scanning'. Landing here it replaced "The scanner stopped" with a sentence
    // about stickers, over a camera this method has just CLOSED: the user is told to show a side
    // again by a scanner with no lens on and no loop running. The count is lost, which is the
    // cheaper half — the panel's pinned sentence is now the camera error, and a refusal is
    // re-decided from scratch the moment the scan resumes.
    this.dropDiagnosis();
    const start = this.maybe<HTMLButtonElement>('start');
    if (start) {
      start.hidden = false;
      start.disabled = false;
    }
    this.cameraFault = {
      title: 'The scanner stopped',
      tone: 'err',
      body: 'The camera opened but no frame could be read for several seconds. Try Start again, and if it keeps happening the model or the camera driver is at fault rather than the cube.',
    };
    this.notice = this.cameraFault;
    this.report('error', 'Could not read from the camera.');
    // Rethrown into the console for whoever is debugging: the notice tells the user what to do,
    // and this is the only place the underlying cause survives at all.
    console.error('[ai-scan-panel] scan loop stopped after repeated failures', err);
  }

  /**
   * A read has settled: decide what it MEANS — a new side, one already in hand, the side a confirm
   * asked for, or a correction — and file it.
   *
   * A side is NAMED by its centre's colour and RECOGNISED by that colour together with the eight
   * stickers around it (`sameSide`, which forgives one flickering sticker — a side re-shown with one
   * sticker read differently is the same side, not a stranger with a familiar centre).
   * The centre cannot be left out of recognising a side, because different sides can share their eight
   * exactly: after U D R L F B the white and yellow sides are the same eight stickers around different
   * centres.
   *
   * The run that produced this read was identical in all nine positions (`Stillness`), so its centre
   * is the centre every frame of it showed — there is no such thing here as a side whose centre the
   * scan could not read, because such a side never settles.
   */
  private fileSettledRead(read: ColorFace): void {
    const claim = sideClaimed(read.colors);
    // While confirming, only the side we asked for counts, and it is taken as a CANONICAL
    // capture rather than filed as a new face: its rotation is the whole point of asking. It is the
    // side asked for when its centre says so — or, for a side whose centre was misread, when its eight
    // point to that side and no other.
    if (this.awaiting) {
      this.acceptConfirmation(read, claim);
      return;
    }
    if (claim === undefined) {
      // Unreachable from the camera today — `fitFace` keeps only colour classes, so a fitted centre
      // is always a colour — and kept because a read that names no side must never be filed. The
      // sentence says what happened and the one thing that helps: the scanner keeps reading.
      this.report(
        'scanning',
        this.tinted('err', "Couldn't read this side's centre — keep showing it."),
      );
      return;
    }
    // A finished scan captures nothing: the cube in view is most likely just being picked up —
    // to be solved, not re-scanned — and silently replacing part of an ACCEPTED scan because a
    // side drifted through the frame would be the worst kind of helpfulness.
    if (this.finished) {
      this.report(
        'scanning',
        'This cube is already scanned — tap a sticker to fix one, or start the scan over for a different cube.',
      );
      this.still.reset(); // spent, as in the in-hand branch below
      return;
    }
    // With all six sides in, the loop only runs because the scan was refused — so a re-shown side
    // is a correction: replace its reading and check again. Which side it corrects is the side its
    // eight point to when they point to one alone, and otherwise the one its centre names — a
    // correction is the moment a sticker has changed, so the eight may no longer agree.
    if (this.sidesHeld() >= FACES.length) {
      this.replaceCapturedSide(read, claim);
      return;
    }
    // A side the scan already has.
    const inHand = this.sideInHand(read);
    if (inHand) {
      this.traceEvent('turned-away', {
        face: inHand.slot,
        colors: [...read.colors],
        why: 'the same side again',
      });
      const named = this.missingSides();
      this.shownAgain = true;
      this.report(
        'scanning',
        'Already have the ',
        this.bold(GUIDE[inHand.slot].color),
        ' side',
        named ? ` — still need ${named}.` : ' — show a different one.',
      );
      // The read is SPENT: a side left in view must settle again before it is answered again.
      // Left standing, the run stayed satisfied and this branch ran on every tick — sixteen
      // "Already have" reports a second and the trace's event ring filled in half a minute
      // (audit, 2026-09-20).
      this.still.reset();
      return;
    }
    this.fileNewSide(read, claim);
  }

  /**
   * File a read the scan has decided is a side it does not have — under the colour its centre
   * claims, or not at all.
   *
   * The tail of `fileSettledRead`, lifted out (2026-09-21). `kind` is what the capture is announced
   * as — `'side'`, or `'reread'` for a side that was already in hand.
   */
  private fileNewSide(
    read: ColorFace,
    claim: Face | undefined,
    kind: ScanCapture['kind'] = 'side',
  ): void {
    // A SIDE IS ITS CENTRE, and a centre that could not be read names nothing (2026-09-23, the
    // owner's call to take the logo machinery out). There used to be a whole apparatus here for a
    // centre a printed logo made unreadable: the side was held UNNAMED, a side already holding that
    // colour was withdrawn to join it, and `resolveCentres` decided at six which slot each filled.
    // Five fixes over ten days, and it never converged — on the cube it was written for the scan
    // took a minute or more and then showed a side it could not place. What it bought was a scan
    // that limped; what it cost was every screen having to model a side with no name.
    //
    // So: no name, no capture. The scan says the centre could not be read and keeps looking, and
    // the stall bound states it plainly after twelve seconds and offers painting.
    if (claim === undefined) {
      this.report(
        'scanning',
        this.tinted('err', "Couldn't read this side's centre — keep showing it."),
      );
      return;
    }
    // Another side already holds that colour: one of the two is misread, and nothing here can say
    // which. Refusing is the honest answer — the reading that arrives second does not get to evict
    // the one already filed, and neither is guessed at.
    const holder = this.faces[claim];
    if (holder) {
      this.report(
        'scanning',
        'Two sides are reading as the ',
        this.bold(GUIDE[claim].color),
        ' side — show them again, or tap a sticker to fix one.',
      );
      return;
    }
    this.traceEvent('captured', { face: claim, colors: [...read.colors] });
    // A capture is the only thing that counts as progress: the stall bound measures time spent with
    // nothing to show for it, not time spent.
    this.lastProgressAt = performance.now();
    this.capture(claim, read, kind);
  }

  /**
   * A side shown again once all six are in: a CORRECTION, since the loop only runs then because the
   * scan was refused.
   *
   * Which side it corrects is the side its eight point to when they point to one alone, and
   * otherwise the one its centre names — a correction is the moment a sticker has changed, so the
   * eight may no longer agree. Lifted out of `fileSettledRead` (audit, 2026-09-20).
   */
  private replaceCapturedSide(read: ColorFace, claim: Face | undefined): void {
    // The side its eight point to, when they point to one alone. A correction is the moment a
    // sticker has changed, so the eight may no longer agree — and then the centre names it instead.
    const byEight = this.sideByEight(read);
    const slot = byEight ?? (claim !== undefined && this.faces[claim] ? claim : undefined);
    if (slot === undefined) {
      // The eight did not point anywhere and the centre names no side in hand, so there is nothing
      // to correct and nothing honest to say about which side this is — the scanner keeps reading
      // rather than guessing a slot.
      this.report('scanning', 'Keep showing that side — its middle sticker keeps changing colour.');
      return;
    }
    const fresh = withCentre(read, colourOfSlot(slot));
    // A read identical to the one already filed would re-run the same refusal forever, so it
    // just restates the options.
    if (fresh.colors.join(',') === this.faces[slot]!.colors.join(',')) {
      // Sides are named by COLOUR in every sentence here, never by position: a capture is a
      // colour, and where it sits is the scan's to decide (the blue side of an older cube
      // is its bottom, not its back — ADR 0001).
      this.shownAgain = true;
      this.report(
        'scanning',
        'The ',
        this.bold(GUIDE[slot].color),
        ' side reads the same as before — tap a sticker to fix it, or show another side.',
      );
      return;
    }
    this.faces[slot] = fresh;
    // A fresh camera read is at whatever rotation it was held at, so whatever the settle knew
    // about this side is no longer true of what is stored.
    this.settled.delete(slot);
    this.confirmed = {};
    this.mismatches = 0;
    this.buildDots();
    this.captured('reread', slot);
    this.scheduleCheck(this.tinted('ok', `Re-read the ${GUIDE[slot].color} side — checking…`));
    return;
  }

  /**
   * A read offered while a confirm is standing: take it as that side, or ask again.
   *
   * Lifted out of `fileSettledRead` (audit, 2026-09-20), which owned eight decisions at once. This
   * is the first of them and the most self-contained: it is the only branch that ends a confirm, and
   * nothing after it in the original ran when a confirm was standing.
   */
  private acceptConfirmation(read: ColorFace, claim: Face | undefined): void {
    const asking = this.awaiting;
    if (!asking) return;
    const asked = asking.face;
    const held = this.faces[asked];
    // The side asked for when its centre says so — or, for a side whose centre was misread or never
    // settled, when its eight point to that side and no other.
    if (claim !== asked && (held === undefined || this.sideByEight(read) !== asked)) {
      this.report('confirm', ...this.confirmWords(asking));
      this.still.reset(); // spent: another side in view is answered once per settle, not per tick
      return;
    }
    // Taken as a CANONICAL capture rather than filed as a new face: its rotation is the whole point
    // of having asked. APPENDED, never overwritten (2026-09-20): the assembler may ask for a side
    // already looked at, under another colour up, and needs both photographs to count two
    // contradictions (`Looks` in ai-assemble.ts) — an overwrite here would leave it seeing one look
    // and asking for the same side for as long as it has holds to ask for.
    const looks = this.confirmed[asked] ?? [];
    looks.push({ capture: withCentre(read, colourOfSlot(asked)), up: asking.up });
    this.confirmed[asked] = looks;
    this.awaiting = null;
    this.captured('confirm', asked);
    this.scheduleCheck(this.tinted('ok', 'Got it — checking…'));
  }

  /**
   * The side in hand that `read` shows again, with its slot — or null for a side not in hand: its
   * centre claims the same colour and its eight agree (`sameSide`).
   *
   * BOTH HALVES ARE LOAD-BEARING. The centre alone is not enough, because a side re-shown after one
   * sticker was read differently is the same side; the eight alone are not enough either, because
   * different sides can share them exactly — after U D R L F B the white and yellow sides are the
   * same eight around different centres.
   *
   * A READ WHOSE CENTRE NAMES A SIDE IN HAND IS THAT SIDE UNLESS ITS EIGHT CONTRADICT IT: five of
   * eight agreeing under some turn (`SAME_SIDE_BY_CENTRE`), not seven. Two stickers read differently
   * on a re-show is ordinary; two sides of one cube sharing a centre colour AND five of eight is not
   * (`dev-docs/scanner-audit-2026-09-20.md` §1.7).
   */
  private sideInHand(read: ColorFace): { side: ColorFace; slot: Face } | null {
    const centre = read.colors[4];
    for (const slot of FACES) {
      const side = this.faces[slot];
      if (
        side &&
        side.colors[4] === centre &&
        sameSide(read.colors, side.colors, SAME_SIDE_BY_CENTRE)
      ) {
        return { side, slot };
      }
    }
    return null;
  }

  /**
   * The named side whose eight `read` shows, when exactly one does — however its centre read. For the
   * moments after six, when every side is named and the one being shown is a side the scan has: a
   * centre that read yellow as white is still that side. When two sides share their eight (a
   * symmetric cube), the eight point to neither and the centre decides, as it always did.
   */
  private sideByEight(read: ColorFace): Face | undefined {
    const matches = FACES.filter((f) => {
      const side = this.faces[f];
      return side !== undefined && sameSide(read.colors, side.colors);
    });
    return matches.length === 1 ? matches[0] : undefined;
  }

  /** File a freshly-recognised face under its own letter, then keep scanning (or finish at six). */
  private capture(face: Face, read: ColorFace, kind: ScanCapture['kind'] = 'side'): void {
    this.faces[face] = read;
    // The camera cannot see which way up a side was held, so a capture's rotation is unknown until
    // the assembly solves it. See `settled`.
    this.settled.delete(face);
    this.buildDots();
    this.captured(kind, face);
    const done = this.sidesHeld();
    if (done >= FACES.length) {
      this.scheduleCheck(this.tinted('ok', 'All six sides captured — checking…'));
      return;
    }
    // Name the last sides rather than only counting them: "5/6" makes a child inspect six tiles
    // for the gap, while "show YELLOW" is the answer itself.
    const named = this.missingSides();
    this.report(
      'scanning',
      'Got the ',
      this.bold(GUIDE[face].color),
      ` side — ${done}/6. ${named ? `Still to show: ${named}.` : 'Show another side…'}`,
    );
  }

  /**
   * Stop the loop, report 'checking', and run the assembly one beat later (CHECK_BEAT_MS), so the
   * capture or correction that triggered the check paints before any verdict replaces it. Clears
   * the pinned notice: whatever it explained is being re-decided right now.
   *
   * GUARDED ON THE READING, NOT ON THE CAMERA (2026-09-05). A check is a computation over the six
   * faces; the camera has already said everything it is going to say about them. Guarding it with
   * `frameEpoch` meant anything that touched the camera during the 350 ms beat cancelled the
   * verdict and put NOTHING in its place — and switching cameras is exactly that: six captures on
   * screen, `complete` never set, and no way back, because re-showing a side that reads the same
   * as the one on file is answered with "that side reads the same as before". Measured: six
   * captures, no check, and identical re-reads unable to recover it.
   *
   * `diagnosisEpoch` is the serial number of the READING, bumped by everything that re-decides it
   * — a capture, a correction, a paint stroke, a mode change, `reset()` — so a restart during the
   * beat still cancels the check, and `stop()` clears the timer outright for a navigation. What is
   * left running is the case that should always have run.
   */
  private scheduleCheck(...opening: (string | Node)[]): void {
    this.stopLoop();
    this.forgetObservation();
    this.finished = false; // whatever was settled is being re-decided
    this.notice = null;
    this.suspects = [];
    this.dropDiagnosis();
    this.report('checking', ...opening);
    const epoch = this.diagnosisEpoch;
    if (this.checkTimer !== null) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      if (epoch === this.diagnosisEpoch) this.assemble();
    }, CHECK_BEAT_MS);
  }

  /** The sides captured so far, in URFDLB order — the shape hosts draw progress from. */
  private capturedFaces(): CapturedFace[] {
    const out: CapturedFace[] = [];
    for (const face of FACES) {
      const read = this.faces[face];
      if (read) out.push({ face, colors: [...read.colors] });
    }
    return out;
  }

  /** Sides in hand. Counted by the same test `capturedFaces` files by, without copying a side. */
  private sidesHeld(): number {
    let held = 0;
    for (const face of FACES) if (this.faces[face]) held += 1;
    return held;
  }

  /**
   * Correct one sticker of an already-captured side, and re-check the cube. The detector is good,
   * not perfect — held-out colour accuracy is ~90%, and orange and white are its weak classes —
   * so a scan can fail on a single misread sticker that a person can see at a glance.
   *
   * Only a side already READ can be corrected — there is nothing to overrule otherwise. `index` is
   * into the capture as shown, which is what a host displays, so a click maps straight through.
   * The centre is not correctable: a face's centre colour is its identity, and changing one would
   * rename the face rather than fix it.
   *
   * Any confirmations already gathered are dropped, because they were answers about a reading
   * that no longer exists.
   */
  setSticker(face: Face, index: number, colour: number): void {
    if (!Number.isInteger(index) || index < 0 || index > 8 || index === 4) return;
    if (!Number.isInteger(colour) || colour < 0 || colour >= FACES.length) return;
    // `face` is a SLOT in every mode — the colour of the side being touched, never a position.
    // A host draws its tiles by position and knows the arrangement it is drawing them in, so it
    // is the host that maps the Down tile of a Japanese cube to the blue capture. The panel took
    // a position while painting and a slot otherwise, which put the same asymmetry into every
    // call site; one vocabulary at the boundary is what stops that (2026-09-07).
    // Outside painting, only a side the camera has actually read can be corrected. Hand-building
    // one the scanner never saw is a different act with a different failure mode — nine guesses
    // instead of one correction — and it would let a stray tap turn an unscanned tile into a face
    // the camera then refuses to read. Correcting a reading is the job; supplying one is not.
    // Painting is where supplying one IS the job, so there the side is created on first touch,
    // starting from its own centre colour.
    let read = this.faces[face];
    if (read === undefined) {
      if (!this.painting) return;
      read = {
        colors: Array<number>(9).fill(colourOfSlot(face)),
        confidence: Array<number>(9).fill(1),
      };
      this.faces[face] = read;
      // Painted in place: the user authored it into the canonical net, so its rotation is known
      // by construction — which is what makes editing it by index meaningful at all.
      this.settled.add(face);
      this.buildDots();
    } else if (read.colors[index] === colour) {
      return;
    }
    read.colors[index] = colour;
    read.confidence[index] = 1; // a person looked at it, which beats the detector's guess
    // ...and so must every fallback in `assembleColors`, or they quietly undo it. `locked` is the
    // guarantee: neither the count repair nor the paint path may return a colouring that changes
    // this sticker, whatever cost ceiling it runs under. The one-hot row is guidance on top of that
    // -- the count repair reads `scores`, not `colors`, and a stale row would have it spend its
    // search trying to move this sticker back, find the lock, and refuse a cube it could otherwise
    // have repaired around the correction.
    read.locked ??= Array<boolean>(9).fill(false);
    read.locked[index] = true;
    const row = read.scores?.[index];
    if (read.scores && row) read.scores[index] = row.map((_, c) => (c === colour ? 1 : 0));
    // Whatever was settled is being re-decided — the same sentence `scheduleCheck` says on the
    // camera path, and the same reason. Painting had no equivalent, so editing an ACCEPTED cube
    // into an invalid one emitted 'scan-invalid' while still reporting complete: true, and the
    // host's Solve button stayed lit over a cube the panel had just refused.
    this.invalidateReading();
    const done = this.capturedFaces().length;
    if (this.painting) {
      this.afterPaintStroke(
        `Painted the ${GUIDE[face].color} side — ${done}/${FACES.length} sides.`,
        done,
      );
      return;
    }
    // BELOW SIX, and not otherwise: `invalidateReading` above has just cancelled any check in its
    // 350 ms beat, whose `scheduleCheck` had already stopped the loop. Reporting "show another
    // side" and returning with six in hand left no loop running and no check coming: a tap on a
    // done tile during that beat was a dead scan until Start
    // (`dev-docs/scanner-audit-2026-09-20.md` §2.3).
    if (this.sidesHeld() < FACES.length) {
      this.report('scanning', `Corrected the ${GUIDE[face].color} side. Show another side…`);
      return;
    }
    this.scheduleCheck(this.tinted('ok', 'Corrected — checking…'));
  }

  /**
   * A stroke landed while the user is authoring the cube: check it, and act only on a
   * finished one.
   *
   * Half of setSticker was this branch, and it shares nothing with the correction path
   * below it but the bookkeeping above them both. A half-painted cube is invalid BY
   * DEFINITION, so reporting each stroke as a failure would be noise rather than news —
   * and once all six sides are there, silence stops being kindness.
   */
  private afterPaintStroke(line: string, done: number): void {
    // Every stroke is checked, and only a finished cube is acted on. Half-painted states are
    // invalid by definition, so reporting each one as a failure would be noise, not news — but
    // once all six sides ARE painted, silence stops being kindness: say what still blocks it.
    if (done === FACES.length) {
      // `diagnose: false` for the same reason the camera path passes it: the decode is seconds on
      // a badly-painted cube, and here it lands between a tap and the tile turning colour.
      // Over POSITIONS: a painting's centres are authored in place, so the record the validator
      // reads is keyed by where each side sits — and everything it names comes back as slots.
      const result = this.fromPositions(
        assemblePainted(this.positionFaces(), undefined, { diagnose: false }),
      );
      if (result.valid) {
        // Authored by hand, and said so: a host must not repair a smart cube's tracking from a
        // cube nobody looked at (`dev-docs/scanner-audit-2026-09-20.md` §2.5).
        this.finish(result, 'painted');
        return;
      }
      this.diagnose(result, (r, first) => {
        this.publishPaintRefusal(r);
        // The stroke's own line is written once, by the caller below. A refinement replaces the
        // notice and nothing else, so it re-reports rather than duplicating that sentence.
        if (!first) this.report('painting', line);
      });
    }
    this.report('painting', line);
  }

  /** A refused painting, said out loud. Called again for each diagnosis that lands for it. */
  private publishPaintRefusal(result: AiScanResult): void {
    // Same classification, same proven wording, same public event as the camera path — the
    // only difference is how you get out of it, which here is tapping rather than re-showing.
    // Painting used to build its own notice and emit nothing, so `scan-invalid` fired for a
    // refused SCAN and not for a refused PAINTING: a public event that depended on which mode
    // the user happened to be in.
    this.suspects = result.suspects ?? [];
    this.dispatchEvent(new CustomEvent<AiScanResult>('scan-invalid', { detail: result }));
    this.notice = this.misreadNotice(result, {
      one: 'If it is wrong, tap it and pick the colour you see.',
      many: 'Check those sides against the cube in your hand and repaint what does not match.',
    }) ?? {
      title: 'Not solvable yet',
      tone: 'info',
      body: `${result.reason ?? 'Not a legal cube yet'} — check the sides against your cube.`,
    };
  }

  /**
   * Turn hand-painting on or off. The two are exclusive by nature, not by policy: painting means
   * the user is authoring the cube, and a camera that kept reading would overwrite what they typed
   * in. So turning it on releases the camera, and turning it off opens it again from scratch.
   */
  setPainting(on: boolean): void {
    if (on === this.painting) return;
    this.painting = on;
    this.notice = null; // whichever mode's guidance was pinned, the mode it spoke to is over
    this.suspects = [];
    this.dropDiagnosis();
    if (on) {
      const dropped = this.dropUnsettledCaptures();
      this.stop(); // stop() clears the device, so a host stops showing a live lens
      if (dropped.length > 0) {
        this.notice = {
          title: 'Those sides need painting too',
          tone: 'info',
          body: 'The camera cannot see which way up a side was held, so a side it had not finished checking cannot be edited sticker by sticker. %1 was cleared — paint it the way it sits on your cube.',
          params: [dropped.map((f) => GUIDE[f].color).join(', ')],
        };
      }
      this.report('painting', PAINTING);
      return;
    }
    void this.start();
  }

  /**
   * Declare which colour a PAINTED cube has under white — the paint board's centre swap.
   *
   * A painting is authored by position, so its centres ARE its scheme: the Down tile's centre is
   * yellow on a Western painting and blue on a Japanese one, and swapping the pair is the one
   * thing a painter can say about it that the tiles cannot. Everything painted stays with its
   * COLOUR — the stickers painted around the blue centre are still around the blue centre, which
   * has simply moved from the back to the bottom — and the reading is re-decided from there,
   * because a cube is legal or not under the arrangement it actually has. Only meaningful while
   * painting: a camera reading's scheme is the scan's to decide, never a caller's (ADR 0001).
   */
  setPaintScheme(scheme: Scheme): void {
    if (!this.painting || !SCHEMES.includes(scheme) || this.scheme === scheme) return;
    this.scheme = scheme;
    this.invalidateReading();
    const under = GUIDE[slotOf(colourOf('D', scheme))].color;
    const line = `Centres swapped — ${under} is under WHITE now.`;
    const done = this.capturedFaces().length;
    if (done === FACES.length) {
      // Re-decided under the arrangement just declared, exactly as a stroke would be.
      this.afterPaintStroke(line, done);
      return;
    }
    this.report('painting', `${line} ${PAINTING}`);
  }

  /**
   * Entering painting: forget every capture whose rotation is still unknown, and say which.
   *
   * THE MODE BOUNDARY, stated rather than implied. Painting edits stickers BY INDEX, and
   * `finishAccepted` already spells out why that needs a settled rotation: "a click on sticker i
   * must mean index i of what is stored — without this, correcting a side captured 90° off edited
   * the wrong sticker and turned a good scan invalid." An unsettled camera capture is exactly that
   * side. Carrying it into painting broke two things at once: the tiles a user taps did not match
   * the cube in their hand, and `assemblePainted` — which searches no rotations, by design —
   * judged a 90°-off capture as authored-in-place and reported an INVENTED count. Measured: a
   * correct cube with one side captured a quarter turn off came back as "At least 5 stickers were
   * misread", about a cube with nothing wrong with it.
   *
   * Only the UNSETTLED ones go. A finished scan settles all six into canonical rotation, so the
   * common path — scan, then hand-fix one sticker — loses nothing at all.
   */
  private dropUnsettledCaptures(): Face[] {
    const dropped = FACES.filter((f) => this.faces[f] && !this.settled.has(f));
    // Let go THROUGH `forgetCapture` (2026-09-21), never by clearing a list: several removal paths
    // each wrote a subset of what a capture is recorded in by hand, and a capture nothing held any
    // more went on counting towards progress until the scan was restarted.
    if (dropped.length === 0) return dropped;
    for (const f of dropped) this.forgetCapture(this.faces[f]!);
    // Every confirmation answered a question about a reading that no longer exists.
    this.confirmed = {};
    this.awaiting = null;
    this.mismatches = 0;
    this.finished = false;
    this.buildDots();
    return dropped;
  }

  /**
   * Forget one side's reading so the camera can read it again — the sensible thing for a centre
   * sticker to do, since a centre cannot be colour-corrected without renaming the face.
   *
   * Every confirmation gathered so far answered a question about a reading that included this
   * side, so they go too. The capture loop is restarted, because it stops once six sides are in
   * and dropping one means there is something to look for again.
   */
  rescanFace(face: Face): void {
    const held = this.faces[face];
    if (!held) return;
    this.captureEpoch += 1;
    this.forgetCapture(held);
    this.invalidateReading();
    this.buildDots();
    // EVERY side handed back since the loop last ran is named, not only this one (2026-09-20). A
    // host hands back several in a row — the sides a smart cube's report left behind — and with
    // the camera dark each call's words replaced the last's in `pendingOpening`, so the reopen
    // said "Show the ORANGE side again" about three sides (`dev-docs/scanner-audit-2026-09-20.md`
    // §2.14). `loop()` clears the list once the words have actually been said.
    if (!this.rescanQueue.includes(face)) this.rescanQueue.push(face);
    const names = this.rescanQueue.map((f) => GUIDE[f].color);
    const which =
      names.length === 1
        ? `the ${names[0]} side`
        : `the ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} sides`;
    // loop() reopens the camera itself when it is dark, keeping the other sides.
    this.loop(
      'scanning',
      `Show ${which} again — ${names.length === 1 ? 'it' : 'they'} will be read fresh.`,
    );
  }

  /**
   * The selectable cameras. Labels are only filled in once camera permission has been granted,
   * so a host gets named entries by calling this after the first successful start().
   */
  async cameras(): Promise<CameraDevice[]> {
    return (await this.ensureDetector()).cameras();
  }

  /**
   * Throw the whole scan away and scan afresh — the ONLY thing that clears captured sides.
   * Public for host UIs; with the camera dark it is also the way back on, so a host needs just
   * this one call behind its restart control.
   */
  restart(): void {
    this.reset();
    if (this.painting) {
      this.report('painting', PAINTING);
      return;
    }
    this.loop('scanning'); // reopens the camera itself when it is dark
  }

  /** Where the read under way stands, for `ScanProgress.settling`. */
  private settling(): ScanSettling | null {
    const { run, heldMs } = this.still.status();
    return run === 0
      ? null
      : { run, needed: STABLE, heldMs: Math.round(heldMs), neededMs: STABLE_MS };
  }

  /**
   * One accepted capture: the stage's pulse, and the `scan-capture` event a headless host hears.
   *
   * The event goes out once the capture path has FINISHED — its report written, its check
   * scheduled — as a snapshot taken now. Dispatched in the middle of that path, a listener that
   * restarted the scan, stopped it or switched to painting had its change overwritten when the path
   * carried on over the state it had just cleared (audit, 2026-09-19). And it is not sent at all
   * if the scan changed under it in between — a listener to the path's own report can restart the
   * scan, stop it, switch to painting or take a side back, and "a side was saved" over any of those
   * is a chime and a "got it" for a moment that is gone (audit, 2026-09-19, round 3).
   */
  private captured(kind: ScanCapture['kind'], face: Face): void {
    // The read that made this capture is spent, on EVERY path: the confirm and re-read paths did not
    // reset it, so the reports after them carried a finished read's progress (audit, 2026-09-19).
    this.still.reset();
    // And the flicker history goes WITH the side (D8). It survives an ordinary reset now — a side
    // that will not settle abstains constantly, and wiping it there meant the one specific thing
    // the scan can say was never reached — but the next side is a new subject with no frame in
    // between for `classify` to notice the change on, so naming a sticker of the side just filed
    // would be describing a cube that is no longer in front of the camera.
    this.still.forgetFlicker();
    this.flash();
    const detail: ScanCapture = { kind, face, sides: this.sidesHeld() };
    const epoch = this.captureEpoch;
    queueMicrotask(() => {
      if (epoch === this.captureEpoch) {
        this.dispatchEvent(new CustomEvent<ScanCapture>('scan-capture', { detail }));
      }
    });
  }

  /**
   * Forget what the camera last showed: the read under way, the live face, and the boxes. ONE place,
   * because it was written out by hand at every site that stops watching, and when `seen` was added
   * it reached some of them — `stop()` then reported a painting with the last frame's boxes still in
   * it, and a check with a finished read's progress (found by audit, 2026-09-19).
   */
  private forgetObservation(): void {
    this.still.reset();
    this.showPreview(null);
    this.seen = null;
  }

  /**
   * A tick that showed nothing — no frame, or an inference that failed: forget the observation, and
   * if something was on show (boxes, a live face, a read under way) say so with one report carrying
   * the waiting line. A headless host otherwise kept drawing the last frame until a later report or
   * the fatal limit; and republishing the last line kept "Reading a side" standing over nothing
   * (audit, 2026-09-19). A tick over nothing says nothing, as before.
   */
  private withdrawObservation(): void {
    const showing = this.seen !== null || this.live !== null || this.still.status().run > 0;
    this.forgetObservation();
    if (showing) this.report(this.awaiting ? 'confirm' : 'scanning', this.idleLine());
  }

  /** Brief green border pulse on the stage to confirm a capture. */
  private flash(): void {
    const stage = this.root.querySelector('.stage');
    if (!(stage instanceof HTMLElement)) return;
    stage.classList.remove('flash');
    void stage.offsetWidth; // force reflow so the animation restarts on rapid captures
    stage.classList.add('flash');
  }

  /** "Show the GREEN side again, with WHITE facing up." — the whole instruction, as nodes. */
  private confirmWords(req: ConfirmRequest): (string | Node)[] {
    return [
      'Show the ',
      this.bold(GUIDE[req.face].color),
      ' side again, with ',
      this.bold(GUIDE[req.up].color),
      ' facing up.',
    ];
  }

  /** The same instruction as a plain sentence, for the pinned notice. */
  private confirmSentence(req: ConfirmRequest): string {
    return `Show the ${GUIDE[req.face].color} side again, with ${GUIDE[req.up].color} facing up.`;
  }

  /**
   * What an ambiguous scan IS, said before the look that settles it.
   *
   * The sentence this replaced — "Several readings of this cube fit what the camera saw, and six
   * photos cannot tell them apart" — was read as a failed scan by a user whose every colour was
   * correct (2026-09-06). It said neither that the colours were right nor what was undetermined,
   * and the cube drawn beside it looked right because it IS the six sides as they were held. So
   * this says all of it: the colours are read; how many cubes fit them; which sides could have
   * been held more than one way up (the assembler names them); and that the picture shows the
   * sides as held, not which reading is the cube. The ask follows as its own sentence.
   */
  private ambiguitySentence(result: AiScanResult): string {
    const n = result.readings ?? 0;
    const count = n >= 2 ? (COUNT_WORDS[n] ?? String(n)) : '';
    const ways = count ? `${count} ways` : 'more than one way';
    const sides = (result.undetermined ?? []).map((f) => GUIDE[f].color);
    const held =
      sides.length === 0
        ? ''
        : sides.length === 1
          ? ` — the ${sides[0]} side could have been held more than one way up —`
          : ` — the ${sides.slice(0, -1).join(', ')} and ${sides[sides.length - 1]} sides could each have been held more than one way up —`;
    return `Every side's colours are read. This cube fits them ${ways}${held} and the picture shows the sides as they were held, not which of the ${count || 'readings'} it is.`;
  }

  /**
   * What to say about a sticker that keeps breaking the read on its own: WHICH sticker, and — when it
   * has only ever shown two colours — which two. That much is measured. The light remark is added only
   * for a pair the light is known to confuse, because that is the only cause with evidence behind it:
   * red against orange is ambiguous under warm light (`dev-docs/red-orange-fine-tune.md`), and orange
   * read as yellow followed the light, not the pipeline or the sticker size (AGENTS.md, 0.6.1). It
   * says "helps", never "will settle it": the capture rule promises nothing about the next read.
   */
  private flickerLine(position: number): string {
    const cell = CELL_NAMES[position] ?? 'marked';
    const pair = this.still.flickerColours(position);
    if (pair.length !== 2) return `Reading a side — the ${cell} sticker keeps changing colour.`;
    const [a, b] = pair.map((c) => GUIDE[FACES[c]!]!.color);
    const light = LIGHT_CONFUSED.has(pair.join(','))
      ? ' Whiter light on it helps tell them apart.'
      : '';
    return `Reading a side — the ${cell} sticker keeps changing between ${a} and ${b}.${light}`;
  }

  /**
   * The waiting-for-input line, matched to where the scan actually is. One generic "show any
   * side" for every state was how a finished scan kept being nagged for sides, and how the ask
   * for one SPECIFIC side got contradicted the moment the cube left the frame.
   */
  /**
   * Whether this scan has been looking at a cube and capturing nothing for longer than the bound.
   *
   * False while a confirm is pending or the scan is finished: neither is a stall, and interrupting
   * a confirm with "this side is not being read" would be about the wrong side entirely.
   */
  private stuck(now: number = performance.now()): boolean {
    if (this.awaiting || this.finished) return false;
    // SOMETHING HAS TO BE THERE. An empty frame is not a stall, it is an empty frame.
    if (now - this.lastSightingAt > AiScanPanel.SIGHTING_FRESH_MS) return false;
    return now - this.lastProgressAt >= AiScanPanel.STUCK_AFTER_MS;
  }

  /**
   * What to say when nothing has been captured for the bound.
   *
   * IT NAMES ONLY WHAT WAS MEASURED, which is that this scan has read no side — not a tilt, not a
   * shake, not the light, none of which anything here observes (`apps/web/test/scan-sentences.test.mjs`
   * refuses those words by name). And it offers the one thing that always works, because on the cube
   * this was written for the detector finds two or three of nine stickers and no threshold recovers
   * the rest: the person can set the colours themselves.
   */
  private stuckLine(): string {
    const painted = this.capturedFaces().length;
    return painted === 0
      ? "This cube isn't being read. You can paint it by hand instead."
      : "This side isn't being read. Show another side, or paint this one by hand.";
  }

  private idleLine(): string {
    // THE BOUND, ahead of every other idle wording: a scan that has captured nothing for
    // `STUCK_AFTER_MS` has something to say, and "Show any side to the camera" is not it.
    if (this.stuck()) return this.stuckLine();
    if (this.awaiting) {
      return `Looking for the ${GUIDE[this.awaiting.face].color} side — hold it with ${GUIDE[this.awaiting.up].color} up.`;
    }
    if (this.finished) return 'Scan finished — start the scan over to read a different cube.';
    if (this.capturedFaces().length >= FACES.length) return RE_READ_LINE;
    return 'Show any side to the camera.';
  }

  /** "YELLOW and BLUE" — the sides still to show, named once there are few enough to name. */
  private missingSides(): string | null {
    const missing = FACES.filter((f) => !this.faces[f]);
    if (missing.length === 0 || missing.length > 2) return null;
    return missing.map((f) => GUIDE[f].color).join(' and ');
  }

  /**
   * The scheme the HOST assumes, from the `scheme` attribute — its Cube colours setting. Western
   * when unset or unreadable: the default every cube had before there was a setting, and the
   * assumption the model's class order encodes. Read on demand rather than observed, because it
   * matters only at the moments a position is needed and nothing is drawn from it in between.
   */
  private hostScheme(): Scheme {
    const attr = this.getAttribute('scheme');
    return SCHEMES.find((s) => s === attr) ?? 'western';
  }

  /**
   * The scheme positions are taken under when this panel has to lay its slots out as positions:
   * the verdict's, when a verdict decided one, else the host's assumption. Two places need a
   * position at all — a painted cube, whose centres are authored by position, and a settled scan
   * re-checked in place — and both are cubes the scan has already placed or the host has already
   * assumed; nothing else in the panel ever names a position.
   */
  private workingScheme(): Scheme {
    return this.scheme === 'western' || this.scheme === 'japanese'
      ? this.scheme
      : this.hostScheme();
  }

  /** The captures by POSITION under the working scheme — the record `assemblePainted` and an
   *  in-place decode read, whose keys mean where a side sits rather than what colour it is. */
  private positionFaces(): Record<Face, ColorFace> {
    const scheme = this.workingScheme();
    const out = {} as Record<Face, ColorFace>;
    for (const slot of FACES) {
      const read = this.faces[slot];
      if (read) out[positionOf(colourOfSlot(slot), scheme)] = read;
    }
    return out;
  }

  /** The tile the host names for a position, as the SLOT its capture lives in. */
  private slotAt(position: Face): Face {
    return slotOf(colourOf(position, this.workingScheme()));
  }

  /**
   * A result that was computed over POSITIONS (the painted path, an in-place decode), with every
   * coordinate it names moved back into slots — the only coordinates a host ever receives.
   */
  private fromPositions<T extends { suspects?: StickerSuspect[]; misreadFace?: Face }>(r: T): T {
    return {
      ...r,
      ...(r.suspects
        ? { suspects: r.suspects.map((s) => ({ ...s, face: this.slotAt(s.face) })) }
        : {}),
      ...(r.misreadFace ? { misreadFace: this.slotAt(r.misreadFace) } : {}),
    };
  }

  /**
   * The reading's rotations are already known — painted in place, or settled by an accepted scan.
   *
   * Read in ONE place because two things now depend on it and they must not disagree: which
   * validator runs (`assemblePainted`, no rotation search), and how the deferred misread decode is
   * asked the same question. A decode allowed to rotate a face back reports "0 misreads" about a
   * cube the validator has just refused — measured on nine scrambles with one side turned 90°.
   */
  private inPlace(): boolean {
    return this.capturedFaces().length === FACES.length && FACES.every((f) => this.settled.has(f));
  }

  /** Read the six faces (plus any confirmations) into a cube, and act on what comes back. */
  private assemble(): void {
    // A CUBE WHOSE ROTATIONS ARE ALREADY KNOWN IS NOT A ROTATION PROBLEM.
    //
    // Once a scan has been accepted, `finishAccepted` turns every capture into canonical rotation
    // and records it. A tap that re-opens the verdict was nevertheless re-running the full 4^6
    // search, which is free to find a SECOND legal reading of the same stickers — so correcting
    // one sticker on a finished near-solved cube dropped every confirmation the user had already
    // answered and asked to be shown a side again, for an orientation nobody had lost. Pinning is
    // what `assemblePainted` is: same validation, same diagnosis, no rotation search.
    if (this.inPlace()) {
      // WITHOUT A SCHEME, deliberately (2026-09-07, found by audit). `assemblePainted` reads the
      // scheme off the centres it is handed — and on this path those centres were laid out BY
      // `positionFaces()`, under the scheme this panel is already assuming, so the answer is that
      // assumption handed back. Adopting it would turn a host's setting into a verdict the scan
      // never reached: accept a solved cube as `undetermined`, tap one sticker and tap it back,
      // and the cube would come back "proven Western". A correction re-decides stickers, not the
      // arrangement, so `finishAccepted` keeps whatever the last real verdict established.
      const { scheme: _assumed, ...checked } = this.fromPositions(
        assemblePainted(this.positionFaces(), undefined, { diagnose: false }),
      );
      // A CORRECTION, and said so (2026-09-20): a host with a smart cube connected compared this
      // verdict against the tracking the previous verdict installed — the very reading the tap
      // corrects — and refused it (`dev-docs/scanner-audit-2026-09-20.md` §1.3).
      this.finish(checked, 'correction');
      return;
    }
    // A `reread` means a confirmation disagreed with its first capture about colours: adopt the
    // fresh, deliberately-held look as that side's reading and check again. Each adoption pins its
    // side at distance 0, so this settles within six rounds; the cap is a backstop, not a path.
    this.assembleNamed();
  }

  /**
   * The assembly for a scan whose six sides are all named — the tail of `assemble`, lifted out when
   * the centre resolution moved off the page's thread (D3). Unchanged but for its name.
   *
   * A `reread` means a confirmation disagreed with its first capture about colours: adopt the
   * fresh, deliberately-held look as that side's reading and check again. Each adoption pins its
   * side at distance 0, so this settles within six rounds; the cap is a backstop, not a path.
   */
  private assembleNamed(): void {
    let result: AiScanResult;
    for (let round = 0; ; round++) {
      try {
        // `diagnose: false` — the assembly answers now and the misread decode arrives later, off
        // this thread. Only the refusal branch is affected; every accepted scan is untouched.
        result = assembleColors(this.faces, undefined, this.confirmed, { diagnose: false });
      } catch (err) {
        this.checkFailed(err);
        return;
      }
      const face = result.reread;
      // THE LOOK THE ASSEMBLER NAMED (`rereadLook`, 2026-09-21), never "the latest". With two looks
      // at one side the disagreeing one can be the EARLIER: adopting the last then changed nothing,
      // the earlier look went on disagreeing with it, and six rounds of that refused the scan with
      // a "checking again" that never checked. Older assemblers name no look; then it is the last.
      const looks = face === undefined ? undefined : this.confirmed[face];
      const named = looks?.[result.rereadLook ?? (looks?.length ?? 0) - 1];
      const fresh = named?.capture;
      if (
        face === undefined ||
        named === undefined ||
        fresh === undefined ||
        round >= FACES.length
      ) {
        this.finish(result, 'camera');
        return;
      }
      this.faces[face] = fresh;
      // The adopted look stays on record — it is now the reading, and against itself it pins the
      // side's rotation, which is what makes every adoption settle the side within the six rounds.
      // Every OTHER look at that side is kept only if it could still be a rotation measurement of
      // this reading (the assembler's own tolerance rule): one that could not would be named next
      // round, adopted in turn, and un-adopt this one — for as many rounds as the cap allows.
      this.confirmed[face] = looks!.filter(
        (look) => look === named || matchingRotations(fresh, look.capture).size > 0,
      );
    }
  }

  /**
   * Let go of one capture and of the settle recorded for it.
   *
   * Several removal paths each wrote a subset of this by hand, and a capture nothing held any more
   * went on being counted until the scan was restarted (2026-09-21).
   */
  private forgetCapture(capture: ColorFace): void {
    for (const f of FACES) {
      if (this.faces[f] === capture) {
        delete (this.faces as Partial<Record<Face, ColorFace>>)[f];
        this.settled.delete(f);
      }
    }
  }

  /**
   * A check threw. Six well-formed faces should never throw — but if they do, never freeze on
   * "checking…" and never destroy the captures over it: say so and keep scanning. Shared by both
   * ways a check runs, so the two cannot come to say different things about the same failure.
   */
  private checkFailed(err: unknown): void {
    const why = String((err as Error)?.message ?? err);
    this.notice = {
      title: 'Something went wrong',
      tone: 'err',
      body: `Couldn't check the scan (${why}). Show a side again to retry, or start the scan over.`,
    };
    this.loop('scanning', this.tinted('err', 'Couldn’t check the scan — see the note.'));
  }

  /**
   * Turn a refused reading into words. ONE implementation, for the camera and for painting.
   *
   * There were two. Painting grew its own copy the day it learned to diagnose, and within a single
   * commit the copies had already disagreed about the mathematics: the camera says "there is no
   * single sticker to point at", which is what is proven, while the painting copy said "more than
   * one wrong sticker has more than one possible repair", which is NOT — the guarantee is that
   * above distance one the nearest legal cube need not be the USER'S cube, and a given input may
   * still have a unique nearest repair. Overclaiming is the failure this project treats most
   * seriously, and duplication is how it got in.
   *
   * What genuinely differs between the modes is only how you RECOVER — show the side again, or tap
   * the sticker — so that is what the caller supplies. Classification, tone, and the proven wording
   * live here. `params` starts with the count so the sentence keeps its %1 and a catalog can
   * translate it before substitution; extra params follow as %2 onward.
   */
  private misreadNotice(
    result: AiScanResult,
    recovery: {
      one: string;
      many: string;
      /** The count sentence for `many`, when the caller can say more than the default. */
      lead?: string;
      params?: (string | number)[];
      action?: ScanNotice['action'];
    },
  ): ScanNotice | null {
    const misread = result.misreadCount ?? 0;
    // The decode is still running (see AssembleOptions.diagnose). Say that, and say nothing about
    // the cube: `null` is not zero, and it is not "the decoder could not tell" either — that one
    // falls through to a caller's own sentence about damage too wide to place. No placeholders, so
    // this sentence cannot pick up a count that does not exist yet.
    if (result.misreadCount === null) {
      return {
        title: 'Not a solvable cube',
        tone: 'err',
        body: 'Working out how many stickers are wrong — that takes a moment on a badly-read cube.',
      };
    }
    if (this.suspects.length > 0) {
      // The ONE claim that is provable here is the one this sentence makes: changing the marked
      // sticker turns the reading into a legal cube. That is what the decoder measured.
      //
      // It is NOT a proof that the marked sticker was misread, and the copy used to say it was.
      // `distance === 1` is a property of the READING, not of the cube: two legal cubes stand
      // three stickers apart, so a reading that takes TWO of those three from a cube you never
      // held sits one sticker from that cube and two from yours. The decoder then names the third
      // position — which you read correctly — uniquely and with nothing to contradict it.
      // Measured, not hypothesised: `ai-assemble.test.ts` pins one such pair of cubes and the
      // reading between them. Nothing in the reading distinguishes the two cases, so the honest
      // move is to hand the question to the only source of truth in the room, which is the cube
      // in the user's hand.
      return {
        title: 'Check the marked sticker',
        tone: 'err',
        body: `Changing it would make this a solvable cube. Check it against your cube first — when more than one sticker is misread, the marked one can be a sticker that was read correctly. ${recovery.one}`,
      };
    }
    if (misread > 1) {
      return {
        title: 'Some stickers were misread',
        tone: 'err',
        body: `${recovery.lead ?? 'At least %1 stickers were misread, so there is no single sticker to point at.'} ${recovery.many}`,
        params: [misread, ...(recovery.params ?? [])],
        ...(recovery.action ? { action: recovery.action } : {}),
      };
    }
    if (misread === 1) {
      // One change's worth of damage, and still nothing to point at. The decoder found a repair
      // but could not say WHERE in the coordinates the user taps: the rotation search names a
      // different as-shown index under each quarter turn of a face whose reading is symmetric, and
      // only one of them repairs the reading as shown — which one is not recoverable from what the
      // caller receives. So the sentence talks about the reading, not about the stickers; an
      // earlier draft said several stickers "would each fix" it, which the pinned counterexample
      // in misread-decode.test.ts disproves. The older copy fell through to "too much of the cube
      // was read wrong to say where", which overstates damage the code has measured as small.
      //
      // Same placeholder numbering as the branch above on purpose: %1 is the count and %2 onward
      // is the caller's, so one catalog entry per sentence and no branch-specific indexing.
      return {
        title: 'A sticker looks wrong',
        tone: 'err',
        body: `At least %1 sticker was misread, and the reading does not pin down which one. ${recovery.many}`,
        params: [misread, ...(recovery.params ?? [])],
      };
    }
    return null;
  }

  /**
   * Route an assembled verdict to the one branch that handles it.
   *
   * This was 124 lines holding three unrelated jobs: settling an accepted scan, asking for a
   * side, and explaining a refusal. Nothing was shared between them but the argument, so the
   * length was the only thing making them look related — and a reader chasing one branch had
   * to step over the other two to be sure they were not reached.
   */
  private finish(result: AiScanResult, origin: ScanOrigin): void {
    this.stopLoop();
    this.forgetObservation();
    this.suspects = result.suspects ?? [];
    if (result.valid) {
      if ((result.lowConfidence?.length ?? 0) === 0) {
        this.finishAccepted(result, origin);
        return;
      }
      // Solvable, but read too faintly to trust. It used to fall through to the refusal path,
      // which dispatches `scan-invalid` — carrying a detail whose own `valid` field says true. A
      // host acting on the event name and a host acting on the payload would then disagree about
      // the same cube, which is a state no host can handle correctly because it is not a state.
      //
      // Unreachable today, and kept impossible rather than merely unlikely: `fitFace` builds no
      // face out of a sticker below MIN_STICKER_CONFIDENCE (0.25) and `assembleColors` calls one
      // faint below LOW_CONFIDENCE_THRESHOLD (0.15), so the camera cannot produce one and a
      // painted sticker is confidence 1. `onnx-postprocess.test.ts` pins that ordering. If the two
      // numbers ever cross, this says something true instead of emitting a contradiction.
      this.finishUnsure();
      return;
    }
    if (result.confirm && result.reread === undefined) {
      this.finishConfirming(result, result.confirm);
      return;
    }
    this.finishRefused(result);
  }

  /** Solvable but too faint to trust: no public verdict, a pinned explanation, keep scanning. */
  private finishUnsure(): void {
    this.notice = {
      title: 'Some stickers were unclear',
      tone: 'err',
      body: 'The cube reads as solvable, but some stickers were too faint to trust. Show those sides again, or tap stickers to confirm them.',
    };
    this.loop('scanning', this.tinted('err', 'Some stickers were too faint to trust.'));
  }

  /** Accepted: settle the captures into canonical rotation, release the camera, announce it. */
  private finishAccepted(result: AiScanResult, origin: ScanOrigin): void {
    // WHAT WAS ACCEPTED IS WHAT IS KEPT (2026-09-20). A repair-assembled scan — the count or the
    // pixel path recolouring a sticker to reach a legal cube — accepted a colouring the captures
    // here did not hold, so the settle below rotated the misread colours and the first correction
    // tap re-checked them in place and refused the cube the host had just painted from `facelets`
    // (`dev-docs/scanner-audit-2026-09-20.md` §1.4). The assembler now hands back the captures the
    // reading was built from, and they are adopted before anything is rotated. What a person
    // locked survives: a repair never moves a locked sticker, and the copy carries `locked`.
    const accepted = result.captures;
    if (accepted) {
      for (const f of FACES) {
        const next = accepted[f];
        if (next) this.faces[f] = next;
      }
    }
    // Settle the captures into canonical rotation. The host repaints its tiles from the
    // validated string after the settle, so from here on a click on sticker i must mean index i
    // of what is stored — without this, correcting a side captured 90° off edited the wrong
    // sticker and turned a good scan invalid.
    const rots = result.rotations;
    if (rots) {
      FACES.forEach((f, fi) => {
        const read = this.faces[f];
        const k = rots[fi] ?? 0;
        if (read && k !== 0) {
          // Everything the capture carries is per-sticker and rotates together. Dropping `scores`,
          // `lab` or `locked` here left the fallbacks with nothing to work on -- or nothing to
          // respect -- the next time this cube was checked, after a sticker correction, say; and
          // only for the sides that happened to need rotating, which is the worst kind of
          // difference: one that depends on how the cube was held.
          this.faces[f] = {
            ...read,
            colors: rotateFace(read.colors, k),
            confidence: rotateFace(read.confidence, k),
            ...(read.scores ? { scores: rotateFace(read.scores, k) } : {}),
            ...(read.lab ? { lab: rotateFace(read.lab, k) } : {}),
            ...(read.locked ? { locked: rotateFace(read.locked, k) } : {}),
          };
        }
      });
    }
    this.confirmed = {};
    this.awaiting = null;
    this.mismatches = 0;
    this.finished = true;
    // Every side is now in canonical rotation — that is what the settle above just did — so from
    // here a tap means the sticker it shows, and a re-check needs no rotation search at all.
    for (const f of FACES) this.settled.add(f);
    // What the verdict established about the cube's colours, kept for the host and for every
    // in-place re-check of this same cube. `'undetermined'` is a verdict too: the state is known
    // and the scheme is not, and a host must be told that rather than left with the last belief.
    //
    // An ABSENT scheme leaves the last verdict standing rather than clearing it: only a result
    // that actually searched the schemes carries one, and the in-place re-check deliberately does
    // not (see `assemble`). Every fresh camera scan and every painting carries one, so this is
    // not a way for a verdict to go missing — it is how a correction stops being one.
    if (result.scheme !== undefined) this.scheme = result.scheme;
    this.notice = null;
    // Release the camera BEFORE reporting, so the 'done' report carries device: null and a host
    // that stays on the scan screen stops showing a live lens over a finished scan.
    this.stop();
    this.report('done', this.tinted('ok', 'Scan complete — solvable cube captured.'));
    // The captures ride along only inside this element; a host draws from `facelets`.
    const { captures: _kept, ...detail } = result;
    this.dispatchEvent(
      new CustomEvent<ScanCompleteDetail>('scan-complete', { detail: { ...detail, origin } }),
    );
  }

  /**
   * One reading is not enough: name a side to show again, and how to hold it.
   *
   * `confirm` is a parameter rather than read off `result` because the caller has already
   * established it is there. Inside the old single method a type guard did that silently; making
   * it an argument states the precondition where a reader looks for it, and the compiler keeps it.
   */
  private finishConfirming(result: AiScanResult, confirm: ConfirmRequest): void {
    if (result.mismatch) {
      // The looks genuinely contradict each other about the HOLD (colour disagreements were
      // already resolved as rereads), and which look lied is not knowable — so drop them all
      // and ask again. The captures stay: they were never the problem. Past the first
      // contradiction the notice also names the way out a user may prefer.
      this.confirmed = {};
      this.mismatches++;
      this.awaiting = confirm;
      this.notice = {
        title: 'Those looks disagree',
        tone: 'err',
        body: `One of them was held a different way up. ${this.confirmSentence(confirm)}${
          this.mismatches >= 2
            ? " Each tile's edge colours show which way up to hold that side — or start the scan over."
            : ''
        }`,
      };
      this.loop(
        'confirm',
        this.tinted('err', 'Those two looks disagree. '),
        ...this.confirmWords(confirm),
      );
      return;
    }
    this.awaiting = confirm;
    this.notice = {
      title: 'One more look',
      tone: 'info',
      body:
        (result.ambiguous
          ? `${this.ambiguitySentence(result)} `
          : 'A single look could have been held wrong, so another one checks it. ') +
        this.confirmSentence(confirm),
    };
    this.loop('confirm', ...this.confirmWords(confirm));
  }

  /**
   * Explain a refusal now, and explain it better when the misread count arrives.
   *
   * `publish` is called at least once, synchronously, with `first` true — so the refusal is on
   * screen within the same tick however long the decode turns out to take. It is called a second
   * time, with `first` false, only for the answer to THIS reading: the epoch is captured here and
   * re-read when the answer lands, so a correction, a re-shown side or a restart in between drops
   * the answer rather than describing a cube that is no longer there.
   *
   * Where the page has no worker the whole thing collapses back to one call carrying the count —
   * the behaviour that shipped before the decode moved off this thread.
   *
   * AND THE EPOCH IS NOT THE ONLY WAY TO BE STALE (2026-09-05). It tracks the READING, which is
   * what the answer is about — and a camera that failed in the meantime changes nothing about the
   * reading while changing everything about what the panel should be saying. So a refinement
   * landing after "The camera did not open" replaced that sentence with a misread notice and
   * reported 'scanning' over a null device: the user was told to show a side again by a scanner
   * with no camera. A failure notice outranks a better explanation of a refusal, and the test is
   * `clearCameraFault`'s — is the sentence a failure pinned still the one on screen.
   */
  private diagnose(result: AiScanResult, publish: (r: AiScanResult, first: boolean) => void): void {
    // Nothing was deferred: an ambiguous reading (which has legal readings and so nothing to
    // decode), or a diagnosis that already ran. Running the decoder over one of those spends a
    // real search to answer "0 misreads" and would overwrite a count that is already right.
    if (result.misreadCount !== null) {
      publish(result, true);
      return;
    }
    const epoch = ++this.diagnosisEpoch;
    // In place means BY POSITION — a painting's centres, or a settled scan's, are where each side
    // sits — and the decode then answers in positions, so its answer is moved back to slots
    // before a host sees it. A camera reading goes by slot and is decoded under every scheme.
    const inPlace = this.inPlace();
    const faces = inPlace ? this.positionFaces() : this.faces;
    const settle = (diagnosis: MisreadDiagnosis) =>
      inPlace ? this.fromPositions(diagnosis) : diagnosis;
    const reply = this.misread.request({ epoch, faces, fixedRotation: inPlace }, (r) => {
      if (r.epoch !== this.diagnosisEpoch) return;
      if (this.cameraFault !== null && this.notice === this.cameraFault) return;
      publish(decided(result, settle(r.diagnosis)), false);
    });
    publish(reply ? decided(result, settle(reply.diagnosis)) : result, true);
  }

  /** Refused: keep every capture, and say what would make it a cube. */
  private finishRefused(result: AiScanResult): void {
    // Refused — but NOT thrown away. The six captures are the user's work and every way out of a
    // refusal needs them: fix a sticker, re-show a side (the loop below replaces its reading), or
    // restart. The old code reset everything here, which wiped the board in the same paint as the
    // sixth capture and read as the app breaking.
    this.confirmed = {};
    this.awaiting = null;
    // Published NOW with whatever is known, and published again when the misread count lands. The
    // first call restarts the capture loop; the second must not, or a user who has been holding a
    // side still for the three seconds the decode took loses that run to a loop reset.
    this.diagnose(result, (r, first) => this.publishRefusal(r, first));
  }

  /**
   * Say a refusal out loud: the public event, the pinned notice, the transient line.
   *
   * Run once per refusal and once more per diagnosis that lands for it, so `scan-invalid` carries
   * the same null-then-value shape `misreadCount` has — a host sees the refusal immediately and
   * the count when there is one, rather than waiting seconds for either.
   */
  private publishRefusal(result: AiScanResult, first: boolean): void {
    this.suspects = result.suspects ?? [];
    this.dispatchEvent(new CustomEvent<AiScanResult>('scan-invalid', { detail: result }));
    // Classification and the proven wording come from misreadNotice(); only the way OUT is the
    // camera's own — show the side again. The tip that used to follow ("hold each side the way its
    // tile's edge colours show, and a scan settles itself") promised what the assembly does not do:
    // it never prefers the hold a side was shown in, so holding it that way settles nothing
    // (2026-09-18, `dev-docs/scan-guidance-plan.md` §1.1).
    // With two or more misread and no side to name, "show those sides again" named sides the
    // decoder had just said it could not name, and the orientation tip was about a different
    // problem (a user's screenshot, 2026-09-06). That many wrong stickers is usually one cause —
    // red and orange under warm light, a misread centre that inflates
    // the count and that no reading can detect — and re-showing sides one at a time keeps the
    // cause. So the instruction is the one the user can follow: start over, better, with the
    // button in the card; the per-side re-read stays as the last sentence for someone who can
    // see which side is wrong. The count stays because it is what the decoder proves.
    const camera = this.misreadNotice(result, {
      one: 'If it is wrong, tap it and pick the colour you see; if it is right, show that side again to re-read it.',
      lead: result.misreadFace
        ? undefined
        : 'At least %1 stickers do not fit a real cube — too many to tell which.',
      many: result.misreadFace
        ? 'Show the %2 side to the camera again — it will be read fresh.'
        : `Start the scan over in whiter light; red and orange are the colours it confuses most. ${RE_READ_LINE}`,
      params: result.misreadFace ? [GUIDE[result.misreadFace].color] : [],
      action: result.misreadFace ? undefined : { label: 'Start over', kind: 'restart' },
    });
    const { notice, line } = classifyRefusal(result, camera);
    this.notice = notice;
    // Keep scanning: with all six sides in, a re-shown side replaces its reading (see onTick).
    // A refinement only replaces the WORDS — see finishRefused for why it must not restart it.
    if (first) this.loop('scanning', this.tinted('err', line));
    else this.report('scanning', this.tinted('err', line));
  }

  private buildDots(): void {
    const dots = this.maybe('dots');
    if (!dots) return;
    dots.textContent = '';
    for (const face of FACES) {
      const g = GUIDE[face];
      const span = document.createElement('span');
      span.style.background = g.swatch;
      span.className = this.faces[face] ? 'done' : '';
      span.title = this.faces[face] ? `${g.color} — captured` : `${g.color} — needed`;
      dots.appendChild(span);
    }
  }

  private buildPreview(): void {
    const p = this.maybe('preview');
    if (!p) return;
    p.textContent = '';
    for (let i = 0; i < 9; i++) p.appendChild(document.createElement('i'));
  }

  private showPreview(colors: number[] | null): void {
    this.live = colors;
    const p = this.maybe('preview');
    if (!p) return;
    if (!colors) {
      p.dataset.show = '0';
      return;
    }
    const cells = p.querySelectorAll('i');
    for (let i = 0; i < 9; i++) {
      (cells[i] as HTMLElement).style.background = CLASS_SWATCH[colors[i]!] ?? '#000';
    }
    p.dataset.show = '1';
  }

  /**
   * Show `parts` on the built-in status line (when there is one) AND tell the host what changed.
   * Every status change goes through here, so a headless host sees exactly what a visible one does.
   */
  private report(phase: ScanPhase, ...parts: (string | Node)[]): void {
    // Taken, not read: the flag belongs to this one report, and clearing it before the event is
    // dispatched means a listener that causes another report cannot stamp that one too.
    const shownAgain = this.shownAgain;
    this.shownAgain = false;
    const message = parts.map((p) => (typeof p === 'string' ? p : (p.textContent ?? ''))).join('');
    this.lastLine = message;
    const status = this.maybe('status');
    if (status) {
      status.textContent = '';
      status.append(...parts);
    }
    this.dispatchEvent(
      new CustomEvent<ScanProgress>('scan-progress', {
        detail: {
          phase,
          message,
          captured: this.capturedFaces(),
          sides: this.sidesHeld(),
          live: this.live,
          settling: this.settling(),
          seen: this.seen,
          shownAgain,
          device: this.cam.device,
          confirm: this.awaiting,
          runtime: this.cam.runtime,
          notice: this.notice,
          suspects: [...this.suspects],
          complete: this.finished,
          scheme: this.scheme,
        },
      }),
    );
  }

  private bold(text: string): HTMLElement {
    const b = document.createElement('b');
    b.textContent = text;
    return b;
  }
  private tinted(cls: 'ok' | 'err', text: string): HTMLElement {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    return span;
  }
}

/**
 * What a refused camera scan SAYS: the pinned notice and the transient line, decided together.
 *
 * Pure, and lifted out of `publishRefusal` (2026-09-21), which had grown the event, the state, this
 * classification, the action and the copy into one decision tree — where a category added to the
 * notice and not to the line left the two voices contradicting each other about the user's cube.
 * The transient line has to describe the SAME refusal the notice does. It was one sentence for
 * every branch — "That isn't a solvable cube yet" — which is simply false for the ambiguous one: a
 * cube that reads several ways is solvable, and every reading of it is, and the notice says so.
 *
 * `camera` is the misread notice already built for this refusal (`misreadNotice`, which reads the
 * suspects), or null when the decode named no count: it comes first because a count is the most
 * specific thing a refusal can say. The categories that follow are ordered from the most specific
 * fact the assembler established to the least: unread centres, a centre collision, a scheme the
 * looks cannot settle, a symmetry no look can, and — claiming nothing — damage too wide to place.
 * Exported so each category's words can be pinned without driving a scan into it.
 */
export function classifyRefusal(
  result: AiScanResult,
  camera: ScanNotice | null,
): { notice: ScanNotice; line: string } {
  if (camera) {
    // A notice that says "start over" cannot have a transient line under it saying "fix a
    // sticker". Same verdict, the notice's own advice.
    return {
      notice: camera,
      line: camera.action
        ? "That isn't a solvable cube yet — start the scan over, or show one side again."
        : "That isn't a solvable cube yet — fix a sticker, or show a side again.",
    };
  }
  if (result.schemeAmbiguous) {
    // The readings left standing are different cubes that differ in nothing but which colour
    // is under white — blue on an older cube, yellow on most — and no hold a child could be
    // asked for tells them apart (ADR 0001 §8.2). Never a guess from a setting: the wrong
    // guess is a confidently wrong cube for whichever child has the other kind. One turn of any
    // face breaks the symmetry; measured on every continuation of the founding fixture.
    return {
      notice: {
        title: 'Which colour is under white?',
        tone: 'err',
        body: 'Every side is read, but these readings differ only in which colour sits under white — blue or yellow — and no extra look can tell them apart. Turn any one face a quarter turn, then start the scan over to read the changed cube.',
      },
      line: 'This cube reads two ways that differ only in its colours — turn any one face a quarter turn, then start over.',
    };
  }
  if (result.ambiguous) {
    return {
      notice: {
        title: 'Too symmetric to tell',
        tone: 'err',
        body: 'This cube reads the same several ways, and no extra look can split them. Turn any one face a quarter turn, then start the scan over to read the changed cube.',
      },
      line: 'This cube reads the same several ways — turn any one face a quarter turn, then start over.',
    };
  }
  // The decoder could not say how much is wrong (it hit its work budget, or the damage is past
  // what it will search). Claim nothing about a count, and ask for the one thing that always
  // helps. The old copy said "a sticker was misread" here — a singular the code had already
  // ruled out, over an instruction to tap one of forty-eight.
  return {
    notice: {
      title: "That doesn't read as a solvable cube",
      tone: 'err',
      body: `Too much of the cube was read wrong to say where. Show the sides to the camera again — each one is read fresh — or start the scan over.`,
    },
    line: "That isn't a solvable cube yet — fix a sticker, or show a side again.",
  };
}

/**
 * A deferred refusal, once the decode has spoken.
 *
 * The marker has to be REMOVED, not merged over: a decode that ran and could claim nothing (its
 * 20M-node backstop exhausted) answers with an EMPTY diagnosis, and spreading that over a result
 * still carrying `misreadCount: null` leaves the marker standing — so the panel says "working out
 * how many stickers are wrong" for the rest of the session, about a question that has already been
 * answered as far as it ever will be. Found by measuring rather than by reading: the worst input
 * the plan names is exactly the input whose decode comes back empty.
 */
function decided(result: AiScanResult, diagnosis: MisreadDiagnosis): AiScanResult {
  // Rest-destructured rather than spread-then-deleted: dropping the key is the whole job, and
  // this is the one form that says so in the expression that builds the result.
  const { misreadCount: _checking, ...settled } = result;
  return { ...settled, ...diagnosis };
}

if (!customElements.get('ai-scan-panel')) {
  customElements.define('ai-scan-panel', AiScanPanel);
}
