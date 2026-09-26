// @vitest-environment happy-dom
//
// `WebDetector`'s LOAD lifecycle — the two races the park made ordinary and nothing covered.
//
// A model load is the most expensive thing this class does (a multi-megabyte fetch plus a compile,
// 1-5 s) and the only thing it owns that cannot be released by anyone else: an `InferenceSession`
// is a wasm heap or a GPU device, and a detector that drops one leaks it for the life of the page.
// Both cases here are about a load that lands after the world moved — one after `dispose()`, one
// after the model URL changed — and both are silent when they go wrong, which is why the
// assertions are about what must NOT have happened.
//
// The runtime is stubbed at `InferenceOffload.createRunner`, the one door this class loads a model
// through, deliberately: what is under test is when this class installs a runner and when it refuses
// to, and a real 25 MB wasm load would answer neither question while making the test a browser test.
// `tests/model-runner.test.ts` owns the runtime and `tests/inference-worker.test.ts` the worker it
// runs in. (It was stubbed at `createModelRunner` until 2026-09-22, when the load moved behind the
// worker: a stub there is skipped whenever a case gives the page a `Worker`, as the letterbox cases do.)

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraLostError, FrameNotReadyError } from '../src/camera.js';
import { IMG_SIZE, preprocess } from '../src/onnx-detect.js';
import type { Frame } from '../src/types.js';
import { INFERENCE_WORKER_LOST, InferenceWorkerLostError } from '../view/inference-client.js';
import { handleLetterboxRequest, type LetterboxReply } from '../view/letterbox-protocol.js';
import type { LetterboxJob } from '../view/letterbox-worker.js';
import { WebDetector } from '../view/web-detector.js';

/** One `createRunner` call, held open so the test decides when the model "arrives". */
interface PendingLoad {
  modelUrl: string;
  opts: { wasmPaths?: string; ortUrl?: string; signal?: AbortSignal };
  resolve: (runner: unknown) => void;
  reject: (err: unknown) => void;
}

const seam = vi.hoisted(() => ({
  pending: [] as {
    modelUrl: string;
    opts: { wasmPaths?: string; ortUrl?: string; signal?: AbortSignal };
    resolve: (runner: unknown) => void;
    reject: (err: unknown) => void;
  }[],
  released: [] as string[],
  /** Every `openCamera` call: the options it was given and the switch that settles it. */
  cameras: [] as {
    settle: (source: unknown) => void;
    fail: (err: unknown) => void;
  }[],
  /** Sources whose `stop()` ran — by the label the test gave them. */
  stopped: [] as string[],
}));

vi.mock('../view/inference-client.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../view/inference-client.js')>();
  return {
    ...real,
    InferenceOffload: class {
      createRunner(
        modelUrl: string,
        opts: { wasmPaths?: string; ortUrl?: string; signal?: AbortSignal },
      ): Promise<unknown> {
        return new Promise((resolve, reject) => {
          seam.pending.push({ modelUrl, opts, resolve, reject });
        });
      }
    },
  };
});

vi.mock('../src/camera.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/camera.js')>();
  return {
    ...real,
    listCameras: async () => [],
    openCamera: () =>
      new Promise((settle, fail) => {
        seam.cameras.push({ settle, fail });
      }),
  };
});

const pending = (): PendingLoad[] => seam.pending;

/**
 * A runner that says which model it is.
 *
 * `providers` carries the identity rather than a separate field, because it is the one thing about
 * an installed runner this class exposes — so "which model is installed" is answerable from
 * outside without reaching into a private.
 */
function runnerFor(id: string): unknown {
  return Object.assign(async () => ({ data: new Float32Array(0), anchors: 0, rows: 10 }), {
    dispose: async (): Promise<void> => {
      seam.released.push(id);
    },
    providers: [id],
  });
}

const videoEl = (): HTMLVideoElement => document.createElement('video');
/** `dispose()` is fire-and-forget by contract, so a release lands a microtask later. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A `FrameSource` that records being stopped, so a released stream is observable. */
function sourceNamed(id: string): unknown {
  return {
    device: { deviceId: id, label: id },
    grab: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    stop: () => {
      seam.stopped.push(id);
    },
  };
}

afterEach(() => {
  seam.pending.length = 0;
  seam.released.length = 0;
  seam.cameras.length = 0;
  seam.stopped.length = 0;
});

