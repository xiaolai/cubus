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
 * Write one frame and the boxes that were found in it.
 *
 * PNG RATHER THAN RAW, because a 1.2 MB RGBA frame becomes 1.6 MB of base64 and a handful of those
 * is a nuisance to move and to look at; a PNG of the same frame is a tenth of that and opens in
 * anything. It is LOSSLESS, which matters more than the size here — the whole question is what the
 * exact pixel values are, and a JPEG would answer it with values the camera never produced.
 */
export async function savePixelProbe(frame: Frame, dets: readonly Detection[]): Promise<void> {
  const png = await toPng(frame);
  if (!png) return;
  await fetch('/__record', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'pixel-probe',
      capturedAt: new Date().toISOString(),
      width: frame.width,
      height: frame.height,
      hunting: PIXEL_PROBE_CLASS,
      boxes: boxesOf(dets),
      png,
    }),
  });
}

/** The frame as a base64 PNG, or null where the runtime cannot encode one. */
async function toPng(frame: Frame): Promise<string | null> {
  // BOTH globals, not just the canvas. They are separate browser APIs and a runtime can have one
  // without the other; reaching for `ImageData` unguarded threw where this function is documented
  // to return null, and the throw was only invisible because the one caller swallows it.
  const Canvas = (globalThis as { OffscreenCanvas?: typeof OffscreenCanvas }).OffscreenCanvas;
  const Pixels = (globalThis as { ImageData?: typeof ImageData }).ImageData;
  if (!Canvas || !Pixels) return null;
  const canvas = new Canvas(frame.width, frame.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // COPIED into an array whose buffer is known not to be shared. `Frame.data` is a
  // `Uint8ClampedArray` over any `ArrayBufferLike`, and `ImageData` will not take one that might sit
  // on a `SharedArrayBuffer` — which this page has, being cross-origin isolated for the solver.
  const pixels = new Uint8ClampedArray(frame.data.length);
  pixels.set(frame.data);
  ctx.putImageData(new Pixels(pixels, frame.width, frame.height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // In chunks: `String.fromCharCode(...bytes)` on a whole frame overflows the argument list.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
