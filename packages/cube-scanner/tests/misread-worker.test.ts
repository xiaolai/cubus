// The misread decode's two halves: the wire (`misread-protocol.ts`) and the thread it crosses
// (`misread-client.ts`).
//
// What is actually at risk here is not the decode — `misread-decode.test.ts` owns that — but the
// three ways a page can fail to have a worker, and the one way an answer can arrive about a cube
// that is no longer on screen. Both are silent when they go wrong: a stranded request leaves the
// panel pinned on "working out how many stickers are wrong" forever, and a stale answer states a
// count about a reading the user has already corrected. So the assertions here are mostly about
// what must NOT happen.

import Cube from 'cubejs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assembleColors, type ColorFace } from '../src/ai-assemble.js';
import { rotateFace } from '../src/facelet-cube.js';
import { FACES, type Face } from '../src/types.js';
import { MisreadDecoder } from '../view/misread-client.js';
import {
  handleMisreadRequest,
  type MisreadReply,
  type MisreadRequest,
} from '../view/misread-protocol.js';

const LETTER_CLASS: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
const DEEP = new Cube().move("R U F2 D' L B R2 F D U2 L2 B'").asString();

/** A facelet string -> the six faces as the detector reports them. */
function faces(facelets: string): Record<Face, ColorFace> {
  const out = {} as Record<Face, ColorFace>;
  FACES.forEach((face, fi) => {
    const colors: number[] = [];
    for (let k = 0; k < 9; k++) colors.push(LETTER_CLASS[facelets[fi * 9 + k] as Face]!);
    out[face] = { colors, confidence: Array(9).fill(1) };
  });
  return out;
}

/** `facelets` with `n` non-centre stickers turned a colour they are not. */
function misread(facelets: string, n: number): Record<Face, ColorFace> {
  const f = faces(facelets);
  let done = 0;
  for (const face of FACES) {
    for (let i = 0; i < 9 && done < n; i++) {
      if (i === 4) continue;
      f[face]!.colors[i] = (f[face]!.colors[i]! + 1) % 6;
      done++;
    }
    if (done === n) break;
  }
  return f;
}

/**
 * A `Worker` that never leaves this thread — and answers with the SAME handler the real worker
 * runs, so a test that drives it is testing the shipped decode and not a stand-in for it.
 */
