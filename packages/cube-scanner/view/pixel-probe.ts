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

import type { Detection } from './../src/onnx-postprocess.js';
import type { Frame } from './../src/types.js';

/** The switch, read the same way the trace's and the recorder's are. */
export const PIXEL_PROBE_KEY = 'cubusScanPixels';

/**
 * The colour class the probe is hunting. 0 is white — the class under investigation.
 *
 * A constant rather than an argument because this is an instrument for one question at a time, and
 * a knob nobody turns is a knob that rots. Change it here when the question changes.
 */
export const PIXEL_PROBE_CLASS = 0;

/**
 * The least time between two saved frames.
 *
 * A scan runs at up to sixteen frames a second and the point is a handful of pictures, not a film:
 * at 1.2 MB a frame, an unthrottled probe would write a gigabyte in a minute and slow the very loop
 * it is watching.
 */
export const PIXEL_PROBE_EVERY_MS = 3_000;

/**
 * The most frames one page will ever save.
 *
 * A SECOND BOUND, because the throttle alone was not one. The first version saved the whole frame
 * every three seconds for as long as a scan ran: on a 1920×1080 camera that is 4 MB a shot, and one
 * session wrote 245 MB and made the app unusable — `inferMs` peaked at 608 ms against a 20 ms
 * median and the tick rate halved, because a 3 MB base64 encode and a 4 MB `JSON.stringify` were
 * running on the page's own thread. A rate limit bounds the rate; only a count bounds the total.
 */
export const PIXEL_PROBE_MAX_FRAMES = 40;

/**
 * The longest side of a saved picture, in pixels.
 *
 * The question is what the pixel VALUES are on a sticker, which a crop around the boxes answers as
 * well as a whole 1920×1080 frame and in about a fortieth of the bytes. Downscaling is deliberately
 * NOT used to get there — resampling averages a clipped pixel with its neighbours and would hide
 * the very thing being looked for — so this caps the crop by clamping its rectangle instead.
 */
export const PIXEL_PROBE_MAX_SIDE = 640;

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

/** How many this page has already written. Module scope: the bound is per page, not per scan. */
let saved = 0;

/** Forget the count — for tests, and for a developer who wants another run without a reload. */
export const resetPixelProbe = (): void => {
  saved = 0;
};

/**
 * The rectangle worth saving: the boxes, with a margin, clamped to the frame and to a maximum side.
 *
 * Exported to be tested on its own. A crop is the whole difference between an instrument that can
 * be left on and one that writes a quarter of a gigabyte.
 */
export function cropFor(frame: Frame, dets: readonly Detection[]) {
  const xs = dets.flatMap((d) => [d.cx - d.w / 2, d.cx + d.w / 2]);
  const ys = dets.flatMap((d) => [d.cy - d.h / 2, d.cy + d.h / 2]);
  if (xs.length === 0) return { x: 0, y: 0, w: frame.width, h: frame.height };
  // A margin, because what surrounds a sticker is part of the answer: a blown-out sticker beside a
  // correctly exposed background says something a tight crop would leave out.
  const pad = 0.25;
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const mx = (x1 - x0) * pad;
  const my = (y1 - y0) * pad;
  const left = Math.max(0, Math.floor(x0 - mx));
  const top = Math.max(0, Math.floor(y0 - my));
  const w = Math.min(frame.width - left, Math.ceil(x1 - x0 + mx * 2), PIXEL_PROBE_MAX_SIDE);
  const h = Math.min(frame.height - top, Math.ceil(y1 - y0 + my * 2), PIXEL_PROBE_MAX_SIDE);
  return { x: left, y: top, w: Math.max(1, w), h: Math.max(1, h) };
}

/**
 * Write the part of a frame the boxes are in, and the boxes.
 *
 * PNG, and LOSSLESS on purpose: the whole question is what the exact pixel values are, and a JPEG
 * would answer it with values the camera never produced. What is NOT saved is the rest of the
 * 1920×1080 frame, which answered nothing and cost 4 MB a shot.
 */
export async function savePixelProbe(frame: Frame, dets: readonly Detection[]): Promise<void> {
  if (saved >= PIXEL_PROBE_MAX_FRAMES) return;
  const crop = cropFor(frame, dets);
  const png = await toPng(frame, crop);
  if (!png) return;
  saved += 1;
  await fetch('/__record', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'pixel-probe',
      capturedAt: new Date().toISOString(),
      width: frame.width,
      height: frame.height,
      crop,
      nth: saved,
      hunting: PIXEL_PROBE_CLASS,
      boxes: boxesOf(dets),
      png,
    }),
  });
}

/** The cropped frame as a base64 PNG, or null where the runtime cannot encode one. */
async function toPng(
  frame: Frame,
  crop: { x: number; y: number; w: number; h: number },
): Promise<string | null> {
  // BOTH globals, not just the canvas. They are separate browser APIs and a runtime can have one
  // without the other; reaching for `ImageData` unguarded threw where this function is documented
  // to return null, and the throw was only invisible because the one caller swallows it.
  const Canvas = (globalThis as { OffscreenCanvas?: typeof OffscreenCanvas }).OffscreenCanvas;
  const Pixels = (globalThis as { ImageData?: typeof ImageData }).ImageData;
  if (!Canvas || !Pixels) return null;
  const canvas = new Canvas(crop.w, crop.h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // COPIED row by row out of the frame, into an array whose buffer is known not to be shared.
  // `Frame.data` is a `Uint8ClampedArray` over any `ArrayBufferLike`, and `ImageData` will not take
  // one that might sit on a `SharedArrayBuffer` — which this page has, being cross-origin isolated
  // for the solver. Copying the crop rather than the frame is also what makes this cheap.
  const pixels = new Uint8ClampedArray(crop.w * crop.h * 4);
  for (let row = 0; row < crop.h; row++) {
    const from = ((crop.y + row) * frame.width + crop.x) * 4;
    pixels.set(frame.data.subarray(from, from + crop.w * 4), row * crop.w * 4);
  }
  ctx.putImageData(new Pixels(pixels, crop.w, crop.h), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // In chunks: `String.fromCharCode(...bytes)` on a whole frame overflows the argument list.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