describe('WebDetector — a load that lands after the world moved', () => {
  it('releases a runner that arrives after dispose() instead of installing it', async () => {
    // The panel disconnects during the model load — a screen swap mid-download, or a detector that
    // loses the park race and is disposed on the way back. The load then finished and committed
    // its runner anyway, so a detector nothing holds kept an InferenceSession alive with no
    // reference left able to release it. That is precisely the leak the park exists to close.
    const video = videoEl();
    const det = new WebDetector(
      () => video,
      () => './model-a.onnx',
    );
    const loading = det.load();
    expect(pending()).toHaveLength(1);

    det.dispose();
    pending()[0]!.resolve(runnerFor('A'));
    await loading;

    // Nothing installed on a discarded detector…
    expect(det.providers).toBeNull();
    // …and the session it would have held was given back.
    await flush();
    expect(seam.released).toEqual(['A']);
  });

  it('does not answer a request for model B with a load of model A', async () => {
    // The in-flight guard handed every caller the pending promise whatever URL they asked for, so
    // asking for B while A loaded RESOLVED SUCCESSFULLY with A installed — and `loadedUrl` then
    // said A while the owner believed B. The park is where a detector changes owner and model URL
    // at once (`retarget`), which is what makes this ordinary rather than theoretical.
    const video = videoEl();
    let url = './model-a.onnx';
    const det = new WebDetector(
      () => video,
      () => url,
    );
    const first = det.load();
    expect(pending()).toHaveLength(1);
    expect(pending()[0]?.modelUrl).toMatch(/model-a\.onnx$/);

    url = './model-b.onnx';
    const second = det.load();
    // Serialised, not raced: two sessions being created at once is what both guards prevent.
    expect(pending()).toHaveLength(1);

    pending()[0]!.resolve(runnerFor('A'));
    await first;

    // Only now does B's own load start — and it is B that is asked for. `flush` rather than one
    // microtask since 2026-09-05: B's load releases A BEFORE it builds, and a release is awaited,
    // which is also why A's installation is observable here as its RELEASE rather than as
    // `providers` — the queued load takes it down on its way in.
    await flush();
    expect(seam.released).toEqual(['A']);
    expect(pending()).toHaveLength(2);
    expect(pending()[1]?.modelUrl).toMatch(/model-b\.onnx$/);
    pending()[1]!.resolve(runnerFor('B'));
    await second;
    expect(det.providers).toEqual(['B']);
    // A was replaced, not merely forgotten.
    await flush();
    expect(seam.released).toEqual(['A']);
  });

  it('still shares one load between two callers asking for the SAME model', async () => {
    // The guard the case above must not have broken: the panel's slow-load timeout abandons the
    // wait and the user presses Start, and both callers must land on one session.
    const video = videoEl();
    const det = new WebDetector(
      () => video,
      () => './model-a.onnx',
    );
    const a = det.load();
    const b = det.load();
    expect(pending()).toHaveLength(1);
    pending()[0]!.resolve(runnerFor('A'));
    await Promise.all([a, b]);
    expect(pending()).toHaveLength(1);
    expect(det.providers).toEqual(['A']);
    // A finished load is not repeated either.
    await det.load();
    expect(pending()).toHaveLength(1);
  });

  it('does not start a QUEUED load for B on a detector disposed while it waited', async () => {
    // The hole the per-URL guard opened. A load for B that arrives while A is in flight does not
    // start its own session — it waits for A and then re-enters `load()`, and that re-entry read
    // the disposal generation AS IT WAS BY THEN. So a panel that disconnects during the wait —
    // exactly the window the park makes ordinary — got B's session built and INSTALLED on a
    // detector nobody holds: an InferenceSession with no reference left able to release it, which
    // is the one leak this class has no way back from.
    const video = videoEl();
    let url = './model-a.onnx';
    const det = new WebDetector(
      () => video,
      () => url,
    );
    const first = det.load();
    url = './model-b.onnx';
    const queued = det.load();
    expect(pending()).toHaveLength(1); // B is waiting on A, not racing it

    det.dispose();
    pending()[0]!.resolve(runnerFor('A'));
    await first;
    await queued;

    // B's load never started…
    await flush();
    expect(pending()).toHaveLength(1);
    // …nothing was installed…
    expect(det.providers).toBeNull();
    // …and A, which was already out when the dispose landed, was given back.
    expect(seam.released).toEqual(['A']);
  });

  it('still starts a load asked for AFTER a dispose', async () => {
    // The other side of the same generation check: `dispose()` forgets the pending promise on
    // purpose, so a NEW caller is a new caller. Only a queue that was already waiting is stale.
    const video = videoEl();
    const det = new WebDetector(
      () => video,
      () => './model-a.onnx',
    );
    const abandoned = det.load();
    det.dispose();
    pending()[0]!.resolve(runnerFor('A'));
    await abandoned;

    const fresh = det.load();
    expect(pending()).toHaveLength(2);
    pending()[1]!.resolve(runnerFor('A2'));
    await fresh;
    expect(det.providers).toEqual(['A2']);
  });

  it('leaves the LAST model asked for installed, not the one that was loading', async () => {
    // THE INSTALLED-MODEL SHORTCUT, ASKED TOO EARLY. `if (this.run && loadedUrl === url) return`
    // read as the cheapest test first and was wrong in exactly the case the two guards were
    // combined for: with A installed and B on its way, a caller asking for A was told "already
    // loaded" and returned — and B then replaced A underneath it, so the LAST caller to ask ended
    // up scanning on a model nobody had asked it for. Reachable through the park, where the owner
    // and the model URL change together and a host may change its mind twice inside one load.
    const video = videoEl();
    let url = './model-a.onnx';
    const det = new WebDetector(
      () => video,
      () => url,
    );
    const toA = det.load();
    pending()[0]!.resolve(runnerFor('A'));
    await toA;
    expect(det.providers).toEqual(['A']);

    url = './model-b.onnx';
    const toB = det.load();
    await flush();
    expect(pending()).toHaveLength(2);
    url = './model-a.onnx';
    const backToA = det.load();

    pending()[1]!.resolve(runnerFor('B'));
    await toB;
    await flush();
    // A is asked for AFRESH rather than assumed: the runner that said A was released when B
    // started, so there is nothing installed to short-circuit on.
    expect(pending()).toHaveLength(3);
    pending()[2]!.resolve(runnerFor('A2'));
    await backToA;
    // The model the last caller asked for. Before this it was B, silently.
    expect(det.providers).toEqual(['A2']);
  });

  it('releases the model it is replacing BEFORE it builds the replacement', async () => {
    // Two `InferenceSession`s alive at once is the one arrangement that can fail for want of
    // memory on the machine least able to spare it — a phone swapping models mid-session — and
    // `load()` has documented the release-before-build order since it was written while doing it
    // in the other order: build, warm, time, and only then let the old heap go.
    const video = videoEl();
    let url = './model-a.onnx';
    const det = new WebDetector(
      () => video,
      () => url,
    );
    const first = det.load();
    pending()[0]!.resolve(runnerFor('A'));
    await first;

    url = './model-b.onnx';
    const second = det.load();
    await flush();
    // A is gone by the time B is even asked for, and the detector says so meanwhile: `loadedModel`
    // reports what is INSTALLED, so a reader caught mid-swap is told nothing rather than A.
    expect(seam.released).toEqual(['A']);
    expect(pending()).toHaveLength(2);
    expect(det.providers).toBeNull();
    pending()[1]!.resolve(runnerFor('B'));
    await second;
    expect(det.providers).toEqual(['B']);
    expect(seam.released).toEqual(['A']);
  });

  it('builds nothing for a detector disposed while the old model was still being released', async () => {
    // The window the release-before-build order opens: `dispose()` can land while the OUTGOING
    // session is being given back, and the replacement is not built yet. Building and installing it
    // then would put a live InferenceSession on a detector nobody holds — the one leak this class
    // has no way back from, arriving through the door the memory fix had just opened.
    const video = videoEl();
    let url = './model-a.onnx';
    const det = new WebDetector(
      () => video,
      () => url,
    );
    const first = det.load();
    let finishRelease = (): void => {};
    pending()[0]!.resolve(
      Object.assign(async () => ({ data: new Float32Array(0), anchors: 0, rows: 10 }), {
        dispose: (): Promise<void> =>
          new Promise<void>((resolve) => {
            finishRelease = (): void => {
              seam.released.push('A');
              resolve();
            };
          }),
        providers: ['A'],
      }),
    );
    await first;

    url = './model-b.onnx';
    const second = det.load();
    await flush();
    expect(pending()).toHaveLength(1); // still inside the release; B has not been asked for

    det.dispose();
    finishRelease();
    await second;
    await flush();

    // B's session was never created, so there is nothing to leak and nothing installed.
    expect(pending()).toHaveLength(1);
    expect(det.providers).toBeNull();
    expect(seam.released).toEqual(['A']);
  });

  it('a failed load does not wedge the next one', async () => {
    const video = videoEl();
    const det = new WebDetector(
      () => video,
      () => './model-a.onnx',
    );
    const failing = det.load();
    pending()[0]!.reject(new Error('the model would not load'));
    await expect(failing).rejects.toThrow(/would not load/);
    const retry = det.load();
    expect(pending()).toHaveLength(2);
    pending()[1]!.resolve(runnerFor('A'));
    await retry;
    expect(det.providers).toEqual(['A']);
  });
});

