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
// The runtime is stubbed at `createModelRunner`, deliberately: what is under test is when this
// class installs a runner and when it refuses to, and a real 25 MB wasm load would answer neither
// question while making the test a browser test. `tests/model-runner.test.ts` owns the runtime.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameNotReadyError } from '../src/camera.js';
import { WebDetector } from '../view/web-detector.js';

/** One `createModelRunner` call, held open so the test decides when the model "arrives". */
interface PendingLoad {
  modelUrl: string;
  opts: { wasmPaths?: string; ortUrl?: string };
  resolve: (runner: unknown) => void;
  reject: (err: unknown) => void;
}

const seam = vi.hoisted(() => ({
  pending: [] as {
    modelUrl: string;
    opts: { wasmPaths?: string; ortUrl?: string };
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

vi.mock('../view/onnx-runtime.js', () => ({
  createModelRunner: (modelUrl: string, opts: { wasmPaths?: string; ortUrl?: string }) =>
    new Promise((resolve, reject) => {
      seam.pending.push({ modelUrl, opts, resolve, reject });
    }),
}));

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

  it('preprocesses the frame and hands back what the model said', async () => {
    const det = await ready();
    await expect(det.next()).resolves.toEqual({
      data: expect.any(Float32Array),
      anchors: 0,
      rows: 10,
    });
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
    const det = new WebDetector(videoEl, () => './vendor/cube-yolo.onnx');
    void det.load();
    await Promise.resolve();
    expect(pending()[0]?.opts.wasmPaths).toBe(new URL('./vendor/', document.baseURI).href);
  });
});
