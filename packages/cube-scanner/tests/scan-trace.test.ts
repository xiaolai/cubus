// The scan trace recorder: off unless asked for, bounded, and a summary that answers the questions a
// flickering scan raises. Driven by an injected clock so no case sleeps.

import { describe, expect, it } from 'vitest';
import {
  EVENT_CAPACITY,
  frameNote,
  ScanTrace,
  sideSpeeds,
  type TickNote,
  type TickRecord,
  TRACE_KEY,
  type TraceEvent,
  traceEnabled,
} from '../view/scan-trace.js';

const store = (value: string | null) => ({
  getItem: (k: string) => (k === TRACE_KEY ? value : null),
});

describe('traceEnabled — off unless asked for', () => {
  it('is on only for the exact value "1"', () => {
    expect(traceEnabled(store('1'))).toBe(true);
    for (const v of [null, '0', 'true', 'yes', '']) expect(traceEnabled(store(v))).toBe(false);
  });

  it('is off, not an error, where storage cannot be read', () => {
    // A locked-down page throws on the first touch of localStorage. A diagnostic must not be the
    // thing that breaks a scan there.
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(traceEnabled(throwing)).toBe(false);
    expect(traceEnabled(undefined)).toBe(false);
  });
});

/** A trace on a clock the test moves by hand. */
function traced(capacity?: number) {
  let now = 1000;
  const trace = new ScanTrace(
    capacity,
    () => now,
    () => '2026-09-18T00:00:00.000Z',
  );
  return {
    trace,
    at(ms: number) {
      now = 1000 + ms;
    },
  };
}

const tick = (fields: Partial<TickNote>): TickNote =>
  ({ inferMs: 10, outcome: 'reading', ...fields }) as TickNote;

describe('ScanTrace — recording', () => {
  it('drops a tick recorded before any session, rather than filing it under a session of 0', () => {
    const { trace } = traced();
    expect(trace.record(tick({}))).toBeNull();
    expect(trace.size).toBe(0);
  });

  it('stamps each tick with its session, its order and its time from the session start', () => {
    const { trace, at } = traced();
    trace.begin({ runtime: 'native', phase: 'scanning' });
    at(40);
    trace.record(tick({ outcome: 'abstain', reason: 'PARTIAL_FACE' }));
    at(100);
    trace.record(tick({}));
    trace.begin({ runtime: 'native', phase: 'scanning' });
    at(160);
    trace.record(tick({}));
    expect(trace.dump().map((r) => [r.session, r.seq, r.t])).toEqual([
      [1, 0, 40],
      [1, 1, 100],
      [2, 0, 60],
    ]);
  });

  it('keeps only the newest ticks up to its capacity — a trace left on is not a leak', () => {
    const { trace } = traced(3);
    trace.begin({ runtime: 'web', phase: 'scanning' });
    for (let i = 0; i < 5; i++) trace.record(tick({ inferMs: i }));
    expect(trace.size).toBe(3);
    expect(trace.dump().map((r) => r.inferMs)).toEqual([2, 3, 4]);
  });

  it('hands out copies, so reading the trace cannot rewrite it', () => {
    const { trace } = traced();
    trace.begin({ runtime: 'web', phase: 'scanning' });
    trace.record(tick({ inferMs: 7 }));
    const [copy] = trace.dump();
    copy!.inferMs = 999;
    expect(trace.dump()[0]!.inferMs).toBe(7);
  });

  it('clears', () => {
    const { trace } = traced();
    trace.begin({ runtime: 'web', phase: 'scanning' });
    trace.record(tick({}));
    trace.clear();
    expect(trace.size).toBe(0);
  });
});

