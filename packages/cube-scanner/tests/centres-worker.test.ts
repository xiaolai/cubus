// The centre resolution's two halves: the wire (`centres-protocol.ts`) and the thread it crosses
// (`centres-client.ts`).
//
// What is at risk here is not the resolution — `centre-collision.test.ts` owns that — but the three
// ways a page can fail to have a worker, the one way an answer can arrive about a cube that is no
// longer in hand, and the budget. Every one of them is silent when it goes wrong: a stranded
// request leaves six captured sides with no verdict at all, a stale answer files sides for a scan
// the user has already changed, and an unbounded enumeration wedges the thread it was moved to. So
// the assertions here are mostly about what must NOT happen.
//
// D3, `dev-docs/scan-pipeline-audit-2026-09-23.md` §3.

import Cube from 'cubejs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ColorFace, MAX_CENTRE_FILINGS, type UnnamedSide } from '../src/ai-assemble.js';
import { type Colour, slotOf } from '../src/scheme.js';
import { FACES, type Face } from '../src/types.js';
import { CentreResolver } from '../view/centres-client.js';
import {
  type CentresReply,
  type CentresRequest,
  handleCentresRequest,
} from '../view/centres-protocol.js';

const LETTER_CLASS: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
const DEEP = new Cube().move("R U F2 D' L B R2 F D U2 L2 B'").asString();

/** A facelet string -> the six faces as the detector reports them. */
function faces(facelets: string): Record<Face, ColorFace> {
  const out = {} as Record<Face, ColorFace>;
  FACES.forEach((face, fi) => {
    const colors: number[] = [];
    for (let k = 0; k < 9; k++) colors.push(LETTER_CLASS[facelets[fi * 9 + k] as Face]!);
    out[face] = { colors, confidence: Array(9).fill(0.9) };
  });
  return out;
}

/**
 * A scan with `n` sides unnamed: the first `n` captures held back, the rest filed by their centres.
 * The shape the panel is in when a centre collision reaches the resolver.
 */
function collision(n: number): { named: Partial<Record<Face, ColorFace>>; unnamed: UnnamedSide[] } {
  const all = faces(DEEP);
  const named: Partial<Record<Face, ColorFace>> = {};
  const unnamed: UnnamedSide[] = [];
  for (const [i, face] of FACES.entries()) {
    const capture = all[face]!;
    if (i < n) unnamed.push({ capture, centreConfidence: 0.7, centreClaim: null });
    else named[slotOf(capture.colors[4] as Colour)] = capture;
  }
  return { named, unnamed };
}

const ask = (n: number, epoch = 1, budget?: number): CentresRequest => ({
  epoch,
  ...collision(n),
  ...(budget === undefined ? {} : { budget }),
});

/**
 * A `Worker` that never leaves this thread — and answers with the SAME handler the real worker
 * runs, so a test that drives it is testing the shipped resolution and not a stand-in for it.
 */
