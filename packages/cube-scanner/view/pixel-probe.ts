// DEV ONLY: save the picture behind a frame, so a question about the camera stops being inference.
//
// WHY THIS EXISTS (2026-09-24). A cube's white face was never captured across 3,881 recorded frames.
// Everything known about that came from BOX COUNTS — white detected 1,026 times, never nine in one
// frame, never fitted at any confidence floor from 0.25 down to 0.06 — and two confident diagnoses
// drawn from those counts were both wrong in turn: "white is invisible to the camera" (it is
// detected a thousand times) and "the 0.25 floor is discarding it" (lowering the floor adds 150
// fitted faces and not one white). Counts cannot separate a blown-out sticker from a shadowed one
// from a correctly-exposed one the model simply misreads. A picture can.
//
// `RecordedFrame.pixels` has had a field for exactly this since D9 and nothing has ever filled it;
// the note there says capturing pixels "needs a person and hardware", which is precisely the
// situation this is for.
//
// OFF UNLESS ASKED, and asked for in the place every other developer switch in this package lives:
// `localStorage.cubusScanPixels = '1'`. It posts to the dev server's `/__record` sink, which exists
// only under `apps/web/serve.mjs` and refuses anything that is not a loopback POST — so on a built
// app the fetch simply fails and is swallowed. Nothing here runs, allocates or reaches the network
// with the switch off.

import { IMG_SIZE, preprocess } from './../src/letterbox.js';
import type { Detection } from './../src/onnx-postprocess.js';
import type { Frame } from './../src/types.js';

/** The switch, read the same way the trace's and the recorder's are. */
export const PIXEL_PROBE_KEY = 'cubusScanPixels';

/**
 * How many NEIGHBOURED boxes a frame needs before its picture is worth saving.
 *
 * NEVER A COLOUR, AND THE FIRST VERSION'S MISTAKE WAS EXACTLY THAT (2026-09-24). It fired on any
 * frame containing a box the model labelled white — the label under investigation — and white is
 * the class that false-positives on walls, doors and paper. So it captured a roomful of empty
 * frames, never the white face, and the pixel statistics drawn from them described a wooden door.
 * Triggering on the unreliable signal to investigate the unreliable signal is circular, and it cost
 * a whole diagnosis.
 *
 * Geometry does not have that problem. `dropIsolated` keeps boxes that have neighbours, which is
 * what a cube's face looks like and what a doorframe does not, whatever colour anything is called.
 * Six is below the nine a fit needs, on purpose: the frames worth seeing are the ones the fit
 * REFUSED.
 */
export const PIXEL_PROBE_MIN_NEIGHBOURS = 6;

/**
 * The least time between two saved frames.
 *
 * A scan runs at up to sixteen frames a second and the point is a handful of pictures, not a film:
 * at 1.2 MB a frame, an unthrottled probe would write a gigabyte in a minute and slow the very loop
 * it is watching.
 */
export const PIXEL_PROBE_EVERY_MS = 3_000;

/**
 * The most frames one page will ever ATTEMPT.
 *
 * A SECOND BOUND, because the throttle alone was not one. The first version saved the whole frame
 * every three seconds for as long as a scan ran: on a 1920×1080 camera that is 4 MB a shot, and one
 * session wrote 245 MB and made the app unusable — `inferMs` peaked at 608 ms against a 20 ms
 * median and the tick rate halved, because a 3 MB base64 encode and a 4 MB `JSON.stringify` were
 * running on the page's own thread. A rate limit bounds the rate; only a count bounds the total.
 *
 * IT BOUNDS ATTEMPTS, NOT SUCCESSES, and that is the load-bearing word (2026-09-24). Counting only
 * what the sink acknowledged would leave the expensive half — the letterbox, the PNG encode, the
 * base64 — unbounded against a sink answering 500, which is the one case where the budget matters
 * most. `pixelProbeCounts()` reports both numbers so a developer can see the difference rather than
 * infer it.
 */