describe('WebDetector — the camera-open completion boundary', () => {
  it('does not install a camera that resolved after stop()', async () => {
    // `openCamera` releases its stream itself while it is still opening — but once it has RESOLVED
    // its abort listener is gone, and the microtask between that resolution and `use()` resuming
    // was guarded by nothing. A `stop()` landing there found `source` still null and returned;
    // `use()` then assigned the live stream onto a detector the caller had just stopped. The lens
    // stayed on, and `Detector.use`'s promise that a cancelled open rejects was broken in exactly
    // the case it exists for.
    const det = new WebDetector(videoEl, () => './model-a.onnx');
    const opening = det.use({});
    await Promise.resolve();
    expect(seam.cameras).toHaveLength(1);

    // Resolve FIRST, then stop before the awaiting `use()` gets its turn.
    seam.cameras[0]!.settle(sourceNamed('cam-1'));
    det.stop();

    await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    // Nothing installed…
    expect(det.device).toBeNull();
    // …and the stream that was opened behind the stop was released rather than left running.
    expect(seam.stopped).toEqual(['cam-1']);
  });

  it('installs a camera that resolved with nothing superseding it', async () => {
    const det = new WebDetector(videoEl, () => './model-a.onnx');
    const opening = det.use({});
    await Promise.resolve();
    seam.cameras[0]!.settle(sourceNamed('cam-1'));
    await opening;
    expect(det.device).toEqual({ deviceId: 'cam-1', label: 'cam-1' });
    expect(seam.stopped).toEqual([]);
  });
});

