/**
 * The scan trace: every tick of a scan, kept in memory, for working out why a side will not settle.
 *
 * WHY IT EXISTS (2026-09-18). After v0.6.0 replaced the detector, reads that used to settle took
 * much longer — the status line changed over and over without a side being captured — and a white
 * centre printed with a logo would not settle at all. The scan cannot say why: it keeps one bit per
 * frame and discards the rest, and the stillness gate forgets its history every time a frame
 * abstains. This keeps what it discards.
 *
 * OFF UNLESS ASKED FOR. `localStorage.cubusScanTrace = '1'`, read when a scan loop starts, so it is
 * switched on for the next side shown and never mid-frame. When off the scan runs exactly the code
 * it ran before: no second decode, no record, nothing on the page's globals. When on it keeps the
 * last TRACE_CAPACITY ticks and publishes itself as `window.__cubusScanTrace`, whose `summary()`
 * is the first thing to read and whose `dump()` is everything. Nothing leaves the machine: there is
 * no upload and no file, only memory a developer reads.
 */

import { sameSide } from '../src/ai-assemble.js';
import type { CentreProbe, FrameTrace, TracedBox } from '../src/fit-trace.js';
import type { FitReason, GeometryFailure } from '../src/onnx-postprocess.js';
import { COLOUR_NAMES } from '../src/scheme.js';

/** The switch, in localStorage. */
export const TRACE_KEY = 'cubusScanTrace';

/**
 * Ticks kept. The native path ticks about sixteen times a second, so this is four minutes of
 * scanning — long enough for a whole cube, short enough that a trace left on is not a leak.
 */
export const TRACE_CAPACITY = 4000;

/** Whether the switch is on. A storage that throws (a locked-down page) is simply "off". */
export function traceEnabled(
  store: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): boolean {
  try {
    return store?.getItem(TRACE_KEY) === '1';
  } catch {
    return false;
  }
}

/** How a tick ended. `reading` is a face that did not settle yet; `settled` is one that did. */
export type Outcome = 'no-frame' | 'error' | 'abstain' | 'reading' | 'settled';

export interface TickRecord {
  session: number;
  seq: number;
  /** Milliseconds since the session began. */
  t: number;
  /** How long the detector took. Measured before any post-processing, so the trace cannot inflate it. */
  inferMs: number;
  /**
   * The frame's whole post-processing with the trace on — the scan's own decode and fit PLUS the
   * trace's second decode. Not the trace's cost alone: it is here to show whether watching the
   * scan is slowing the scan down, and the whole figure is the one that answers that.
   */
  traceMs?: number;
  outcome: Outcome;
  reason?: FitReason;
  geometry?: GeometryFailure;
  kept?: number;
  near?: number;
  centre?: CentreProbe;
  boxes?: TracedBox[];
  colors?: number[];
  conf?: number[];
  run?: number;
  heldMs?: number;
  flicker?: number | null;
  /** The words on screen after this tick — what the person scanning actually read. */
  line?: string;
  error?: string;
}

export interface SessionMeta {
  runtime: string;
  providers?: readonly string[];
  phase: string;
  /**
   * The stillness gate's minimum: no side can be captured sooner than this after its first read.
   * Passed in by the panel (its STABLE_MS) rather than restated here, so the "overhead over the
   * floor" the speed report shows is measured against the floor the scan actually has.
   */
  floorMs?: number;
}

/**
 * How fast one side went from being shown to being captured, and what cost the time.
 *
 * The gate captures a side after three identical reads spanning 500 ms, so a side shown still and
 * read cleanly takes about the floor. Everything above it is RUN BREAKS: each one restarts the count.
 * They come in three kinds, which need three different fixes, so they are counted apart:
 *   - abstain  a frame that read no face (`PARTIAL_FACE`, a geometry rule…) — detection;
 *   - colour   exactly one sticker read a different colour than the frame before — colour, keyed
 *              `cell<i>:<from>><to>` with cells in reading order;
 *   - moved    two or more stickers changed at once — the cube was turned or moved, not misread.
 *
 * THE CENTRE IS NOT A BREAK, BECAUSE THE GATE DOES NOT TREAT IT AS ONE (D10,
 * `dev-docs/scan-pipeline-audit-2026-09-23.md` §3). `Stillness` has keyed its run on the EIGHT
 * since 2026-09-20 — a logo cap alternating white and blue must not be able to veto a capture — so
 * a centre that changed between two frames broke nothing, and counting it here inflated every
 * per-side break total on exactly the cubes the trace was opened to diagnose. The audit's §1.2
 * numbers were read off a trace that did this. Centre changes are still recorded, under `centre`,
 * because a flickering centre IS the logo cube's signature and losing it would be the opposite
 * mistake — they are simply not counted as breaks.
 *
 * WHICH FRAMES BELONG TO THE SIDE (2026-09-18). A side is measured from its own first read — a read
 * that is the filed side by `sameSide` (seven of the eight around the centre, under some turn) — and only after
 * the previous side's last read. The first version measured from the previous CAPTURE, and the side
 * just captured stays in front of the camera for a while after it is filed, while the person may
 * try another side before this one: on a real scan it put 20.8 s against a side that settled 0.7 s
 * after its first read. That time is real, and is kept apart as `waitMs` and `otherReads`; the
 * counts below are the cost of settling THIS side.
 */