export const PIXEL_PROBE_MAX_FRAMES = 40;

/**
 * THE PICTURE SAVED IS THE MODEL'S OWN INPUT, not a crop of the camera frame.
 *
 * A `Detection` is in the 640 px letterbox the model was handed, and the first version cropped the
 * FRAME using those numbers — so on a 1920×1080 camera every crop landed in the left third of the
 * picture at a third of the right scale, and twenty-two saved frames showed a doorframe while the
 * cube sat outside the crop. Three conclusions were drawn from those pictures before a box
 * coordinate was checked against the frame width.
 *
 * Converting correctly would have fixed that instance. Saving the model's input removes the CLASS:
 * there is no conversion left to get wrong, because the boxes and the picture are in the same space
 * by construction. It is also what the question is actually about — not what the camera saw, but
 * what the detector was given — and it is 640×640 whatever the camera's resolution, so the size
 * bound comes free instead of from a crop rectangle.
 *
 * WHAT IS EXACT AND WHAT IS NOT (corrected 2026-09-24). The GEOMETRY is exact — same letterbox,
 * same scale, same pad, so a box lands on the sticker it named. The SAMPLE VALUES are quantised:
 * `preprocess` resamples bilinearly, so its floats sit off the 1/255 grid, and an 8-bit PNG rounds
 * them. A model sample of 0.5015625 is stored as 128 and reads back as 0.50196. PNG is lossless
 * about the bytes it is given and says nothing about that rounding, so this artefact is an 8-BIT
 * VISUALISATION of the model's input rather than the tensor itself. Enough to see a blown-out
 * sticker or a logo; not enough to recompute a detector score from.
 */
export const PIXEL_PROBE_SIDE = IMG_SIZE;

/** Whether the switch is on. Storage can throw on a page with it disabled, so this never rethrows. */
export function pixelProbeEnabled(store?: Pick<Storage, 'getItem'>): boolean {
  try {
    const storage = store ?? globalThis.localStorage;
    return storage?.getItem(PIXEL_PROBE_KEY) === '1';
  } catch {
    return false;
  }
}

/** The boxes as the report carries them: enough to find a sticker in the picture afterwards. */
const boxesOf = (dets: readonly Detection[]) =>
  dets.map((d) => ({
    cx: Math.round(d.cx * 10) / 10,
    cy: Math.round(d.cy * 10) / 10,
    w: Math.round(d.w * 10) / 10,
    h: Math.round(d.h * 10) / 10,
    cls: d.classId,
    conf: Math.round(d.confidence * 1000) / 1000,
  }));

/**
 * How many this page has already begun, and how many the sink took. Module scope: the bound is per
 * page, not per scan.
 */
let attempted = 0;
let delivered = 0;

/** Forget the counts — for tests, and for a developer who wants another run without a reload. */
export const resetPixelProbe = (): void => {
  attempted = 0;
  delivered = 0;
};

/**
 * What the budget has been spent on, and what came of it.
 *
 * Two numbers rather than one because they answer different questions and a single "saved" count
 * answered neither honestly: forty attempts against a sink returning 500 used the whole budget and
 * wrote nothing, and reported the same number as forty frames on disk.
 */
export const pixelProbeCounts = (): { attempted: number; delivered: number } => ({
  attempted,
  delivered,
});

/** The two platform APIs an encode needs, or null on a runtime that has neither or only one. */
function encoderOf(): { Canvas: typeof OffscreenCanvas; Pixels: typeof ImageData } | null {
  // BOTH globals, not just the canvas. They are separate browser APIs and a runtime can have one
  // without the other; reaching for `ImageData` unguarded threw where the encode is documented to
  // decline, and the throw was only invisible because the one caller swallows it.
  const Canvas = (globalThis as { OffscreenCanvas?: typeof OffscreenCanvas }).OffscreenCanvas;
  const Pixels = (globalThis as { ImageData?: typeof ImageData }).ImageData;
  return Canvas && Pixels ? { Canvas, Pixels } : null;
}

