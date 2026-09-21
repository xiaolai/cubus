// The letterbox, off the page's thread (2026-09-20).
//
// Inference left the page's thread long ago (onnxruntime's proxy worker, or the GPU), and the
// letterbox did not: `preprocess` on a 720p frame measured 14 ms median with a 7–94 ms spread on the
// dev Mac, on every tick, up to sixteen ticks a second — a fifth to a third of the thread that also
// draws the 3D cube (`dev-docs/scanner-audit-2026-09-20.md` §2.10). This worker takes the camera's
// picture as an `ImageBitmap` — which crosses without a copy — draws it into an `OffscreenCanvas`,
// reads the pixels back HERE rather than on the page, and letterboxes them with the same
// `preprocess` the page would have used. The tensor and the frame travel back by transfer.
//
// Bundled separately from `ai-scan-panel.js` because a worker is a separate script by definition,
// and deliberately thin: everything it knows is `handleLetterboxRequest`, which the client's
// fallback also calls, so the two tensors cannot come to differ.

import { handleLetterboxRequest, type LetterboxReply } from './letterbox-protocol.js';

/** What the page posts: a bitmap of the picture (transferred), and the id to answer under. */
export interface LetterboxJob {
  id: number;
  bitmap: ImageBitmap;
}

/**
 * A failure, relayed rather than thrown: a worker that dies owes its caller no answer at all.
 *
 * TWO KINDS, told apart by `fatal` (2026-09-21). A frame the letterbox refuses — a 0x0 bitmap,
 * `preprocess` saying it is not an image — is that frame's failure and the next frame may be
 * fine. A canvas with no 2D context, a `drawImage` or `getImageData` the engine refuses, a reply
 * it will not transfer: those are this worker's machinery, and every later frame fails the same
 * way. One catch used to relay both as the first kind, so the client kept a worker that could
 * never answer and the scan failed one tick at a time until its own deadline. A fatal failure is
 * the client's cue to write the worker path off and letterbox on the page.
 */
export interface LetterboxFailure {
  id: number;
  error: string;
  fatal?: true;
}

let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;

/** Pixels off a bitmap, through one canvas kept between frames and resized only on change. */
function pixelsOf(bitmap: ImageBitmap): { data: Uint8ClampedArray; width: number; height: number } {
  const { width, height } = bitmap;
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = new OffscreenCanvas(width, height);
    context = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!context) throw new Error('letterbox worker: no 2D context');
  context.drawImage(bitmap, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  return { data: image.data, width: image.width, height: image.height };
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

self.addEventListener('message', (ev: MessageEvent<LetterboxJob>) => {
  const { id, bitmap } = ev.data;
  try {
    let frame: ReturnType<typeof pixelsOf>;
    try {
      frame = pixelsOf(bitmap);
    } catch (err) {
      const failure: LetterboxFailure = { id, error: message(err), fatal: true };
      self.postMessage(failure);
      return;
    }
    let reply: LetterboxReply;
    try {
      reply = handleLetterboxRequest({ id, frame });
    } catch (err) {
      const failure: LetterboxFailure = { id, error: message(err) };
      self.postMessage(failure);
      return;
    }
    try {
      // Transferred, not copied: the 4.9 MB tensor and the 3.7 MB frame would otherwise be cloned
      // on the way back, which is the copy this worker exists to take off the page.
      self.postMessage(reply, { transfer: [reply.data.buffer, reply.frame.data.buffer] });
    } catch (err) {
      const failure: LetterboxFailure = { id, error: message(err), fatal: true };
      self.postMessage(failure);
    }
  } finally {
    bitmap.close();
  }
});
