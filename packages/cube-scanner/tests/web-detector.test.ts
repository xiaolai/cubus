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
  resolve: (runner: unknown) => void;
  reject: (err: unknown) => void;
}

const seam = vi.hoisted(() => ({
  pending: [] as {
    modelUrl: string;
    resolve: (runner: unknown) => void;
    reject: (err: unknown) => void;
  }[],
  released: [] as string[],
}));

vi.mock('../view/onnx-runtime.js', () => ({
  createModelRunner: (modelUrl: string) =>
    new Promise((resolve, reject) => {
      seam.pending.push({ modelUrl, resolve, reject });
    }),
}));

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

afterEach(() => {
  seam.pending.length = 0;
  seam.released.length = 0;
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