describe('ScanTrace — the summary', () => {
  it('answers how each frame ended, how often the words changed, and what the centre was', () => {
    const { trace, at } = traced();
    trace.begin({ runtime: 'native', providers: ['coreml'], phase: 'scanning' });
    const ticks: [number, Partial<TickNote>][] = [
      [
        60,
        {
          inferMs: 12,
          outcome: 'abstain',
          reason: 'PARTIAL_FACE',
          line: 'Show a side.',
          centre: { found: true, cls: 0, conf: 0.19, kept: false, dist: 0.1 },
        },
      ],
      [
        120,
        {
          inferMs: 14,
          outcome: 'reading',
          line: 'Reading a side — hold still…',
          centre: { found: true, cls: 0, conf: 0.4, kept: true, dist: 0 },
        },
      ],
      [
        180,
        {
          inferMs: 30,
          outcome: 'abstain',
          reason: 'PARTIAL_FACE',
          line: 'Show a side.',
          centre: { found: false },
        },
      ],
      [
        240,
        {
          inferMs: 13,
          outcome: 'abstain',
          reason: 'BAD_GEOMETRY',
          geometry: { rule: 'area-ratio', value: 6.1, bound: 5 },
          line: 'Show any side of your cube to the camera.',
          centre: null,
        },
      ],
      [
        300,
        {
          inferMs: 11,
          outcome: 'settled',
          colors: [0, 0, 0, 0, 0, 0, 0, 0, 0],
          line: 'Got the white side.',
        },
      ],
    ];
    for (const [t, fields] of ticks) {
      at(t);
      trace.record(tick(fields));
    }
    const [s] = trace.summary() as Record<string, unknown>[];
    expect(s).toMatchObject({
      session: 1,
      runtime: 'native',
      providers: ['coreml'],
      ticks: 5,
      seconds: 0.3,
      outcomes: { abstain: 3, reading: 1, settled: 1 },
      abstain: { PARTIAL_FACE: 2, BAD_GEOMETRY: 1 },
      geometry: { 'area-ratio': 1 },
      // The words on screen changed on four of the five ticks — which is the flicker the person
      // scanning sees, counted.
      lineChanges: 4,
      settled: [{ t: 300, colors: 'white white white white white white white white white' }],
      // Three, not four: the BAD_GEOMETRY tick's probe is null — too few kept boxes to say where
      // the face's centre is — and a probe that could not be made is not one that found nothing.
      centre: {
        probed: 3,
        nothingThere: 1,
        nearMiss: 1,
        kept: 1,
        classes: { white: 2 },
        nearMissConf: { median: 0.2, p90: 0.2, max: 0.2 },
      },
    });
    expect(s!.inferMs).toEqual({ median: 13, p90: 30, max: 30 });
    // Every probe lands in exactly one of the three answers.
    const c = s!.centre as { probed: number; nothingThere: number; nearMiss: number; kept: number };
    expect(c.nothingThere + c.nearMiss + c.kept).toBe(c.probed);
  });

  it('reports a figure it cannot compute as null, never as a number', () => {
    // No ticks, no timing: a rate of zero or a median of zero would be a claim, and there is
    // nothing to base one on.
    const { trace } = traced();
    trace.begin({ runtime: 'web', phase: 'scanning' });
    const [s] = trace.summary() as Record<string, unknown>[];
    expect(s).toMatchObject({
      ticks: 0,
      seconds: 0,
      ticksPerSecond: null,
      inferMs: null,
      traceMs: null,
    });
  });

  it('names a colour class it has no word for rather than dropping it', () => {
    const { trace, at } = traced();
    trace.begin({ runtime: 'web', phase: 'scanning' });
    at(10);
    trace.record(tick({ outcome: 'settled', colors: [9] }));
    const [s] = trace.summary() as { settled: { colors: string }[] }[];
    expect(s!.settled[0]!.colors).toBe('class 9');
  });
});

