// view/inference-protocol.ts
function transferable(data) {
  const owned = data.buffer instanceof ArrayBuffer && data.byteOffset === 0 && data.byteLength === data.buffer.byteLength;
  return owned ? data : new Float32Array(data);
}

// src/detect-head.ts
var NUM_CLASSES = 6;
var DETECT_ROWS = 4 + NUM_CLASSES;

// src/letterbox.ts
var IMG_SIZE = 640;
var PAD = 114 / 255;

// view/onnx-runtime.ts
var ortByUrl = /* @__PURE__ */ new Map();
var urlOf = /* @__PURE__ */ new WeakMap();
var retiredAt = /* @__PURE__ */ new Map();
var retired = /* @__PURE__ */ new WeakSet();
var withQuery = (url, key, value) => {
  const [addr = "", hash = ""] = url.split(/(?=#)/, 2);
  return `${addr}${addr.includes("?") ? "&" : "?"}${key}=${value}${hash}`;
};
var RuntimeRetiredError = class extends Error {
  constructor() {
    super(
      "the runtime module is retired: a link of its chain did not settle within the chain's patience, so nothing new runs on it \u2014 a new session loads a fresh module"
    );
    this.name = "RuntimeRetiredError";
  }
};
var configuring = /* @__PURE__ */ new WeakMap();
var configured = /* @__PURE__ */ new WeakMap();
var RUN_CHAIN_TIMEOUT_MS = 3e4;
var chainTimeoutMs = RUN_CHAIN_TIMEOUT_MS;
function retire(ort, why) {
  if (retired.has(ort)) return;
  retired.add(ort);
  const url = urlOf.get(ort);
  if (url !== void 0) {
    ortByUrl.delete(url);
    retiredAt.set(url, (retiredAt.get(url) ?? 0) + 1);
  }
  console.warn(
    `[cubus] ${why}: the runtime module is retired, and the next session loads a fresh one`
  );
}
function serialise(ort, work, kind = "work") {
  const prev = configuring.get(ort) ?? Promise.resolve();
  let release = () => {
  };
  const released = new Promise((resolve) => {
    release = resolve;
  });
  configuring.set(ort, released);
  return prev.then(async () => {
    try {
      if (kind === "work" && retired.has(ort)) throw new RuntimeRetiredError();
      const timer = setTimeout(() => {
        retire(ort, `a link of the runtime's chain did not settle within ${chainTimeoutMs} ms`);
        release();
      }, chainTimeoutMs);
      try {
        return await work();
      } finally {
        clearTimeout(timer);
      }
    } finally {
      release();
    }
  });
}
var loadOrt = (url) => {
  let pending = ortByUrl.get(url);
  if (!pending) {
    const generation = retiredAt.get(url) ?? 0;
    const target = generation === 0 ? url : withQuery(url, "cubus-runtime-generation", `${generation}`);
    pending = import(
      /* @vite-ignore */
      target
    ).then(
      (ort) => {
        urlOf.set(ort, url);
        return ort;
      },
      (err) => {
        ortByUrl.delete(url);
        throw err;
      }
    );
    ortByUrl.set(url, pending);
  }
  return pending;
};
var runtimeUrl = (url, proxied) => proxied ? withQuery(url, "cubus-runtime", "proxied") : url;
var proxiedSiblingUrl = (url) => {
  const match = /^([^?#]*?)([^/?#]+)(\?[^#]*)?(#.*)?$/.exec(url);
  if (!match) return url;
  const [, dir = "", file = "", query = "", hash = ""] = match;
  const dot = file.lastIndexOf(".");
  const named = dot > 0 ? `${file.slice(0, dot)}.proxied${file.slice(dot)}` : `${file}.proxied`;
  return `${dir}${named}${query}${hash}`;
};
async function loadRuntime(ortUrl, proxied) {
  if (!proxied) return loadOrt(ortUrl);
  try {
    return await loadOrt(runtimeUrl(ortUrl, true));
  } catch (err) {
    const sibling = proxiedSiblingUrl(ortUrl);
    if (sibling === ortUrl) throw err;
    try {
      const ort = await loadOrt(sibling);
      console.info(
        `[cubus] the runtime's query-string identity did not load here \u2014 using ${sibling} instead`
      );
      return ort;
    } catch {
      throw err;
    }
  }
}
var documentVisibility = {
  hidden: () => globalThis.document?.visibilityState === "hidden",
  watch(onChange) {
    const doc = globalThis.document;
    doc?.addEventListener?.("visibilitychange", onChange);
    return () => doc?.removeEventListener?.("visibilitychange", onChange);
  }
};
var GPU_BUDGET_MS = 400;
var GPU_PROBE_RUNS = 2;
var SOFTWARE_RENDERERS = [
  "swiftshader",
  "llvmpipe",
  "lavapipe",
  "softpipe",
  "warp",
  "basic render",
  "microsoft basic"
];
function softwareAdapter(adapter) {
  if (adapter.isFallbackAdapter === true || adapter.info?.isFallbackAdapter === true) return true;
  const info = adapter.info;
  if (!info) return false;
  const text = `${info.vendor ?? ""} ${info.architecture ?? ""} ${info.description ?? ""}`.toLowerCase().trim();
  if (text.length === 0) return false;
  return SOFTWARE_RENDERERS.some((name) => text.includes(name));
}
async function preferredProviders() {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) return ["wasm"];
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return ["wasm"];
    if (softwareAdapter(adapter)) {
      console.info(
        "[cubus] WebGPU offers only a software adapter \u2014 using the wasm runtime instead"
      );
      return ["wasm"];
    }
    return ["webgpu", "wasm"];
  } catch {
    return ["wasm"];
  }
}
var usesGpu = (eps) => {
  const first = eps[0];
  if (first === void 0) return false;
  return (typeof first === "string" ? first : first.name) === "webgpu";
};
function defaultThreadCount(isolated = typeof globalThis.crossOriginIsolated === "boolean" ? globalThis.crossOriginIsolated : false, cores = globalThis.navigator?.hardwareConcurrency ?? 1) {
  if (!isolated) return 1;
  return Math.max(1, Math.min(cores - 2, 6));
}
function webgpuBackendLive(ort) {
  const webgpu = ort.env.webgpu;
  if (typeof webgpu !== "object" || webgpu === null) return null;
  return Boolean(webgpu.device);
}
function webgpuQueue(ort) {
  const device = ort.env.webgpu?.device;
  const queue = device?.queue;
  if (typeof queue !== "object" || queue === null) return null;
  return typeof queue.submit === "function" ? queue : null;
}
var queueWatches = /* @__PURE__ */ new WeakMap();
function watchQueue(queue) {
  let watch = queueWatches.get(queue);
  if (!watch) {
    const original = Object.getOwnPropertyDescriptor(queue, "submit");
    const submit = queue.submit;
    const counters = /* @__PURE__ */ new Set();
    const wrapper = function(...args) {
      for (const counter2 of counters) counter2.n++;
      return submit.apply(this, args);
    };
    try {
      Object.defineProperty(queue, "submit", {
        configurable: true,
        writable: true,
        enumerable: original?.enumerable ?? false,
        value: wrapper
      });
    } catch {
      return null;
    }
    watch = { wrapper, original, counters };
    queueWatches.set(queue, watch);
  }
  const live = watch;
  const counter = { n: 0 };
  live.counters.add(counter);
  let released = false;
  return {
    counter,
    release() {
      if (released) return;
      released = true;
      live.counters.delete(counter);
      if (live.counters.size > 0) return;
      queueWatches.delete(queue);
      if (queue.submit !== live.wrapper) return;
      if (live.original) Object.defineProperty(queue, "submit", live.original);
      else delete queue.submit;
    }
  };
}
async function gpuRanTheGraph(ort, probe) {
  const queue = webgpuQueue(ort);
  const watch = queue ? watchQueue(queue) : null;
  if (!watch) {
    await probe();
    return null;
  }
  try {
    await probe();
  } finally {
    watch.release();
  }
  return watch.counter.n > 0;
}
async function bestTimedRun(probe, visibility) {
  const hidden = () => visibility.hidden();
  if (hidden()) return null;
  let wentHidden = false;
  const noteHidden = () => {
    if (hidden()) wentHidden = true;
  };
  const unwatch = visibility.watch(noteHidden);
  let best = Number.POSITIVE_INFINITY;
  let watched = true;
  try {
    for (let i = 0; i < GPU_PROBE_RUNS && watched; i++) {
      const started = performance.now();
      await probe();
      if (hidden() || wentHidden) watched = false;
      else best = Math.min(best, performance.now() - started);
    }
  } finally {
    unwatch();
  }
  return watched && !hidden() && !wentHidden ? best : null;
}
async function owning(session, work) {
  let owned = true;
  try {
    return await work(() => {
      owned = false;
    });
  } catch (err) {
    if (owned) await session.release().catch(() => {
    });
    throw err;
  }
}
function inputSide(session) {
  const meta = session.inputMetadata?.[0];
  const dims = meta?.isTensor ? meta.shape : void 0;
  const h = dims?.[2];
  return typeof h === "number" && h > 0 ? h : IMG_SIZE;
}
function validatedRun(ort, session, inputName, outputName) {
  return async (input, imgsz) => {
    const tensor = new ort.Tensor("float32", input, [1, 3, imgsz, imgsz]);
    const result = await session.run({ [inputName]: tensor });
    const out = result[outputName];
    if (!out) throw new Error(`model produced no '${outputName}' output`);
    if (out.type !== "float32" || !(out.data instanceof Float32Array)) {
      throw new Error(`model output '${outputName}' is ${out.type}, not float32`);
    }
    const shape = `[${out.dims.join(", ")}]`;
    if (out.dims.length !== 3 || out.dims[0] !== 1) {
      throw new Error(
        `model output '${outputName}' has dims ${shape}, not the [1, rows, anchors] a detect head produces`
      );
    }
    const rows = out.dims[1] ?? 0;
    const anchors = out.dims[2] ?? 0;
    if (!Number.isInteger(rows) || !Number.isInteger(anchors) || rows <= 0 || anchors <= 0) {
      throw new Error(`model output '${outputName}' has dims ${shape}, which has no anchor axis`);
    }
    if (rows !== DETECT_ROWS) {
      const why = rows >= anchors ? ` \u2014 ${rows} rows against ${anchors} anchors is the transpose of a detect head` : "";
      throw new Error(
        `model output '${outputName}' has dims ${shape}: ${rows} rows, not the ${DETECT_ROWS} a ${DETECT_ROWS - 4}-class detect head produces${why}`
      );
    }
    if (out.data.length !== rows * anchors) {
      throw new Error(
        `model output '${outputName}' holds ${out.data.length} floats, not the ${rows * anchors} its dims ${shape} promise`
      );
    }
    return { data: out.data, anchors, rows };
  };
}
async function createSession(ort, cfg) {
  const { modelUrl, ortUrl, numThreads, wasmDir, proxied, executionProviders } = cfg;
  return serialise(ort, async () => {
    const first = configured.get(ort);
    if (first && (first.numThreads !== numThreads || first.wasmPaths !== wasmDir)) {
      throw new Error(
        `the runtime at ${ortUrl} is already initialised with numThreads ${first.numThreads} and wasmPaths ${first.wasmPaths}; this runner asked for ${numThreads} and ${wasmDir}, which onnxruntime cannot change on a live module`
      );
    }
    ort.env.wasm.numThreads = numThreads;
    ort.env.wasm.proxy = proxied;
    ort.env.wasm.wasmPaths = wasmDir;
    configured.set(ort, { numThreads, wasmPaths: wasmDir });
    return ort.InferenceSession.create(modelUrl, {
      executionProviders,
      graphOptimizationLevel: "all"
    });
  });
}
async function createModelRunner(modelUrl, opts = {}) {
  const chosenHere = opts.executionProviders === void 0;
  const executionProviders = opts.executionProviders ?? await preferredProviders();
  const gpu = usesGpu(executionProviders);
  const ortUrl = opts.ortUrl ?? "./ort.mjs";
  const proxied = !gpu && !opts.offPageThread;
  const ort = await loadRuntime(ortUrl, proxied);
  const numThreads = opts.numThreads ?? defaultThreadCount();
  const wasmDir = opts.wasmPaths ?? "./";
  let session;
  try {
    session = await createSession(ort, {
      modelUrl,
      ortUrl,
      numThreads,
      wasmDir,
      // The proxy is OFF for the GPU path — see `createSession` for why that is not a compromise.
      proxied,
      executionProviders
    });
  } catch (err) {
    if (!(err instanceof RuntimeRetiredError)) throw err;
    return createModelRunner(modelUrl, opts);
  }
  return owning(session, async (relinquish) => {
    const rebuildOnWasm = async (why) => {
      console.info(why);
      relinquish();
      await session.release().catch(() => {
      });
      return createModelRunner(modelUrl, { ...opts, executionProviders: ["wasm"] });
    };
    const gpuVerdict = gpu && chosenHere ? webgpuBackendLive(ort) : null;
    const notTheGpu = "[cubus] WebGPU did not take this model \u2014 using the wasm runtime, off the page thread";
    if (gpuVerdict === false) return rebuildOnWasm(notTheGpu);
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    if (!inputName || !outputName) throw new Error("model has no input/output tensor");
    const run = validatedRun(ort, session, inputName, outputName);
    const side = inputSide(session);
    const probe = () => run(new Float32Array(3 * side * side), side);
    if (opts.warmUp ?? true) {
      const measured = await serialise(ort, async () => {
        let ranOnGpu = null;
        if (gpuVerdict === true) ranOnGpu = await gpuRanTheGraph(ort, probe);
        else await probe();
        if (ranOnGpu === false) return { ranOnGpu, best: null };
        const best = gpu && chosenHere ? await bestTimedRun(probe, opts.visibility ?? documentVisibility) : null;
        return { ranOnGpu, best };
      });
      if (measured.ranOnGpu === false) return rebuildOnWasm(notTheGpu);
      const budget = opts.gpuBudgetMs ?? GPU_BUDGET_MS;
      if (measured.best !== null && measured.best > budget) {
        return rebuildOnWasm(
          `[cubus] the GPU ran this model in ${Math.round(measured.best)} ms \u2014 slower than the wasm runtime, so using that instead`
        );
      }
    }
    const serialised = (input, imgsz) => serialise(ort, () => run(input, imgsz));
    return Object.assign(serialised, {
      dispose: () => serialise(ort, () => session.release(), "release"),
      providers: executionProviders
    });
  });
}

// view/inference-worker.ts
var messageOf = (err) => err instanceof Error ? err.message : String(err);
var nameOf = (err) => err instanceof Error ? err.name : "Error";
function serveInference(scope, create = createModelRunner) {
  let runner = null;
  let loading = false;
  let hidden = false;
  const watchers = /* @__PURE__ */ new Set();
  const visibility = {
    hidden: () => hidden,
    watch(onChange) {
      watchers.add(onChange);
      return () => {
        watchers.delete(onChange);
      };
    }
  };
  async function load(req) {
    if (runner || loading) {
      scope.postMessage({
        kind: "load-failed",
        error: "inference worker: a model is already loaded here, and one worker holds one model"
      });
      return;
    }
    loading = true;
    hidden = req.hidden;
    try {
      runner = await create(req.modelUrl, {
        wasmPaths: req.wasmPaths,
        ortUrl: req.ortUrl,
        ...req.numThreads === void 0 ? {} : { numThreads: req.numThreads },
        offPageThread: true,
        visibility
      });
      scope.postMessage({
        kind: "loaded",
        providers: runner.providers.map((p) => typeof p === "string" ? p : p.name)
      });
    } catch (err) {
      scope.postMessage({ kind: "load-failed", error: messageOf(err) });
    } finally {
      loading = false;
    }
  }
  async function run(req) {
    const current = runner;
    if (!current) {
      scope.postMessage({
        kind: "run-failed",
        id: req.id,
        error: "inference worker: no model is loaded here",
        name: "Error"
      });
      return;
    }
    let reply;
    try {
      const out = await current(req.input, req.imgsz);
      reply = {
        kind: "ran",
        id: req.id,
        data: transferable(out.data),
        anchors: out.anchors,
        rows: out.rows
      };
    } catch (err) {
      scope.postMessage({
        kind: "run-failed",
        id: req.id,
        error: messageOf(err),
        name: nameOf(err)
      });
      return;
    }
    try {
      scope.postMessage(reply, { transfer: [reply.data.buffer] });
    } catch (err) {
      scope.postMessage({
        kind: "run-failed",
        id: req.id,
        error: messageOf(err),
        name: nameOf(err)
      });
    }
  }
  scope.addEventListener("message", (ev) => {
    const req = ev.data;
    if (req.kind === "visibility") {
      hidden = req.hidden;
      for (const onChange of [...watchers]) onChange();
    } else if (req.kind === "load") {
      void load(req);
    } else if (req.kind === "run") {
      void run(req);
    }
  });
}
serveInference(self);
export {
  serveInference
};
