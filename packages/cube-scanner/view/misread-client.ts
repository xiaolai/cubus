// The misread decode, asked for from the page's thread and answered from another one.
//
// `decodeMisread` is the only part of a refusal that is not fast: 52-125 ms at distance 3 on an
// easy scramble, 612-682 ms at distance 4, 2.7 s for a distance-3 answer on a 20-move scramble,
// and 2.1-3.0 s when its 20M-node backstop is exhausted — seconds spent to claim nothing
// (measured 2026-09-05). All of it ran on the page's thread, between the sixth capture and the
// frame that explains the refusal, so the worst inputs froze the scan screen for three seconds.
//
// So the refusal is published first with `misreadCount: null` ("checking") and the count arrives
// later. This module owns the "later": one worker per decoder, spawned on the first refusal that
// needs it, and a synchronous answer where there is no worker to be had.
//
// THE FALLBACK IS SYNCHRONOUS ON PURPOSE, and `request()` says so in its return type. A page with
// no `Worker` — a DOM test, a webview that forbids one — still gets the whole diagnosis in the
// call it asked for it in, which is exactly the behaviour that shipped before this file existed.
// Answering it a microtask later instead would be a second code path for every host to handle,
// for no gain on the only platform that takes it.
//
// The three ways to have no worker are `apps/web/lib/solve-client.js`'s, and they are the same
// three here, so the handling mirrors it: `Worker` absent from the platform; `Worker` present and
// refusing to build this script synchronously (a CSP that forbids worker-src, a blocked URL); and
// a worker that builds and then fails to LOAD, which arrives later as an `error` event. The third
// is the one that bites: the constructor has already handed back an object, so neither of the
// first two guards sees it. Here it must do more than be remembered — a request already in flight
// would otherwise never be answered and the notice would sit on "working out how many stickers
// are wrong" forever, which is the quiet failure this project likes least. So the pending
// requests are answered on this thread, loudly, and only a worker that never SPOKE is written off
// (one that answered before and then died is not a reason to block the page for the rest of the
// session).

import {
  type MisreadReply,
  type MisreadRequest,
  handleMisreadRequest,
} from './misread-protocol.js';

/**
 * One worker's worth of misread decoding, owned by whoever constructs it.
 *
 * Per-owner rather than per-page, unlike the detector park: what a detector holds is a loaded
 * model (1-5 s and tens of megabytes), while this is a module that parses in about a millisecond
 * and is spawned only by a refusal, which most sessions never reach. The park would cost more
 * bookkeeping than it saves.
 */
export class MisreadDecoder {
  private worker: Worker | null = null;
  /** Set once a worker has proved it cannot be had at all, so no later request builds another. */
  private broken = false;
  /** Whether the current worker has ever answered — the test that makes `broken` safe to set. */
  private spoke = false;
  /** The request this decoder is still waiting on — at most one; see `request`. */
  private pending = new Map<
    number,
    { request: MisreadRequest; answer: (r: MisreadReply) => void }
  >();

  /**
   * Ask for `request`'s diagnosis.
   *
   * Returns the answer outright when this page has nowhere else to run it — in which case
   * `answer` is never called and the caller already has everything. Returns null when a worker
   * took the request, and `answer` runs exactly once, later, with the reply for this epoch.
   */
  request(request: MisreadRequest, answer: (reply: MisreadReply) => void): MisreadReply | null {
    const worker = this.spawn();
    if (!worker) return handleMisreadRequest(request);
    // ONE LIVE QUESTION per decoder. A second request means the reading changed — that is the only
    // reason there is a second one — so every earlier answer is already about a cube that is gone.
    // Holding those callbacks would queue answers nobody reads, and would make a worker failure
    // below replay every one of them on this thread, one after another. Hand-painting is where it
    // shows: once the sixth side exists, EVERY stroke re-checks the cube, so a cube painted
    // sticker by sticker asks seven questions before the one whose answer is shown.
    //
    // The worker still finishes what it started. `decodeMisread` is one DFS under a node budget
    // with no yield point, so there is nothing to interrupt short of terminating the thread — and
    // its answer is dropped on arrival instead, by `deliver`. The wait that costs is bounded by
    // which readings are actually slow: a half-painted cube is nowhere near legal, every rotation
    // fails the lower-bound prune, and it comes back in microseconds. It is the nearly-legal
    // readings that take seconds, and those are the ones nothing supersedes.
    this.pending.clear();
    this.pending.set(request.epoch, { request, answer });
    worker.postMessage(request);
    return null;
  }

  /** Give the worker back. A decoder is usable again afterwards; it simply spawns a new one. */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.spoke = false;
    this.pending.clear();
  }

  private spawn(): Worker | null {
    if (this.worker) return this.worker;
    if (this.broken || typeof Worker === 'undefined') return null;
    try {
      // A same-origin URL beside this bundle, resolved at runtime rather than bundled: the app
      // loads `vendor/ai-scan-panel.js`, so `vendor/misread-worker.js` is the sibling this names.
      const spawned = new Worker(new URL('./misread-worker.js', import.meta.url), {
        type: 'module',
      });
      spawned.addEventListener('message', (ev: MessageEvent) => {
        this.spoke = true;
        this.deliver(ev.data as MisreadReply);
      });
      spawned.addEventListener('error', (ev: Event) => this.failed(ev));
      this.worker = spawned;
      return spawned;
    } catch (cause) {
      console.warn(
        'misread-client: the decoder worker could not be built, so it runs on this thread',
        cause,
      );
      this.broken = true;
      return null;
    }
  }

  private deliver(reply: MisreadReply): void {
    const waiting = this.pending.get(reply.epoch);
    // An epoch nothing is waiting for is dropped here rather than guessed at. It happens when a
    // dispose() cleared the queue while a decode was still running.
    if (!waiting) return;
    this.pending.delete(reply.epoch);
    waiting.answer(reply);
  }

  private failed(cause: Event): void {
    // A worker that never spoke cannot load at all: writing it off is what stops every later
    // refusal building another thread exactly as doomed. One that HAD answered may simply have
    // died, and a session should not lose the thread over it.
    if (!this.spoke) this.broken = true;
    console.warn(
      'misread-client: the decoder worker failed, so the reading is checked on this thread',
      cause,
    );
    this.worker?.terminate();
    this.worker = null;
    this.spoke = false;
    // The requests it was holding are answered here rather than abandoned. This blocks the page
    // for as long as the decode takes, which is the cost the worker existed to avoid — but the
    // refusal has already been painted, and a notice that never resolves is worse than a stall.
    const stranded = [...this.pending.values()];
    this.pending.clear();
    for (const { request, answer } of stranded) answer(handleMisreadRequest(request));
  }
}