describe('WebDetector — next(), the one call the scan loop makes', () => {
  /**
   * A detector with a camera open and a model installed — the state `next()` requires.
   *
   * Built through the public methods rather than by reaching into privates, because what is under
   * test is what `next()` does with what those two left behind.
   */
  async function ready(
    grab?: () => unknown,
    runner: unknown = runnerFor('A'),
  ): Promise<WebDetector> {
    const det = new WebDetector(videoEl, () => './model-a.onnx');
    const opening = det.use({});
    await Promise.resolve();
    const source = sourceNamed('cam-1') as Record<string, unknown>;
    if (grab) source.grab = grab;
    seam.cameras[0]!.settle(source);
    await opening;
    const loading = det.load();
    pending()[0]!.resolve(runner);
    await loading;
    return det;
  }

  it('preprocesses the frame and hands back what the model said, with the frame', async () => {
    const det = await ready();
    await expect(det.next()).resolves.toEqual({
      data: expect.any(Float32Array),
      anchors: 0,
      rows: 10,
      // The frame travels with the output: the panel reads the paint under the fitted stickers from
      // it, and this is the last moment it exists.
      frame: {
        data: expect.any(Uint8ClampedArray),
        width: expect.any(Number),
        height: expect.any(Number),
      },
    });
  });

  it('hands back a COPY of the frame, because the grabber reuses its buffer', async () => {
    // A reference would be overwritten by the next tick before the panel has read the pixels under
    // the stickers — and the read would silently describe a later frame than the fit it belongs to.
    const buffer = new Uint8ClampedArray(4 * 4 * 4).fill(9);
    const det = await ready(() => ({ data: buffer, width: 4, height: 4 }));
    const out = await det.next();
    buffer.fill(200);
    expect(out?.frame?.data[0]).toBe(9);
  });

  it('answers null for a camera that has opened but delivered nothing yet', async () => {
    // "Not yet" is a tick to skip, not a failure: a camera takes a moment to produce its first
    // frame and the loop simply asks again.
    const det = await ready(() => {
      throw new FrameNotReadyError();
    });
    await expect(det.next()).resolves.toBeNull();
  });

  it('rejects a frame that genuinely cannot be read, rather than skipping the tick', async () => {
    // THE FAIL-LOUD RULE, at the app's most important surface. A bare `catch { return null }` here
    // turned every failure into "try again next tick" — a canvas that could not be allocated, a
    // `getImageData` refused by a tainted surface, a video element the owner detached — and the
    // scanner then idled forever on "Show any side" with a camera that was never going to deliver.
    const det = await ready(() => {
      throw new TypeError('the canvas is tainted');
    });
    await expect(det.next()).rejects.toThrow(/tainted/);
  });

  it('lets an inference failure escape to the caller', async () => {
    // The panel counts failing ticks and eventually says the scanner stopped; it can only do that
    // if a run that rejects reaches it.
    const failing = Object.assign(
      async (): Promise<never> => {
        throw new Error('the session died');
      },
      { dispose: async (): Promise<void> => {}, providers: ['A'] },
    );
    const det = await ready(undefined, failing);
    await expect(det.next()).rejects.toThrow(/session died/);
  });

  it('refuses to run at all without a camera or without a model', async () => {
    const noCamera = new WebDetector(videoEl, () => './model-a.onnx');
    await expect(noCamera.next()).rejects.toThrow(/no camera open/);

    const noModel = new WebDetector(videoEl, () => './model-a.onnx');
    const opening = noModel.use({});
    await Promise.resolve();
    seam.cameras[0]!.settle(sourceNamed('cam-1'));
    await opening;
    await expect(noModel.next()).rejects.toThrow(/model not loaded/);
  });

  it('is usable again after dispose(), which releases rather than tombstones', async () => {
    // `Detector.dispose` says what this does and it is not "the detector is unusable afterwards":
    // the disposal paths and the re-use paths overlap by construction at the park, so a refusal
    // here would turn "the panel came back" into "the scanner is dead".
    const det = await ready();
    det.dispose();
    await flush();
    expect(seam.released).toEqual(['A']);
    expect(det.device).toBeNull();

    const opening = det.use({});
    await Promise.resolve();
    seam.cameras[1]!.settle(sourceNamed('cam-2'));
    await opening;
    const loading = det.load();
    pending()[1]!.resolve(runnerFor('A2'));
    await loading;
    expect(det.device).toEqual({ deviceId: 'cam-2', label: 'cam-2' });
    await expect(det.next()).resolves.toMatchObject({ rows: 10 });
  });
});