export interface SideSpeed {
  /** The face it was filed under, or `held(B)` for a side left unnamed because its centre read as B, like another side's. */
  side: string;
  /** When it was captured or held back, in milliseconds since the session began. */
  at: number;
  /**
   * From the previous side's last read — for the first side, from the first frame showing five or
   * more boxes — to this capture: everything spent getting here, turning the cube included.
   */
  waitMs: number | null;
  /** From this side's first read to its capture. At least the floor; the rest is overhead. */
  firstReadMs: number | null;
  /** Reads in the wait that were neither side: another side tried, or this one read too wrongly to know. */
  otherReads: number;
  /** Ticks and reads from this side's first read to its capture; the counts below cover the same span. */
  ticks: number;
  reads: number;
  breaks: {
    total: number;
    abstain: Record<string, number>;
    colour: Record<string, number>;
    moved: number;
  };
  /**
   * How many frame-to-frame changes were the CENTRE alone — not breaks (the gate ignores them),
   * and the logo cube's signature, keyed `<from>><to>` by colour name.
   */
  centre: Record<string, number>;
}

/** Frames that show a side: enough boxes that a face is plausibly in front of the camera. */
const IN_VIEW_BOXES = 5;

/** The centre's position in a read, in reading order — the one cell the stillness gate ignores. */
const CENTRE_CELL = 4;

/** The colours a side was filed with. Every capture and hold the panel records carries them. */
function filedColours(mark: TraceEvent): readonly number[] {
  const colors = mark.detail.colors;
  if (!Array.isArray(colors) || !colors.every((c) => typeof c === 'number')) {
    throw new Error(
      `a ${mark.kind} event at ${mark.t} ms carries no colours to measure its side by`,
    );
  }
  return colors as number[];
}

/**
 * One SideSpeed per side captured or held back, in order, for ONE session's ticks and events.
 * Pure, so the arithmetic is testable without a scan.
 */
export function sideSpeeds(
  ticks: readonly TickRecord[],
  events: readonly TraceEvent[],
): SideSpeed[] {
  const marks = events.filter((e) => e.kind === 'captured' || e.kind === 'held-back');
  const out: SideSpeed[] = [];
  let from = Number.NEGATIVE_INFINITY;
  let previous: readonly number[] | null = null;
  for (const m of marks) {
    const filed = filedColours(m);
    const win = ticks.filter((r) => r.t > from && r.t <= m.t);
    from = m.t;
    let lastOfPrevious: TickRecord | undefined;
    for (let i = win.length - 1; previous !== null && i >= 0; i--) {
      const colors = win[i]!.colors;
      if (colors !== undefined && sameSide(colors, previous)) {
        lastOfPrevious = win[i];
        break;
      }
    }
    const after = lastOfPrevious ? win.filter((r) => r.t > lastOfPrevious.t) : win;
    const start = after.findIndex((r) => r.colors !== undefined && sameSide(r.colors, filed));
    const own = start < 0 ? [] : after.slice(start);
    const seen = lastOfPrevious ?? win.find((r) => (r.kept ?? 0) >= IN_VIEW_BOXES);
    const firstRead = own[0];
    previous = filed;
    const breaks: SideSpeed['breaks'] = { total: 0, abstain: {}, colour: {}, moved: 0 };
    const centre: SideSpeed['centre'] = {};
    for (let i = 1; i < own.length; i++) {
      const prev = own[i - 1]!;
      const cur = own[i]!;
      if (prev.colors === undefined) continue; // only a run that existed can be broken
      if (cur.colors === undefined) {
        count(breaks.abstain, cur.geometry?.rule ?? cur.reason ?? cur.outcome);
        breaks.total += 1;
        continue;
      }
      // Recorded, and kept OUT of the break counts: the gate keys on the eight (D10).
      if (cur.colors[CENTRE_CELL] !== prev.colors[CENTRE_CELL]) {
        count(
          centre,
          `${colourOf(prev.colors[CENTRE_CELL]!)}>${colourOf(cur.colors[CENTRE_CELL]!)}`,
        );
      }
      const changed: number[] = [];
      for (let c = 0; c < cur.colors.length; c++) {
        if (c !== CENTRE_CELL && cur.colors[c] !== prev.colors[c]) changed.push(c);
      }
      if (changed.length === 0) continue;
      breaks.total += 1;
      if (changed.length === 1) {
        const c = changed[0]!;
        count(breaks.colour, `cell${c}:${colourOf(prev.colors[c]!)}>${colourOf(cur.colors[c]!)}`);
      } else breaks.moved += 1;
    }
    out.push({
      side: m.kind === 'held-back' ? `held(${String(m.detail.shares)})` : String(m.detail.face),
      at: m.t,
      waitMs: seen ? m.t - seen.t : null,
      firstReadMs: firstRead ? m.t - firstRead.t : null,
      otherReads: (start < 0 ? after : after.slice(0, start)).filter((r) => r.colors !== undefined)
        .length,
      ticks: own.length,
      reads: own.filter((r) => r.colors !== undefined).length,
      breaks,
      centre,
    });
  }
  return out;
}

