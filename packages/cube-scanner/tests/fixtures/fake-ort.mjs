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
  webgpuDeclines: false,
  ...registry.model,
});

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

export const env = {
  /** Populated with a `device` when a webgpu session is created — see `gpuTookTheWork`. A test sets
   *  `registry.model.webgpuDeclines` to model onnxruntime silently assigning the graph to wasm. */
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
  async create(_modelUrl, options) {
    instance.sessions++;
    instance.providers = options.executionProviders;
    const first = options.executionProviders?.[0];
    const asked = typeof first === 'string' ? first : first?.name;
    if (asked === 'webgpu' && !cfg().webgpuDeclines) env.webgpu.device = { fake: true };
    const session = {
      inputNames: cfg().noInputNames ? [] : ['images'],
      outputNames: ['output0'],
      inputMetadata: [{ isTensor: true, shape: [1, 3, 640, 640] }],
      async run(feeds) {
        instance.runs++;
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
