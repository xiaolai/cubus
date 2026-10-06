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
export function traceEnabled(store?: Pick<Storage, 'getItem'>): boolean {
  try {
    // READ INSIDE THE TRY, not as a default argument. A default is evaluated at the call, BEFORE
    // the body runs, and `globalThis.localStorage` is a getter that THROWS on a page where storage
    // is denied — a sandboxed iframe, a browser set to block it. So the documented "a storage that
    // throws is simply off" was not true of the commonest way for one to throw: the exception
    // escaped this function entirely and took the scan loop with it.
    const storage = store ?? globalThis.localStorage;
    return storage?.getItem(TRACE_KEY) === '1';
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
 * A BREAK IS COUNTED WHERE THE GATE BREAKS A RUN, and the centre has been on both sides of that
 * line. `Stillness` keyed its run on the EIGHT between 2026-09-20 and 2026-09-23 so that a logo cap
 * alternating white and blue could not veto a capture; a centre change broke nothing then, and
 * counting it here inflated every per-side total on exactly the cubes the trace was opened to
 * diagnose (D10, `dev-docs/scan-pipeline-audit-2026-09-23.md` §3 — the audit's §1.2 numbers were
 * read off a trace that did). The gate keys on all nine again, so the centre counts again: not
 * counting it now would report zero breaks for a session the centre broke on every frame, which is
 * the same defect with its sign flipped. Centre changes are ALSO tallied on their own, under
 * `centre`, because a flickering centre is a printed logo's signature and should be readable at a
 * glance rather than dug out of the per-cell counts.
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
  /** The face it was filed under. */
  side: string;
  /** When it was captured, in milliseconds since the session began. */
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
 * One SideSpeed per side captured, in order, for ONE session's ticks and events.
 * Pure, so the arithmetic is testable without a scan.
 */
/**
 * Is `read` the same side as `other` — its CENTRE and its ring, never the ring alone?
 *
 * D5, APPLIED HERE TOO (Codex audit, 2026-09-26). `sameSide` compares the eight around the centre
 * and deliberately leaves the centre out, because that is the sticker a logo misreads. But the eight
 * alone do not name a side: after `U D R L F B` the white and yellow sides carry the SAME eight
 * around different centres. This file measures per-side timing by walking back through the ticks
 * until it finds "the previous side", so on that scramble one side's window swallowed the other's
 * ticks — the swallowed side reported zero ticks and a null settling time, from a session in which
 * it had plainly been held up. The panel has always asked both questions (`sideInHand`); this asked
 * one.
 *
 * USED FOR THE BOUNDARY BETWEEN TWO SIDES, AND NOWHERE ELSE. Where this side's own window STARTS is
 * still decided on the ring alone, because inside a window a flickering centre is this side with a
 * flickering centre — and D10 requires that flip to be COUNTED as the break it is, which it cannot
 * be if the ticks carrying it fall outside the window. What the ring alone cannot do is tell this
 * side from the PREVIOUS one, which is the question asked below.
 *
 * The traced colours are the reading AS READ — `traceEvent('captured', …)` records `read.colors`
 * before `withCentre` rewrites anything — so the centre here is a measurement and comparing it is
 * comparing like with like.
 */
const sameSideAs = (read: readonly number[], other: readonly number[]): boolean =>
  read[4] === other[4] && sameSide(read, other);

/** Which ticks belong to one captured side, and the two instants its timings are measured from. */
interface SideWindow {
  /** The ticks of this side itself: from its first read to the capture. */
  own: TickRecord[];
  /** Ticks in the window before this side's own reading began — the fumbling before it settled. */
  before: TickRecord[];
  /** The first tick that showed the cube at all, which `waitMs` is measured from. */
  seen: TickRecord | undefined;
}

/**
 * Split one capture's ticks into the side's own run and what came before it.
 *
 * LIFTED OUT OF `sideSpeeds` (Codex audit, 2026-09-26, the complexity half). Choosing the window and
 * scoring the run are two jobs: the first is about which side a tick belongs to, the second about
 * what broke a run of them. They were one function of complexity 23, and the ONE place they touch —
 * the boundary rule below — is exactly where a defect had been hiding.
 */
function windowFor(
  win: readonly TickRecord[],
  filed: readonly number[],
  previous: readonly number[] | null,
): SideWindow {
  // The last tick that still showed the PREVIOUS side: everything after it is this side's window.
  let lastOfPrevious: TickRecord | undefined;
  for (let i = win.length - 1; previous !== null && i >= 0; i--) {
    const colors = win[i]!.colors;
    if (colors !== undefined && sameSideAs(colors, previous)) {
      lastOfPrevious = win[i];
      break;
    }
  }
  const after = lastOfPrevious ? win.filter((r) => r.t > lastOfPrevious.t) : [...win];
  const start = after.findIndex((r) => r.colors !== undefined && sameSide(r.colors, filed));
  return {
    own: start < 0 ? [] : after.slice(start),
    before: start < 0 ? after : after.slice(0, start),
    seen: lastOfPrevious ?? win.find((r) => (r.kept ?? 0) >= IN_VIEW_BOXES),
  };
}

/** What broke this side's run, by cause — and the centre's own tally beside it. */
interface RunBreaks {
  breaks: SideSpeed['breaks'];
  centre: SideSpeed['centre'];
}

/** Compare one pair of consecutive ticks and record what, if anything, broke the run. */
function noteBreak(prev: TickRecord, cur: TickRecord, into: RunBreaks): void {
  if (prev.colors === undefined) return; // only a run that existed can be broken
  if (cur.colors === undefined) {
    count(into.breaks.abstain, cur.geometry?.rule ?? cur.reason ?? cur.outcome);
    into.breaks.total += 1;
    return;
  }
  // The centre's own tally, kept as well as counted: a flickering centre is a printed logo's
  // signature, and the per-cell `colour` breakdown does not make it easy to see at a glance.
  if (cur.colors[CENTRE_CELL] !== prev.colors[CENTRE_CELL]) {
    count(
      into.centre,
      `${colourOf(prev.colors[CENTRE_CELL]!)}>${colourOf(cur.colors[CENTRE_CELL]!)}`,
    );
  }
  // COUNTED LIKE ANY OTHER CELL (2026-09-23). It was excluded while `Stillness` keyed its run
  // on the eight, because a break the gate does not treat as one is not a break — D10. The
  // gate keys on all nine again, so excluding it here would report zero breaks for a session
  // whose every run the centre broke, which is exactly the session this trace is opened for.
  const changed: number[] = [];
  for (let c = 0; c < cur.colors.length; c++) {
    if (cur.colors[c] !== prev.colors[c]) changed.push(c);
  }
  if (changed.length === 0) return;
  into.breaks.total += 1;
  if (changed.length === 1) {
    const c = changed[0]!;
    count(into.breaks.colour, `cell${c}:${colourOf(prev.colors[c]!)}>${colourOf(cur.colors[c]!)}`);
  } else into.breaks.moved += 1;
}

/** Walk a side's run and tally every break in it. */
function breaksIn(own: readonly TickRecord[]): RunBreaks {
  const into: RunBreaks = {
    breaks: { total: 0, abstain: {}, colour: {}, moved: 0 },
    centre: {},
  };
  for (let i = 1; i < own.length; i++) noteBreak(own[i - 1]!, own[i]!, into);
  return into;
}

export function sideSpeeds(
  ticks: readonly TickRecord[],
  events: readonly TraceEvent[],
): SideSpeed[] {
  const marks = events.filter((e) => e.kind === 'captured');
  const out: SideSpeed[] = [];
  let from = Number.NEGATIVE_INFINITY;
  let previous: readonly number[] | null = null;
  for (const m of marks) {
    const filed = filedColours(m);
    const win = ticks.filter((r) => r.t > from && r.t <= m.t);
    from = m.t;
    const { own, before, seen } = windowFor(win, filed, previous);
    previous = filed;
    const firstRead = own[0];
    const { breaks, centre } = breaksIn(own);
    out.push({
      side: String(m.detail.face),
      at: m.t,
      waitMs: seen ? m.t - seen.t : null,
      firstReadMs: firstRead ? m.t - firstRead.t : null,
      otherReads: before.filter((r) => r.colors !== undefined).length,
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

/** Everything one session's ticks add up to, before any of it is shaped into a report. */
interface TickTally {
  outcomes: Partial<Record<Outcome, number>>;
  abstain: Partial<Record<FitReason, number>>;
  geometry: Partial<Record<GeometryFailure['rule'], number>>;
  centreClasses: Record<string, number>;
  centre: { probed: number; nothingThere: number; nearMiss: number; kept: number };
  nearMissConf: number[];
  lineChanges: number;
}

/** What the CENTRE probe made of one tick, folded into the running tally. */
function tallyCentre(probe: NonNullable<TickRecord['centre']>, into: TickTally): void {
  into.centre.probed += 1;
  if (!probe.found) {
    into.centre.nothingThere += 1;
    return;
  }
  const name = colourOf(probe.cls);
  into.centreClasses[name] = (into.centreClasses[name] ?? 0) + 1;
  if (probe.kept) {
    into.centre.kept += 1;
    return;
  }
  into.centre.nearMiss += 1;
  into.nearMissConf.push(probe.conf);
}

/**
 * Add one session's ticks up.
 *
 * LIFTED OUT OF `summary` (Codex audit, 2026-09-26, the complexity half — this one it did not
 * report, and it is the same shape as `sideSpeeds` at 23: counting and reporting in one function).
 * Counting is what this does; shaping the numbers into a report is `summary`'s, and the centre
 * probe's four-way split is its own again.
 */
function tallyTicks(ticks: readonly TickRecord[]): TickTally {
  const into: TickTally = {
    outcomes: {},
    abstain: {},
    geometry: {},
    centreClasses: {},
    centre: { probed: 0, nothingThere: 0, nearMiss: 0, kept: 0 },
    nearMissConf: [],
    lineChanges: 0,
  };
  let previousLine: string | undefined;
  for (const r of ticks) {
    count(into.outcomes, r.outcome);
    if (r.reason) count(into.abstain, r.reason);
    if (r.geometry) count(into.geometry, r.geometry.rule);
    if (r.line !== undefined) {
      if (previousLine !== undefined && r.line !== previousLine) into.lineChanges += 1;
      previousLine = r.line;
    }
    if (r.centre) tallyCentre(r.centre, into);
  }
  return into;
}

/**
 * Something the scan decided that is not a frame: a side filed, or a side turned away as one
 * already in hand. Kept apart from the ticks because a decision is not a frame's property, and
 * because these are the steps a scan goes through that a list of frames cannot show.
 */
export interface TraceEvent {
  session: number;
  /** Milliseconds since the session began, on the same clock as the ticks. */
  t: number;
  kind: 'captured' | 'turned-away' | 'loop-restarted';
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
      const { outcomes, abstain, geometry, centreClasses, centre, nearMissConf, lineChanges } =
        tallyTicks(ticks);
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
