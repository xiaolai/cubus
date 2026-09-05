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
  createModelRunner,
  GPU_BUDGET_MS,
  GPU_PROBE_RUNS,
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
    /** `true` for every session, or the model URLs WebGPU refuses — two sessions, one device. */
    webgpuDeclines?: boolean | string[];
    proxiedCreateFails?: boolean;
    /** Every create rejects, whatever the proxy mode — a failed INITIALISATION, not a fallback. */
    createFails?: boolean;
    /** Macrotask ticks a run waits before submitting, per model URL. The overlap seam. */
    runTicks?: Record<string, number>;
  };
}

/**
 * A `document` that can be watched as well as polled.
 *
 * The existing hidden-page case assigns a bare `{ visibilityState }`, which is enough to model a
 * tab that is hidden the whole time. It cannot model the one this file needed next: a tab that
 * goes hidden and comes BACK inside a single awaited probe, where every poll reads "visible" and
 * only the event says otherwise.
 */
function watchableDocument(): {
  visibilityState: string;
  listeners: Set<() => void>;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
  blink(): void;
} {
  const listeners = new Set<() => void>();
  const fire = (): void => {
    for (const fn of [...listeners]) fn();
  };
  const doc = {
    visibilityState: 'visible',
    listeners,
    addEventListener(_type: string, fn: () => void): void {
      listeners.add(fn);
    },
    removeEventListener(_type: string, fn: () => void): void {
      listeners.delete(fn);
    },
    /** Hidden and back again, as a tab that is briefly backgrounded really is. */
    blink(): void {
      doc.visibilityState = 'hidden';
      fire();
      doc.visibilityState = 'visible';
      fire();
    },
  };
  return doc;
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

  it('keeps the GPU for a SECOND healthy session sharing the runtime’s one device', async () => {
    // THE REGRESSION A DEVICE TRANSITION CAUSED. The check was "this create put a device where
    // there was none", and the shipped runtime publishes `env.webgpu.device` from its EP
    // initialiser, which the backend registry runs at most ONCE per module. So there is no second
    // transition to see, and every GPU session after the first on a page was rebuilt on proxied
    // wasm — slower, and for nothing. Measured on real hardware before it was fixed: two
    // `createModelRunner` calls in one headed Chromium page on an Apple GPU, the first
    // `['webgpu','wasm']`, the second downgraded with "WebGPU did not take this model", one device
    // object throughout. The park reaches this: a second panel, a rebuilt detector, a model swap.
    withAdapter(true);
    const ortUrl = freshOrtUrl();
    const first = await createModelRunner('model.onnx', { ortUrl, numThreads: 1 });
    expect(first.providers).toEqual(['webgpu', 'wasm']);

    const second = await createModelRunner('model.onnx', { ortUrl, numThreads: 1 });
    expect(second.providers).toEqual(['webgpu', 'wasm']);
    // One module, two sessions, no rebuild and nothing thrown away.
    expect(instances()).toHaveLength(1);
    expect(instances()[0]?.sessions).toBe(2);
    expect(instances()[0]?.released).toBe(0);
  });

  it('does not read a PREVIOUS session’s GPU device as this one’s', async () => {
    // The other side of the same fact. `ort.env` is global to the runtime MODULE and
    // `createModelRunner` caches modules by URL, so a device left behind by an earlier GPU session
    // is still there for a later runner whose graph onnxruntime runs on wasm instead — which then
    // runs UNPROXIED on the page's thread, the one arrangement this check exists to prevent.
    // Reading the device cannot tell the two apart; the session's own EXECUTION can, so the
    // warm-up is run with the device's command queue watched.
    withAdapter(true);
    const ortUrl = freshOrtUrl();
    const first = await createModelRunner('model.onnx', { ortUrl, numThreads: 1 });
    expect(first.providers).toEqual(['webgpu', 'wasm']); // a genuine GPU session: device now set
    expect(instances()).toHaveLength(1);

    registry().model = { webgpuDeclines: true };
    const second = await createModelRunner('model.onnx', { ortUrl, numThreads: 1 });
    expect(second.providers).toEqual(['wasm']);
    const [direct, proxied] = instances();
    expect(direct?.sessions).toBe(2); // both GPU asks went to the same, direct module…
    expect(direct?.released).toBe(1); // …and the second one was released, not kept unproxied
    expect(proxied?.proxy).toBe(true);
  });

  it('leaves the runtime’s queue exactly as it found it', async () => {
    // The observation replaces `submit` on the device's queue for the length of one run. A copy
    // left behind would count a later session's work as this one's, and — worse — hold this
    // module's closure alive on an object the whole page shares.
    withAdapter(true);
    const ortUrl = freshOrtUrl();
    const fixture = (await import(ortUrl)) as {
      env: { webgpu: { device?: { queue: { submit: unknown } } } };
    };
    await createModelRunner('model.onnx', { ortUrl, numThreads: 1 });
    const queue = fixture.env.webgpu.device?.queue;
    expect(queue).toBeDefined();
    // `GPUQueue.prototype.submit` is a prototype method, so putting it back means leaving no own
    // property behind — not restoring a value onto the instance.
    expect(Object.hasOwn(queue!, 'submit')).toBe(false);
    const inherited = queue!.submit;
    await createModelRunner('model.onnx', { ortUrl, numThreads: 1 });
    expect(queue!.submit).toBe(inherited);
  });

  it('gives each of two CONCURRENT runners its own GPU evidence, and puts the queue back', async () => {
    // TWO PROBES ON ONE DEVICE, which is the arrangement the queue count could not survive.
    //
    // `env.webgpu.device` belongs to the MODULE, so every session on it submits on one queue —
    // and the observation was per-probe, installed over whatever it found and restored to whatever
    // it had found. Two `createModelRunner` calls overlapping (a panel re-mounting while another is
    // still coming up) therefore produced two failures at once: the session WebGPU declined counted
    // the other one's 17 command buffers and kept a GPU that never ran its graph, and the restores
    // landed out of order — A installs, B installs, A restores, B restores — leaving A's wrapper
    // reinstated as an own property of a queue the whole page shares, counting later sessions and
    // holding a dead module's closure alive.
    //
    // The fix is both halves: the probe section runs on the same `serialise` chain creation does,
    // so two probes never overlap on one module; and the wrapper belongs to the queue, installed
    // once and removed by whoever put it there. `runTicks` is what makes the overlap real here —
    // the rest of the fake is synchronous, so without a yield inside a run the two probes take
    // turns and the bug cannot be staged.
    withAdapter(true);
    const noted = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const ortUrl = freshOrtUrl();
      const fixture = (await import(ortUrl)) as {
        env: { webgpu: { device?: { queue: { submit: unknown } } } };
      };
      registry().model = {
        // The GPU takes the first model's graph and refuses the second's — the two sessions this
        // evidence has to tell apart, on one device.
        webgpuDeclines: ['decliner.onnx'],
        // The decliner's probe is the WIDER window, so it is watching while the other submits.
        runTicks: { 'gpu.onnx': 1, 'decliner.onnx': 3 },
      };
      const [onGpu, declined] = await Promise.all([
        createModelRunner('gpu.onnx', { ortUrl, numThreads: 1 }),
        createModelRunner('decliner.onnx', { ortUrl, numThreads: 1 }),
      ]);

      // The session the GPU DID take keeps it…
      expect(onGpu.providers).toEqual(['webgpu', 'wasm']);
      // …and the one it did not is rebuilt on proxied wasm, on its own submissions and nobody
      // else's. Without the serialisation this reads ['webgpu', 'wasm']: 17 command buffers were
      // submitted while it watched, none of them its own.
      expect(declined.providers).toEqual(['wasm']);
      const [direct, proxied] = instances();
      expect(direct?.sessions).toBe(2); // both GPU asks went to the one direct module…
      expect(direct?.released).toBe(1); // …and only the declined one was released
      expect(proxied?.proxy).toBe(true);

      // And the page's queue is exactly as it was found: `GPUQueue.prototype.submit` is a
      // prototype method, so putting it back means leaving NO own property behind. A wrapper left
      // here is a counter with no probe, on an object nothing will ever clean up.
      const queue = fixture.env.webgpu.device?.queue;
      expect(queue).toBeDefined();
      expect(Object.hasOwn(queue!, 'submit')).toBe(false);
    } finally {
      noted.mockRestore();
    }
  });

  it('does not read a LIVE runner’s inference as a starting session’s evidence', async () => {
    // THE CASE SERIALISING THE PROBES AGAINST EACH OTHER LEFT BEHIND, and the one that actually
    // happens. Two `createModelRunner` calls overlapping needs two panels coming up at once; a
    // runner that was handed back minutes ago and is SCANNING — five inferences a second, on the
    // module's one device queue — is the ordinary state of the app while a second panel mounts.
    // Its command buffers were counted as the new session's evidence, so a session WebGPU declined
    // kept `['webgpu', 'wasm']`: the proxy off, and a ~200 ms wasm run left on the page's own
    // thread, which is the single arrangement all of this exists to prevent.
    withAdapter(true);
    const noted = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const ortUrl = freshOrtUrl();
      registry().model = {
        // The GPU took the scanning session's graph and refuses the newcomer's.
        webgpuDeclines: ['decliner.onnx'],
        // The live run yields before it submits, and the newcomer's probe is the wider window — so
        // without the serialisation the 17 command buffers land inside it.
        runTicks: { 'gpu.onnx': 1, 'decliner.onnx': 4 },
      };
      const scanning = await createModelRunner('gpu.onnx', { ortUrl, numThreads: 1 });
      expect(scanning.providers).toEqual(['webgpu', 'wasm']);

      // A frame in flight, exactly as the scan loop leaves one…
      const frame = scanning(new Float32Array(3 * 640 * 640), 640);
      // …while the next panel's session comes up on the same module.
      const declined = await createModelRunner('decliner.onnx', { ortUrl, numThreads: 1 });
      await frame;

      // Judged on its own submissions and nobody else's. Before this it read ['webgpu', 'wasm'].
      expect(declined.providers).toEqual(['wasm']);
      const [direct, proxied] = instances();
      expect(direct?.released).toBe(1); // the declined session was released, not kept unproxied
      expect(proxied?.proxy).toBe(true);
      // And the observation is off the page's queue again.
      const fixture = (await import(ortUrl)) as {
        env: { webgpu: { device?: { queue: { submit: unknown } } } };
      };
      expect(Object.hasOwn(fixture.env.webgpu.device!.queue, 'submit')).toBe(false);
    } finally {
      noted.mockRestore();
    }
  });

  it('refuses a second runner that asks the same module for a different configuration', async () => {
    // `numThreads` and `wasmPaths` are read when the wasm backend initialises, which the runtime
    // does ONCE per module. A second runner asking for different values used to get the first
    // one's silently: its options said one thing and the session it got was another, which makes
    // every measurement taken through that option a measurement of something else. Serialising
    // creation never made these reconfigurable — it stopped two being half-applied at once.
    const ortUrl = freshOrtUrl();
    await createModelRunner('model.onnx', { ortUrl, numThreads: 1, wasmPaths: '/a/' });
    // The same configuration is fine, and is what the app actually does on every re-mount.
    await createModelRunner('model.onnx', { ortUrl, numThreads: 1, wasmPaths: '/a/' });
    expect(instances()[0]?.sessions).toBe(2);

    await expect(
      createModelRunner('model.onnx', { ortUrl, numThreads: 6, wasmPaths: '/a/' }),
    ).rejects.toThrow(/already initialised with numThreads 1/);
    await expect(
      createModelRunner('model.onnx', { ortUrl, numThreads: 1, wasmPaths: '/b/' }),
    ).rejects.toThrow(/wasmPaths \/a\//);
    // Refused BEFORE a session was created, so nothing was built and nothing needs releasing.
    expect(instances()[0]?.sessions).toBe(2);
    expect(instances()[0]?.released).toBe(0);
    // And the refusal does not wedge the queue behind it.
    await createModelRunner('model.onnx', { ortUrl, numThreads: 1, wasmPaths: '/a/' });
    expect(instances()[0]?.sessions).toBe(3);
  });

  it('refuses a different configuration after a create that FAILED on the same module', async () => {
    // A CREATE THAT REJECTED STILL INITIALISED THE BACKEND. `InferenceSession.create` brings the
    // wasm backend up from `ort.env` first and fetches the model second, so a 404 model — or a
    // graph the runtime will not take — burns `numThreads` and `wasmPaths` into the module on its
    // way to failing. Pinning only after a SUCCESSFUL create read as caution and left exactly the
    // hole the pin exists to close: the next runner asked for a different thread count, was
    // allowed, and silently got the failed runner's.
    //
    // Whether the backend really did initialise before any given failure is not something
    // onnxruntime reports, so the pin is kept rather than guessed at — a loud refusal a caller can
    // read and retry, against a session that quietly runs on somebody else's thread count.
    const ortUrl = freshOrtUrl();
    registry().model = { createFails: true };
    await expect(createModelRunner('model.onnx', { ortUrl, numThreads: 4 })).rejects.toThrow(
      /would not load/,
    );
    expect(instances()[0]?.sessions).toBe(0); // nothing came up, and nothing needs releasing
    expect(instances()[0]?.released).toBe(0);

    registry().model = { createFails: false };
    await expect(createModelRunner('model.onnx', { ortUrl, numThreads: 1 })).rejects.toThrow(
      /already initialised with numThreads 4/,
    );
    // …and the configuration that WAS initialised still works, so this is a refusal and not a
    // wedge: a caller retrying the failed load gets its session.
    const runner = await createModelRunner('model.onnx', { ortUrl, numThreads: 4 });
    expect(runner.providers).toEqual(['wasm']);
    expect(instances()[0]?.sessions).toBe(1);
  });

  it('releases the abandoned session exactly once when the rebuild itself fails', async () => {
    // Both fallback branches released the session and then rebuilt INSIDE `owning`, so a rebuild
    // that rejects fell into its catch and released the same session a second time. Measured
    // release counts on the abandoned module before this: [2, 1].
    withAdapter(true);
    const noted = vi.spyOn(console, 'info').mockImplementation(() => {});
    registry().nextRunMs = 5;
    registry().model = { proxiedCreateFails: true };
    try {
      await expect(
        createModelRunner('model.onnx', {
          ortUrl: freshOrtUrl(),
          gpuBudgetMs: 1,
          numThreads: 1,
        }),
      ).rejects.toThrow(/wasm backend would not start/);
      const [gpuModule, wasmModule] = instances();
      expect(gpuModule?.released).toBe(1);
      // The rebuild really was attempted, on the proxied module, and left nothing of its own.
      expect(wasmModule?.proxy).toBe(true);
      expect(wasmModule?.sessions).toBe(0);
      expect(wasmModule?.released).toBe(0);
    } finally {
      noted.mockRestore();
    }
  });

  it('discards the verdict when the page blinked hidden inside one sample', async () => {
    // `visibilityState` is a SNAPSHOT. A tab that goes hidden during an awaited probe and is back
    // before the sample is checked reads as visible at every point the polls look, while the run
    // they just timed was throttled the whole way — and the downgrade is permanent for the
    // runner's life. The event fires on both edges, which is the evidence the polls cannot have.
    withAdapter(true);
    const g = globalThis as { document?: unknown };
    const prior = g.document;
    const doc = watchableDocument();
    g.document = doc;
    // Blink during the FIRST TIMED sample: run 1 is the warm-up, which is not timed and runs
    // before the listener exists.
    let runs = 0;
    Object.defineProperty(registry(), 'nextRunMs', {
      configurable: true,
      get: () => {
        runs++;
        if (runs === 2) doc.blink();
        return 5;
      },
    });
    try {
      const runner = await createModelRunner('model.onnx', {
        ortUrl: freshOrtUrl(),
        gpuBudgetMs: 1, // a budget every run misses — and which must not be consulted here
        numThreads: 1,
      });
      expect(runner.providers).toEqual(['webgpu', 'wasm']);
      expect(instances()).toHaveLength(1);
      expect(runs).toBeGreaterThan(1); // the blink really happened inside a timed run
      expect(doc.listeners.size).toBe(0); // …and the listener does not outlive the sampling
    } finally {
      g.document = prior;
    }
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