describe('ScanTrace — events, the decisions that are not frames', () => {
  it('drops an event before any session, as it drops a tick', () => {
    const { trace } = traced();
    expect(trace.event('captured', { face: 'U' })).toBeNull();
    expect(trace.events()).toEqual([]);
  });

  it('stamps an event on the ticks’ own clock, so the two can be read as one timeline', () => {
    const { trace, at } = traced();
    trace.begin({ runtime: 'native', phase: 'scanning' });
    at(250);
    trace.record(tick({}));
    at(260);
    trace.event('turned-away', { face: 'B', why: 'the same side again' });
    expect(trace.events()).toEqual([
      {
        session: 1,
        t: 260,
        kind: 'turned-away',
        detail: { face: 'B', why: 'the same side again' },
      },
    ]);
    expect(trace.dump()[0]!.t).toBe(250);
  });

  it('hands out copies, including of the detail, so reading cannot rewrite the record', () => {
    const { trace } = traced();
    trace.begin({ runtime: 'web', phase: 'scanning' });
    trace.event('captured', { face: 'U' });
    const [copy] = trace.events();
    copy!.detail.face = 'X';
    expect(trace.events()[0]!.detail.face).toBe('U');
  });

  it('is bounded, and cleared with the ticks', () => {
    const { trace } = traced();
    trace.begin({ runtime: 'web', phase: 'scanning' });
    for (let i = 0; i < EVENT_CAPACITY + 3; i++) trace.event('captured', { i });
    expect(trace.events()).toHaveLength(EVENT_CAPACITY);
    expect(trace.events()[0]!.detail.i).toBe(3); // the oldest three went first
    trace.clear();
    expect(trace.events()).toEqual([]);
  });

  it('reports each session’s events in its own summary, and no other session’s', () => {
    const { trace, at } = traced();
    trace.begin({ runtime: 'web', phase: 'scanning' });
    at(10);
    trace.event('captured', { face: 'B', colors: [5, 5, 5, 5, 5, 5, 5, 5, 5] });
    trace.begin({ runtime: 'web', phase: 'scanning' });
    at(30);
    trace.event('turned-away', { face: 'B', why: 'the same side again' });
    const [first, second] = trace.summary() as { events: unknown[] }[];
    expect(first!.events).toEqual([
      { t: 10, kind: 'captured', face: 'B', colors: [5, 5, 5, 5, 5, 5, 5, 5, 5] },
    ]);
    expect(second!.events).toEqual([
      { t: 20, kind: 'turned-away', face: 'B', why: 'the same side again' },
    ]);
  });
});

