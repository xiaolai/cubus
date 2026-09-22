// The detector's model, asked for from the page and run in a worker the page owns (2026-09-22).
//
// Why a worker of our own, when onnxruntime already has one: RELEASE. See `inference-worker.ts` for
// the measurement. A runner made here is disposed by terminating its worker, which takes the
// runtime's module, its wasm heap and its thread pool with it — the only way this page has of
// getting that memory back short of being reloaded. `pickDetector` releases a parked detector a
// while after the scan screen is left (`PARKED_RELEASE_MS`), and this is what makes that release
// worth anything.
//
// The arrangement of `letterbox-client.ts`, for the same ways of having no worker: no `Worker` on
// the platform, or one that refuses to build (a CSP, a blocked URL), and both go to the page's
// thread exactly as before. One more is this worker's own: a model the worker cannot load. Whether
// that is the WORKER's fault or the MODEL's is not something the worker can say, so the page's
// thread is asked the same thing — if it loads there, the worker path is written off for this client
// and the model runs on the page; if it fails there too, that failure is the answer.

import { DETECT_ROWS } from '../src/detect-head.js';
import type { ModelOutput } from '../src/detector.js';
import type { InferenceReply, InferenceRequest, LoadRequest } from './inference-protocol.js';
import { transferable } from './inference-protocol.js';
import {
  createModelRunner,
  documentVisibility,
  type ModelRunner,
  type ModelRunnerOptions,
} from './onnx-runtime.js';

/** The `name` a lost worker's errors carry — what `tickFail` reads to rebuild rather than retry. */
export const INFERENCE_WORKER_LOST = 'InferenceWorkerLostError';

/**
 * The worker is gone: released, failed, or answering in a way that cannot be read. Every run still
 * waiting on it is rejected with this, and so is every run asked of it afterwards — a worker does
 * not come back, and a runner that went on accepting frames for it would be a scanner waiting on
 * nothing.
 */
export class InferenceWorkerLostError extends Error {
  constructor(why: string) {
    super(why);
    this.name = INFERENCE_WORKER_LOST;
  }
}

/** What a runner is built from: absolute URLs, as `createModelRunner`'s options ask. */
export interface InferenceOptions {
  wasmPaths: string;
  ortUrl: string;
  numThreads?: number;
  /** Aborting it while the model loads terminates the worker at once and rejects the load. */
  signal?: AbortSignal;
}

interface Waiting<T> {
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

/** "An AbortError", as the platform says it — what a cancelled load rejects with. */
const aborted = (): DOMException => new DOMException('the model load was cancelled', 'AbortError');

/**
 * One worker and the model in it, seen from the page.
 *
 * Every listener names THIS worker's state and nothing else, and every path out goes through
 * `close`, which is idempotent: a late event from a worker that has already been closed finds
 * nothing waiting and changes nothing.
 */
class RemoteModel {
  private readonly pending = new Map<number, Waiting<ModelOutput>>();
  private loading: Waiting<string[]> | null = null;
  private lost: InferenceWorkerLostError | null = null;
  private nextId = 0;
  private readonly unwatch: () => void;

  constructor(private readonly worker: Worker) {
    worker.addEventListener('message', (ev: MessageEvent<InferenceReply>) => this.deliver(ev.data));
    worker.addEventListener('error', (ev: Event) => {
      const said = (ev as { message?: unknown }).message;
      this.close(
        `the inference worker failed${typeof said === 'string' && said ? `: ${said}` : ''}`,
      );
    });
    // An answer that could not be deserialised reaches neither `deliver` nor `error`, so without
    // this the frame it answered would wait for the panel's deadline — the letterbox client's lesson.
    worker.addEventListener('messageerror', () => {
      this.close('an answer from the inference worker could not be read');
    });
    this.unwatch = documentVisibility.watch(() => {
      this.post({ kind: 'visibility', hidden: documentVisibility.hidden() });
    });
  }

