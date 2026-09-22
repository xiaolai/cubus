// What the inference worker is ASKED and what it ANSWERS (2026-09-22) — one shape, shared by the
// worker (`inference-worker.ts`) and the page's half (`inference-client.ts`), as the letterbox and
// misread workers share theirs.
//
// One worker holds ONE model: `load` once, then any number of `run`s. A different model is a
// different worker, and releasing a model is terminating its worker — which is the whole reason
// this exists: a WebAssembly memory never shrinks and onnxruntime has no way to unload itself, so a
// runtime that lives on the page holds its heap, its compiled code and its thread pool until the
// page goes. In a worker of the page's own, the page can give all of it back.

/** Load the model. URLs are ABSOLUTE: a worker resolves a relative one against its own script. */
export interface LoadRequest {
  kind: 'load';
  modelUrl: string;
  wasmPaths: string;
  ortUrl: string;
  /** Left to the worker's own `defaultThreadCount()` when absent, which reads what the page would. */
  numThreads?: number;
  /** The page's visibility when it asked, so a timing taken before the first change is judged. */
  hidden: boolean;
}

/** Run one letterboxed frame. The input's buffer is transferred, not copied. */
export interface RunRequest {
  kind: 'run';
  id: number;
  input: Float32Array;
  imgsz: number;
}

/** The page became hidden or visible — what the GPU timing probe needs to hear, forwarded. */
export interface VisibilityRequest {
  kind: 'visibility';
  hidden: boolean;
}

export type InferenceRequest = LoadRequest | RunRequest | VisibilityRequest;

/** The model is loaded, on these providers (by name — see `ModelRunner.providers`). */
export interface LoadedReply {
  kind: 'loaded';
  providers: string[];
}

/** The model did not load. The worker is spent; the client terminates it. */
export interface LoadFailedReply {
  kind: 'load-failed';
  error: string;
}

/** One frame's output, validated by the runner in the worker; `data` is transferred back. */
export interface RanReply {
  kind: 'ran';
  id: number;
  data: Float32Array;
  anchors: number;
  rows: number;
}

/** One frame failed. `name` is the error's own, so a caller can tell a class of failure apart. */
export interface RunFailedReply {
  kind: 'run-failed';
  id: number;
  error: string;
  name: string;
}

export type InferenceReply = LoadedReply | LoadFailedReply | RanReply | RunFailedReply;

/**
 * `data`, in a buffer that is its alone and not shared — the only kind that can be TRANSFERRED.
 *
 * A view over part of a larger buffer would detach the rest of it on transfer, and a view over a
 * SharedArrayBuffer (a threaded wasm heap is one) cannot be transferred at all: posted, it would be
 * shared, and the reader would see memory the runtime goes on writing. Either is copied into a
 * buffer of its own first. The common case — a tensor onnxruntime has already copied out of its
 * heap — goes through untouched.
 */
export function transferable(data: Float32Array): Float32Array {
  const owned =
    data.buffer instanceof ArrayBuffer &&
    data.byteOffset === 0 &&
    data.byteLength === data.buffer.byteLength;
  return owned ? data : new Float32Array(data);
}