interface Session extends SessionMeta {
  id: number;
  startedAt: string;
}

/** What a tick contributes before the recorder stamps it. */
export type TickNote = Omit<TickRecord, 'session' | 'seq' | 't'>;

/**
 * Something the scan decided that is not a frame: a side filed, held back, turned away, or a held-back
 * side resolved at check time. Kept apart from the ticks because the resolution does not happen on a
 * tick at all — it runs from the check timer after the sixth side — and because these are the steps a
 * logo on the white centre goes through, which a list of frames cannot show.
 */
export interface TraceEvent {
  session: number;
  /** Milliseconds since the session began, on the same clock as the ticks. */
  t: number;
  kind: 'captured' | 'held-back' | 'turned-away' | 'contest-resolved';
  detail: Record<string, unknown>;
}

/** Events kept. A whole scan is a handful; this is a bound, not an expectation. */
export const EVENT_CAPACITY = 500;

/** The fields of a traced frame that belong on the tick's record. */
export function frameNote(frame: FrameTrace): Partial<TickNote> {
  return { kept: frame.kept, near: frame.near, centre: frame.centre, boxes: frame.boxes };
}

const colourOf = (cls: number) => COLOUR_NAMES[cls] ?? `class ${cls}`;

function quantiles(values: number[]): { median: number; p90: number; max: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const round = (v: number) => Math.round(v * 10) / 10;
  return { median: round(at(0.5)), p90: round(at(0.9)), max: round(sorted[sorted.length - 1]!) };
}

const count = <K extends string>(into: Partial<Record<K, number>>, key: K) => {
  into[key] = (into[key] ?? 0) + 1;
};

export class ScanTrace {
  private readonly records: TickRecord[] = [];
  private readonly happenings: TraceEvent[] = [];
  private readonly sessions: Session[] = [];
  private session = 0;
  private seq = 0;
  private start = 0;

  constructor(
    private readonly capacity: number = TRACE_CAPACITY,
    private readonly clock: () => number = () => performance.now(),
    private readonly wall: () => string = () => new Date().toISOString(),
  ) {}

  /** A scan loop started: every tick until the next `begin` belongs to it. */
  begin(meta: SessionMeta): void {
    this.session += 1;
    this.seq = 0;
    this.start = this.clock();
    this.sessions.push({ ...meta, id: this.session, startedAt: this.wall() });
  }

  /** Record one tick. Dropped when no session has begun, rather than filed under a session of 0. */
  record(note: TickNote): TickRecord | null {
    if (this.session === 0) return null;
    const rec: TickRecord = {
      ...note,
      session: this.session,
      seq: this.seq++,
      t: Math.round(this.clock() - this.start),
    };
    this.records.push(rec);
    if (this.records.length > this.capacity) this.records.shift();
    return rec;
  }

  /** Record a decision that is not a frame. Dropped before any session, like a tick. */
  event(kind: TraceEvent['kind'], detail: Record<string, unknown> = {}): TraceEvent | null {
    if (this.session === 0) return null;
    const ev: TraceEvent = {
      session: this.session,
      t: Math.round(this.clock() - this.start),
      kind,
      detail: { ...detail },
    };
    this.happenings.push(ev);
    if (this.happenings.length > EVENT_CAPACITY) this.happenings.shift();
    return ev;
  }

