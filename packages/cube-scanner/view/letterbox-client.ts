// The letterbox asked for from the page's thread and answered from another one (2026-09-20).
//
// One worker per client, spawned on first use, and a synchronous fallback where no worker can be
// had — the arrangement of `misread-client.ts`, for the same three ways of having no worker: no
// `Worker` on the platform; one that refuses to build (a CSP, a blocked URL); and one that builds
// and then dies, which arrives later as an `error` event and must not leave a request unanswered.
// A fourth is this worker's own: a page with no `createImageBitmap` or `OffscreenCanvas` has no way
// to hand it a picture, and reads the pixels on the page as before.
//
// ONE REQUEST IN FLIGHT. The panel's tick guard already prevents two inferences at once, and this
// mirrors it rather than queueing: a second `prepare` while one is out rejects, because the frame
// it would prepare is one the loop is not going to run.

import { FrameNotReadyError } from '../src/camera.js';
import type { Frame } from '../src/types.js';
import { handleLetterboxRequest, type LetterboxReply } from './letterbox-protocol.js';
import type { LetterboxFailure, LetterboxJob } from './letterbox-worker.js';

/** A letterboxed frame: the tensor, its side, and the pixels it was made from. */
export interface Prepared {
  data: Float32Array;
  imgsz: number;
  frame: Frame;
  /**
   * Whether the frame's buffer is the caller's to keep. A worker answers with a buffer nothing
   * else holds; the fallback hands back what `grab()` returned, which a source may reuse on the
   * next tick — so the caller copies exactly when this is false and never pays for it twice.
   */
  owned: boolean;
}

/** The three facilities the worker path needs, as the page exposes them (or not). */
interface OffloadPage {
  Worker?: unknown;
  OffscreenCanvas?: unknown;
  createImageBitmap?: (source: HTMLVideoElement) => Promise<ImageBitmap>;
}

/**
 * Can this page hand a picture to a worker at all? Read off the globals at each call, as
 * `misread-client.ts` reads `Worker` — which is also what lets a test take them away.
 */
export function canOffload(): boolean {
  const page = globalThis as OffloadPage;
  return (
    typeof page.Worker === 'function' &&
    typeof page.createImageBitmap === 'function' &&
    typeof page.OffscreenCanvas === 'function'
  );
}

/**
 * Is this the rejection `createImageBitmap` gives a video with no picture to take yet?
 *
 * The spec names it: a video whose `readyState` is below HAVE_CURRENT_DATA rejects with an
 * `InvalidStateError`, and that is the ONLY rejection this client reads as "not yet". Every other
 * one — a detached element, a security refusal, an allocation the engine could not make — is a
 * failure that would recur on every tick, and translating it into "try again" (as this did until
 * 2026-09-21) left `WebDetector.next()` idling for ever on a camera that was never going to deliver.
 */
function notYetSnapshottable(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'InvalidStateError';
}

interface Waiting {
  id: number;
  resolve: (r: Prepared) => void;
  reject: (e: unknown) => void;
}

export class LetterboxOffload {
  private worker: Worker | null = null;
  /** Set once a worker has proved it cannot be had at all, so no later request builds another. */
  private broken = false;
  /** Whether the current worker has ever answered — the test that makes `broken` safe to set. */
  private spoke = false;
  private nextId = 0;
  private waiting: Waiting | null = null;

  /** Whether the next `prepare` will go to a worker. */
  get offloading(): boolean {
    return !this.broken && canOffload();
  }

  /**
   * Letterbox the video's current picture off the page's thread, or on it when there is no other.
   *
   * `fallback` reads the pixels on the page — the caller's `grab()`, with its liveness checks — and
   * is what a page without the worker path runs. It is NOT what a worker that dies mid-frame runs:
   * that tick fails loud, as any failed tick does, and the next one falls back.
   *
   * THE SLOT IS TAKEN BEFORE THE FIRST AWAIT (2026-09-21). `waiting` used to be set only after
   * `createImageBitmap` had resolved, so two calls could both pass the one-request guard, both
   * post, and the second overwrite the first's slot — whose promise then never settled. The
   * answer returned here is the SLOT's promise, so a request stranded while the engine is still
   * taking the snapshot is answered the moment it is stranded, not when the snapshot lands; the
   * snapshot itself runs on the side (`snapshot`) and is what re-checks the worker afterwards.
   */
  async prepare(video: HTMLVideoElement, fallback: () => Frame): Promise<Prepared> {
    const worker = this.offloading ? this.spawn() : null;
    if (!worker) return this.onThread(fallback);
    if (this.waiting) throw new Error('letterbox: a frame is already being prepared');
    const id = ++this.nextId;
    let slot!: Waiting;
    const answer = new Promise<Prepared>((resolve, reject) => {
      slot = { id, resolve, reject };
    });
    this.waiting = slot;
    void this.snapshot(video, worker, slot);
    return answer;
  }

