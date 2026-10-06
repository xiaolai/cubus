// The detector's model in a worker the page owns: the client (`inference-client.ts`), the worker
// entry (`inference-worker.ts`) and the wire between them (`inference-protocol.ts`), 2026-09-22.
//
// What this exists to buy is RELEASE — a model the page can give back by terminating its worker —
// and the ways that goes wrong are all silent: a run left waiting on a worker that is gone (the scan
// sits on "Show any side" until the panel's deadline), a worker the page thought it released and did
// not (the memory stays, which is the whole defect), a relative URL resolved against the wrong base
// (a 404 the worker reports as "the model would not load"), and a worker written off where the page
// could not have done better (the release then returns nothing, for the rest of the page). So most
// assertions here are about what must NOT happen. The positive claim — the worker runs the real
// `createModelRunner` and its answer crosses intact — is made end to end, through the fake runtime.
//
// In Node rather than happy-dom, on purpose, as `letterbox-worker.test.ts` is: vitest's web
// transform rewrites `new URL('./inference-worker.js', import.meta.url)` to the SOURCE file's URL, so
// the assertion about which script the client asks for can only be made against the untransformed
// module.

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelOutput } from '../src/detector.js';
import {
  INFERENCE_WORKER_LOST,
  InferenceOffload,
  InferenceWorkerLostError,
} from '../view/inference-client.js';
import type {
  InferenceReply,
  InferenceRequest,
  LoadRequest,
  RunRequest,
} from '../view/inference-protocol.js';
import { transferable } from '../view/inference-protocol.js';
import type { InferenceScope } from '../view/inference-worker.js';
import type { ModelRunner, ModelRunnerOptions } from '../view/onnx-runtime.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const MODEL_URL = pathToFileURL(join(FIXTURES, 'model.onnx')).href;
const WASM_PATHS = pathToFileURL(`${FIXTURES}/`).href;
/** The fake runtime, under a URL nothing else in the run imports — see model-runner.test.ts. */
let caseId = 0;
const freshOrtUrl = (): string =>
  `${pathToFileURL(join(FIXTURES, 'fake-ort.mjs')).href}?inference-case=${++caseId}`;

/** A detect head's worth of output, as the model produces it: [1, 10, anchors]. */
const head = (anchors = 4): ModelOutput => ({
  data: new Float32Array(10 * anchors).map((_, i) => i),
  anchors,
  rows: 10,
});

/**
 * A `Worker` that never leaves this thread. What it is POSTED goes through `structuredClone` with the
 * transfer list, exactly as `postMessage` does — so a transferred input is detached here, and a
 * test can see that it was. What it SENDS back goes the same way.
 */