class FakeWorker {
  static built: FakeWorker[] = [];
  static refuse: Error | null = null;
  static last(): FakeWorker {
    const w = FakeWorker.built[FakeWorker.built.length - 1];
    if (!w) throw new Error('no worker was built');
    return w;
  }
  posted: MisreadRequest[] = [];
  terminated = false;
  private listeners = new Map<string, ((ev: unknown) => void)[]>();
  constructor(readonly url: URL) {
    if (FakeWorker.refuse) throw FakeWorker.refuse;
    FakeWorker.built.push(this);
  }
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  postMessage(message: MisreadRequest): void {
    // Through the wire, exactly as postMessage does it: anything the structured clone algorithm
    // cannot carry fails HERE rather than in a browser nobody is watching.
    this.posted.push(structuredClone(message));
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Reply to a posted request the way the worker entry does. */
  answer(index = 0): void {
    const request = this.posted[index];
    if (!request) throw new Error(`nothing posted at ${index}`);
    this.send(structuredClone(handleMisreadRequest(request)));
  }
  /** Reply with something the client is not waiting for. */
  send(reply: MisreadReply): void {
    for (const fn of this.listeners.get('message') ?? []) fn({ data: reply });
  }
  /** The asynchronous failure: the worker was built and then could not load. */
  fail(): void {
    for (const fn of this.listeners.get('error') ?? []) fn(new Event('error'));
  }
}

function withWorker(): void {
  FakeWorker.built = [];
  FakeWorker.refuse = null;
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
}

afterEach(() => {
  (globalThis as { Worker?: unknown }).Worker = undefined;
  FakeWorker.built = [];
  FakeWorker.refuse = null;
  vi.restoreAllMocks();
});

describe('MisreadDecoder — where the decode runs', () => {
  it('answers on this thread, in the same call, when the page has no Worker', () => {
    // The fallback is SYNCHRONOUS on purpose: a page without a worker gets the whole diagnosis in
    // the call it asked for it in, which is exactly what shipped before the decode moved off the
    // main thread. A microtask-later answer would be a second code path for every host to handle.
    expect(typeof (globalThis as { Worker?: unknown }).Worker).toBe('undefined');
    const later = vi.fn();
    const reply = new MisreadDecoder().request(
      { epoch: 7, faces: misread(DEEP, 1), fixedRotation: false },
      later,
    );
    expect(reply?.epoch).toBe(7);
    expect(reply?.diagnosis.misreadCount).toBe(1);
    expect(later).not.toHaveBeenCalled();
  });

  it('hands the decode to a worker when there is one, and answers nothing on this thread', () => {
    withWorker();
    const answers: MisreadReply[] = [];
    const decoder = new MisreadDecoder();
    const now = decoder.request({ epoch: 3, faces: misread(DEEP, 2), fixedRotation: false }, (r) =>
      answers.push(r),
    );
    // Null is the whole point: nothing was decoded here, so the caller has nothing yet.
    expect(now).toBeNull();
    expect(answers).toEqual([]);
    const worker = FakeWorker.last();
    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0]?.epoch).toBe(3);
    // A module worker at a same-origin URL beside the panel bundle.
    expect(worker.url.href).toMatch(/misread-worker\.js$/);
    worker.answer();
    expect(answers).toHaveLength(1);
    expect(answers[0]?.epoch).toBe(3);
    expect(answers[0]?.diagnosis.misreadCount).toBeGreaterThanOrEqual(1);
  });

  it('re-uses its worker across requests instead of spawning one per refusal', () => {
    withWorker();
    const decoder = new MisreadDecoder();
    decoder.request({ epoch: 1, faces: misread(DEEP, 1), fixedRotation: false }, () => {});
    // ANSWERED before the second is asked, since 2026-09-05: only one decode is posted at a time
    // (see the supersession case below), so back-to-back requests would no longer show reuse —
    // the second would still be waiting. Reuse is the claim here, and it is about the WORKER.
    FakeWorker.last().answer();
    decoder.request({ epoch: 2, faces: misread(DEEP, 1), fixedRotation: false }, () => {});
    expect(FakeWorker.built).toHaveLength(1);
    expect(FakeWorker.last().posted.map((p) => p.epoch)).toEqual([1, 2]);
  });

  it('keeps one decode running and one waiting — never a queue of obsolete work', () => {
    // THE BACKLOG. Clearing the pending callbacks was only half of a supersession: every request
    // was still POSTED, so the worker built a queue and the answer that is actually wanted arrived
    // behind every obsolete decode ahead of it. On a nearly-legal reading each of those is
    // seconds — the readings this file's own note says are "the ones nothing supersedes", which
    // was an assumption rather than something the code enforced.
    //
    // Hand-painting is the case that reaches it: with the sixth side in, every stroke re-checks
    // the cube, so five quick corrections used to enqueue five decodes.
    withWorker();
    const answers: MisreadReply[] = [];
    const decoder = new MisreadDecoder();
    for (const epoch of [1, 2, 3, 4, 5]) {
      decoder.request({ epoch, faces: misread(DEEP, 1), fixedRotation: false }, (r) =>
        answers.push(r),
      );
    }
    const worker = FakeWorker.last();
    // One in flight; the other four collapsed into the one that is still worth asking.
    expect(worker.posted.map((p) => p.epoch)).toEqual([1]);

    worker.answer(0);
    // …and the LATEST goes out next, not the second-oldest.
    expect(worker.posted.map((p) => p.epoch)).toEqual([1, 5]);
    worker.answer(1);
    // Every superseded callback is dropped rather than queued: nobody is waiting on epoch 2-4.
    expect(answers.map((a) => a.epoch)).toEqual([1, 5]);
    // Nothing is left holding the worker, so the next refusal is answered rather than stranded.
    decoder.request({ epoch: 6, faces: misread(DEEP, 1), fixedRotation: false }, (r) =>
      answers.push(r),
    );
    expect(worker.posted.map((p) => p.epoch)).toEqual([1, 5, 6]);
  });