describe('WebDetector — next() with the letterbox on another thread (2026-09-20)', () => {
  /** The worker path's three facilities, faked on the page this suite's detector reads them from. */
  class FakeBitmap {
    constructor(readonly frame: Frame) {}
    close(): void {}
  }
  class FakeWorker {
    static built: FakeWorker[] = [];
    posted: LetterboxJob[] = [];
    /** What the last `answer` sent, so the caller's frame can be compared with it by identity. */
    sent: LetterboxReply | null = null;
    terminated = false;
    private listeners = new Map<string, ((ev: unknown) => void)[]>();
    constructor() {
      FakeWorker.built.push(this);
    }
    addEventListener(type: string, fn: (ev: unknown) => void): void {
      const list = this.listeners.get(type) ?? [];
      list.push(fn);
      this.listeners.set(type, list);
    }
    postMessage(message: LetterboxJob): void {
      this.posted.push(message);
    }
    terminate(): void {
      this.terminated = true;
    }
    answer(index = 0): void {
      const job = this.posted[index];
      if (!job) throw new Error(`nothing posted at ${index}`);
      const reply = handleLetterboxRequest({
        id: job.id,
        frame: (job.bitmap as unknown as FakeBitmap).frame,
      });
      this.sent = reply;
      for (const fn of this.listeners.get('message') ?? []) fn({ data: reply });
    }
  }
  const page = globalThis as {
    Worker?: unknown;
    createImageBitmap?: unknown;
    OffscreenCanvas?: unknown;
  };
  const PICTURE: Frame = { data: new Uint8ClampedArray(4 * 4 * 4).fill(77), width: 4, height: 4 };

  /** Give the page a worker and a bitmap factory; happy-dom already has `OffscreenCanvas`. */
  function withWorker(): void {
    FakeWorker.built = [];
    page.Worker = FakeWorker;
    page.createImageBitmap = async () => new FakeBitmap(PICTURE);
  }
  /** As `withWorker`, with a snapshot the test finishes by hand. */
  function withDeferredWorker(): { snap: () => void } {
    withWorker();
    let take: () => void = () => {};
    page.createImageBitmap = () =>
      new Promise<FakeBitmap>((resolve) => {
        take = () => resolve(new FakeBitmap(PICTURE));
      });
    return { snap: () => take() };
  }
  afterEach(() => {
    page.Worker = undefined;
    delete page.createImageBitmap;
    FakeWorker.built = [];
  });

  /** A source that gives its liveness verdict ahead of the read, so the bitmap path may take it. */
  const readySource = (): Record<string, unknown> => ({
    ...(sourceNamed('cam-1') as object),
    ready: () => {},
  });
  /** Enough turns of the microtask queue for a tick to reach its post. */
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  /** A runner that records what it was fed. */
  function recordingRunner(fed: { input: Float32Array; imgsz: number }[]): unknown {
    return Object.assign(
      async (input: Float32Array, imgsz: number) => {
        fed.push({ input, imgsz });
        return { data: new Float32Array(0), anchors: 0, rows: 10 };
      },
      { dispose: async (): Promise<void> => {}, providers: ['R'] },
    );
  }

  async function readyWith(source: Record<string, unknown>, runner: unknown): Promise<WebDetector> {
    const det = new WebDetector(videoEl, () => './model-a.onnx');
    const opening = det.use({});
    await Promise.resolve();
    seam.cameras[0]!.settle(source);
    await opening;
    const loading = det.load();
    pending()[0]!.resolve(runner);
    await loading;
    return det;
  }

  it('takes the picture as a bitmap, runs the model on the worker’s tensor, and keeps the worker’s frame without a second copy', async () => {
    withWorker();
    const grab = vi.fn(() => PICTURE);
    const fed: { input: Float32Array; imgsz: number }[] = [];
    const det = await readyWith({ ...readySource(), grab }, recordingRunner(fed));
    const tick = det.next();
    await settle();
    const worker = FakeWorker.built[0]!;
    expect(worker.posted).toHaveLength(1);
    worker.answer();
    const out = await tick;
    // No pixel was read on this thread…
    expect(grab).not.toHaveBeenCalled();
    // …the model saw the worker's tensor, which is the page's tensor…
    expect(fed).toHaveLength(1);
    expect(fed[0]!.imgsz).toBe(IMG_SIZE);
    expect(fed[0]!.input).toEqual(preprocess(PICTURE).data);
    // …and the frame that travels with the output is the worker's buffer itself: it was
    // transferred, nothing else holds it, and copying it again would put the 3.7 MB copy per tick
    // back on the thread the worker took it off.
    expect(out?.frame?.data).toBe(worker.sent!.frame.data);
  });

  it('asks the source whether it is live before taking a bitmap: not-ready skips the tick, lost fails it', async () => {
    // The bitmap path never calls `grab()`, so the camera's own verdicts — the two that used to
    // live only inside it — have to be asked at the door, or a camera that stopped delivering
    // would go on being snapshotted as a frozen picture forever.
    withWorker();
    let verdict: Error | null = new FrameNotReadyError();
    const grab = vi.fn(() => PICTURE);
    const source = {
      ...(sourceNamed('cam-1') as object),
      grab,
      ready: () => {
        if (verdict) throw verdict;
      },
    };
    const det = await readyWith(source, runnerFor('A'));
    await expect(det.next()).resolves.toBeNull();
    verdict = new CameraLostError('the camera stopped delivering');
    await expect(det.next()).rejects.toBeInstanceOf(CameraLostError);
    expect(grab).not.toHaveBeenCalled();
    expect(FakeWorker.built[0]?.posted ?? []).toEqual([]);
  });

  it('still copies the frame on the page path, where the grabber’s buffer is reused', async () => {
    // No worker on this page: the fallback runs `grab()`, whose buffer the source may overwrite on
    // the next tick, and the copy that has always protected the panel's pixel reads stays.
    const buffer = new Uint8ClampedArray(4 * 4 * 4).fill(9);
    const det = await readyWith(
      { ...(sourceNamed('cam-1') as object), grab: () => ({ data: buffer, width: 4, height: 4 }) },
      runnerFor('A'),
    );
    const out = await det.next();
    expect(out?.frame?.data).not.toBe(buffer);
    buffer.fill(200);
    expect(out?.frame?.data[0]).toBe(9);
  });

  it('dispose() takes the letterbox worker with it, and the tick it held answers null', async () => {
    withWorker();
    const det = await readyWith(readySource(), runnerFor('A'));
    const tick = det.next();
    await settle();
    const worker = FakeWorker.built[0]!;
    det.dispose();
    expect(worker.terminated).toBe(true);
    // Null, not the worker's "disposed" rejection: the detector was told to go away, and a
    // rejection here would start the panel's failure clock over a detector that did exactly that.
    await expect(tick).resolves.toBeNull();
  });

  it('reads a source with no ready() through grab(), never as a bitmap', async () => {
    // `FrameSource.ready` is optional: a source that cannot say ahead of time answers at `grab()`,
    // and that answer still stands. The bitmap path never calls `grab()`, so such a source used to
    // lose its only liveness check there — a camera that stopped would have been snapshotted as a
    // frozen picture on every tick, for ever.
    withWorker();
    const grab = vi.fn(() => PICTURE);
    const det = await readyWith({ ...(sourceNamed('cam-1') as object), grab }, runnerFor('A'));
    const out = await det.next();
    expect(grab).toHaveBeenCalledTimes(1);
    expect(FakeWorker.built).toEqual([]);
    // And the grabber's buffer is copied, as on any page-thread read.
    expect(out?.frame?.data).not.toBe(PICTURE.data);
    expect(out?.frame?.data[0]).toBe(77);
  });

  it('rejects a snapshot the engine refuses for good, rather than skipping the tick', async () => {
    // Every `createImageBitmap` rejection used to become "not ready", so a detached element or a
    // security refusal was retried for ever as a camera that had not delivered yet.
    withWorker();
    page.createImageBitmap = async () => {
      throw new TypeError('the element is detached');
    };
    const det = await readyWith(readySource(), runnerFor('A'));
    await expect(det.next()).rejects.toThrow(/detached/);
  });

  it('answers null, and feeds no runner, for a tick whose model was replaced while its frame was out', async () => {
    // `next()` checked `this.run` before awaiting the letterbox and dereferenced the FIELD after
    // it. A `load()` for another model in between releases the outgoing runner through a null
    // `run` — a TypeError on a detector doing what it was told — or installs the new one, which
    // then ran a frame nobody asked it to.
    withWorker();
    let url = './model-a.onnx';
    const fedA: { input: Float32Array; imgsz: number }[] = [];
    const det = new WebDetector(videoEl, () => url);
    const opening = det.use({});
    await Promise.resolve();
    seam.cameras[0]!.settle(readySource());
    await opening;
    const loadA = det.load();
    pending()[0]!.resolve(recordingRunner(fedA));
    await loadA;

    const tick = det.next();
    await settle();
    const worker = FakeWorker.built[0]!;
    expect(worker.posted).toHaveLength(1);
    url = './model-b.onnx';
    const loadB = det.load(); // releases A first; B is not even asked for yet
    await flush();
    worker.answer();
    await expect(tick).resolves.toBeNull();
    expect(fedA).toEqual([]);

    const fedB: { input: Float32Array; imgsz: number }[] = [];
    pending()[1]!.resolve(recordingRunner(fedB));
    await loadB;
    expect(fedB).toEqual([]); // the stale frame did not run on the newcomer either
    // …and the next tick runs on B.
    const next = det.next();
    await settle();
    FakeWorker.built[0]!.answer(1);
    await expect(next).resolves.toMatchObject({ rows: 10 });
    expect(fedB).toHaveLength(1);
  });

  it('stop() abandons the frame in flight, so a restart is not told one is already being prepared', async () => {
    // A worker that had gone silent held the frame for ever, and every Stop/Start after it found
    // "a frame is already being prepared" — nothing the user could do got past it.
    withWorker();
    const det = await readyWith(readySource(), runnerFor('A'));
    const tick = det.next();
    await settle();
    expect(FakeWorker.built[0]!.posted).toHaveLength(1);
    det.stop(); // the worker never answered
    await expect(tick).resolves.toBeNull();

    const reopening = det.use({});
    await Promise.resolve();
    seam.cameras[1]!.settle(readySource());
    await reopening;
    const next = det.next();
    await settle();
    // The same worker, given the next frame — not refused, not rebuilt.
    expect(FakeWorker.built).toHaveLength(1);
    expect(FakeWorker.built[0]!.posted).toHaveLength(2);
    FakeWorker.built[0]!.answer(1);
    await expect(next).resolves.toMatchObject({ rows: 10 });
  });

  it('a run that SUCCEEDS after stop() answers null, like every other await here', async () => {
    // CODEX AUDIT, 2026-09-26. Every other await in `next()` re-checks its owner afterwards and the
    // success path did not, so a `stop()` landing during the inference came back with a finished
    // reading from a detector nobody was listening to. The panel's epoch guard throws it away
    // today — which is exactly why this was never seen, and why it was the caller keeping a promise
    // this function is supposed to keep itself.
    withWorker();
    // A runner whose inference is held open, so `stop()` can land DURING it rather than during the
    // letterbox — the success path is the one with no owner re-check.
    let finishRun: (() => void) | null = null;
    const held = Object.assign(
      () =>
        new Promise((resolve) => {
          finishRun = () => resolve({ data: new Float32Array(0), anchors: 0, rows: 10 });
        }),
      { dispose: async (): Promise<void> => {}, providers: ['held'] },
    );
    const det = await readyWith(readySource(), held);
    const tick = det.next();
    await settle();
    FakeWorker.built[0]!.answer();
    await settle();
    expect(finishRun, 'the inference never started, so this measures nothing').not.toBeNull();
    det.stop();
    // The model answers anyway, as a real one is entitled to: the frame was already in flight.
    finishRun!();
    await expect(tick).resolves.toBeNull();
  });

  it('dispose() during the snapshot posts nothing to the terminated worker', async () => {
    // The continuation after `createImageBitmap` used to post to a worker `dispose()` had already
    // terminated — which discards its queue — and the request it installed could never settle.
    const { snap } = withDeferredWorker();
    const det = await readyWith(readySource(), runnerFor('A'));
    const tick = det.next();
    await settle();
    const worker = FakeWorker.built[0]!;
    det.dispose();
    await expect(tick).resolves.toBeNull();
    snap();
    await settle();
    expect(worker.posted).toEqual([]);
  });
});