  /** Every event kept, oldest first. Copies, like `dump`. */
  events(): TraceEvent[] {
    return this.happenings.map((e) => ({ ...e, detail: { ...e.detail } }));
  }

  get size(): number {
    return this.records.length;
  }

  /** Every tick kept, oldest first. A copy, so reading it cannot disturb the recording. */
  dump(): TickRecord[] {
    return this.records.map((r) => ({ ...r }));
  }

  clear(): void {
    this.records.length = 0;
    this.happenings.length = 0;
  }

  /**
   * One entry per session, read first. It answers the questions a flickering scan raises, in the
   * order they are worth asking: is the detector slow, how does each frame end, how often did the
   * words change, and — for the logo case — what the detector made of the centre of the face.
   */
  summary(): object[] {
    return this.sessions.map((s) => {
      const ticks = this.records.filter((r) => r.session === s.id);
      const outcomes: Partial<Record<Outcome, number>> = {};
      const abstain: Partial<Record<FitReason, number>> = {};
      const geometry: Partial<Record<GeometryFailure['rule'], number>> = {};
      const centreClasses: Record<string, number> = {};
      const centre = { probed: 0, nothingThere: 0, nearMiss: 0, kept: 0 };
      const nearMissConf: number[] = [];
      let lineChanges = 0;
      let previousLine: string | undefined;
      for (const r of ticks) {
        count(outcomes, r.outcome);
        if (r.reason) count(abstain, r.reason);
        if (r.geometry) count(geometry, r.geometry.rule);
        if (r.line !== undefined && previousLine !== undefined && r.line !== previousLine)
          lineChanges += 1;
        if (r.line !== undefined) previousLine = r.line;
        if (r.centre) {
          centre.probed += 1;
          if (!r.centre.found) centre.nothingThere += 1;
          else {
            centreClasses[colourOf(r.centre.cls)] =
              (centreClasses[colourOf(r.centre.cls)] ?? 0) + 1;
            if (r.centre.kept) centre.kept += 1;
            else {
              centre.nearMiss += 1;
              nearMissConf.push(r.centre.conf);
            }
          }
        }
      }
      const first = ticks[0];
      const last = ticks[ticks.length - 1];
      const seconds = last ? Math.round(last.t / 100) / 10 : 0;
      // THE RATE IS OVER THE TICKS HELD, not over the session. The ring keeps the newest
      // TRACE_CAPACITY ticks, so a long session has dropped its first ones, and dividing what is
      // left by the whole session's age reported 6.6 ticks a second on a scanner running at 14.
      const span = first && last ? (last.t - first.t) / 1000 : 0;
      const events = this.happenings.filter((e) => e.session === s.id);
      const sides = sideSpeeds(ticks, events);
      const waits = sides.flatMap((x) => (x.waitMs === null ? [] : [x.waitMs]));
      const settles = sides.flatMap((x) => (x.firstReadMs === null ? [] : [x.firstReadMs]));
      const resolved = [...events].reverse().find((e) => e.kind === 'contest-resolved');
      return {
        session: s.id,
        startedAt: s.startedAt,
        runtime: s.runtime,
        providers: s.providers,
        phase: s.phase,
        ticks: ticks.length,
        // Ticks the ring dropped from this session's start: `seq` counts from 0 per session.
        ticksDropped: first ? first.seq : 0,
        seconds,
        ticksPerSecond: span > 0 ? Math.round(((ticks.length - 1) / span) * 10) / 10 : null,
        // The speed report: per side, then the whole. Read `sides` first — it says which side was
        // slow and what the time went on.
        speed: {
          floorMs: s.floorMs ?? null,
          sides,
          waitMs: quantiles(waits),
          firstReadMs: quantiles(settles),
          firstSideInViewToLastSideMs:
            sides.length > 0 && sides[0]!.waitMs !== null
              ? sides[sides.length - 1]!.at - (sides[0]!.at - sides[0]!.waitMs)
              : null,
          resolved: resolved ? { ...resolved.detail } : null,
        },
        inferMs: quantiles(ticks.map((r) => r.inferMs)),
        traceMs: quantiles(ticks.flatMap((r) => (r.traceMs === undefined ? [] : [r.traceMs]))),
        outcomes,
        abstain,
        geometry,
        lineChanges,
        settled: ticks
          .filter((r) => r.outcome === 'settled')
          .map((r) => ({ t: r.t, colors: (r.colors ?? []).map(colourOf).join(' ') })),
        centre: { ...centre, classes: centreClasses, nearMissConf: quantiles(nearMissConf) },
        events: events.map((e) => ({ t: e.t, kind: e.kind, ...e.detail })),
      };
    });
  }
}
