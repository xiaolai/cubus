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

import { FACES } from '../src/types.js';
import {
  handleMisreadRequest,
  type MisreadReply,
  type MisreadRequest,
} from './misread-protocol.js';

/**
 * A request copied down to its sticker arrays, taken the moment it is accepted.
 *
 * A caller hands its LIVE reading in — `ai-scan-panel` passes `this.faces` itself — and a request
 * does not always leave at once: it may sit as `queued` behind a running decode, and on a worker
 * failure it is run on this thread from whatever it holds by then. Hand-painting mutates those
 * arrays between the two moments (every stroke re-checks the cube), so the decode ran over a
 * reading the epoch it carries does not describe: the caller then accepts an answer about the
 * cube as it is NOW under the serial number of the cube as it WAS, which is the one confusion the
 * epoch exists to make impossible.
 *
 * `postMessage` already snapshots on the way to a worker (structured clone), which is exactly why
 * this was invisible: the copy happened, just later than the promise it backs.
 */
function snapshot(request: MisreadRequest): MisreadRequest {
  const faces = {} as MisreadRequest['faces'];
  for (const face of FACES) faces[face] = { colors: [...request.faces[face].colors] };
  return { epoch: request.epoch, faces, fixedRotation: request.fixedRotation };
}

/**
 * One worker's worth of misread decoding, owned by whoever constructs it.
 *
 * Per-owner rather than per-page, unlike the detector park: what a detector holds is a loaded
 * model (1-5 s and tens of megabytes), while this is a module that parses in about a millisecond
 * and is spawned only by a refusal, which most sessions never reach. The park would cost more
 * bookkeeping than it saves.
 */
/** One asked-for decode: what to send, and who to tell. */
interface Job {
  request: MisreadRequest;
  answer: (reply: MisreadReply) => void;
}

export class MisreadDecoder {
  private worker: Worker | null = null;
  /** Set once a worker has proved it cannot be had at all, so no later request builds another. */
  private broken = false;
  /** Whether the current worker has ever answered — the test that makes `broken` safe to set. */
  private spoke = false;
  /** The request the worker is actually decoding, or null when it is idle. See `request`. */
  private running: Job | null = null;
  /** The one request waiting for it to come free. A newer ask REPLACES this. See `request`. */
  private queued: Job | null = null;

  /**
   * Ask for `request`'s diagnosis.
   *
   * Returns the answer outright when this page has nowhere else to run it — in which case
   * `answer` is never called and the caller already has everything. Returns null when a worker
   * took the request, and `answer` runs AT MOST once, later, with the reply for this epoch.
   *
   * AT MOST, not exactly (corrected 2026-09-05, having been the stronger claim since this class
   * was written). Three things drop a callback, and all three are deliberate: a newer ask replaces
   * one that has not been posted yet (see below); `dispose()` gives the worker back and forgets
   * what it was holding; and a worker failure answers only the LATEST of the two it was carrying,
   * because the other is already about a cube that is gone. Every one of them means the answer
   * would have been discarded on arrival for its epoch anyway — so a caller must not treat this
   * callback as the thing that CLEARS a "checking…" marker on its own. `ai-scan-panel` does not:
   * every site that supersedes a reading bumps `diagnosisEpoch` and republishes.
   *
   * The request is SNAPSHOT here, not held by reference — see `snapshot`.
   */
  request(request: MisreadRequest, answer: (reply: MisreadReply) => void): MisreadReply | null {
    const worker = this.spawn();
    if (!worker) return handleMisreadRequest(request);
    // ONE LIVE QUESTION per decoder, AND ONE WAITING ONE — never a queue (2026-09-05).
    //
    // Clearing the pending CALLBACKS was only half of it: every request was still posted, so the
    // worker built a backlog and the answer that is actually wanted arrived behind every obsolete
    // decode ahead of it. A second request means the reading changed — that is the only reason
    // there is a second one — so an ask that has not been posted yet is simply replaced here, and
    // the file's own note that "the readings that take seconds are the ones nothing supersedes"
    // stops being an assumption and becomes something this method enforces. Hand-painting is where
    // it shows: once the sixth side exists EVERY stroke re-checks the cube, so a cube painted
    // sticker by sticker used to enqueue seven decodes before the one whose answer is shown.
    //
    // The worker still finishes what it STARTED. `decodeMisread` is one DFS under a node budget
    // with no yield point, so there is nothing to interrupt short of terminating the thread; its
    // answer is delivered and the caller drops it on the epoch it carries (`ai-scan-panel` checks
    // `diagnosisEpoch` before it publishes anything).
    this.queued = { request: snapshot(request), answer };
    this.dispatch();
    return null;
  }

  /** Give the worker back. A decoder is usable again afterwards; it simply spawns a new one. */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.spoke = false;
    this.running = null;
    this.queued = null;
  }

  /**
   * Post the waiting ask, if the worker is free to take it.
   *
   * Guarded on `running` rather than called only from the idle path, because `answer` may ask for
   * another decode re-entrantly — the panel republishes on a reply, and a host may correct a
   * sticker from that — and two posts in flight is exactly the backlog this class exists to avoid.
   */
  private dispatch(): void {
    if (this.running !== null || this.queued === null || this.worker === null) return;
    const next = this.queued;
    this.queued = null;
    this.running = next;
    this.worker.postMessage(next.request);
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
      // BOTH LISTENERS NAME THE WORKER THEY ARE ABOUT (2026-09-05). A terminated worker is not a
      // silenced one — `terminate()` stops the thread and does not retract an event already on its
      // way — so a `dispose()` or a `failed()` followed by a fresh spawn left the OLD worker's
      // listeners live and pointing at `this`. A late error from the dead one then terminated its
      // replacement and, because `spoke` had been reset with it, wrote the decoder off as
      // unbuildable: every refusal for the rest of the session decoded on the page's thread, which
      // is the three-second freeze this whole file exists to remove. A late message was the same
      // fault in the quieter direction, answering the current request from a worker that is gone.
      spawned.addEventListener('message', (ev: MessageEvent) => {
        if (this.worker !== spawned) return;
        this.spoke = true;
        this.deliver(ev.data as MisreadReply);
      });
      spawned.addEventListener('error', (ev: Event) => {
        if (this.worker !== spawned) return;
        this.failed(ev);
      });
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
    const waiting = this.running;
    // An epoch nothing is waiting for is dropped here rather than guessed at. It happens when a
    // dispose() cleared the decode that was running, and when a worker answers something nobody
    // asked for.
    if (!waiting || waiting.request.epoch !== reply.epoch) return;
    this.running = null;
    // The waiting ask goes out even if `answer` throws: a stalled queue would leave the notice it
    // was going to refine sitting on "working out how many" for the rest of the session, which is
    // the quiet failure this whole file is arranged around.
    try {
      waiting.answer(reply);
    } finally {
      this.dispatch();
    }
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
    // The request it was holding is answered here rather than abandoned. This blocks the page for
    // as long as the decode takes, which is the cost the worker existed to avoid — but the refusal
    // has already been painted, and a notice that never resolves is worse than a stall.
    //
    // The LATEST of the two, and only that one. A waiting ask exists precisely because the reading
    // changed, so the running one is already about a cube that is gone — answering both would
    // spend seconds of the page's thread on a diagnosis whose caller drops it on arrival for its
    // epoch. Dropping the superseded callback is the same rule `request` applies when it replaces
    // a waiting ask.
    const stranded = this.queued ?? this.running;
    this.running = null;
    this.queued = null;
    if (stranded) stranded.answer(handleMisreadRequest(stranded.request));
  }
}