/**
 * Write the picture the MODEL was given, and the boxes it found in it.
 *
 * PNG, and LOSSLESS about the bytes it is handed: the question is what the pixel values are, and a
 * JPEG would answer it with values nothing ever produced. The 8-bit rounding that happens first is
 * described on `PIXEL_PROBE_SIDE`.
 *
 * THE BUDGET IS RESERVED SYNCHRONOUSLY, before the first `await`, and this is not a detail: the
 * caller throttles when a save STARTS and nothing serialises when one finishes, so a check-then-
 * increment straddling an await let overlapping calls read the same count — 41 calls produced 41
 * posts against a limit of 40, measured. Reserving first makes the bound hold under any
 * interleaving, and the reservation is never handed back: the work it paid for has already been
 * done by then.
 *
 * Throws where the sink refuses the frame. The one caller catches and warns; an HTTP error that
 * resolved quietly would report a saved frame that no file exists for.
 */
export async function savePixelProbe(frame: Frame, dets: readonly Detection[]): Promise<void> {
  // Before the reservation, because it is not a failure this page can recover from and spending
  // budget on a runtime that will never encode anything would only hide that fact.
  const encoder = encoderOf();
  if (!encoder) return;
  if (attempted >= PIXEL_PROBE_MAX_FRAMES) return;
  attempted += 1;
  const nth = attempted;
  const png = await toPng(frame, encoder);
  const response = await fetch('/__record', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'pixel-probe',
      capturedAt: new Date().toISOString(),
      // The CAMERA's size, for the record, and the picture's own size, which is the model's.
      cameraWidth: frame.width,
      cameraHeight: frame.height,
      side: PIXEL_PROBE_SIDE,
      nth,
      neighbours: dets.length,
      boxes: boxesOf(dets),
      png,
    }),
  });
  if (!response?.ok) {
    throw new Error(`the pixel sink refused frame ${nth} (HTTP ${response?.status ?? '?'})`);
  }
  delivered += 1;
}

/**
 * The model's input as 8-bit RGBA, opaque.
 *
 * Pure, and separated from the canvas on purpose: this is the only step whose correctness is this
 * module's own — the plane order, the channel order and the scale — and it is the step that cannot
 * be checked by looking at a canvas fake. `preprocess` returns CHW floats in [0,1]; this is the
 * inverse of its normalize and nothing else. The rounding it performs is the quantisation described
 * on `PIXEL_PROBE_SIDE`.
 */
export function rgbaOf(data: Float32Array, imgsz: number): Uint8ClampedArray<ArrayBuffer> {
  const plane = imgsz * imgsz;
  const pixels = new Uint8ClampedArray(new ArrayBuffer(plane * 4));
  for (let i = 0; i < plane; i++) {
    pixels[i * 4] = Math.round((data[i] ?? 0) * 255);
    pixels[i * 4 + 1] = Math.round((data[plane + i] ?? 0) * 255);
    pixels[i * 4 + 2] = Math.round((data[plane * 2 + i] ?? 0) * 255);
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

/** Bytes as base64, in chunks: `String.fromCharCode(...bytes)` on a frame overflows the argument list. */
export function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The model's 640×640 input as a base64 PNG: letterbox, convert, encode, serialise. */
async function toPng(
  frame: Frame,
  { Canvas, Pixels }: { Canvas: typeof OffscreenCanvas; Pixels: typeof ImageData },
): Promise<string> {
  // THE MODEL'S OWN INPUT, produced by the very function the detector uses, so the picture and the
  // boxes are in one space and no conversion can drift.
  const { data, imgsz } = preprocess(frame, PIXEL_PROBE_SIDE);
  const canvas = new Canvas(imgsz, imgsz);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('the pixel probe could not get a 2d context');
  ctx.putImageData(new Pixels(rgbaOf(data, imgsz), imgsz, imgsz), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return base64Of(new Uint8Array(await blob.arrayBuffer()));
}
