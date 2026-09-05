// A fake onnxruntime-web module, loaded by URL exactly as the real one is.
//
// `createModelRunner` reaches its runtime through `import(url)`, so a fixture at a file:// URL is
// the ONE seam that exercises the whole function — provider choice, session creation, warm-up, the
// timing probe, the release, and the rebuild — with no browser, no GPU, and no 25 MB of wasm.
//
// It is a module and not an object because the thing under test is module IDENTITY: the wasm proxy
// mode cannot be changed on a live module (see `runtimeUrl`), and a fallback that reuses one dies
// with "worker not ready". A fake passed as a value could not express that, which is exactly the
// bug the browser found and no unit test could see.
//
// Every instance records what it was asked to do on a registry shared through `globalThis`, since
// each distinct URL gets its own module instance and the test needs to compare across them.

/** The detect head this fake emits by default: [1, 10, 8400], the shape the real model produces. */
const ROWS = 10;
const ANCHORS = 8400;

const registry = (globalThis.__fakeOrt ??= { instances: [], nextRunMs: 0 });

/** What this fake should pretend the model is. Read at call time, so a test can set it after import.
 *
 * On the REGISTRY and not on the module, because the runner imports a different module instance per
 * proxy mode — so a test that reached in and patched "the" module would patch whichever instance it
 * happened to import first, and silently configure the one under test not at all. (It did. That is
 * why this exists.) */
const cfg = () => ({
  dims: [1, ROWS, ANCHORS],
  outLength: null,
  noInputNames: false,
  /** `true` for every session, or a list of the model URLs WebGPU refuses — see `refuses`. */
  webgpuDeclines: false,
  proxiedCreateFails: false,
  /** Every create rejects, whatever the proxy mode: how a test drives a failed initialisation. */
  createFails: false,
  /** Macrotask ticks a run waits before it submits anything, keyed by model URL — see `tick`. */
  runTicks: {},
  ...registry.model,
});

/** Does the GPU refuse THIS model's graph? A list, because two sessions on one device differ. */
const refuses = (modelUrl) => {
  const declines = cfg().webgpuDeclines;
  return declines === true || (Array.isArray(declines) && declines.includes(modelUrl));
};

/**
 * A run that YIELDS before it submits, so two probes can genuinely overlap.
 *
 * The rest of this fake is synchronous, which makes it deterministic and makes every existing case
 * cheap — and also means one runner's whole probe finishes before another's begins, so the queue
 * observation could never be caught counting somebody else's work. `runTicks` buys exactly the
 * window that matters: a real inference is milliseconds of awaited work, and a second
 * `createModelRunner` on the same page walks straight into the middle of it.
 *
 * Macrotasks and not microtasks, because a microtask queue drains before any timer and the two
 * runners would still take turns rather than overlap. Zero by default, so nothing else changes.
 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** This module instance's log — one per distinct URL the runner imports. */
const instance = {
  url: import.meta.url,
  proxy: null,
  numThreads: null,
  sessions: 0,
  runs: 0,
  /** Every input buffer this instance was fed, by identity — see the buffer-per-probe rule. */
  inputBuffers: [],
  released: 0,
  providers: null,
};
registry.instances.push(instance);

/**
 * The ONE WebGPU device this module ever publishes, and the queue a GPU run submits on.
 *
 * ONE, not one per session, because that is what the shipped runtime does: `env.webgpu.device` is
 * assigned inside the EP initialiser, which the backend registry runs at most once per module and
 * marks aborted forever on failure. A fake that handed out a fresh object per session made a
 * device TRANSITION look like per-session evidence — which is how a check that downgrades every
 * GPU session after the first on a page passed here while failing on real hardware.
 *
 * The queue is the per-session evidence in its place: a GPU-EP run submits command buffers on it
 * (17 per inference, measured in Chromium on an Apple GPU) and a run the CPU EP took submits none.
 */
class FakeGpuQueue {
  // On the PROTOTYPE, as `GPUQueue.prototype.submit` is — so an observer that replaces it has to
  // put the object back the way a real one is (no own property), not merely restore a value.
  submit() {}
}
const gpuDevice = { queue: new FakeGpuQueue() };