describe('WebDetector — where the runtime is fetched from', () => {
  it('takes the model URL’s DIRECTORY, not the text before its last slash', async () => {
    // Stripping the filename with `/[^/]+$/` parses a URL by hand and reads a query or a fragment
    // as path: `model.onnx?path=a/b` kept `model.onnx?path=a/` as the "directory", so wasmPaths and
    // the runtime module were fetched from a URL no server has and the model never loaded.
    const det = new WebDetector(videoEl, () => './vendor/model.onnx?path=a/b#frag/ment');
    void det.load();
    await Promise.resolve();
    const asked = pending()[0]!;
    expect(asked.modelUrl).toBe('./vendor/model.onnx?path=a/b#frag/ment');
    expect(asked.opts.wasmPaths).toBe(new URL('./vendor/', document.baseURI).href);
    expect(asked.opts.ortUrl).toBe(new URL('./vendor/ort.mjs', document.baseURI).href);
  });

  it('still points an ordinary model at its own folder', async () => {
    const det = new WebDetector(videoEl, () => './vendor/cubedet.onnx');
    void det.load();
    await Promise.resolve();
    expect(pending()[0]?.opts.wasmPaths).toBe(new URL('./vendor/', document.baseURI).href);
  });
});

describe('WebDetector — a model in a worker the page can release, and can lose (2026-09-22)', () => {
  /** A detector with its camera open and `runner` installed. */
  async function scanning(runner: unknown): Promise<WebDetector> {
    const det = new WebDetector(videoEl, () => './model-a.onnx');
    const opening = det.use({});
    await Promise.resolve();
    seam.cameras[0]!.settle(sourceNamed('cam-1'));
    await opening;
    const loading = det.load();
    pending()[0]!.resolve(runner);
    await loading;
    return det;
  }

  it('dispose() during the load calls it off — the worker goes now — and the load still resolves with nothing installed', async () => {
    // A detector released while its model is loading (the scan screen left mid-download, and the
    // park's release firing) must not leave a worker loading for nobody: the load's signal is the
    // cancellation, and the caller of a disposed detector is owed "finished, nothing installed".
    const det = new WebDetector(videoEl, () => './model-a.onnx');
    const loading = det.load();
    await Promise.resolve();
    const { signal } = pending()[0]!.opts;
    expect(signal?.aborted).toBe(false);
    det.dispose();
    expect(signal?.aborted).toBe(true);
    pending()[0]!.reject(new DOMException('the model load was cancelled', 'AbortError'));
    await expect(loading).resolves.toBeUndefined();
    expect(det.loadedModel).toBeNull();
  });

  it('a lost worker drops its model, every later tick says so BY NAME, and a load builds another', async () => {
    // By name, because the panel decides what Start does from the error its failing ticks END on:
    // "model not loaded" there would read as a broken frame, and Start would skip the load.
    const lost = Object.assign(
      async () => {
        throw new InferenceWorkerLostError('the inference worker failed: out of memory');
      },
      { dispose: async (): Promise<void> => {}, providers: ['A'] },
    );
    const det = await scanning(lost);
    expect(det.loadedModel).toBe('./model-a.onnx');
    await expect(det.next()).rejects.toMatchObject({ name: INFERENCE_WORKER_LOST });
    expect(det.loadedModel).toBeNull(); // it no longer claims a model it does not hold
    await expect(det.next()).rejects.toMatchObject({ name: INFERENCE_WORKER_LOST });

    const reloading = det.load();
    expect(pending()).toHaveLength(2); // a new load, not "already loaded"
    pending()[1]!.resolve(runnerFor('A2'));
    await reloading;
    expect(det.providers).toEqual(['A2']);
    await expect(det.next()).resolves.toMatchObject({ rows: 10 });
  });

  it('a frame rejected because dispose() ended its worker answers null, not an error', async () => {
    // Terminating the worker rejects the frame it was holding. That frame belongs to a detector
    // that has been told to stop, so it is a superseded tick — the contract's null — and not a
    // failure that would start the panel's clock over a detector doing exactly what it was told.
    let reject!: (err: unknown) => void;
    const holding = Object.assign(
      () =>
        new Promise((_resolve, rej) => {
          reject = rej;
        }),
      {
        dispose: async (): Promise<void> => {
          reject(new InferenceWorkerLostError('the model was released'));
        },
        providers: ['A'],
      },
    );
    const det = await scanning(holding);
    const tick = det.next();
    det.dispose();
    await expect(tick).resolves.toBeNull();
  });
});
