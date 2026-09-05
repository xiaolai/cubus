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
    expect(det.providers).toEqual(['A']);

    // Only now does B's own load start — and it is B that is asked for.
    await Promise.resolve();
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