  it('drops a reply nothing is waiting for rather than guessing whose it is', () => {
    withWorker();
    const answers: MisreadReply[] = [];
    const decoder = new MisreadDecoder();
    decoder.request({ epoch: 5, faces: misread(DEEP, 1), fixedRotation: false }, (r) =>
      answers.push(r),
    );
    FakeWorker.last().send({ epoch: 99, diagnosis: { misreadCount: 4 } });
    expect(answers).toEqual([]);
    FakeWorker.last().answer();
    expect(answers.map((a) => a.epoch)).toEqual([5]);
  });

  it('runs the decode here when the Worker constructor refuses to build the script', () => {
    // A CSP that forbids worker-src, a blocked URL: the constructor throws synchronously, and the
    // only wrong answer is to let that reach the caller — solving lost its worker this way once
    // and took the Random die with it (apps/web/lib/solve-client.js).
    withWorker();
    FakeWorker.refuse = new Error('worker-src blocked');
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const decoder = new MisreadDecoder();
    const first = decoder.request(
      { epoch: 1, faces: misread(DEEP, 1), fixedRotation: false },
      () => {},
    );
    expect(first?.diagnosis.misreadCount).toBe(1);
    expect(warned).toHaveBeenCalled();
    // And it is remembered: a second refusal must not build another doomed thread.
    FakeWorker.refuse = null;
    const second = decoder.request(
      { epoch: 2, faces: misread(DEEP, 1), fixedRotation: false },
      () => {},
    );
    expect(second?.diagnosis.misreadCount).toBe(1);
    expect(FakeWorker.built).toHaveLength(0);
  });

  it('answers a stranded request here when the worker fails to load', () => {
    // THE FAILURE THAT IS ONLY VISIBLE IF SOMEONE LOOKS FOR IT. A 404 or a syntax error arrives
    // as an `error` event long after the constructor returned, so the request already in flight
    // would simply never be answered — and the panel would sit on "working out how many stickers
    // are wrong" for the rest of the session, which reads as the app hanging.
    withWorker();
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const answers: MisreadReply[] = [];
    const decoder = new MisreadDecoder();
    decoder.request({ epoch: 8, faces: misread(DEEP, 1), fixedRotation: false }, (r) =>
      answers.push(r),
    );
    const worker = FakeWorker.last();
    worker.fail();
    expect(answers).toHaveLength(1);
    expect(answers[0]?.epoch).toBe(8);
    expect(answers[0]?.diagnosis.misreadCount).toBe(1);
    expect(worker.terminated).toBe(true);
    expect(warned).toHaveBeenCalled();
    // A worker that never SPOKE cannot load at all, so no later refusal builds another.
    decoder.request({ epoch: 9, faces: misread(DEEP, 1), fixedRotation: false }, () => {});
    expect(FakeWorker.built).toHaveLength(1);
  });

