// The letterbox's two halves off the page: the client (`letterbox-client.ts`) and the worker entry
// (`letterbox-worker.ts`), joined by `letterbox-protocol.ts` (2026-09-20).
//
// What is at risk is not the letterbox — `letterbox.test.ts` and `letterbox-parity.test.ts` own
// that — but the ways a page can fail to have a worker and the ways a frame can be lost between
// the two threads. Each is silent when it goes wrong: a stranded request leaves the scan loop
// waiting on a frame that will never come, a wrong-id answer lands a tensor on the wrong tick, and
// a worker written off too eagerly puts 14 ms a tick back on the thread that draws. So the
// assertions here are mostly about what must NOT happen, and the one positive claim — the worker's
// tensor is the page's tensor — is made by running both paths on the same pixels.
//
// In Node rather than happy-dom, on purpose: vitest's web transform rewrites
// `new URL('./letterbox-worker.js', import.meta.url)` to the SOURCE file's URL, so the one assertion
// about which script the client asks for could only be made against the untransformed module.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameNotReadyError } from '../src/camera.js';
import { IMG_SIZE, preprocess } from '../src/onnx-detect.js';
import type { Frame } from '../src/types.js';
import { canOffload, LetterboxOffload } from '../view/letterbox-client.js';
import { handleLetterboxRequest, type LetterboxReply } from '../view/letterbox-protocol.js';
import type { LetterboxFailure, LetterboxJob } from '../view/letterbox-worker.js';

