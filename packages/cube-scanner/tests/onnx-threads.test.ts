// How many wasm threads the runtime is asked for.
//
// This was a hard-coded 1 with the note "so no SharedArrayBuffer / cross-origin-isolation headers
// are needed" — true when written, and the reason every non-Apple build ran a THREADED runtime on
// a single core at 3-4 fps. The headers exist now, so the count is derived; these are the two
// properties that make deriving it safe rather than optimistic.

import { describe, expect, it } from 'vitest';

import { defaultThreadCount, preferredProviders, usesGpu } from '../view/onnx-runtime.js';

describe('defaultThreadCount', () => {
  it('asks for exactly one thread when the page is not isolated', () => {
    // Without SharedArrayBuffer the runtime has no threads to give, whatever it is asked for.
    // Asking anyway is how a page ends up throwing instead of quietly running on one core.
    for (const cores of [1, 4, 8, 16, 64]) {
      expect(defaultThreadCount(false, cores)).toBe(1);
    }
  });

  it('leaves two cores for the camera and the renderer', () => {
    // The benchmark that chose this ran inference on an otherwise idle page. The real app has a
    // camera pipeline and a 3D renderer running beside it, and on a phone it has a thermal
    // budget as well — so the count is deliberately not the core count.
    expect(defaultThreadCount(true, 8)).toBe(6);
    expect(defaultThreadCount(true, 10)).toBe(6);
    expect(defaultThreadCount(true, 4)).toBe(2);
  });

  it('caps at six, because Chromium gets SLOWER beyond it', () => {
    // Measured, 640x640, median of 10 runs: Chromium (10 cores) 9.5 fps at 6 threads and 7.2 at
    // 8 — a regression, not a plateau. WebKit keeps gaining to 11.3 at 8, so the cap costs it
    // about a quarter of its peak. One number for both engines, chosen for the one that can be
    // hurt rather than the one that cannot.
    expect(defaultThreadCount(true, 32)).toBe(6);
    expect(defaultThreadCount(true, 128)).toBe(6);
  });

  it('never asks for fewer than one, whatever the machine reports', () => {
    // navigator.hardwareConcurrency is not guaranteed sane; 0 or 1 must not become 0 or -1.
    expect(defaultThreadCount(true, 1)).toBe(1);
    expect(defaultThreadCount(true, 2)).toBe(1);
    expect(defaultThreadCount(true, 0)).toBe(1);
  });
});

describe('preferredProviders', () => {
  /** Swap `navigator.gpu` for the duration of one case, and put it back whatever happens. */
  const withGpu = async (gpu: unknown, run: () => Promise<void>) => {
    const g = globalThis as Record<string, unknown>;
    const had = 'navigator' in g;
    const nav = (g.navigator ?? {}) as Record<string, unknown>;
    const prev = nav.gpu;
    nav.gpu = gpu; // assignment, not delete: `?.gpu` reads undefined either way
    if (!had) g.navigator = nav;
    try {
      await run();
    } finally {
      nav.gpu = prev;
      if (!had) g.navigator = undefined;
    }
  };

  it('asks for the GPU first when the browser hands back an adapter', async () => {
    // Measured on this model in Chromium on a real GPU: 15 ms a frame against 198 ms for threaded
    // wasm. wasm stays SECOND rather than being replaced — onnxruntime walks the list, so this is
    // a fallback and not a preference.
    await withGpu({ requestAdapter: async () => ({}) }, async () => {
      expect(await preferredProviders()).toEqual(['webgpu', 'wasm']);
    });
  });

  it('asks the adapter rather than trusting that navigator.gpu exists', async () => {
    // The case this exists for: `navigator.gpu` is present and `requestAdapter()` still resolves
    // null — a blocklisted or absent GPU. onnxruntime handed `webgpu` with nothing behind it does
    // not fail fast, it sits in session creation, which reads as a hung scanner.
    await withGpu({ requestAdapter: async () => null }, async () => {
      expect(await preferredProviders()).toEqual(['wasm']);
    });
  });

  it('falls back to wasm when there is no WebGPU at all', async () => {
    await withGpu(undefined, async () => {
      expect(await preferredProviders()).toEqual(['wasm']);
    });
  });

  it('treats a throwing requestAdapter as no GPU, not as a failure to start', async () => {
    // A refusal is still an answer. Letting this reject would take the scanner down on a browser
    // that merely dislikes the question.
    await withGpu(
      {
        requestAdapter: async () => {
          throw new Error('WebGPU is disabled by policy');
        },
      },
      async () => {
        expect(await preferredProviders()).toEqual(['wasm']);
      },
    );
  });
});

// Which provider WINS decides whether the wasm proxy is on, and onnxruntime picks the first in the
// list that can take the work. Asserting membership instead of order meant `['wasm', 'webgpu']`
// reported a GPU run, turned the proxy off, and put a ~200 ms wasm inference back on the page's
// thread — the exact arrangement `ort.env.wasm.proxy` exists to prevent, reached by the flag that
// controls it.
describe('usesGpu', () => {
  it('is true only when webgpu is the provider that would actually run', () => {
    expect(usesGpu(['webgpu', 'wasm'])).toBe(true);
    expect(usesGpu(['webgpu'])).toBe(true);
  });

  it('is false when wasm wins, however far down the list webgpu appears', () => {
    expect(usesGpu(['wasm', 'webgpu'])).toBe(false);
    expect(usesGpu(['wasm'])).toBe(false);
  });

  it('is false for an empty list rather than throwing', () => {
    expect(usesGpu([])).toBe(false);
  });

  it('reads the name off an object-form provider, not just a bare string', () => {
    expect(usesGpu([{ name: 'webgpu' }, 'wasm'])).toBe(true);
    expect(usesGpu([{ name: 'wasm' }, { name: 'webgpu' }])).toBe(false);
  });
});
