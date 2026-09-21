// What the letterbox worker is ASKED and what it ANSWERS — one shape, and one implementation of the
// work behind it, shared by the worker (`letterbox-worker.ts`) and by the fallback that runs on the
// calling thread when a page has no worker (`letterbox-client.ts`). The same arrangement as the
// misread decoder's `misread-protocol.ts`, for the same reason: one module both bundles keep whole.

import { IMG_SIZE, preprocess } from '../src/letterbox.js';
import type { Frame } from '../src/types.js';

/** One frame to letterbox. `id` comes back unchanged, so a late answer can be told from the one wanted. */
export interface LetterboxRequest {
  id: number;
  frame: Frame;
}

/** The tensor `preprocess` makes of the frame, and the frame itself, handed back for the pixel path. */
export interface LetterboxReply {
  id: number;
  data: Float32Array;
  imgsz: number;
  frame: Frame;
}

/**
 * Letterbox one frame. The whole of the worker is this call, and so is the whole of the fallback —
 * which is what makes "the worker's tensor is the on-thread tensor" a property of the code rather
 * than a hope about two copies. `preprocess` throws on a frame that is not an image; the worker
 * relays that as an error reply rather than letting it die.
 */
export function handleLetterboxRequest(request: LetterboxRequest): LetterboxReply {
  const pre = preprocess(request.frame, IMG_SIZE);
  return { id: request.id, data: pre.data, imgsz: pre.imgsz, frame: request.frame };
}