describe('sideSpeeds — how fast a side went from shown to captured, and what cost the time', () => {
  const A = [0, 1, 2, 3, 1, 5, 0, 1, 2]; // centre red
  const A2 = [0, 4, 2, 3, 1, 5, 0, 1, 2]; // …its top edge read as orange: one sticker, one break
  const B = [5, 5, 2, 3, 1, 5, 0, 1, 2]; // two stickers at once: the cube moved
  const P = [2, 2, 2, 2, 2, 2, 2, 2, 2]; // the side captured before this one
  const Q = [5, 5, 5, 5, 0, 5, 5, 5, 5]; // a third side, tried in between
  const rec = (t: number, f: Partial<TickRecord>): TickRecord =>
    ({ session: 1, seq: t, t, inferMs: 10, outcome: 'reading', ...f }) as TickRecord;
  const ev = (
    t: number,
    kind: TraceEvent['kind'],
    detail: Record<string, unknown>,
  ): TraceEvent => ({
    session: 1,
    t,
    kind,
    detail,
  });

  it('tells a side from its TWIN, which carries the same eight around a different centre', () => {
    // CODEX AUDIT, 2026-09-26, and D5 of the 2026-09-23 audit applied here too. `sameSide` leaves
    // the centre out on purpose — it is the sticker a logo misreads — but the eight alone do not
    // name a side: after `U D R L F B` the white and yellow sides carry the SAME eight around
    // different centres. Walking back for "the previous side" on the ring alone therefore stopped
    // on the TWIN, so one side's window swallowed the other's ticks and the swallowed side reported
    // zero ticks and a null settling time from a session it had plainly been held up in.
    const white = [1, 2, 3, 4, 0, 4, 3, 2, 1];
    const yellow = [1, 2, 3, 4, 3, 4, 3, 2, 1]; // the SAME eight, a different centre
    const ticks = [
      rec(100, { colors: white, kept: 9 }),
      rec(200, { colors: white, kept: 9, outcome: 'settled' }),
      rec(300, { colors: yellow, kept: 9 }),
      rec(400, { colors: yellow, kept: 9, outcome: 'settled' }),
    ];
    const events = [
      ev(200, 'captured', { face: 'U', colors: white }),
      ev(400, 'captured', { face: 'D', colors: yellow }),
    ];
    const [first, second] = sideSpeeds(ticks, events);
    expect(first?.ticks, 'the first side lost its own ticks').toBeGreaterThan(0);
    expect(
      second?.ticks,
      'the twin was mistaken for the side before it, so its ticks went to that one',
    ).toBeGreaterThan(0);
    expect(second?.firstReadMs, 'the twin never got a settling time').not.toBeNull();
  });

  it('measures the wait and first-read to capture, and counts each break by its cause', () => {
    const ticks = [
      rec(50, { outcome: 'abstain', reason: 'NO_FACE', kept: 0 }), // nothing shown yet
      rec(100, { outcome: 'abstain', reason: 'PARTIAL_FACE', kept: 6 }), // the side comes into view
      rec(200, { colors: A, kept: 9 }), // first read
      rec(300, { colors: A, kept: 9 }),
      rec(400, { outcome: 'abstain', reason: 'PARTIAL_FACE', kept: 8 }), // break: abstain
      rec(500, { colors: A, kept: 9 }),
      rec(600, { colors: A2, kept: 9 }), // break: the top edge read red, then orange
      rec(700, { colors: A2, kept: 9 }),
      rec(800, { colors: B, kept: 9 }), // break: two stickers at once
      rec(900, { outcome: 'settled', colors: A, kept: 9 }), // and back: two again
    ];
    const [side] = sideSpeeds(ticks, [ev(900, 'captured', { face: 'F', colors: A })]);
    expect(side).toEqual({
      side: 'F',
      at: 900,
      waitMs: 800,
      firstReadMs: 700,
      otherReads: 0,
      ticks: 8,
      reads: 7,
      breaks: {
        total: 4,
        abstain: { PARTIAL_FACE: 1 },
        colour: { 'cell1:red>orange': 1 },
        moved: 2,
      },
      centre: {},
    });
  });

  it('counts a centre flip as the break it is, and tallies it separately as well', () => {
    // TWICE REVERSED, AND THE RULE IS THE SAME EACH TIME: the trace counts a break where the GATE
    // breaks a run. `Stillness` keyed on the eight between 2026-09-20 and 2026-09-23 and a centre
    // flip broke nothing, so counting it here inflated every per-side total on exactly the cubes
    // the trace was opened to diagnose (D10). The gate keys on all nine again, so not counting it
    // would now report zero breaks for a session the centre broke on every frame — the same defect
    // with the sign flipped.
    //
    // The separate `centre` tally is kept either way: a flickering centre is a printed logo's
    // signature, and it should be readable at a glance rather than dug out of the per-cell counts.
    const withCentre = (c: number) => A.map((v, i) => (i === 4 ? c : v));
    const ticks = [
      rec(100, { colors: withCentre(0), kept: 9 }),
      rec(200, { colors: withCentre(5), kept: 9 }), // centre alone: white → blue
      rec(300, { colors: withCentre(0), kept: 9 }), // and back
      rec(400, { outcome: 'settled', colors: withCentre(0), kept: 9 }),
    ];
    const [side] = sideSpeeds(ticks, [ev(400, 'captured', { face: 'F', colors: A })]);
    expect(side!.breaks).toEqual({
      total: 2,
      abstain: {},
      colour: { 'cell4:white>blue': 1, 'cell4:blue>white': 1 },
      moved: 0,
    });
    expect(side!.centre).toEqual({ 'white>blue': 1, 'blue>white': 1 });
  });

  it('starts a side at its own first read, not at the previous capture', () => {
    // The shape of a real scan that the first version got wrong: the side just captured stays in
    // front of the camera after it is filed, and the person tries a third side before this one. The
    // first version measured all of it as this side's, and reported 20.8 s for a side that settled
    // 0.7 s after its first read.
    const ticks = [
      rec(100, { colors: P, kept: 9 }),
      rec(200, { outcome: 'settled', colors: P, kept: 9 }),
      rec(300, { colors: P, kept: 9 }), // still in view after it was filed
      rec(400, { colors: P, kept: 9 }), // the previous side, last seen
      rec(500, { outcome: 'abstain', reason: 'NO_FACE', kept: 0 }),
      rec(600, { colors: Q, kept: 9 }), // another side, tried
      rec(700, { outcome: 'abstain', reason: 'PARTIAL_FACE', kept: 6 }),
      rec(800, { colors: Q, kept: 9 }),
      rec(1400, { colors: A, kept: 9 }), // this side's first read
      rec(1500, { colors: A2, kept: 9 }), // one sticker wrong is still this side
      rec(2000, { outcome: 'settled', colors: A2, kept: 9 }),
    ];
    const sides = sideSpeeds(ticks, [
      ev(200, 'captured', { face: 'U', colors: P }),
      ev(250, 'turned-away', { face: 'U', colors: P }), // not a side: does not start a clock
      ev(2000, 'captured', { face: 'F', colors: A2 }),
    ]);
    expect(sides[1]).toMatchObject({
      side: 'F',
      waitMs: 1600, // from 400, when the previous side was last read
      firstReadMs: 600, // from 1400
      otherReads: 2,
      ticks: 3,
      reads: 3,
      breaks: { total: 1, colour: { 'cell1:red>orange': 1 }, moved: 0 },
    });
  });

  it('names a geometry refusal by its rule, not by BAD_GEOMETRY', () => {
    const ticks = [
      rec(100, { colors: A, kept: 9 }),
      rec(200, {
        outcome: 'abstain',
        reason: 'BAD_GEOMETRY',
        geometry: { rule: 'row-spread', value: 1.2, bound: 1 },
      }),
      rec(300, { colors: A, kept: 9 }),
    ];
    const [side] = sideSpeeds(ticks, [ev(300, 'captured', { face: 'U', colors: A })]);
    expect(side!.breaks.abstain).toEqual({ 'row-spread': 1 });
  });

  it('says a side never seen in view waited for an unknown time, not for none', () => {
    const ticks = [rec(100, { colors: A, kept: 3 })];
    const [side] = sideSpeeds(ticks, [ev(100, 'captured', { face: 'F', colors: A })]);
    expect(side!.waitMs).toBeNull();
  });

  it('refuses a capture that does not say what it filed, rather than measure some other side', () => {
    const ticks = [rec(100, { colors: A, kept: 9 })];
    expect(() => sideSpeeds(ticks, [ev(100, 'captured', { face: 'F' })])).toThrow(/no colours/);
  });
});

