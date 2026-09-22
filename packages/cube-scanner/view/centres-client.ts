// The centre resolution, asked for from the page's thread and answered from another one.
//
// WHY (D3, `dev-docs/scan-pipeline-audit-2026-09-23.md` §3). `resolveCentres` enumerates every way
// the unnamed sides could fill the free slots and runs a whole assembly per filing. Measured on the
// dev Mac by the audit's own `dev-docs/scan-pipeline-audit-2026-09-23/verify.ts`: 26 ms, 54 ms, 148 ms and 509 ms for one to four unnamed
// sides, before any phone slowdown. All of it ran on the page's thread, at the moment after the
// sixth capture when a child is waiting to be told the cube is done — so the screen froze for up to
// half a second on exactly the cubes (logo centres) this resolver exists for.
//
// This is `misread-client.ts`'s shape, deliberately: the same worker lifecycle, the same
// per-worker listener guard, the same synchronous fallback, the same epoch rule. Two clients of the
// same shape are easier to keep right than one clever abstraction over both, and every comment
// there was paid for by a defect.
//
// THE FALLBACK IS SYNCHRONOUS ON PURPOSE, and `request()` says so in its return type. A page with
// no `Worker` — a DOM test, a webview that forbids one — gets the whole resolution in the call it
// asked for it in, which is exactly the behaviour that shipped before this file existed.

import type { ColorFace } from '../src/ai-assemble.js';
import { FACES, type Face } from '../src/types.js';
import {
  type CentresReply,
  type CentresRequest,
  handleCentresRequest,
} from './centres-protocol.js';

/**
 * A copy of what was asked, taken at the moment of asking.
 *
 * The panel mutates its captures in place — a correction, a re-shown side, a filing adopted — and a
 * request held by reference would be resolved against a cube that has changed under it. That is not
 * a stale ANSWER, which the epoch catches; it is a wrong question, which nothing catches.
 */
function snapshot(request: CentresRequest): CentresRequest {
  const copyFace = (f: ColorFace): ColorFace => ({
    ...f,
    colors: [...f.colors],
    confidence: [...f.confidence],
    ...(f.scores ? { scores: f.scores.map((row) => [...row]) } : {}),
    ...(f.lab ? { lab: f.lab.map((row) => [...row] as [number, number, number]) } : {}),
    ...(f.locked ? { locked: [...f.locked] } : {}),
  });
  const named: Partial<Record<Face, ColorFace>> = {};
  for (const face of FACES) {
    const side = request.named[face];
    if (side) named[face] = copyFace(side);
  }
  return {
    epoch: request.epoch,
    named,
    unnamed: request.unnamed.map((u) => ({ ...u, capture: copyFace(u.capture) })),
    ...(request.budget === undefined ? {} : { budget: request.budget }),
  };
}

/** One asked-for resolution: what to send, and who to tell. */
interface Job {
  request: CentresRequest;
  answer: (reply: CentresReply) => void;
}

/** One worker's worth of centre resolution, owned by whoever constructs it. */
export class CentreResolver {
  private worker: Worker | null = null;
  /** Set once a worker has proved it cannot be had at all, so no later request builds another. */
  private broken = false;
  /** Whether the current worker has ever answered — the test that makes `broken` safe to set. */
  private spoke = false;
  /** The request the worker is actually resolving, or null when it is idle. */
  private running: Job | null = null;
  /** The one request waiting for it to come free. A newer ask REPLACES this. */
  private queued: Job | null = null;

  /**
   * Ask for `request`'s resolution.
   *
   * Returns the answer outright when this page has nowhere else to run it — in which case `answer`
   * is never called and the caller already has everything. Returns null when a worker took the
   * request, and `answer` runs AT MOST once, later, with the reply for this epoch.
   *
   * AT MOST, for `misread-client.ts`'s three reasons, and every one of them means the answer would
   * have been discarded on arrival for its epoch anyway. So a caller must not treat this callback
   * as the thing that clears a "checking…" marker on its own.
   */
  request(request: CentresRequest, answer: (reply: CentresReply) => void): CentresReply | null {
    const worker = this.spawn();
    if (!worker) return handleCentresRequest(request);
    // ONE LIVE QUESTION per resolver, AND ONE WAITING ONE — never a queue. A second request means
    // the scan changed, which is the only reason there is a second one, so an ask that has not been
    // posted yet is simply replaced.
    this.queued = { request: snapshot(request), answer };
    this.dispatch();
    return null;
  }

