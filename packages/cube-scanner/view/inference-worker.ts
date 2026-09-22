// The detector's model, in a worker the page owns (2026-09-22).
//
// onnxruntime used to live on the page: its module, its wasm heap and its thread pool in the page's
// own realm on the GPU path, and in a worker onnxruntime spawned for itself on the wasm path. Either
// way nothing could give it back — a WebAssembly memory never shrinks, onnxruntime has no way to
// unload itself, and its proxy worker is its own, unreachable from here. Measured in Chromium on a
// laptop with the shipped model, the scan screen left with its model parked: releasing the session
// returned ~30 MB of the ~210 MB the wasm path had added across the browser's processes, and ~180 MB
// of the ~390 MB the GPU path had, and the rest stayed until the page went. Hosted HERE, it goes
// with this worker: the same release returns 330–350 MB on either path, and the page's own process
// comes back to within 3 MB of its size before the scan. (A bare load-and-terminate of this worker
// measured the same in WebKit: +303 MB loaded, 243 MB returned.)
//
// Deliberately thin. Everything the runner knows — providers, the GPU probe, the fallback to wasm,
// validating the output — is `createModelRunner`, unchanged, told only that it is off the page's
// thread (`offPageThread`) and how to hear whether the page is watching (`visibility`). This file is
// the wire: one model per worker, loaded once, run on request, and answered by transfer.

import type {
  InferenceReply,
  InferenceRequest,
  LoadRequest,
  RunRequest,
} from './inference-protocol.js';
import { transferable } from './inference-protocol.js';
import {
  createModelRunner,
  type ModelRunner,
  type ModelRunnerOptions,
  type VisibilitySource,
} from './onnx-runtime.js';

/** A message, from anything that was thrown. */
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A name, from anything that was thrown — `Error` for what is not an error at all. */
const nameOf = (err: unknown): string => (err instanceof Error ? err.name : 'Error');

/** The worker's global scope, as far as this file uses it — a seam the tests fill with a fake. */
export interface InferenceScope {
  addEventListener(type: 'message', fn: (ev: MessageEvent<InferenceRequest>) => void): void;
  postMessage(message: InferenceReply, options?: { transfer?: Transferable[] }): void;
}

/**
 * Answer the page on `scope`: one model, then its runs.
 *
 * `create` is `createModelRunner` in the shipped worker and a stand-in in the tests, which is the
 * only reason it is a parameter.
 */
export function serveInference(
  scope: InferenceScope,
  create: (modelUrl: string, opts: ModelRunnerOptions) => Promise<ModelRunner> = createModelRunner,
): void {
  let runner: ModelRunner | null = null;
  let loading = false;
  // The page's visibility, as the page last reported it. The worker has no document of its own, so
  // without this the GPU timing probe would judge every sample as watched — including one taken
  // while the tab was in the background, which is the sample `bestTimedRun` exists to decline.
  let hidden = false;
  const watchers = new Set<() => void>();
  const visibility: VisibilitySource = {
    hidden: () => hidden,
    watch(onChange) {
      watchers.add(onChange);
      return () => {
        watchers.delete(onChange);
      };
    },
  };

  async function load(req: LoadRequest): Promise<void> {
    // ONE MODEL PER WORKER. The client never asks twice — a different model is a different worker,
    // and that is what makes releasing one a `terminate()` — so a second load is refused rather
    // than quietly replacing, or quietly doubling, the session this worker holds.
    if (runner || loading) {
      scope.postMessage({
        kind: 'load-failed',
        error: 'inference worker: a model is already loaded here, and one worker holds one model',
      });
      return;
    }
    loading = true;
    hidden = req.hidden;
    try {
      runner = await create(req.modelUrl, {
        wasmPaths: req.wasmPaths,
        ortUrl: req.ortUrl,
        ...(req.numThreads === undefined ? {} : { numThreads: req.numThreads }),
        offPageThread: true,
        visibility,
      });
      scope.postMessage({
        kind: 'loaded',
        providers: runner.providers.map((p) => (typeof p === 'string' ? p : p.name)),
      });
    } catch (err) {
      scope.postMessage({ kind: 'load-failed', error: messageOf(err) });
    } finally {
      loading = false;
    }
  }

  async function run(req: RunRequest): Promise<void> {
    const current = runner;
    if (!current) {
      scope.postMessage({
        kind: 'run-failed',
        id: req.id,
        error: 'inference worker: no model is loaded here',
        name: 'Error',
      });
      return;
    }
    let reply: InferenceReply;
    try {
      const out = await current(req.input, req.imgsz);
      reply = {
        kind: 'ran',
        id: req.id,
        data: transferable(out.data),
        anchors: out.anchors,
        rows: out.rows,
      };
    } catch (err) {
      scope.postMessage({
        kind: 'run-failed',
        id: req.id,
        error: messageOf(err),
        name: nameOf(err),
      });
      return;
    }
    try {
      // Transferred, not copied: the output is ~336 KB a frame at five frames a second.
      scope.postMessage(reply, { transfer: [reply.data.buffer] });
    } catch (err) {
      // A reply that will not go is this frame's failure, said under its id — never a silence the
      // page's run would wait on until the panel's own deadline.
      scope.postMessage({
        kind: 'run-failed',
        id: req.id,
        error: messageOf(err),
        name: nameOf(err),
      });
    }
  }

  scope.addEventListener('message', (ev) => {
    const req = ev.data;
    if (req.kind === 'visibility') {
      hidden = req.hidden;
      for (const onChange of [...watchers]) onChange();
    } else if (req.kind === 'load') {
      void load(req);
    } else if (req.kind === 'run') {
      void run(req);
    }
  });
}

serveInference(self as unknown as InferenceScope);