describe('the summary’s rate and speed report', () => {
  it('measures the rate over the ticks held, and says how many the ring dropped', () => {
    // Five ticks 100 ms apart into a ring of three: the three held span 200 ms, so ten a second.
    // Dividing by the session's whole age (500 ms) is the bug this replaced: it said six.
    const { trace, at } = traced(3);
    trace.begin({ runtime: 'native', phase: 'scanning' });
    for (let i = 1; i <= 5; i++) {
      at(i * 100);
      trace.record(tick({}));
    }
    const [s] = trace.summary() as Record<string, unknown>[];
    expect(s).toMatchObject({ ticks: 3, ticksDropped: 2, seconds: 0.5, ticksPerSecond: 10 });
  });

  it('carries the floor it was given, and the sides', () => {
    const { trace, at } = traced();
    trace.begin({ runtime: 'native', phase: 'scanning', floorMs: 500 });
    at(100);
    trace.record(tick({ colors: [0, 0, 0, 0, 0, 0, 0, 0, 0], kept: 9 }));
    at(700);
    trace.record(tick({ outcome: 'settled', colors: [0, 0, 0, 0, 0, 0, 0, 0, 0], kept: 9 }));
    trace.event('captured', { face: 'U', colors: [0, 0, 0, 0, 0, 0, 0, 0, 0] });
    at(800);
    trace.event('turned-away', { face: 'B', why: 'the same side again' });
    const [s] = trace.summary() as { speed: Record<string, unknown> }[];
    expect(s!.speed).toMatchObject({
      floorMs: 500,
      sides: [{ side: 'U', waitMs: 600, firstReadMs: 600 }],
      waitMs: { median: 600, p90: 600, max: 600 },
      firstReadMs: { median: 600, p90: 600, max: 600 },
      firstSideInViewToLastSideMs: 600,
    });
  });
});

describe('frameNote', () => {
  it('carries the frame fields a tick record keeps, and not the verdict', () => {
    // The verdict belongs to the tick's outcome, which the panel names; copying `fit` here would
    // put a second copy of it on every record.
    const note = frameNote({
      fit: { ok: false, reason: 'NO_FACE' },
      kept: 0,
      near: 2,
      boxes: [],
      centre: null,
    });
    expect(note).toEqual({ kept: 0, near: 2, centre: null, boxes: [] });
  });
});