  /**
   * Take the picture and hand it to `worker` under `slot`, unless the slot was stranded meanwhile.
   *
   * The worker is re-checked AFTER the await: a `dispose()` or a worker death landing during the
   * snapshot has already stranded this request, and posting the bitmap to a terminated worker —
   * which discards its queue — would have left the request installed and unanswerable. A
   * superseded snapshot's bitmap is the one resource nothing else will release, so it is closed
   * here; so is one a failed post could not transfer.
   */
  private async snapshot(video: HTMLVideoElement, worker: Worker, slot: Waiting): Promise<void> {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(video);
    } catch (err) {
      if (this.waiting !== slot) return; // stranded meanwhile, and answered by whoever did it
      this.waiting = null;
      // The camera-lost verdict is the source's to give, and the caller asks it
      // (`FrameSource.ready`) before coming here.
      slot.reject(
        notYetSnapshottable(err)
          ? new FrameNotReadyError('the video has no picture to snapshot yet')
          : err,
      );
      return;
    }
    if (this.worker !== worker || this.waiting !== slot) {
      bitmap.close();
      return;
    }
    const job: LetterboxJob = { id: slot.id, bitmap };
    try {
      worker.postMessage(job, [bitmap]);
    } catch (err) {
      // A post that fails leaves nothing in flight, or the next tick would find a frame "already
      // being prepared" that no worker ever received.
      bitmap.close();
      this.waiting = null;
      slot.reject(err);
    }
  }

  /**
   * The page-thread path on its own, for a caller that must not take a bitmap: a source with no
   * `FrameSource.ready` answers its liveness at `grab()` and nowhere else (2026-09-21).
   */
  onThread(fallback: () => Frame): Prepared {
    return { ...handleLetterboxRequest({ id: 0, frame: fallback() }), owned: false };
  }

  /**
   * Abandon the frame in flight, if any, and keep the worker: what a `stop()` mid-frame wants.
   * The caller of that frame is told; a bitmap still being snapshotted for it is closed when it
   * arrives (see `prepare`); a reply the worker still sends for it is dropped by its id.
   */
  cancel(why = 'letterbox: the frame was abandoned'): void {
    this.strand(why);
  }

  /** Give the worker back. A client is usable again afterwards; it simply spawns a new one. */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.spoke = false;
    this.strand('letterbox: the worker was disposed');
  }

  private spawn(): Worker | null {
    if (this.worker) return this.worker;
    try {
      // A same-origin URL beside this bundle, resolved at runtime rather than bundled: the app loads
      // `vendor/ai-scan-panel.js`, so `vendor/letterbox-worker.js` is the sibling this names.
      const spawned = new Worker(new URL('./letterbox-worker.js', import.meta.url), {
        type: 'module',
      });
      // Every listener names the worker it is about, so a late event from a terminated one
      // cannot act on its replacement (the lesson of `misread-client.ts`).
      spawned.addEventListener('message', (ev: MessageEvent<LetterboxReply | LetterboxFailure>) => {
        if (this.worker !== spawned) return;
        this.spoke = true;
        this.deliver(ev.data);
      });
      spawned.addEventListener('error', (ev: Event) => {
        if (this.worker !== spawned) return;
        this.failed(ev);
      });
      // A reply that could not be deserialised (2026-09-21). It reaches neither `deliver` nor the
      // `error` listener, so without this the request it answered stayed in flight for ever and
      // every later frame was refused as "already being prepared". A worker whose answers cannot
      // be read is a worker that failed, and is handled as one.
      spawned.addEventListener('messageerror', (ev: Event) => {
        if (this.worker !== spawned) return;
        this.failed(ev);
      });
      this.worker = spawned;
      return spawned;
    } catch (cause) {
      console.warn(
        'letterbox-client: the letterbox worker could not be built, so frames are prepared on this thread',
        cause,
      );
      this.broken = true;
      return null;
    }
  }

  private deliver(reply: LetterboxReply | LetterboxFailure): void {
    if ('error' in reply && reply.fatal) {
      // The worker's own machinery failed — no 2D context, a readback or a transfer the engine
      // refused (2026-09-21). That is not a fault of one frame: every later frame would fail the
      // same way, and keeping the worker to find out on each tick is exactly how the scan stayed
      // broken. The path is written off, whatever the worker had answered before.
      console.warn(
        `letterbox-client: the letterbox worker cannot letterbox here (${reply.error}), so frames are prepared on this thread`,
      );
      this.broken = true;
      this.worker?.terminate();
      this.worker = null;
      this.spoke = false;
      this.strand(`letterbox worker: ${reply.error}`);
      return;
    }
    const waiting = this.waiting;
    if (!waiting || waiting.id !== reply.id) return; // nobody is waiting for this frame any more
    this.waiting = null;
    if ('error' in reply) {
      waiting.reject(new Error(`letterbox worker: ${reply.error}`));
      return;
    }
    waiting.resolve({ data: reply.data, imgsz: reply.imgsz, frame: reply.frame, owned: true });
  }

  private failed(cause: Event): void {
    // A worker that never spoke cannot load at all: writing it off is what stops every later tick
    // building another thread exactly as doomed. One that HAD answered may simply have died, and
    // the next tick builds another.
    if (!this.spoke) this.broken = true;
    console.warn(
      'letterbox-client: the letterbox worker failed, so frames are prepared on this thread',
      cause,
    );
    this.worker?.terminate();
    this.worker = null;
    this.spoke = false;
    this.strand('letterbox: the worker failed while preparing a frame');
  }

  /** The frame in flight, if any, is lost with its worker: its caller is told so rather than left waiting. */
  private strand(why: string): void {
    const stranded = this.waiting;
    this.waiting = null;
    stranded?.reject(new Error(why));
  }
}