  /** Load the model; resolves with the providers it came up on. */
  load(req: Omit<LoadRequest, 'kind' | 'hidden'>): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      this.loading = { resolve, reject };
      this.post({ kind: 'load', ...req, hidden: documentVisibility.hidden() });
    });
  }

  /** The runner a detector holds: a run is a round trip, and disposing it terminates the worker. */
  runner(providers: string[]): ModelRunner {
    const run = (input: Float32Array, imgsz: number): Promise<ModelOutput> =>
      this.run(input, imgsz);
    return Object.assign(run, {
      dispose: async (): Promise<void> => {
        this.close('the model was released');
      },
      providers,
    });
  }

  /**
   * One frame. The input is TRANSFERRED, which detaches it here — as onnxruntime's own proxy always
   * did on the wasm path, so no caller could rely on keeping it. A view that does not own its
   * buffer outright is copied first rather than detaching a stranger's memory (`transferable`).
   */
  private run(input: Float32Array, imgsz: number): Promise<ModelOutput> {
    if (this.lost) return Promise.reject(this.lost);
    const id = ++this.nextId;
    return new Promise<ModelOutput>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const tensor = transferable(input);
      if (!this.post({ kind: 'run', id, input: tensor, imgsz }, [tensor.buffer])) {
        this.pending.delete(id);
        reject(this.lost ?? new InferenceWorkerLostError('the frame could not be sent'));
      }
    });
  }

  /**
   * Give the worker back: terminate it, and reject everything still waiting on it. Idempotent.
   *
   * The ONE place the worker ends, whether the page released it or it failed, so there is no path
   * on which a run is left waiting on a worker that no longer exists.
   */
  close(why: string): void {
    if (this.lost) return;
    const lost = new InferenceWorkerLostError(why);
    this.lost = lost;
    this.worker.terminate();
    this.unwatch();
    const loading = this.loading;
    this.loading = null;
    loading?.reject(lost);
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const w of waiting) w.reject(lost);
  }

  /** Post, or close the worker and say false if the post was refused. */
  private post(message: InferenceRequest, transfer: Transferable[] = []): boolean {
    if (this.lost) return false;
    try {
      this.worker.postMessage(message, transfer);
      return true;
    } catch (err) {
      this.close(
        `the inference worker could not be sent a message: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private deliver(reply: InferenceReply): void {
    if (this.lost) return;
    if (reply.kind === 'loaded' || reply.kind === 'load-failed') {
      const loading = this.loading;
      this.loading = null;
      if (reply.kind === 'loaded') loading?.resolve(reply.providers);
      else loading?.reject(new Error(reply.error));
      return;
    }
    const waiting = this.pending.get(reply.id);
    if (!waiting) return; // nobody is waiting for this frame any more
    this.pending.delete(reply.id);
    if (reply.kind === 'run-failed') {
      waiting.reject(Object.assign(new Error(reply.error), { name: reply.name }));
      return;
    }
    // ZERO TRUST AT THE BOUNDARY, though the worker is ours: what crossed is decoded arithmetically
    // downstream, so a tensor that is not a detect head is refused here, with its dims, rather than
    // read off stale offsets. The runner in the worker has already checked the same thing; this is
    // the check that the answer is the one it checked.
    const { data, anchors, rows } = reply;
    if (
      !(data instanceof Float32Array) ||
      !Number.isInteger(anchors) ||
      anchors <= 0 ||
      rows !== DETECT_ROWS ||
      data.length !== rows * anchors
    ) {
      waiting.reject(
        new Error(
          `the inference worker answered with ${data instanceof Float32Array ? `${data.length} floats` : 'no tensor'} as [1, ${rows}, ${anchors}], which is not a ${DETECT_ROWS}-row detect head`,
        ),
      );
      return;
    }
    waiting.resolve({ data, anchors, rows });
  }
}

/**
 * Where a detector's model is loaded: a worker of the page's own where it can be, the page's thread
 * otherwise.
 *
 * `web-detector.ts` holds ONE for the page, shared by every detector: the write-off below is a
 * verdict about the platform, and a detector released and rebuilt would otherwise pay the failed
 * worker load again on every visit.
 */
export class InferenceOffload {
  /** Set once the worker path has failed where the page's thread did not, so it is not tried again. */
  private broken = false;

  constructor(
    private readonly onPage: (
      modelUrl: string,
      opts: ModelRunnerOptions,
    ) => Promise<ModelRunner> = createModelRunner,
  ) {}

  /** Whether the next load will go to a worker. Read off the globals, which is what lets a test take them away. */
  get offloading(): boolean {
    return !this.broken && typeof (globalThis as { Worker?: unknown }).Worker === 'function';
  }

  /**
   * Load the model and hand back its runner.
   *
   * `modelUrl` is resolved against the DOCUMENT before it crosses: a worker resolves a relative URL
   * against its own script, which lives in `vendor/`, so './vendor/cubedet.onnx' would become
   * 'vendor/vendor/cubedet.onnx' there.
   */
  async createRunner(modelUrl: string, opts: InferenceOptions): Promise<ModelRunner> {
    const { signal, ...runtime } = opts;
    if (signal?.aborted) throw aborted();
    const worker = this.offloading ? this.spawn() : null;
    if (!worker) return this.onPage(modelUrl, runtime);
    const remote = new RemoteModel(worker);
    const cancel = (): void => remote.close('the model load was cancelled');
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const providers = await remote.load({
        modelUrl: new URL(modelUrl, globalThis.document?.baseURI).href,
        wasmPaths: runtime.wasmPaths,
        ortUrl: runtime.ortUrl,
        ...(runtime.numThreads === undefined ? {} : { numThreads: runtime.numThreads }),
      });
      return remote.runner(providers);
    } catch (workerErr) {
      remote.close('the model did not load in the inference worker');
      // Cancelled: the caller has moved on, and the page's thread is not asked either.
      if (signal?.aborted) throw aborted();
      // The worker could not load it. The page's thread is asked the same question, and its
      // answer decides whose fault that was — a failure there propagates as the model's.
      const runner = await this.onPage(modelUrl, runtime);
      this.broken = true;
      console.warn(
        '[cubus] the inference worker could not load the model and the page could, so the model runs on the page from now on — releasing it will not return its memory',
        workerErr,
      );
      return runner;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }

  private spawn(): Worker | null {
    try {
      // A same-origin URL beside this bundle, resolved at runtime rather than bundled: the app loads
      // `vendor/ai-scan-panel.js`, so `vendor/inference-worker.js` is the sibling this names.
      return new Worker(new URL('./inference-worker.js', import.meta.url), { type: 'module' });
    } catch (cause) {
      console.warn(
        '[cubus] the inference worker could not be built, so the model runs on the page — releasing it will not return its memory',
        cause,
      );
      this.broken = true;
      return null;
    }
  }
}