  /** Give the worker back. A resolver is usable again afterwards; it simply spawns a new one. */
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
   * another resolution re-entrantly — the panel republishes on a reply, and a host may correct a
   * sticker from that — and two posts in flight is exactly the backlog this avoids.
   */
  private dispatch(): void {
    if (this.running !== null || this.queued === null || this.worker === null) return;
    const next = this.queued;
    this.queued = null;
    this.running = next;
    try {
      this.worker.postMessage(next.request);
    } catch (cause) {
      // A POST THAT THROWS IS A WORKER THAT CANNOT BE USED, not a request to forget. `postMessage`
      // raises on a payload the structured clone algorithm will not carry; left here, `running`
      // would stay occupied for ever and every later resolution would queue behind a question
      // nobody is holding — a scan stuck at six sides with nothing said. `failed` gives the worker
      // back and answers the stranded request on this thread, which is what it exists for.
      this.failed(cause);
    }
  }

  private spawn(): Worker | null {
    if (this.worker) return this.worker;
    if (this.broken || typeof Worker === 'undefined') return null;
    try {
      // A same-origin URL beside this bundle, resolved at runtime rather than bundled: the app
      // loads `vendor/ai-scan-panel.js`, so `vendor/centres-worker.js` is the sibling this names.
      const spawned = new Worker(new URL('./centres-worker.js', import.meta.url), {
        type: 'module',
      });
      // BOTH LISTENERS NAME THE WORKER THEY ARE ABOUT. A terminated worker is not a silenced one —
      // `terminate()` stops the thread and does not retract an event already on its way — so a
      // `dispose()` or a `failed()` followed by a fresh spawn would otherwise leave the OLD
      // worker's listeners live and pointing at `this` (`misread-client.ts` records what that cost).
      spawned.addEventListener('message', (ev: MessageEvent) => {
        if (this.worker !== spawned) return;
        this.spoke = true;
        this.deliver(ev.data as CentresReply);
      });
      spawned.addEventListener('error', (ev: Event) => {
        if (this.worker !== spawned) return;
        this.failed(ev);
      });
      // A REPLY THAT CANNOT BE READ IS A FAILURE, NOT A SILENCE. `messageerror` fires when the
      // structured clone of an incoming message cannot be deserialised; without this listener the
      // resolver would sit on a request whose answer can never arrive, and the scan would stand at
      // six sides for ever. Routed to the same handler as `error`, so the stranded request is
      // answered on this thread exactly as it is for a worker that died.
      spawned.addEventListener('messageerror', (ev: Event) => {
        if (this.worker !== spawned) return;
        this.failed(ev);
      });
      this.worker = spawned;
      return spawned;
    } catch (cause) {
      console.warn(
        'centres-client: the resolver worker could not be built, so it runs on this thread',
        cause,
      );
      this.broken = true;
      return null;
    }
  }

  private deliver(reply: CentresReply): void {
    const waiting = this.running;
    // An epoch nothing is waiting for is dropped here rather than guessed at — and `running` is
    // deliberately LEFT standing. The worker echoes the epoch it was posted, so a mismatch is an
    // unsolicited message and the real answer is still coming; clearing the slot here would make
    // the resolver drop that answer when it arrives, turning a stray message into the stall this
    // guard is supposed to prevent.
    if (!waiting || waiting.request.epoch !== reply.epoch) return;
    this.running = null;
    try {
      waiting.answer(reply);
    } finally {
      this.dispatch();
    }
  }

  private failed(cause: unknown): void {
    // A worker that never spoke cannot load at all: writing it off is what stops every later
    // resolution building another thread exactly as doomed. One that HAD answered may simply have
    // died, and a session should not lose the thread over it.
    if (!this.spoke) this.broken = true;
    console.warn(
      'centres-client: the resolver worker failed, so the sides are placed on this thread',
      cause,
    );
    this.worker?.terminate();
    this.worker = null;
    this.spoke = false;
    // The request it was holding is answered here rather than abandoned. This blocks the page for
    // as long as the resolution takes, which is the cost the worker existed to avoid — but a scan
    // that never resolves is worse than a stall, and the alternative is six captured sides and no
    // verdict at all.
    const stranded = this.queued ?? this.running;
    this.running = null;
    this.queued = null;
    if (stranded) stranded.answer(handleCentresRequest(stranded.request));
  }
}