/** A small picture with a bright block, so a tensor can be told from grey padding. */
function picture(w: number, h: number): Frame {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      const bright = x >= w / 4 && x < w / 2 && y >= h / 4 && y < h / 2;
      data[k] = bright ? 250 : 20;
      data[k + 1] = bright ? 240 : 30;
      data[k + 2] = bright ? 10 : 40;
      data[k + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

/** What `createImageBitmap` hands over in these tests: the picture, with the bitmap's own surface. */
class FakeBitmap {
  closed = false;
  constructor(readonly frame: Frame) {}
  get width(): number {
    return this.frame.width;
  }
  get height(): number {
    return this.frame.height;
  }
  close(): void {
    this.closed = true;
  }
}

/**
 * A `Worker` that never leaves this thread — and answers with the SAME handler the real worker
 * runs on the pixels the bitmap carries, so a test that drives it is testing the shipped
 * letterbox and not a stand-in for it.
 */
class FakeWorker {
  static built: FakeWorker[] = [];
  static refuse: Error | null = null;
  static last(): FakeWorker {
    const w = FakeWorker.built[FakeWorker.built.length - 1];
    if (!w) throw new Error('no worker was built');
    return w;
  }
  posted: LetterboxJob[] = [];
  transferred: unknown[][] = [];
  terminated = false;
  /** Set to make the next `postMessage` throw — a detached bitmap, in the browser. */
  refusePost: Error | null = null;
  private listeners = new Map<string, ((ev: unknown) => void)[]>();
  constructor(
    readonly url: URL,
    readonly options: unknown,
  ) {
    if (FakeWorker.refuse) throw FakeWorker.refuse;
    FakeWorker.built.push(this);
  }
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  postMessage(message: LetterboxJob, transfer: unknown[]): void {
    if (this.refusePost) throw this.refusePost;
    this.posted.push(message);
    this.transferred.push(transfer);
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Reply to a posted job the way the worker entry does: pixels off the bitmap, through the wire. */
  answer(index = 0): void {
    const job = this.posted[index];
    if (!job) throw new Error(`nothing posted at ${index}`);
    const { frame } = job.bitmap as unknown as FakeBitmap;
    // Fresh pixels per frame, as `getImageData` gives the worker: the transfer below detaches them.
    const pixels: Frame = { ...frame, data: new Uint8ClampedArray(frame.data) };
    const reply = handleLetterboxRequest({ id: job.id, frame: pixels });
    // Through the wire, exactly as postMessage does it: transferred, so the buffers that arrive
    // are the ones the worker had and not copies.
    this.send(structuredClone(reply, { transfer: [reply.data.buffer, reply.frame.data.buffer] }));
  }
  /** Reply with anything at all. */
  send(reply: LetterboxReply | LetterboxFailure): void {
    for (const fn of this.listeners.get('message') ?? []) fn({ data: reply });
  }
  /** The asynchronous failure: the worker was built and then could not load, or died. */
  fail(): void {
    for (const fn of this.listeners.get('error') ?? []) fn(new Event('error'));
  }
  /** A reply that arrived and could not be deserialised: the browser's `messageerror`. */
  garble(): void {
    for (const fn of this.listeners.get('messageerror') ?? []) fn(new Event('messageerror'));
  }
}

/** The three facilities the worker path reads off the page, as the client reads them. */
interface Page {
  Worker?: unknown;
  OffscreenCanvas?: unknown;
  createImageBitmap?: unknown;
}
const page = globalThis as Page;
const original: Page = {
  Worker: page.Worker,
  OffscreenCanvas: page.OffscreenCanvas,
  createImageBitmap: page.createImageBitmap,
};

/** Every bitmap `createImageBitmap` has handed the client since the last reset, oldest first. */
let bitmaps: FakeBitmap[] = [];

/**
 * Give the page everything the worker path needs, handing over `frame` as the video's picture —
 * on the globals, as `misread-worker.test.ts` does, because that is where the client reads them.
 */
function pageWith(frame: Frame, overrides: Page = {}): void {
  page.Worker = FakeWorker;
  page.OffscreenCanvas = class {};
  page.createImageBitmap = async () => {
    const bitmap = new FakeBitmap(frame);
    bitmaps.push(bitmap);
    return bitmap as unknown as ImageBitmap;
  };
  Object.assign(page, overrides);
}

/** A page whose snapshot the test finishes by hand — the window every lifecycle race opens in. */
function pageWithDeferredBitmap(frame: Frame): { snap: () => void } {
  let take: () => void = () => {};
  pageWith(frame, {
    createImageBitmap: () =>
      new Promise<ImageBitmap>((resolve) => {
        take = () => {
          const bitmap = new FakeBitmap(frame);
          bitmaps.push(bitmap);
          resolve(bitmap as unknown as ImageBitmap);
        };
      }),
  });
  return { snap: () => take() };
}

/** The video the client snapshots — never read here, since `createImageBitmap` is faked. */
const video = (): HTMLVideoElement => ({}) as HTMLVideoElement;
/** Enough turns of the microtask queue for a `prepare` to reach its post. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

afterEach(() => {
  Object.assign(page, original);
  FakeWorker.built = [];
  FakeWorker.refuse = null;
  bitmaps = [];
  vi.restoreAllMocks();
});

describe('canOffload — whether a page can hand a picture to a worker at all', () => {
  it('needs all three of Worker, createImageBitmap and OffscreenCanvas', () => {
    pageWith(picture(8, 6));
    expect(canOffload()).toBe(true);
    pageWith(picture(8, 6), { Worker: undefined });
    expect(canOffload()).toBe(false);
    pageWith(picture(8, 6), { createImageBitmap: undefined });
    expect(canOffload()).toBe(false);
    pageWith(picture(8, 6), { OffscreenCanvas: undefined });
    expect(canOffload()).toBe(false);
  });
});

describe('LetterboxOffload — where the letterbox runs', () => {
  it('answers on this thread, through the fallback, when the page has no Worker', async () => {
    const frame = picture(8, 6);
    const fallback = vi.fn(() => frame);
    pageWith(frame, { Worker: undefined });
    const offload = new LetterboxOffload();
    expect(offload.offloading).toBe(false);
    const prepared = await offload.prepare(video(), fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(FakeWorker.built).toEqual([]);
    // Not the caller's to keep: the fallback's frame is whatever the source handed over.
    expect(prepared.owned).toBe(false);
    expect(prepared.frame).toBe(frame);
    expect(prepared.imgsz).toBe(IMG_SIZE);
    expect(prepared.data).toEqual(preprocess(frame).data);
  });

  it('answers on this thread when asked to, even with a worker to hand', () => {
    // `onThread` is what a source with no `ready()` gets: its liveness verdicts live in `grab()`,
    // and a bitmap path that never calls it would snapshot a stopped camera for ever.
    const frame = picture(8, 6);
    const fallback = vi.fn(() => frame);
    pageWith(frame);
    const offload = new LetterboxOffload();
    expect(offload.offloading).toBe(true);
    const prepared = offload.onThread(fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(FakeWorker.built).toEqual([]);
    expect(prepared.owned).toBe(false);
    expect(prepared.data).toEqual(preprocess(frame).data);
  });

  it('hands the picture to a worker when there is one, and reads no pixel on this thread', async () => {
    const frame = picture(8, 6);
    const fallback = vi.fn(() => frame);
    pageWith(frame);
    const offload = new LetterboxOffload();
    expect(offload.offloading).toBe(true);
    const pending = offload.prepare(video(), fallback);
    await settle();
    expect(fallback).not.toHaveBeenCalled();
    const worker = FakeWorker.last();
    // A module worker at a same-origin URL beside the panel bundle.
    expect(worker.url.href).toMatch(/letterbox-worker\.js$/);
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.posted).toHaveLength(1);
    // The bitmap is TRANSFERRED, never cloned: a copy would be the 3.7 MB the worker exists to save.
    expect(worker.transferred[0]).toEqual([worker.posted[0]!.bitmap]);

    worker.answer();
    const prepared = await pending;
    expect(prepared.owned).toBe(true);
    expect(prepared.imgsz).toBe(IMG_SIZE);
    // THE ONE POSITIVE CLAIM: the worker's tensor is the page's tensor, on the same pixels.
    expect(prepared.data).toEqual(preprocess(frame).data);
    expect(prepared.frame).toEqual(frame);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('re-uses its worker across frames instead of spawning one per tick', async () => {
    const frame = picture(8, 6);
    pageWith(frame);
    const offload = new LetterboxOffload();
    for (let tick = 0; tick < 3; tick++) {
      const pending = offload.prepare(video(), () => frame);
      await settle();
      FakeWorker.last().answer(tick);
      await pending;
    }
    expect(FakeWorker.built).toHaveLength(1);
    expect(FakeWorker.last().posted.map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it('refuses a second frame while one is out, and still answers the first', async () => {
    // One in flight, like the panel's own tick guard: a frame prepared behind another is a frame
    // the loop is not going to run, so queueing it would only build a backlog of stale pictures.
    const frame = picture(8, 6);
    pageWith(frame);
    const offload = new LetterboxOffload();
    const first = offload.prepare(video(), () => frame);
    await settle();
    await expect(offload.prepare(video(), () => frame)).rejects.toThrow(/already being prepared/);
    FakeWorker.last().answer();
    await expect(first).resolves.toMatchObject({ owned: true });
  });

  it('takes the in-flight slot BEFORE the snapshot, so two calls cannot both post', async () => {
    // The slot used to be taken only once `createImageBitmap` had resolved. Two calls inside that
    // window both passed the one-request guard, both posted, and the second overwrote the first's
    // slot — whose promise then never settled, and the loop waited on a frame that never came.
    const frame = picture(8, 6);
    const { snap } = pageWithDeferredBitmap(frame);
    const offload = new LetterboxOffload();
    const first = offload.prepare(video(), () => frame);
    await Promise.resolve();
    await expect(offload.prepare(video(), () => frame)).rejects.toThrow(/already being prepared/);
    snap();
    await settle();
    const worker = FakeWorker.last();
    expect(worker.posted).toHaveLength(1);
    worker.answer();
    await expect(first).resolves.toMatchObject({ owned: true });
    // …and the second, refused, took no bitmap and left nothing behind.
    expect(bitmaps).toHaveLength(1);
  });

  it('reads a video the engine will not snapshot as "not yet", and posts nothing', async () => {
    // `createImageBitmap` rejects on a video with no picture (InvalidStateError). That is the same
    // "not yet" a zero-sized video is on the page path, and the loop skips the tick for it.
    const frame = picture(8, 6);
    pageWith(frame, {
      createImageBitmap: async () => {
        throw new DOMException('no frame', 'InvalidStateError');
      },
    });
    const offload = new LetterboxOffload();
    const refused = offload.prepare(video(), () => frame);
    await expect(refused).rejects.toBeInstanceOf(FrameNotReadyError);
    // With a reason that names THIS condition, not the zero-size one.
    await expect(refused).rejects.toThrow(/no picture to snapshot/);
    expect(FakeWorker.last().posted).toEqual([]);
    // And nothing is left in flight: the next tick asks again.
    const next = offload.prepare(video(), () => frame);
    await expect(next).rejects.toBeInstanceOf(FrameNotReadyError);
  });

  it('rethrows a snapshot failure that is NOT "not yet", and leaves nothing in flight', async () => {
    // Every `createImageBitmap` rejection used to become FrameNotReadyError, so a detached element,
    // a security refusal or an allocation the engine could not make read as "try again next tick"
    // — and `WebDetector.next()` idled for ever on a camera that was never going to deliver.
    const frame = picture(8, 6);
    pageWith(frame, {
      createImageBitmap: async () => {
        throw new TypeError('The provided value is not of type HTMLVideoElement');
      },
    });
    const offload = new LetterboxOffload();
    const refused = offload.prepare(video(), () => frame);
    await expect(refused).rejects.toBeInstanceOf(TypeError);
    await expect(refused).rejects.not.toBeInstanceOf(FrameNotReadyError);
    // The slot was released with the failure: the next frame is not told one is being prepared.
    await expect(offload.prepare(video(), () => frame)).rejects.toBeInstanceOf(TypeError);
  });

  it('drops a reply nothing is waiting for rather than landing it on another tick', async () => {
    const frame = picture(8, 6);
    pageWith(frame);
    const offload = new LetterboxOffload();
    const pending = offload.prepare(video(), () => frame);
    await settle();
    const worker = FakeWorker.last();
    // A stale answer, under an id this client never issued.
    const stale = handleLetterboxRequest({ id: 99, frame: picture(4, 4) });
    worker.send(stale);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    worker.answer();
    const prepared = await pending;
    expect(prepared.frame.width).toBe(8);
  });

  it('relays a failure the worker reports as a rejection of that frame', async () => {
    const frame = picture(8, 6);
    pageWith(frame);
    const offload = new LetterboxOffload();
    const pending = offload.prepare(video(), () => frame);
    await settle();
    const worker = FakeWorker.last();
    worker.send({ id: worker.posted[0]!.id, error: 'a 0x0 frame is not an image' });
    await expect(pending).rejects.toThrow(/letterbox worker: a 0x0 frame is not an image/);
    // The worker itself is fine; the next frame goes to it.
    expect(worker.terminated).toBe(false);
    expect(offload.offloading).toBe(true);
  });

  it('cancel() abandons the frame in flight and keeps the worker for the next one', async () => {
    // What a `stop()` mid-frame wants: the tick that was out is told, the worker is not rebuilt,
    // and the answer the worker still sends for the abandoned frame lands on nobody.
    const frame = picture(8, 6);
    pageWith(frame);
    const offload = new LetterboxOffload();
    const abandoned = offload.prepare(video(), () => frame);
    await settle();
    const worker = FakeWorker.last();
    offload.cancel('letterbox: the camera was stopped mid-frame');
    await expect(abandoned).rejects.toThrow(/stopped mid-frame/);
    expect(worker.terminated).toBe(false);

    const next = offload.prepare(video(), () => frame);
    await settle();
    expect(FakeWorker.built).toHaveLength(1);
    worker.answer(0); // the late reply to the abandoned frame…
    let settled = false;
    void next.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false); // …answers nothing
    worker.answer(1);
    await expect(next).resolves.toMatchObject({ owned: true });
  });
});

describe('LetterboxOffload — the ways of having no worker', () => {
  it('falls back for good when the worker cannot be built, and warns once', async () => {
    // A CSP that forbids workers, or a URL that cannot be resolved: `new Worker` throws. Every
    // later tick would throw the same way, so the client stops trying rather than paying the
    // attempt on every frame.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    FakeWorker.refuse = new Error('refused by CSP');
    const frame = picture(8, 6);
    const fallback = vi.fn(() => frame);
    pageWith(frame);
    const offload = new LetterboxOffload();
    expect(offload.offloading).toBe(true);
    const prepared = await offload.prepare(video(), fallback);
    expect(prepared.owned).toBe(false);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(offload.offloading).toBe(false);
    await offload.prepare(video(), fallback);
    expect(fallback).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('writes off a worker that fails before it ever spoke, and answers the frame it held', async () => {
    // A worker that builds and then cannot load — a 404 on the bundle — arrives as an `error`
    // event with a frame in flight. That frame's tick fails loud; the next tick falls back; and no
    // second worker is built, because it would fail the same way.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const frame = picture(8, 6);
    const fallback = vi.fn(() => frame);
    pageWith(frame);
    const offload = new LetterboxOffload();
    const pending = offload.prepare(video(), fallback);
    await settle();
    const worker = FakeWorker.last();
    worker.fail();
    await expect(pending).rejects.toThrow(/failed while preparing a frame/);
    expect(worker.terminated).toBe(true);
    expect(offload.offloading).toBe(false);
    const prepared = await offload.prepare(video(), fallback);
    expect(prepared.owned).toBe(false);
    expect(FakeWorker.built).toHaveLength(1);
  });

  it('replaces a worker that dies after it had answered, rather than writing the path off', async () => {
    // One that HAD spoken can load; it simply died (memory pressure, a crashed renderer process).
    // The frame it held is lost with it, and the next tick builds another.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const frame = picture(8, 6);
    pageWith(frame);
    const offload = new LetterboxOffload();
    const first = offload.prepare(video(), () => frame);
    await settle();
    FakeWorker.last().answer();
    await first;

    const second = offload.prepare(video(), () => frame);
    await settle();
    FakeWorker.last().fail();
    await expect(second).rejects.toThrow(/failed while preparing a frame/);
    expect(offload.offloading).toBe(true);

    const third = offload.prepare(video(), () => frame);
    await settle();
    expect(FakeWorker.built).toHaveLength(2);
    FakeWorker.last().answer();
    await expect(third).resolves.toMatchObject({ owned: true });
  });

  it('treats a reply it cannot deserialise as the worker failing, not as a frame still in flight', async () => {
    // `messageerror` reaches neither the message listener nor the error one. Unhandled, the
    // request it answered stayed in flight for ever and every later frame was refused as "already
    // being prepared" — a scan that never took another picture, with no error anywhere.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const frame = picture(8, 6);
    pageWith(frame);
    const offload = new LetterboxOffload();
    const pending = offload.prepare(video(), () => frame);
    await settle();
    const worker = FakeWorker.last();
    worker.garble();
    await expect(pending).rejects.toThrow(/failed while preparing a frame/);
    expect(worker.terminated).toBe(true);
    // Nothing is in flight: the next frame is answered, on the page since this one never spoke.
    const next = await offload.prepare(video(), () => frame);
    expect(next.owned).toBe(false);
  });

  it('writes the path off on a FATAL failure, even from a worker that had answered before', async () => {
    // The worker's own machinery — no 2D context, a readback the engine refused — fails every
    // frame the same way. Relayed as an ordinary per-frame failure it kept the worker, and the scan
    // failed one tick at a time until the panel's own deadline; typed fatal, the client falls back
    // at once and for good.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const frame = picture(8, 6);
    const fallback = vi.fn(() => frame);
    pageWith(frame);
    const offload = new LetterboxOffload();
    const first = offload.prepare(video(), fallback);
    await settle();
    FakeWorker.last().answer();
    await first;

    const second = offload.prepare(video(), fallback);
    await settle();
    const worker = FakeWorker.last();
    worker.send({ id: worker.posted[1]!.id, error: 'no 2D context', fatal: true });
    await expect(second).rejects.toThrow(/letterbox worker: no 2D context/);
    expect(worker.terminated).toBe(true);
    expect(offload.offloading).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const third = await offload.prepare(video(), fallback);
    expect(third.owned).toBe(false);
    expect(FakeWorker.built).toHaveLength(1);
  });

  it('leaves nothing in flight when the post itself fails, and closes the bitmap it could not send', async () => {
    // A bitmap the engine had already detached makes `postMessage` throw. That frame rejects —
    // the NEXT one must not be told "a frame is already being prepared" about it — and the bitmap,
    // never transferred, is still this thread's to close: left open, each such failure kept a
    // native surface alive until garbage collection found it.
    const frame = picture(8, 6);
    pageWith(frame);
    const offload = new LetterboxOffload();
    const first = offload.prepare(video(), () => frame);
    await settle();
    FakeWorker.last().answer();
    await first;
    FakeWorker.last().refusePost = new Error('detached');
    await expect(offload.prepare(video(), () => frame)).rejects.toThrow(/detached/);
    expect(bitmaps).toHaveLength(2);
    expect(bitmaps[1]!.closed).toBe(true);
    FakeWorker.last().refusePost = null;
    const third = offload.prepare(video(), () => frame);
    await settle();
    FakeWorker.last().answer(1);
    await expect(third).resolves.toMatchObject({ owned: true });
  });

  it('dispose() rejects the frame in flight, and a later frame gets a fresh worker', async () => {
    const frame = picture(8, 6);
    pageWith(frame);
    const offload = new LetterboxOffload();
    const pending = offload.prepare(video(), () => frame);
    await settle();
    const old = FakeWorker.last();
    offload.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
    expect(old.terminated).toBe(true);

    const next = offload.prepare(video(), () => frame);
    await settle();
    expect(FakeWorker.built).toHaveLength(2);
    // A late word from the old worker acts on nothing — the new one's frame is still open…
    old.answer();
    let settled = false;
    void next.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    // …until its own worker answers.
    FakeWorker.last().answer();
    await expect(next).resolves.toMatchObject({ owned: true });
  });

  it('posts nothing to a worker disposed while the snapshot was still being taken', async () => {
    // The worker was captured before `await createImageBitmap` and used after it. A `dispose()`
    // landing in between had stranded the request and terminated the worker — and the
    // continuation then posted the bitmap to it anyway. A terminated worker discards its queue, so
    // the newly installed slot could never be answered, and the bitmap was never closed.
    const frame = picture(8, 6);
    const { snap } = pageWithDeferredBitmap(frame);
    const offload = new LetterboxOffload();
    const pending = offload.prepare(video(), () => frame);
    await Promise.resolve();
    const old = FakeWorker.last();
    offload.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
    snap();
    await settle();
    expect(old.posted).toEqual([]);
    expect(bitmaps).toHaveLength(1);
    expect(bitmaps[0]!.closed).toBe(true);
    // The client is whole afterwards: a fresh worker, and a frame that gets answered.
    const next = offload.prepare(video(), () => frame);
    await Promise.resolve();
    snap(); // this frame's own snapshot
    await settle();
    expect(FakeWorker.built).toHaveLength(2);
    FakeWorker.last().answer();
    await expect(next).resolves.toMatchObject({ owned: true });
  });

  it('posts nothing to a worker that died while the snapshot was still being taken', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const frame = picture(8, 6);
    const { snap } = pageWithDeferredBitmap(frame);
    const offload = new LetterboxOffload();
    const pending = offload.prepare(video(), () => frame);
    await Promise.resolve();
    const old = FakeWorker.last();
    old.fail();
    await expect(pending).rejects.toThrow(/failed while preparing a frame/);
    snap();
    await settle();
    expect(old.posted).toEqual([]);
    expect(bitmaps[0]!.closed).toBe(true);
  });
});

describe('the worker entry, driven as the browser drives it', () => {
  /** What `pixelsOf` draws into: a canvas whose context hands back the bitmap's own pixels. */
  class FakeOffscreenCanvas {
    static built: FakeOffscreenCanvas[] = [];
    /** The next canvas built has no 2D context at all (an engine out of GPU memory). */
    static noContext = false;
    /** The next context built refuses its readback (a tainted or oversized surface). */
    static refuseReadback: Error | null = null;
    /** The next context built refuses to draw (a bitmap the engine has already closed). */
    static refuseDraw: Error | null = null;
    constructor(
      public width: number,
      public height: number,
    ) {
      FakeOffscreenCanvas.built.push(this);
    }
    getContext(): unknown {
      if (FakeOffscreenCanvas.noContext) return null;
      const refuse = FakeOffscreenCanvas.refuseReadback;
      const refuseDraw = FakeOffscreenCanvas.refuseDraw;
      let drawn: FakeBitmap | null = null;
      return {
        drawImage: (bitmap: FakeBitmap) => {
          if (refuseDraw) throw refuseDraw;
          drawn = bitmap;
        },
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          if (refuse) throw refuse;
          if (!drawn) throw new Error('nothing drawn');
          const { frame } = drawn as FakeBitmap;
          // What a real canvas does with a bitmap smaller than asked: the size asked for, and the
          // picture's pixels where they land. These tests only ever ask for the bitmap's own size.
          if (w !== frame.width || h !== frame.height) throw new Error('size mismatch');
          return { data: new Uint8ClampedArray(frame.data), width: w, height: h };
        },
      };
    }
  }

  /** The worker's global scope: what it listens on and what it posts through. */
  const posted: { message: unknown; options: unknown }[] = [];
  /** Set to make the scope refuse a post that TRANSFERS — the reply, never the failure. */
  let refuseTransfer: Error | null = null;
  const scope = Object.assign(new EventTarget(), {
    postMessage: (message: unknown, options?: { transfer?: unknown[] }) => {
      if (refuseTransfer && options?.transfer) throw refuseTransfer;
      posted.push({ message, options });
    },
  });
  const g = globalThis as { self?: unknown; OffscreenCanvas?: unknown };
  const had = { self: g.self, OffscreenCanvas: g.OffscreenCanvas };
  beforeAll(async () => {
    g.self = scope;
    // The entry registers its listener on `self` at import, once for this file.
    await import('../view/letterbox-worker.js');
  });
  beforeEach(() => {
    // Re-set per test: the file-level `afterEach` puts the page's globals back.
    g.OffscreenCanvas = FakeOffscreenCanvas;
    FakeOffscreenCanvas.noContext = false;
    FakeOffscreenCanvas.refuseReadback = null;
    refuseTransfer = null;
    posted.length = 0;
  });
  afterAll(() => {
    g.self = had.self;
    g.OffscreenCanvas = had.OffscreenCanvas;
  });
  const entry = async (): Promise<{ posted: typeof posted }> => ({ posted });

  const job = (id: number, frame: Frame): MessageEvent =>
    new MessageEvent('message', { data: { id, bitmap: new FakeBitmap(frame) } });

  it('answers a bitmap with the letterboxed tensor and the pixels, transferred, and closes the bitmap', async () => {
    const { posted } = await entry();
    const frame = picture(8, 6);
    const ev = job(7, frame);
    scope.dispatchEvent(ev);
    expect(posted).toHaveLength(1);
    const reply = posted[0]!.message as LetterboxReply;
    expect(reply.id).toBe(7);
    expect(reply.imgsz).toBe(IMG_SIZE);
    expect(reply.data).toEqual(preprocess(frame).data);
    expect(reply.frame).toEqual(frame);
    expect(posted[0]!.options).toEqual({ transfer: [reply.data.buffer, reply.frame.data.buffer] });
    expect((ev.data.bitmap as FakeBitmap).closed).toBe(true);
  });

  it('relays a frame the letterbox refuses as an ORDINARY failure under the same id, and still closes the bitmap', async () => {
    // A 0x0 bitmap: `preprocess` throws ("not an image"), and a worker that let that escape would
    // die owing its caller an answer — the frame would hang until the tick's own deadline. It is
    // that frame's fault and not the worker's, so it is not marked fatal.
    const { posted } = await entry();
    const ev = job(8, { data: new Uint8ClampedArray(0), width: 0, height: 0 });
    scope.dispatchEvent(ev);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.message).toEqual({
      id: 8,
      error: expect.stringMatching(/0x0 is not an image/),
    });
    expect(posted[0]!.message).not.toHaveProperty('fatal');
    expect((ev.data.bitmap as FakeBitmap).closed).toBe(true);
  });

  it('reports a canvas with no 2D context as FATAL', async () => {
    // Nothing about the next frame changes an engine that would not give this worker a context.
    // Relayed as an ordinary failure, the client kept the worker and every tick failed the same
    // way; fatal is what makes it fall back on the page instead.
    const { posted } = await entry();
    FakeOffscreenCanvas.noContext = true;
    const ev = job(9, picture(10, 10)); // a size no earlier case cached a canvas for
    scope.dispatchEvent(ev);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.message).toEqual({
      id: 9,
      error: expect.stringMatching(/no 2D context/),
      fatal: true,
    });
    expect((ev.data.bitmap as FakeBitmap).closed).toBe(true);
  });

  it('reports a readback the engine refuses as FATAL', async () => {
    const { posted } = await entry();
    FakeOffscreenCanvas.refuseReadback = new Error(
      'The canvas has been tainted by cross-origin data',
    );
    const ev = job(10, picture(12, 12));
    scope.dispatchEvent(ev);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.message).toEqual({
      id: 10,
      error: expect.stringMatching(/tainted/),
      fatal: true,
    });
    expect((ev.data.bitmap as FakeBitmap).closed).toBe(true);
  });

  it('reports a draw the engine refuses as FATAL', async () => {
    // The third infrastructure step (audit finding 74, on verification): `drawImage` throws for a
    // bitmap the engine has already detached or closed, which is no fault of the frame — and a
    // worker that reported it as an ordinary per-frame failure would be retried until the scan died.
    const { posted } = await entry();
    FakeOffscreenCanvas.refuseDraw = new DOMException(
      'The image argument is a detached ImageBitmap',
      'InvalidStateError',
    );
    try {
      // A size no other case uses: the entry keeps one canvas per size, and its context — with the
      // knobs it read — is built once, so a reused size would never see the refusal.
      const ev = job(12, picture(16, 16));
      scope.dispatchEvent(ev);
      expect(posted).toHaveLength(1);
      expect(posted[0]!.message).toEqual({
        id: 12,
        error: expect.stringMatching(/detached ImageBitmap/),
        fatal: true,
      });
      expect((ev.data.bitmap as FakeBitmap).closed).toBe(true);
    } finally {
      FakeOffscreenCanvas.refuseDraw = null;
    }
  });

  it('reports a reply the engine will not transfer as FATAL, rather than dying with the frame', async () => {
    const { posted } = await entry();
    refuseTransfer = new Error('DataCloneError: buffer could not be transferred');
    const ev = job(11, picture(14, 14));
    scope.dispatchEvent(ev);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.message).toEqual({
      id: 11,
      error: expect.stringMatching(/transferred/),
      fatal: true,
    });
    expect((ev.data.bitmap as FakeBitmap).closed).toBe(true);
  });

  it('keeps one canvas between frames of one size, and re-makes it only when the size changes', async () => {
    const { posted } = await entry();
    FakeOffscreenCanvas.built = [];
    scope.dispatchEvent(job(1, picture(8, 6)));
    scope.dispatchEvent(job(2, picture(8, 6)));
    expect(FakeOffscreenCanvas.built).toHaveLength(1);
    scope.dispatchEvent(job(3, picture(6, 8)));
    expect(FakeOffscreenCanvas.built).toHaveLength(2);
    expect(posted.map((p) => (p.message as LetterboxReply).id)).toEqual([1, 2, 3]);
  });
});
