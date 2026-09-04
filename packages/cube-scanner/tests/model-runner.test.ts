// `createModelRunner`'s fallback, release and validation paths — driven without a browser.
//
// These exist because the GPU→wasm recovery had exactly one gate, an end-to-end browser test that
// returns early on a machine with no GPU. A path whose only check evaporates on the machines least
// likely to have hardware is not a gate; the browser test still earns its place (it is what proves
// the real runtime behaves as assumed), but the BRANCH is pinned here, unconditionally.
//
// The seam is the runtime URL: `createModelRunner` imports its runtime by URL, so a fixture module
// at a file:// URL exercises the whole function with no wasm and no GPU. Module identity is the
// subject of half of these, which is why the fake is a module and not an injected object.

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GPU_BUDGET_MS,
  GPU_PROBE_RUNS,
  createModelRunner,
  proxiedSiblingUrl,
  runtimeUrl,
} from '../view/onnx-runtime.js';

const FAKE_ORT = fileURLToPath(new URL('./fixtures/fake-ort.mjs', import.meta.url));

interface FakeInstance {
  url: string;
  proxy: boolean | null;
  sessions: number;
  runs: number;
  released: number;
  providers: unknown;
  inputBuffers: ArrayBufferLike[];
}
interface FakeRegistry {
  instances: FakeInstance[];
  nextRunMs: number;
  model?: {
    dims?: number[];
    outLength?: number | null;
    noInputNames?: boolean;
    webgpuDeclines?: boolean;
  };
}

const registry = (): FakeRegistry => (globalThis as { __fakeOrt?: FakeRegistry }).__fakeOrt!;

/**
 * A URL nothing else in the run has imported.
 *
 * The module map is global and permanent — both the browser's and Node's — so a fixture imported
 * once stays imported, and `createModelRunner`'s own cache is keyed by URL too. Without a unique
 * marker per case, the second test would silently reuse the first's module and its counters.
 */
let caseId = 0;
const freshOrtUrl = (): string => `${FAKE_ORT}?case=${++caseId}`;

/** Every fake module instance created since the last reset, oldest first. */
const instances = (): FakeInstance[] => registry()?.instances ?? [];

/**
 * Give `preferredProviders()` an adapter, or take it away.
 *
 * ASSIGNED onto the existing `navigator`, never replacing it: in Node `globalThis.navigator` is a
 * getter-only property, so `g.navigator = {...}` throws. Same approach as `onnx-threads.test.ts`.
 */
const withAdapter = (present: boolean): void => {
  const g = globalThis as Record<string, unknown>;
  const nav = (g.navigator ?? {}) as Record<string, unknown>;
  nav.gpu = present ? { requestAdapter: async () => ({ info: {} }) } : undefined;
  if (!('navigator' in g)) g.navigator = nav;
};

beforeEach(() => {
  (globalThis as { __fakeOrt?: FakeRegistry }).__fakeOrt = { instances: [], nextRunMs: 0 };
  withAdapter(false); // wasm unless a case says otherwise
});

describe('runtimeUrl', () => {
  it('gives the two proxy modes different module URLs', () => {
    // The whole mechanism in one line: same file, two identities. Equal URLs here would mean one
    // module serving both modes, which is the arrangement that fails with "worker not ready".
    expect(runtimeUrl('./ort.mjs', false)).toBe('./ort.mjs');
    expect(runtimeUrl('./ort.mjs', true)).not.toBe(runtimeUrl('./ort.mjs', false));
  });

  it('keeps an existing query and leaves the fragment last', () => {
    expect(runtimeUrl('./ort.mjs?v=2', true)).toBe('./ort.mjs?v=2&cubus-runtime=proxied');
    expect(runtimeUrl('./ort.mjs#x', true)).toBe('./ort.mjs?cubus-runtime=proxied#x');
  });
});