  it('answers only the LATEST when a worker with both a running and a waiting ask fails', () => {
    // THE FAILURE PATH NOTHING COVERED. The stranded-request case above has ONE ask outstanding;
    // the branch that decides between two — `this.queued ?? this.running` — is the interesting
    // half and was never exercised. Answering both would spend seconds of the page's thread on a
    // diagnosis whose caller drops it on arrival for its epoch; answering the RUNNING one would
    // resolve the wrong reading, since a waiting ask exists precisely because the cube changed.
    withWorker();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const answers: MisreadReply[] = [];
    const decoder = new MisreadDecoder();
    decoder.request({ epoch: 1, faces: misread(DEEP, 1), fixedRotation: false }, (r) =>
      answers.push(r),
    );
    decoder.request({ epoch: 2, faces: misread(DEEP, 2), fixedRotation: false }, (r) =>
      answers.push(r),
    );
    const worker = FakeWorker.last();
    expect(worker.posted.map((p) => p.epoch)).toEqual([1]); // 1 running, 2 waiting

    worker.fail();

    // Exactly one answer, and it is the reading that is still on screen.
    expect(answers.map((a) => a.epoch)).toEqual([2]);
    expect(answers[0]?.diagnosis.misreadCount).toBe(2);
    // Nothing is left pending, so a later ask is taken rather than being blocked behind a ghost.
    const next = decoder.request({ epoch: 3, faces: misread(DEEP, 1), fixedRotation: false }, (r) =>
      answers.push(r),
    );
    // The worker never spoke, so it was written off and this one runs here — synchronously.
    expect(next?.diagnosis.misreadCount).toBe(1);
    expect(answers.map((a) => a.epoch)).toEqual([2]);
  });

  it('decodes the reading as it was ASKED about, not as it is by the time it runs', () => {
    // A caller hands its live reading in — the panel passes `this.faces` itself — and a queued ask
    // does not leave at once. Hand-painting mutates those arrays between the ask and the post, so
    // the decode ran over a cube the epoch it carries does not describe: an answer about the cube
    // as it is NOW, filed under the serial number of the cube as it WAS. `postMessage` snapshots
    // on the way to a worker, which is exactly why only the queued and stranded paths showed it.
    withWorker();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const answers: MisreadReply[] = [];
    const decoder = new MisreadDecoder();
    decoder.request({ epoch: 1, faces: misread(DEEP, 1), fixedRotation: false }, (r) =>
      answers.push(r),
    );
    // Epoch 2 is asked about a TWO-sticker misread, and then the caller keeps painting on the very
    // object it handed over.
    const live = misread(DEEP, 2);
    decoder.request({ epoch: 2, faces: live, fixedRotation: false }, (r) => answers.push(r));
    for (const face of FACES) live[face]!.colors = misread(DEEP, 4)[face]!.colors;

    const worker = FakeWorker.last();
    worker.answer(0); // epoch 1 comes back, so epoch 2 is posted
    expect(worker.posted.map((p) => p.epoch)).toEqual([1, 2]);
    worker.answer(1);
    expect(answers.map((a) => a.epoch)).toEqual([1, 2]);
    // TWO, the reading epoch 2 was asked about — not four, which is what it became afterwards.
    expect(answers[1]?.diagnosis.misreadCount).toBe(2);
  });

  it('does not write off a worker that had been answering', () => {
    // The distinction that makes remembering safe: a thread that answered once and then died is
    // not a reason to move every future decode onto the page's thread for the whole session.
    withWorker();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const decoder = new MisreadDecoder();
    decoder.request({ epoch: 1, faces: misread(DEEP, 1), fixedRotation: false }, () => {});
    FakeWorker.last().answer();
    FakeWorker.last().fail();
    const after = decoder.request(
      { epoch: 2, faces: misread(DEEP, 1), fixedRotation: false },
      () => {},
    );
    expect(after).toBeNull(); // a new worker took it
    expect(FakeWorker.built).toHaveLength(2);
  });