class FakeWorker {
  static built: FakeWorker[] = [];
  static refuse: Error | null = null;
  static last(): FakeWorker {
    const w = FakeWorker.built[FakeWorker.built.length - 1];
    if (!w) throw new Error('no worker was built');
    return w;
  }
  posted: CentresRequest[] = [];
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
  postMessage(message: CentresRequest): void {
    // Through the wire, exactly as postMessage does it: anything the structured clone algorithm
    // cannot carry fails HERE rather than in a browser nobody is watching.
    this.posted.push(structuredClone(message));
  }
  terminate(): void {
    this.terminated = true;
  }
  answer(index = 0): void {
    const request = this.posted[index];
    if (!request) throw new Error(`nothing posted at ${index}`);
    this.send(structuredClone(handleCentresRequest(request)));
  }
  send(reply: CentresReply): void {
    for (const fn of this.listeners.get('message') ?? []) fn({ data: reply });
  }
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

describe('the centre resolution crosses a thread', () => {
  it('answers on this thread when the page has no Worker, in the call that asked', () => {
    // The behaviour that shipped before the worker existed, kept exactly: a DOM test or a webview
    // that forbids workers gets the whole resolution synchronously rather than a second code path.
    (globalThis as { Worker?: unknown }).Worker = undefined;
    const resolver = new CentreResolver();
    const seen: CentresReply[] = [];
    const now = resolver.request(ask(2), (r) => seen.push(r));
    expect(now).not.toBeNull();
    expect(now?.resolution.result.valid).toBe(true);
    expect(seen, 'the callback ran as well as the synchronous answer').toEqual([]);
  });

  it('posts to the worker and answers from it, with the same verdict', () => {
    withWorker();
    const onThread = handleCentresRequest(ask(2));
    const resolver = new CentreResolver();
    const seen: CentresReply[] = [];
    expect(resolver.request(ask(2), (r) => seen.push(r))).toBeNull();
    FakeWorker.last().answer();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.resolution.result.facelets).toBe(onThread.resolution.result.facelets);
    expect(seen[0]!.resolution.decidedBy).toBe(onThread.resolution.decidedBy);
  });

  it('drops an answer about a scan that has moved on', () => {
    // THE CANCELLATION (D3). There is nothing to interrupt inside one enumeration, so what is
    // cancelled is the answer's authority: a reply for an epoch nobody is waiting for is dropped
    // here rather than filing sides for a cube the user has already changed.
    withWorker();
    const resolver = new CentreResolver();
    const seen: CentresReply[] = [];
    resolver.request(ask(2, 7), (r) => seen.push(r));
    FakeWorker.last().send({ epoch: 6, resolution: { result: { facelets: '', valid: false } } });
    expect(seen, 'an answer for another epoch was delivered').toEqual([]);
    FakeWorker.last().answer();
    expect(seen.map((r) => r.epoch)).toEqual([7]);
  });

  it('keeps one question live and one waiting — never a queue', () => {
    // A second request means the scan changed, which is the only reason there is a second one, so
    // an ask that has not been posted yet is replaced rather than enqueued. Without this the worker
    // builds a backlog and the answer that is wanted arrives behind every obsolete one.
    withWorker();
    const resolver = new CentreResolver();
    const seen: CentresReply[] = [];
    resolver.request(ask(2, 1), (r) => seen.push(r));
    resolver.request(ask(2, 2), (r) => seen.push(r));
    resolver.request(ask(2, 3), (r) => seen.push(r));
    expect(FakeWorker.last().posted.map((p) => p.epoch)).toEqual([1]);
    FakeWorker.last().answer(0);
    expect(FakeWorker.last().posted.map((p) => p.epoch)).toEqual([1, 3]);
    expect(
      seen.map((r) => r.epoch),
      'the replaced ask was answered',
    ).toEqual([1]);
  });

  it('answers a stranded request on this thread when the worker dies', () => {
    // A scan that never resolves is worse than a stall: six captured sides and no verdict at all.
    withWorker();
    const resolver = new CentreResolver();
    const seen: CentresReply[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolver.request(ask(2, 4), (r) => seen.push(r));
    FakeWorker.last().fail();
    expect(seen.map((r) => r.epoch)).toEqual([4]);
    expect(seen[0]!.resolution.result.valid).toBe(true);
  });

  it('resolves on this thread when a worker cannot be built at all', () => {
    withWorker();
    FakeWorker.refuse = new Error('blocked by policy');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resolver = new CentreResolver();
    const now = resolver.request(ask(2), () => {});
    expect(now?.resolution.result.valid).toBe(true);
    // …and it does not keep trying: a worker that cannot be had is written off for this resolver.
    expect(resolver.request(ask(2), () => {})).not.toBeNull();
  });

  it('gives the worker back on dispose, and forgets what it was holding', () => {
    withWorker();
    const resolver = new CentreResolver();
    const seen: CentresReply[] = [];
    resolver.request(ask(2, 9), (r) => seen.push(r));
    const worker = FakeWorker.last();
    resolver.dispose();
    expect(worker.terminated).toBe(true);
    // A terminated worker is not a silenced one, so a reply already on its way must land nowhere.
    worker.answer();
    expect(seen).toEqual([]);
  });

  it('sends a COPY, so a capture changed after the ask cannot change the question', () => {
    // The panel mutates its captures in place — a correction, a re-shown side, a filing adopted.
    // A stale ANSWER is caught by the epoch; a wrong QUESTION is caught by nothing.
    withWorker();
    const resolver = new CentreResolver();
    const request = ask(2);
    resolver.request(request, () => {});
    const before = FakeWorker.last().posted[0]!.unnamed[0]!.capture.colors[0];
    request.unnamed[0]!.capture.colors[0] = 5;
    expect(FakeWorker.last().posted[0]!.unnamed[0]!.capture.colors[0]).toBe(before);
  });
});

describe('the resolution is bounded (D3)', () => {
  it('refuses rather than assess more filings than its budget allows', () => {
    // A TRUNCATED SEARCH DECIDES NOTHING, and that is the whole reason the budget refuses instead
    // of trimming. The gate is uniqueness — "exactly one filing is legal" — and uniqueness over a
    // subset is not uniqueness: the filing left out might have been the second legal one.
    const { resolution } = handleCentresRequest(ask(3, 1, 2));
    expect(resolution.result.valid).toBe(false);
    expect(resolution.result.reason).toMatch(/past the budget/);
    expect(resolution.assessed).toEqual({ filings: 6, budget: 2, truncated: true });
    // Nothing is filed on a refusal of this kind: there is no filing to adopt.
    expect(resolution.faces).toBeUndefined();
    expect(resolution.decidedBy).toBeUndefined();
  });

  it('admits every case the panel can reach, and says what it spent', () => {
    // Four unnamed sides is the most the panel can hold — a fifth would mean five sides sharing
    // centres — and 4! = 24 filings is exactly the default budget. Five and six were never
    // reachable in practice and were never bounded either, so a scan that got there would have
    // spent minutes inside one call.
    for (const [n, filings] of [
      [1, 1],
      [2, 2],
      [3, 6],
      [4, 24],
    ] as const) {
      const { resolution } = handleCentresRequest(ask(n));
      expect(resolution.result.reason ?? '', `${n} unnamed was refused`).not.toMatch(
        /past the budget/,
      );
      expect(resolution.assessed).toEqual({
        filings,
        budget: MAX_CENTRE_FILINGS,
        truncated: false,
      });
    }
  });
});