class FakeWorker {
  static built: FakeWorker[] = [];
  static refuse: Error | null = null;
  static last(): FakeWorker {
    const w = FakeWorker.built[FakeWorker.built.length - 1];
    if (!w) throw new Error('no worker was built');
    return w;
  }
  posted: InferenceRequest[] = [];
  terminated = false;
  /** Set to make the next `postMessage` throw — a buffer the engine will not transfer. */
  refusePost: Error | null = null;
  protected listeners = new Map<string, ((ev: unknown) => void)[]>();
  constructor(
    readonly url: URL,
    readonly options: unknown,
  ) {
    if (FakeWorker.refuse) throw FakeWorker.refuse;
    FakeWorker.built.push(this);
  }
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  postMessage(message: InferenceRequest, transfer: Transferable[] = []): void {
    if (this.refusePost) throw this.refusePost;
    this.posted.push(structuredClone(message, { transfer }));
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Answer with anything, through the wire. */
  send(reply: InferenceReply, transfer: Transferable[] = []): void {
    const data = structuredClone(reply, { transfer });
    for (const fn of this.listeners.get('message') ?? []) fn({ data });
  }
  /** The last request of a kind, or a failure naming it. */
  lastOf<K extends InferenceRequest['kind']>(kind: K): Extract<InferenceRequest, { kind: K }> {
    const found = [...this.posted].reverse().find((m) => m.kind === kind);
    if (!found) throw new Error(`nothing of kind ${kind} was posted`);
    return found as Extract<InferenceRequest, { kind: K }>;
  }
  /** The asynchronous failure: the worker was built and then could not load, or died. */
  fail(message?: string): void {
    for (const fn of this.listeners.get('error') ?? []) fn({ message });
  }
  /** An answer that arrived and could not be deserialised. */
  garble(): void {
    for (const fn of this.listeners.get('messageerror') ?? []) fn({});
  }
}

const g = globalThis as { Worker?: unknown; self?: unknown; document?: unknown };
const had = { Worker: g.Worker, self: g.self, document: g.document };

/** A stand-in for the page-thread runner, counting who asked it. */
function pageRunner(behaviour: 'loads' | 'fails' = 'loads') {
  const asked: { modelUrl: string; opts: ModelRunnerOptions }[] = [];
  const onPage = async (modelUrl: string, opts: ModelRunnerOptions): Promise<ModelRunner> => {
    asked.push({ modelUrl, opts });
    if (behaviour === 'fails') throw new Error('the model would not load on the page either');
    return Object.assign(async () => head(), {
      dispose: async () => {},
      providers: ['wasm'] as const,
    });
  };
  return { asked, onPage };
}

/** Load through `offload` and answer the load with `providers`, returning the runner. */
async function loaded(offload: InferenceOffload, providers = ['wasm']): Promise<ModelRunner> {
  const pending = offload.createRunner(MODEL_URL, { wasmPaths: WASM_PATHS, ortUrl: 'x:/ort.mjs' });
  FakeWorker.last().send({ kind: 'loaded', providers });
  return pending;
}

beforeEach(() => {
  FakeWorker.built = [];
  FakeWorker.refuse = null;
  g.Worker = FakeWorker;
});

afterEach(() => {
  g.Worker = had.Worker;
  g.document = had.document;
  vi.restoreAllMocks();
});

describe('the client: where the model is loaded', () => {
  it('spawns the inference worker beside the panel as a module, and loads by ABSOLUTE urls', async () => {
    const { asked, onPage } = pageRunner();
    const offload = new InferenceOffload(onPage);
    const runner = await loaded(offload, ['webgpu', 'wasm']);
    const worker = FakeWorker.last();
    expect(worker.url.href).toMatch(/\/inference-worker\.js$/);
    expect(worker.options).toEqual({ type: 'module' });
    const load = worker.lastOf('load');
    // A worker resolves a relative URL against its OWN script, so the page resolves them first.
    expect(load.modelUrl).toBe(MODEL_URL);
    expect(load.wasmPaths).toBe(WASM_PATHS);
    expect(load.hidden).toBe(false);
    expect('numThreads' in load).toBe(false); // left to the worker's own default
    expect(runner.providers).toEqual(['webgpu', 'wasm']);
    expect(asked).toEqual([]); // the page's thread was never asked
  });

  it('resolves a RELATIVE model URL against the document before it crosses, not against the worker', async () => {
    // The worker's script is in `vendor/`, so './vendor/cubedet.onnx' resolved there is
    // 'vendor/vendor/cubedet.onnx' — a 404 the worker would report as a model that would not load.
    g.document = { baseURI: 'https://app.example/cubus/', visibilityState: 'visible' };
    const offload = new InferenceOffload(pageRunner().onPage);
    void offload.createRunner('./vendor/cubedet.onnx', {
      wasmPaths: 'https://app.example/cubus/vendor/',
      ortUrl: 'https://app.example/cubus/vendor/ort.mjs',
    });
    expect(FakeWorker.last().lastOf('load').modelUrl).toBe(
      'https://app.example/cubus/vendor/cubedet.onnx',
    );
  });

  it('takes the page thread where there is no Worker, and builds none', async () => {
    g.Worker = undefined;
    const { asked, onPage } = pageRunner();
    const offload = new InferenceOffload(onPage);
    expect(offload.offloading).toBe(false);
    await offload.createRunner(MODEL_URL, { wasmPaths: WASM_PATHS, ortUrl: 'x:/ort.mjs' });
    expect(asked).toHaveLength(1);
    expect(FakeWorker.built).toEqual([]);
  });

  it('takes the page thread when the worker will not build, and does not try to build it again', async () => {
    FakeWorker.refuse = new Error('refused by a CSP');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { asked, onPage } = pageRunner();
    const offload = new InferenceOffload(onPage);
    await offload.createRunner(MODEL_URL, { wasmPaths: WASM_PATHS, ortUrl: 'x:/ort.mjs' });
    FakeWorker.refuse = null;
    await offload.createRunner(MODEL_URL, { wasmPaths: WASM_PATHS, ortUrl: 'x:/ort.mjs' });
    expect(asked).toHaveLength(2);
    expect(FakeWorker.built).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('writes the worker off only when the page loads what the worker could not', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { asked, onPage } = pageRunner('loads');
    const offload = new InferenceOffload(onPage);
    const pending = offload.createRunner(MODEL_URL, {
      wasmPaths: WASM_PATHS,
      ortUrl: 'x:/ort.mjs',
    });
    FakeWorker.last().send({ kind: 'load-failed', error: 'no nested workers here' });
    const runner = await pending;
    expect(FakeWorker.last().terminated).toBe(true); // the failed worker is not left running
    expect(asked).toHaveLength(1);
    expect(runner.providers).toEqual(['wasm']);
    expect(warn).toHaveBeenCalledTimes(1);
    // …and the next load goes straight to the page. Asserted before it is awaited: a load sent to a
    // worker nothing answers would otherwise fail this case only by timing out.
    const next = offload.createRunner(MODEL_URL, { wasmPaths: WASM_PATHS, ortUrl: 'x:/ort.mjs' });
    expect(FakeWorker.built).toHaveLength(1);
    expect(asked).toHaveLength(2);
    await next;
  });

  it('a model that fails in both places is the model’s failure: it propagates, and the worker is not written off', async () => {
    const { asked, onPage } = pageRunner('fails');
    const offload = new InferenceOffload(onPage);
    const pending = offload.createRunner(MODEL_URL, {
      wasmPaths: WASM_PATHS,
      ortUrl: 'x:/ort.mjs',
    });
    FakeWorker.last().send({ kind: 'load-failed', error: '404' });
    await expect(pending).rejects.toThrow(/would not load on the page either/);
    expect(asked).toHaveLength(1);
    expect(offload.offloading).toBe(true);
    const again = offload.createRunner(MODEL_URL, { wasmPaths: WASM_PATHS, ortUrl: 'x:/ort.mjs' });
    expect(FakeWorker.built).toHaveLength(2);
    FakeWorker.last().send({ kind: 'loaded', providers: ['wasm'] });
    await again;
  });

  it('a worker that dies during the load is asked of the page, like any worker failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { asked, onPage } = pageRunner();
    const offload = new InferenceOffload(onPage);
    const pending = offload.createRunner(MODEL_URL, {
      wasmPaths: WASM_PATHS,
      ortUrl: 'x:/ort.mjs',
    });
    FakeWorker.last().fail('module script failed');
    await pending;
    expect(FakeWorker.last().terminated).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it('a cancelled load terminates its worker at once and asks the page nothing', async () => {
    const { asked, onPage } = pageRunner();
    const offload = new InferenceOffload(onPage);
    const abort = new AbortController();
    const pending = offload.createRunner(MODEL_URL, {
      wasmPaths: WASM_PATHS,
      ortUrl: 'x:/ort.mjs',
      signal: abort.signal,
    });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.last().terminated).toBe(true);
    expect(asked).toEqual([]);
    expect(offload.offloading).toBe(true); // a cancellation is not a verdict on the worker
  });

  it('a load asked for with a signal already aborted builds no worker and asks the page nothing', async () => {
    const { asked, onPage } = pageRunner();
    const abort = new AbortController();
    abort.abort();
    await expect(
      new InferenceOffload(onPage).createRunner(MODEL_URL, {
        wasmPaths: WASM_PATHS,
        ortUrl: 'x:/ort.mjs',
        signal: abort.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.built).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('tells the worker when the page is hidden, and stops telling it once it is released', async () => {
    const listeners = new Set<() => void>();
    const doc = {
      visibilityState: 'hidden',
      addEventListener: (_t: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_t: string, fn: () => void) => listeners.delete(fn),
    };
    g.document = doc;
    const runner = await loaded(new InferenceOffload(pageRunner().onPage));
    const worker = FakeWorker.last();
    expect(worker.lastOf('load').hidden).toBe(true);
    doc.visibilityState = 'visible';
    for (const fn of [...listeners]) fn();
    expect(worker.lastOf('visibility')).toEqual({ kind: 'visibility', hidden: false });
    await runner.dispose();
    expect(listeners.size).toBe(0);
  });
});

describe('the client: a runner is a round trip, and releasing it ends the worker', () => {
  it('transfers the input and resolves with the tensor that came back', async () => {
    const runner = await loaded(new InferenceOffload(pageRunner().onPage));
    const worker = FakeWorker.last();
    const input = new Float32Array(3 * 4 * 4).fill(0.5);
    const pending = runner(input, 4);
    expect(input.length).toBe(0); // detached: transferred, not copied
    const run = worker.lastOf('run');
    expect(run.imgsz).toBe(4);
    expect(run.input.length).toBe(48);
    const out = head();
    worker.send({ kind: 'ran', id: run.id, ...out }, [out.data.buffer]);
    await expect(pending).resolves.toEqual(head());
  });

  it('copies an input that does not own its buffer, rather than detaching a stranger’s memory', async () => {
    const runner = await loaded(new InferenceOffload(pageRunner().onPage));
    const whole = new Float32Array(100).fill(1);
    const view = whole.subarray(10, 58);
    void runner(view, 4).catch(() => {});
    expect(whole.length).toBe(100); // still there
    expect(FakeWorker.last().lastOf('run').input.length).toBe(48);
  });

  it('a frame that cannot be posted ends the worker and says so, rather than waiting on nothing', async () => {
    const runner = await loaded(new InferenceOffload(pageRunner().onPage));
    const worker = FakeWorker.last();
    worker.refusePost = new Error('DataCloneError');
    await expect(runner(new Float32Array(48), 4)).rejects.toMatchObject({
      name: INFERENCE_WORKER_LOST,
      message: expect.stringContaining('DataCloneError'),
    });
    expect(worker.terminated).toBe(true);
  });

  it('an answer for a frame nobody is waiting on is dropped, and the one that is waited on still lands', async () => {
    const runner = await loaded(new InferenceOffload(pageRunner().onPage));
    const worker = FakeWorker.last();
    const pending = runner(new Float32Array(48), 4);
    const { id } = worker.lastOf('run');
    worker.send({ kind: 'ran', id: id + 100, ...head() });
    worker.send({ kind: 'ran', id, ...head() });
    await expect(pending).resolves.toEqual(head());
  });

  it('refuses an answer that is not a detect head, naming its dims', async () => {
    const runner = await loaded(new InferenceOffload(pageRunner().onPage));
    const pending = runner(new Float32Array(48), 4);
    const { id } = FakeWorker.last().lastOf('run');
    FakeWorker.last().send({ kind: 'ran', id, data: new Float32Array(9 * 4), anchors: 4, rows: 9 });
    await expect(pending).rejects.toThrow(/\[1, 9, 4\].*not a 10-row detect head/);
  });

  it('a failed frame rejects with the worker’s own message and name', async () => {
    const runner = await loaded(new InferenceOffload(pageRunner().onPage));
    const pending = runner(new Float32Array(48), 4);
    const { id } = FakeWorker.last().lastOf('run');
    FakeWorker.last().send({
      kind: 'run-failed',
      id,
      error: 'the chain gave up',
      name: 'RuntimeRetiredError',
    });
    await expect(pending).rejects.toMatchObject({
      name: 'RuntimeRetiredError',
      message: 'the chain gave up',
    });
  });

  it('dispose TERMINATES the worker, rejects the frame in flight, and refuses every later one', async () => {
    const runner = await loaded(new InferenceOffload(pageRunner().onPage));
    const worker = FakeWorker.last();
    const inFlight = runner(new Float32Array(48), 4);
    await runner.dispose();
    expect(worker.terminated).toBe(true);
    await expect(inFlight).rejects.toBeInstanceOf(InferenceWorkerLostError);
    await expect(runner(new Float32Array(48), 4)).rejects.toMatchObject({
      name: INFERENCE_WORKER_LOST,
    });
    // A late answer from the terminated worker changes nothing and throws nothing.
    worker.send({ kind: 'ran', id: 1, ...head() });
    await runner.dispose(); // idempotent
  });

  it('a worker that dies mid-scan loses its frame and every later one — with the lost name the panel reads', async () => {
    const runner = await loaded(new InferenceOffload(pageRunner().onPage));
    const worker = FakeWorker.last();
    const inFlight = runner(new Float32Array(48), 4);
    worker.fail('out of memory');
    await expect(inFlight).rejects.toMatchObject({
      name: INFERENCE_WORKER_LOST,
      message: expect.stringContaining('out of memory'),
    });
    expect(worker.terminated).toBe(true);
    await expect(runner(new Float32Array(48), 4)).rejects.toMatchObject({
      name: INFERENCE_WORKER_LOST,
    });
  });

  it('an answer that cannot be read ends the worker rather than leaving the frame to wait', async () => {
    const runner = await loaded(new InferenceOffload(pageRunner().onPage));
    const inFlight = runner(new Float32Array(48), 4);
    FakeWorker.last().garble();
    await expect(inFlight).rejects.toMatchObject({ name: INFERENCE_WORKER_LOST });
    expect(FakeWorker.last().terminated).toBe(true);
  });
});

describe('transferable', () => {
  it('passes a tensor that owns its buffer through untouched, and copies anything else', () => {
    const owned = new Float32Array(8);
    expect(transferable(owned)).toBe(owned);
    const view = new Float32Array(new ArrayBuffer(64), 8, 4);
    expect(transferable(view)).not.toBe(view);
    expect(transferable(view).buffer.byteLength).toBe(16);
    // A threaded wasm heap is a SharedArrayBuffer: posted, it would be SHARED, not moved.
    const shared = new Float32Array(new SharedArrayBuffer(32));
    expect(transferable(shared).buffer).toBeInstanceOf(ArrayBuffer);
  });
});

describe('the worker entry', () => {
  /** A scope the entry listens on, and everything it posted. */
  function scope(): InferenceScope & {
    posted: { message: InferenceReply; transfer?: Transferable[] }[];
    ask(req: InferenceRequest): void;
  } {
    const posted: { message: InferenceReply; transfer?: Transferable[] }[] = [];
    let listener: ((ev: MessageEvent<InferenceRequest>) => void) | null = null;
    return {
      posted,
      addEventListener: (_type, fn) => {
        listener = fn;
      },
      postMessage: (message, options) => {
        posted.push(options?.transfer ? { message, transfer: options.transfer } : { message });
      },
      ask(req) {
        listener?.({ data: req } as MessageEvent<InferenceRequest>);
      },
    };
  }
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const loadReq = (hidden = false): LoadRequest => ({
    kind: 'load',
    modelUrl: MODEL_URL,
    wasmPaths: WASM_PATHS,
    ortUrl: 'x:/ort.mjs',
    hidden,
  });

  let serveInference: typeof import('../view/inference-worker.js').serveInference;
  const entryScope = scope();
  beforeAll(async () => {
    // The entry registers on `self` at import, once for this file — as the real worker does.
    g.self = entryScope;
    ({ serveInference } = await import('../view/inference-worker.js'));
    g.self = had.self;
  });

  it('registers on its own scope when loaded, as the shipped worker does', async () => {
    entryScope.ask({ kind: 'run', id: 1, input: new Float32Array(1), imgsz: 1 });
    expect(entryScope.posted[0]?.message).toMatchObject({ kind: 'run-failed', id: 1 });
  });

  it('builds the runner OFF the page thread, with the page’s visibility, and answers with provider names', async () => {
    const s = scope();
    const seen: ModelRunnerOptions[] = [];
    serveInference(s, async (_url, opts) => {
      seen.push(opts);
      return Object.assign(async () => head(), {
        dispose: async () => {},
        providers: [{ name: 'webgpu' }, 'wasm'] as ModelRunner['providers'],
      });
    });
    s.ask(loadReq(true));
    await settle();
    expect(seen[0]?.offPageThread).toBe(true);
    expect(seen[0]?.visibility?.hidden()).toBe(true);
    let heard = 0;
    const unwatch = seen[0]?.visibility?.watch(() => heard++);
    s.ask({ kind: 'visibility', hidden: false });
    expect(seen[0]?.visibility?.hidden()).toBe(false);
    expect(heard).toBe(1);
    unwatch?.();
    s.ask({ kind: 'visibility', hidden: true });
    expect(heard).toBe(1);
    expect(s.posted[0]?.message).toEqual({ kind: 'loaded', providers: ['webgpu', 'wasm'] });
  });

  it('holds ONE model: a second load is refused, not stacked', async () => {
    const s = scope();
    let built = 0;
    serveInference(s, async () => {
      built++;
      return Object.assign(async () => head(), { dispose: async () => {}, providers: ['wasm'] });
    });
    s.ask(loadReq());
    s.ask(loadReq()); // while the first is still loading
    await settle();
    s.ask(loadReq()); // and after it has loaded
    await settle();
    expect(built).toBe(1);
    expect(s.posted.map((p) => p.message.kind)).toEqual(['load-failed', 'loaded', 'load-failed']);
  });

  it('says a failed load, and a failed run, under the run’s id and the error’s own name', async () => {
    const s = scope();
    serveInference(s, async () => {
      throw new Error('the model would not load');
    });
    s.ask(loadReq());
    await settle();
    expect(s.posted[0]?.message).toEqual({
      kind: 'load-failed',
      error: 'the model would not load',
    });

    const t = scope();
    class RuntimeRetiredError extends Error {
      override name = 'RuntimeRetiredError';
    }
    serveInference(t, async () =>
      Object.assign(
        async () => {
          throw new RuntimeRetiredError('retired');
        },
        { dispose: async () => {}, providers: ['wasm'] },
      ),
    );
    t.ask(loadReq());
    await settle();
    t.ask({ kind: 'run', id: 7, input: new Float32Array(3), imgsz: 1 });
    await settle();
    expect(t.posted[1]?.message).toEqual({
      kind: 'run-failed',
      id: 7,
      error: 'retired',
      name: 'RuntimeRetiredError',
    });
  });

  it('a reply the scope will not transfer is still an answer under the frame’s id', async () => {
    const s = scope();
    let refuse = true;
    const post = s.postMessage;
    s.postMessage = (message, options) => {
      if (refuse && options?.transfer) {
        refuse = false;
        throw new Error('DataCloneError: could not transfer');
      }
      post(message, options);
    };
    serveInference(s, async () =>
      Object.assign(async () => head(), { dispose: async () => {}, providers: ['wasm'] }),
    );
    s.ask(loadReq());
    await settle();
    s.ask({ kind: 'run', id: 5, input: new Float32Array(3), imgsz: 1 });
    await settle();
    expect(s.posted[1]?.message).toEqual({
      kind: 'run-failed',
      id: 5,
      error: 'DataCloneError: could not transfer',
      name: 'Error',
    });
  });

  it('answers a run by transfer, from a buffer of its own even when the runtime’s was shared', async () => {
    const s = scope();
    const sharedOut = new Float32Array(new SharedArrayBuffer(10 * 4 * 4));
    sharedOut.fill(2);
    serveInference(s, async () =>
      Object.assign(async () => ({ data: sharedOut, anchors: 4, rows: 10 }), {
        dispose: async () => {},
        providers: ['wasm'],
      }),
    );
    s.ask(loadReq());
    await settle();
    s.ask({ kind: 'run', id: 3, input: new Float32Array(3), imgsz: 1 } satisfies RunRequest);
    await settle();
    const { message, transfer } = s.posted[1]!;
    expect(message).toMatchObject({ kind: 'ran', id: 3, anchors: 4, rows: 10 });
    const data = (message as Extract<InferenceReply, { kind: 'ran' }>).data;
    expect(data.buffer).toBeInstanceOf(ArrayBuffer);
    expect(data.buffer).not.toBe(sharedOut.buffer);
    expect(transfer).toEqual([data.buffer]);
    expect([...data.slice(0, 3)]).toEqual([2, 2, 2]);
  });
});

describe('end to end: the real runner, in a worker, through the wire', () => {
  /**
   * A worker whose other end is the SHIPPED entry running the REAL `createModelRunner` against the
   * fake runtime — every message cloned with its transfer list, and delivered on a later task, as a
   * worker's are. What this proves that the halves above cannot: the two agree on the wire.
   */
  class WiredWorker extends FakeWorker {
    private readonly inbox: ((ev: MessageEvent<InferenceRequest>) => void)[] = [];
    constructor(
      url: URL,
      options: unknown,
      serve: typeof import('../view/inference-worker.js').serveInference,
    ) {
      super(url, options);
      serve({
        addEventListener: (_type, fn) => {
          this.inbox.push(fn);
        },
        postMessage: (message, opts) => {
          const data = structuredClone(message, { transfer: opts?.transfer ?? [] });
          setTimeout(() => {
            if (this.terminated) return; // a terminated worker's messages never arrive
            for (const fn of this.listeners.get('message') ?? []) fn({ data });
          }, 0);
        },
      });
    }
    override postMessage(message: InferenceRequest, transfer: Transferable[] = []): void {
      super.postMessage(message, transfer);
      const data = this.posted[this.posted.length - 1]!;
      setTimeout(() => {
        if (this.terminated) return;
        for (const fn of this.inbox) fn({ data } as MessageEvent<InferenceRequest>);
      }, 0);
    }
  }

  let serve: typeof import('../view/inference-worker.js').serveInference;
  beforeAll(async () => {
    const prior = g.self;
    g.self = { addEventListener: () => {}, postMessage: () => {} };
    ({ serveInference: serve } = await import('../view/inference-worker.js'));
    g.self = prior;
  });

  it('loads on ONE unproxied module, runs a frame, and returns the validated head', async () => {
    const made = (): { proxy: boolean | null }[] =>
      (globalThis as { __fakeOrt?: { instances: { proxy: boolean | null }[] } }).__fakeOrt
        ?.instances ?? [];
    const before = made().length;
    g.Worker = class extends WiredWorker {
      constructor(url: URL, options: unknown) {
        super(url, options, serve);
      }
    };
    const offload = new InferenceOffload(() => {
      throw new Error('the page thread must not be asked');
    });
    const runner = await offload.createRunner(MODEL_URL, {
      wasmPaths: WASM_PATHS,
      ortUrl: freshOrtUrl(),
      numThreads: 1,
    });
    expect(runner.providers).toEqual(['wasm']);
    const modules = made().slice(before);
    expect(modules).toHaveLength(1); // one module: no proxied twin
    expect(modules[0]?.proxy).toBe(false);

    const out = await runner(new Float32Array(3 * 640 * 640), 640);
    expect(out.rows).toBe(10);
    expect(out.anchors).toBe(8400);
    expect(out.data).toBeInstanceOf(Float32Array);
    expect(out.data.length).toBe(10 * 8400);

    await runner.dispose();
    expect(FakeWorker.last().terminated).toBe(true);
    await expect(runner(new Float32Array(3 * 640 * 640), 640)).rejects.toMatchObject({
      name: INFERENCE_WORKER_LOST,
    });
  });
});