  it('a dead worker’s error does not take down the one that replaced it', () => {
    // `terminate()` stops a thread; it does not retract an event already on its way. So the
    // listeners of a worker this decoder has finished with are still live and still pointing at
    // `this` — and a late `error` from the dead one ran the whole failure path against its
    // REPLACEMENT: terminated it, and (since `spoke` was reset with the worker) wrote the decoder
    // off as unbuildable, moving every refusal for the rest of the session back onto the page's
    // thread. That is the three-second freeze this file exists to remove, restored by an event
    // about a thread that no longer exists.
    withWorker();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const decoder = new MisreadDecoder();
    decoder.request({ epoch: 1, faces: misread(DEEP, 1), fixedRotation: false }, () => {});
    const dead = FakeWorker.last();
    decoder.dispose(); // the panel disconnected, and the decoder is reused on the next mount

    const answers: MisreadReply[] = [];
    expect(
      decoder.request({ epoch: 2, faces: misread(DEEP, 1), fixedRotation: false }, (r) =>
        answers.push(r),
      ),
    ).toBeNull();
    const live = FakeWorker.last();
    expect(FakeWorker.built).toHaveLength(2);

    dead.fail(); // …and only now does the old thread's 404 arrive

    expect(live.terminated).toBe(false);
    // The live worker still owns the question, and the decoder was not written off.
    live.answer();
    expect(answers.map((a) => a.epoch)).toEqual([2]);
    expect(
      decoder.request({ epoch: 3, faces: misread(DEEP, 1), fixedRotation: false }, () => {}),
    ).toBeNull();
  });

  it('takes a request made from INSIDE an answer, and keeps one decode in flight', () => {
    // The panel republishes on a reply and a host may correct a sticker from that, so `answer` can
    // ask for another decode re-entrantly. `dispatch` is guarded on `running` rather than being
    // called only from the idle path precisely for this: two posts in flight is the backlog the
    // one-running-one-waiting rule exists to prevent.
    withWorker();
    const answers: MisreadReply[] = [];
    const decoder = new MisreadDecoder();
    const again = (r: MisreadReply): void => {
      answers.push(r);
      if (r.epoch === 1) {
        decoder.request({ epoch: 2, faces: misread(DEEP, 2), fixedRotation: false }, again);
      }
    };
    decoder.request({ epoch: 1, faces: misread(DEEP, 1), fixedRotation: false }, again);
    const worker = FakeWorker.last();
    worker.answer(0);
    // The re-entrant ask went out — once — and nothing was built to carry it.
    expect(worker.posted.map((p) => p.epoch)).toEqual([1, 2]);
    expect(FakeWorker.built).toHaveLength(1);
    worker.answer(1);
    expect(answers.map((a) => a.epoch)).toEqual([1, 2]);
  });

  it('sends the waiting ask even when the answer before it threw', () => {
    // A host that throws in its callback must not cost the NEXT reading its answer: a stalled
    // queue leaves the notice it was going to refine sitting on "working out how many stickers are
    // wrong" for the rest of the session, which is the quiet failure this file is arranged around.
    withWorker();
    const answers: MisreadReply[] = [];
    const decoder = new MisreadDecoder();
    decoder.request({ epoch: 1, faces: misread(DEEP, 1), fixedRotation: false }, () => {
      throw new Error('the host blew up');
    });
    decoder.request({ epoch: 2, faces: misread(DEEP, 2), fixedRotation: false }, (r) =>
      answers.push(r),
    );
    const worker = FakeWorker.last();
    // The throw is not swallowed either — it belongs to whoever called back into the host.
    expect(() => worker.answer(0)).toThrow(/blew up/);
    expect(worker.posted.map((p) => p.epoch)).toEqual([1, 2]);
    worker.answer(1);
    expect(answers.map((a) => a.epoch)).toEqual([2]);
  });

  it('posts nothing more when the answer disposed the decoder', () => {
    // `disconnectedCallback` inside a reply — the scan screen left while a diagnosis landed. The
    // waiting ask is about a cube nobody is looking at, and the worker it would go to has been
    // terminated.
    withWorker();
    const decoder = new MisreadDecoder();
    decoder.request({ epoch: 1, faces: misread(DEEP, 1), fixedRotation: false }, () => {
      decoder.dispose();
    });
    decoder.request({ epoch: 2, faces: misread(DEEP, 2), fixedRotation: false }, () => {});
    const worker = FakeWorker.last();
    worker.answer(0);
    expect(worker.posted.map((p) => p.epoch)).toEqual([1]);
    expect(worker.terminated).toBe(true);
    expect(FakeWorker.built).toHaveLength(1);
  });