describe('createModelRunner — the GPU verdict', () => {
  it('keeps a GPU that runs inside the budget, and leaves the proxy off for it', async () => {
    withAdapter(true); // a real adapter, and a fake whose runs are instant
    const runner = await createModelRunner('model.onnx', {
      ortUrl: freshOrtUrl(),
      gpuBudgetMs: GPU_BUDGET_MS,
      numThreads: 1,
    });
    expect(runner.providers).toEqual(['webgpu', 'wasm']);
    // ONE module and no rebuild: a GPU inside the budget must not be second-guessed.
    expect(instances()).toHaveLength(1);
    expect(instances()[0]?.proxy).toBe(false);
    expect(instances()[0]?.released).toBe(0);
  });

  it('takes the proxied wasm path when there is no adapter at all', async () => {
    // The other half, and the common one: no `navigator.gpu`, so nothing is timed and the runtime
    // is the proxied module — the arrangement that keeps a ~200 ms wasm run off the page's thread.
    const runner = await createModelRunner('model.onnx', {
      ortUrl: freshOrtUrl(),
      numThreads: 1,
    });
    expect(runner.providers).toEqual(['wasm']);
    expect(instances()).toHaveLength(1);
    expect(instances()[0]?.proxy).toBe(true);
  });

  it('falls back when WebGPU is asked for and does not take the work', async () => {
    // The silent one. Asking for `webgpu` turns the proxy OFF, so a graph onnxruntime quietly
    // assigns to wasm instead runs on the page's own thread — and the timing probe cannot see it,
    // because an ordinary wasm run is well inside the budget. Only the backend's own signal
    // distinguishes the two, and the fallback must land on the PROXIED module.
    withAdapter(true);
    registry().model = { webgpuDeclines: true };
    const runner = await createModelRunner('model.onnx', { ortUrl: freshOrtUrl(), numThreads: 1 });
    expect(runner.providers).toEqual(['wasm']);
    expect(instances()).toHaveLength(2);
    expect(instances()[0]?.proxy).toBe(false);
    expect(instances()[0]?.released).toBe(1);
    expect(instances()[1]?.proxy).toBe(true);
    // Detected BEFORE the warm-up: the abandoned session must not have paid for shader compilation.
    expect(instances()[0]?.runs).toBe(0);
  });

  it('declines to judge a GPU while the page is hidden', async () => {
    // Both samples can land inside one throttled stretch, and the downgrade is permanent — so a
    // hidden page must not be able to cost a healthy machine its GPU for the session.
    withAdapter(true);
    registry().nextRunMs = 5;
    // Assigned and restored rather than deleted — `delete` on a global is both slow and, in a
    // suite that shares one realm, a way to leave the next file without a document it expected.
    const g = globalThis as { document?: { visibilityState: string } };
    const priorDocument = g.document;
    g.document = { visibilityState: 'hidden' };
    try {
      const runner = await createModelRunner('model.onnx', {
        ortUrl: freshOrtUrl(),
        gpuBudgetMs: 1, // a budget every run misses — and which must not be consulted here
        numThreads: 1,
      });
      expect(runner.providers).toEqual(['webgpu', 'wasm']);
      expect(instances()).toHaveLength(1);
    } finally {
      g.document = priorDocument;
    }
  });

  it('releases the GPU session and rebuilds on wasm when the GPU is too slow', async () => {
    // The regression this whole branch exists for, with no GPU in the room: a provider that answers
    // slowly is dropped, its session released, and the replacement actually works.
    withAdapter(true);
    registry().nextRunMs = 5; // every run "takes" 5 ms
    const runner = await createModelRunner('model.onnx', {
      ortUrl: freshOrtUrl(),
      gpuBudgetMs: 1, // …against a 1 ms budget, so the GPU is judged unviable
      numThreads: 1,
    });

    expect(runner.providers).toEqual(['wasm']);
    // TWO modules, not one: the rebuild must not reuse the module whose proxy mode is already set.
    expect(instances()).toHaveLength(2);
    const [gpuModule, wasmModule] = instances();
    expect(gpuModule?.providers).toEqual(['webgpu', 'wasm']);
    expect(gpuModule?.proxy).toBe(false);
    expect(gpuModule?.released).toBe(1); // the abandoned session was released, not leaked
    expect(wasmModule?.providers).toEqual(['wasm']);
    expect(wasmModule?.proxy).toBe(true);
    expect(wasmModule?.released).toBe(0);
    // …and the thing handed back runs.
    const out = await runner(new Float32Array(3 * 640 * 640), 640);
    expect(out.anchors).toBe(8400);
  });

  it('does not second-guess a provider the caller asked for by name', async () => {
    withAdapter(true);
    registry().nextRunMs = 5;
    const runner = await createModelRunner('model.onnx', {
      ortUrl: freshOrtUrl(),
      executionProviders: ['webgpu'], // explicit: a request, not a preference
      gpuBudgetMs: 1,
      numThreads: 1,
    });
    expect(runner.providers).toEqual(['webgpu']);
    expect(instances()).toHaveLength(1);
  });

  it('gives every internal probe a buffer of its own', async () => {
    // ASSERTED ON IDENTITY, not inferred from a run that happened to succeed. The first version of
    // this test enabled a GPU (so `proxy` was false), used a fixture that never detached anything,
    // and then claimed to be enforcing the detachment rule — it would have passed against a shared
    // buffer, which is the only thing it was supposed to catch.
    withAdapter(true);
    const runner = await createModelRunner('model.onnx', { ortUrl: freshOrtUrl(), numThreads: 1 });
    expect(runner.providers).toEqual(['webgpu', 'wasm']);
    const seen = instances()[0]?.inputBuffers ?? [];
    // Warm-up plus GPU_PROBE_RUNS timed runs.
    expect(seen).toHaveLength(1 + GPU_PROBE_RUNS);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('survives a runtime that DETACHES each input, as the proxied path really does', async () => {
    // The fixture transfers the input buffer away whenever `proxy` is true, exactly as onnxruntime
    // does — so a shared probe buffer fails here with the runtime's own message rather than being
    // a rule nothing tests. Measured against the real runtime before it was modelled.
    const runner = await createModelRunner('model.onnx', { ortUrl: freshOrtUrl(), numThreads: 1 });
    expect(instances()[0]?.proxy).toBe(true);
    // Two further calls through the public runner: each brings its own buffer, as `preprocess` does.
    await runner(new Float32Array(3 * 640 * 640), 640);
    await runner(new Float32Array(3 * 640 * 640), 640);
    const seen = instances()[0]?.inputBuffers ?? [];
    expect(new Set(seen).size).toBe(seen.length);
    // …and they really were DETACHED, which is the whole reason the rule exists. Without this the
    // test passes just as happily against a fixture that forgot to transfer anything, which is the
    // state the previous version of it was in.
    expect(seen.every((b) => b.byteLength === 0)).toBe(true);
  });
});

describe('createModelRunner — session ownership', () => {
  it('releases the session when the model has no usable input or output', async () => {
    // The leak this replaces: the name check threw over a live session, before `dispose` existed
    // for anyone to call. Nothing could release it for the life of the page.
    registry().model = { noInputNames: true };
    await expect(
      createModelRunner('model.onnx', { ortUrl: freshOrtUrl(), numThreads: 1 }),
    ).rejects.toThrow(/no input\/output tensor/);
    expect(instances()[0]?.released).toBe(1);
  });
});

describe('createModelRunner — output validation', () => {
  /** Build a runner whose fake session returns `dims`, and run it. */
  const runWithDims = async (dims: number[], outLength: number | null = null) => {
    registry().model = { dims, outLength };
    return createModelRunner('model.onnx', { ortUrl: freshOrtUrl(), numThreads: 1 });
  };

  it('refuses a TRANSPOSED detect head instead of decoding it off the wrong axis', async () => {
    // `[1, 8400, 10]` has a positive last dimension and a length that divides by it, so the old
    // "is the length a whole number of rows" test passed it — and a cube was then read off the
    // wrong axis with nothing anywhere reporting a problem.
    await expect(runWithDims([1, 8400, 10])).rejects.toThrow(/transpose of a detect head/);
  });

  it('refuses a row count that is not a detect head, even facing the right way', async () => {
    // The residue of the transpose fix: `[1, 9, 8400]` and `[1, 11, 8400]` are oriented correctly
    // and would have passed a check that only asked "are rows the smaller axis". `decodeDetections`
    // reads four box coordinates then one score per class at FIXED offsets, so a different row
    // count is a different model read against stale offsets — a cube nobody held.
    await expect(runWithDims([1, 9, 8400])).rejects.toThrow(/9 rows, not the 10/);
    await expect(runWithDims([1, 11, 8400])).rejects.toThrow(/11 rows, not the 10/);
  });

  it('refuses a rank the decoder cannot index', async () => {
    await expect(runWithDims([10, 8400])).rejects.toThrow(/not the \[1, rows, anchors\]/);
  });

  it('refuses a tensor whose length does not match its own dims', async () => {
    await expect(runWithDims([1, 10, 8400], 999)).rejects.toThrow(/not the 84000 its dims/);
  });

  it('accepts the shape the real model produces', async () => {
    const runner = await runWithDims([1, 10, 8400]);
    const out = await runner(new Float32Array(3 * 640 * 640), 640);
    expect(out.anchors).toBe(8400);
  });
});

describe('the proxied runtime module, and the fallback behind it', () => {
  it('derives a sibling FILE for the proxied mode, keeping query and fragment', () => {
    // The second way to get a distinct module instance. The first — a query string — is the one
    // that ships, and it is verified against apps/web/serve.mjs; it is NOT verified against the
    // Tauri asset protocol on Windows, Linux and Android, which are exactly the three targets where
    // wasm is the only inference path and the proxied module is therefore the only module loaded.
    // A protocol handler that resolves by path alone answers 404 for a name it has never seen, and
    // that is not a slow scanner, it is a model that never loads.
    expect(proxiedSiblingUrl('./vendor/ort.mjs')).toBe('./vendor/ort.proxied.mjs');
    expect(proxiedSiblingUrl('https://x/y/ort.mjs?v=2')).toBe('https://x/y/ort.proxied.mjs?v=2');
    expect(proxiedSiblingUrl('./ort.mjs#z')).toBe('./ort.proxied.mjs#z');
    // …and it is a DIFFERENT identity from the query form, or it would buy nothing.
    expect(proxiedSiblingUrl('./ort.mjs')).not.toBe(runtimeUrl('./ort.mjs', true));
  });

  it('falls back to the sibling file when the query form will not load', async () => {
    // The whole fallback, end to end: a runtime whose primary URL does not exist, with the sibling
    // beside it. The runner must still come back, on the PROXIED module — a wasm run left unproxied
    // on the page's thread is the one arrangement the proxy exists to prevent.
    const noted = vi.spyOn(console, 'info').mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), 'ort-sibling-'));
    try {
      const absent = join(dir, `absent-${++caseId}.mjs`);
      copyFileSync(FAKE_ORT, `${absent.slice(0, -4)}.proxied.mjs`);
      const runner = await createModelRunner('model.onnx', {
        ortUrl: pathToFileURL(absent).href,
        numThreads: 1,
      });
      expect(runner.providers).toEqual(['wasm']);
      expect(instances().at(-1)?.proxy).toBe(true);
      expect(noted).toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      noted.mockRestore();
    }
  });

  it('reports the ORIGINAL failure when neither form loads', async () => {
    // A caller told "ort.proxied.mjs not found" would go looking for a file the app has never
    // depended on. What actually happened is that the primary URL did not load, and that is what
    // has to escape.
    const dir = mkdtempSync(join(tmpdir(), 'ort-neither-'));
    try {
      const absent = pathToFileURL(join(dir, `gone-${++caseId}.mjs`)).href;
      await expect(
        createModelRunner('model.onnx', { ortUrl: absent, numThreads: 1 }),
      ).rejects.toThrow(/gone-\d+\.mjs/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