export const env = {
  /** Populated with `gpuDevice` once a webgpu session comes up. A test sets
   *  `registry.model.webgpuDeclines` to model onnxruntime running the graph on wasm instead. */
  webgpu: {},
  wasm: {
    set proxy(v) {
      instance.proxy = v;
    },
    get proxy() {
      return instance.proxy;
    },
    set numThreads(v) {
      instance.numThreads = v;
    },
    get numThreads() {
      return instance.numThreads;
    },
    wasmPaths: '',
  },
};

export class Tensor {
  constructor(type, data, dims) {
    this.type = type;
    this.data = data;
    this.dims = dims;
    // The real runtime rejects a detached buffer here — the failure a shared probe tensor causes on
    // the proxied path. Reproduced so the "a buffer per probe" rule is enforced and not just noted.
    if (data.length === 0) throw new Error(`Tensor's size(${dims.reduce((a, b) => a * b, 1)}) does not match data length(0).`);
  }
}

export const InferenceSession = {
  async create(modelUrl, options) {
    // A wasm backend that will not start — no SharedArrayBuffer, a blocked worker. It is how a
    // test drives the GPU fallback's own REBUILD failing, which is the path where the abandoned
    // GPU session used to be released twice. Keyed on the proxy mode, because only the rebuild
    // runs on the proxied module.
    if (cfg().proxiedCreateFails && instance.proxy === true) {
      throw new Error('the wasm backend would not start');
    }
    // A create that fails AFTER the backend has been initialised from `ort.env` — the ordinary
    // shape of a 404 model, and the one that pins the module's configuration on its way past.
    if (cfg().createFails) throw new Error('the model would not load');
    instance.sessions++;
    instance.providers = options.executionProviders;
    const first = options.executionProviders?.[0];
    const asked = typeof first === 'string' ? first : first?.name;
    // Whether the GPU takes THIS session's graph — decided per session, and remembered by it.
    const onGpu = asked === 'webgpu' && !refuses(modelUrl);
    // The device is published once and then stays, whatever later sessions do. See `gpuDevice`.
    if (onGpu) env.webgpu.device = gpuDevice;
    const ticks = cfg().runTicks[modelUrl] ?? 0;
    const session = {
      inputNames: cfg().noInputNames ? [] : ['images'],
      outputNames: ['output0'],
      inputMetadata: [{ isTensor: true, shape: [1, 3, 640, 640] }],
      async run(feeds) {
        instance.runs++;
        // Awaited BEFORE the submissions, so the window a second probe can open inside is the
        // window in which this session's own evidence is produced. See `tick`.
        for (let i = 0; i < ticks; i++) await tick();
        // Through the queue OBJECT, so an observer that has replaced `submit` on it counts these.
        if (onGpu) for (let i = 0; i < 17; i++) gpuDevice.queue.submit([]);
        const fed = Object.values(feeds ?? {})[0];
        if (fed) {
          instance.inputBuffers.push(fed.data.buffer);
          // The PROXIED path transfers the input to onnxruntime's worker, which detaches it here.
          // Modelled rather than described, because the rule it justifies — a fresh buffer per
          // probe — is otherwise asserted by a fixture that could not tell the difference.
          // Measured against the real runtime: reusing one buffer fails the next run with
          // "Tensor's size(1228800) does not match data length(0)".
          if (instance.proxy === true) structuredClone(fed.data.buffer, { transfer: [fed.data.buffer] });
        }
        // Wall-clock, because the timing probe measures wall-clock. `nextRunMs` is how a test says
        // "this provider is a rasteriser" without owning one.
        const until = performance.now() + registry.nextRunMs;
        while (performance.now() < until) {
          /* spin: a timer would not be measured by a synchronous span */
        }
        const { dims, outLength } = cfg();
        const length = outLength ?? dims.slice(1).reduce((a, b) => a * b, 1);
        return { output0: { type: 'float32', data: new Float32Array(length), dims } };
      },
      async release() {
        instance.released++;
      },
    };
    return session;
  },
};