  it('dispose() gives the thread back and forgets what it was holding', () => {
    withWorker();
    const answers: MisreadReply[] = [];
    const decoder = new MisreadDecoder();
    decoder.request({ epoch: 1, faces: misread(DEEP, 1), fixedRotation: false }, (r) =>
      answers.push(r),
    );
    const worker = FakeWorker.last();
    decoder.dispose();
    expect(worker.terminated).toBe(true);
    // An answer that arrives after the owner has gone is dropped, not delivered into a torn-down
    // element. `disconnectedCallback` is exactly this moment.
    worker.answer();
    expect(answers).toEqual([]);
    // And the decoder still works: it simply spawns a new one.
    expect(
      decoder.request({ epoch: 2, faces: misread(DEEP, 1), fixedRotation: false }, () => {}),
    ).toBeNull();
    expect(FakeWorker.built).toHaveLength(2);
  });
});

describe('the worker answers exactly what the synchronous decoder answers', () => {
  // The claim the whole deferral rests on. `assembleColors` with no options runs the decode on the
  // calling thread — the behaviour that shipped — and with `{ diagnose: false }` it returns the
  // refusal with `misreadCount: null` and leaves the decode to whoever asked. Those two must agree
  // about every reading, or moving the work changed the answer.
  const READINGS: [string, Record<Face, ColorFace>][] = [
    ['one misread sticker', misread(DEEP, 1)],
    ['two misread stickers', misread(DEEP, 2)],
    ['three misread stickers', misread(DEEP, 3)],
    ['a solved cube read one sticker wrong', misread(new Cube().asString(), 1)],
    [
      'a cube whose sides were held every which way',
      (() => {
        const f = misread(DEEP, 2);
        FACES.forEach((face, i) => {
          f[face]!.colors = rotateFace(f[face]!.colors, i % 4);
        });
        return f;
      })(),
    ],
  ];

  for (const [name, reading] of READINGS) {
    it(`agrees on ${name}`, () => {
      const sync = assembleColors(reading);
      expect(sync.valid).toBe(false);
      const deferred = assembleColors(reading, undefined, {}, { diagnose: false });
      expect(deferred.misreadCount).toBeNull(); // "checking", never a count and never zero
      expect(deferred.suspects).toBeUndefined();

      // Through the wire and back, because that is how the answer actually travels.
      const request: MisreadRequest = { epoch: 1, faces: reading, fixedRotation: false };
      const reply = structuredClone(handleMisreadRequest(structuredClone(request)));
      const refined = { ...deferred, ...reply.diagnosis };
      expect(refined.misreadCount).toEqual(sync.misreadCount);
      expect(refined.suspects).toEqual(sync.suspects);
      expect(refined.misreadFace).toEqual(sync.misreadFace);
      // And the refusal itself is untouched by the deferral — same reason, same everything else.
      expect(refined.reason).toBe(sync.reason);
      expect(refined.valid).toBe(false);
    });
  }

  it('carries fixedRotation, so a painted cube is decoded as painted', () => {
    // The one thing the wire has to get right beyond the faces. Without it the decode is free to
    // rotate a turned side back and answer "0 misreads" about a cube the painted validator has
    // just refused.
    const painted = faces(DEEP);
    painted.U!.colors = rotateFace(painted.U!.colors, 1);
    const asShown = handleMisreadRequest({ epoch: 1, faces: painted, fixedRotation: false });
    const asPainted = handleMisreadRequest({ epoch: 1, faces: painted, fixedRotation: true });
    expect(asShown.diagnosis.misreadCount).toBe(0);
    expect(asPainted.diagnosis.misreadCount).toBeGreaterThan(0);
  });
});
