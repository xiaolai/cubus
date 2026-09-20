/**
 * "Has this read held still long enough to trust?" — the one question, with the state it needs.
 *
 * It lived inside `onTick` as three fields and a condition, which is why the rule was hard to see
 * and impossible to test on its own: exercising it meant driving a camera, a detector, a timer and
 * a DOM element to reach four lines of arithmetic.
 *
 * The rule is deliberately BOTH a count and a duration. A count alone is a lie about time, because
 * the two runtimes tick at very different rates — the duration is measured from the FIRST read of
 * the run, so three identical reads span 120 ms on the 60 ms native tick and 400 ms on the 200 ms
 * web one, and a count that means "still" on one path means "glimpsed" on the other. A duration
 * alone would accept a cube that drifted through several different readings during the window.
 * Requiring both is what makes a captured frame a frame somebody actually held.
 *
 * THE RUN IS KEYED ON THE EIGHT, NOT ON ALL NINE (2026-09-20) — see `eightOf`. The centre is
 * reported separately by `centre()`, which answers null when the reads of a run did not agree about
 * it. A logo cap is exactly that case, and it used to mean the side was never captured at all.
 */
/** Positions that must change at once for a read to be a different subject, not a noisy frame. */
const SUBJECT_CHANGE = 4;
/** The centre's position. Every side has its own centre colour, so another side always changes it. */
const CENTRE = 4;
/** The run's key: the EIGHT around the centre, never the centre itself.
 *
 *  THE CENTRE MUST NOT BE ABLE TO VETO A CAPTURE (2026-09-20). Keyed on all nine, a logo cap reading
 *  blue on one frame and white on the next broke the run on every alternation, so the side never
 *  settled and was never captured at all — the panel said "this sticker keeps changing" for as long
 *  as anyone was willing to hold the cube up. The eight are what identify a side anyway
 *  (`sideByEight`), and the centre is the sticker this package already refuses to trust: its
 *  collisions are settled at six by counting, not by reading.
 *
 *  The guard this does NOT give up is the one that matters: a cube being TURNED through the frame
 *  changes far more than its centre, so eight identical reads over 500 ms still cannot be a face on
 *  its way past. What is given up is only the centre's power to say "not yet". */
const eightOf = (colors: readonly number[]): string =>
  colors.filter((_, i) => i !== CENTRE).join(',');

/** Where each position's sticker comes from when a side is turned a quarter in the hand (row-major). */
const QUARTER_TURN = [6, 3, 0, 7, 4, 1, 8, 5, 2] as const;

/**
 * Whether `next` is `prev` turned a quarter, a half or three quarters — the same side, turned in the
 * hand. Never true of a read that differs in ONE position: a turn moves stickers round in fours (a
 * half turn in pairs), and a cycle whose stickers changed cannot change in just one place.
 */
function turnedFrom(prev: readonly number[], next: readonly number[]): boolean {
  if (prev.length !== QUARTER_TURN.length || next.length !== QUARTER_TURN.length) return false;
  let turned: readonly number[] = prev;
  for (let quarter = 1; quarter <= 3; quarter++) {
    const from = turned;
    turned = QUARTER_TURN.map((i) => from[i]!);
    if (turned.every((c, i) => c === next[i])) return true;
  }
  return false;
}

export class Stillness {
  /**
   * The read the current run is made of, or null when there is no run.
   *
   * `null` rather than `''`, because `''` is also what an empty read joins to — so an empty first
   * read used to look like a CONTINUATION of a run that had already been reset, and inherit its
   * start time. Unreachable from the scanner (a read is always nine stickers) and kept impossible
   * rather than merely unlikely, since the sentinel costs nothing to make unambiguous.
   */
  private key: string | null = null;
  private count = 0;
  private since = 0;
  /**
   * The centre colour each read of the current run showed, in order.
   *
   * The run is keyed on the EIGHT (see `offer`), so the centre is free to disagree across a run and
   * this is where that disagreement is recorded. Emptied with the run.
   */
  private centres: number[] = [];
  /** The colours of the run's read, kept so a broken run can be told WHERE it broke. */
  private colors: readonly number[] | null = null;
  /** Per position, how many times a run has been broken by that position alone. */
  private readonly breaks = new Map<number, number>();
  /** Per position, every colour it showed on either side of a break it made alone. */
  private readonly breakColours = new Map<number, Set<number>>();

  /**
   * @param reads Identical consecutive reads required.
   * @param ms Wall-clock stillness required, from the first read of the current run.
   */
  constructor(
    private readonly reads: number,
    private readonly ms: number,
  ) {}

  /**
   * Offer the latest read. True once it has been identical `reads` times AND still for `ms`.
   *
   * `now` is injectable because the alternative is a test that sleeps: the timing rule is the whole
   * point of this class, so it has to be drivable without wall-clock waits.
   *
   * The default clock is MONOTONIC. `Date.now()` is not: it follows an NTP correction or a manual
   * clock change, and a step forward of half a second satisfies the duration gate outright — the
   * one thing this class exists to refuse. "Held still for 500 ms" is a claim about elapsed time,
   * so it is measured with the clock that only measures elapsed time.
   */
  offer(colors: readonly number[], now: number = performance.now()): boolean {
    const key = eightOf(colors);
    if (key === this.key) {
      this.count += 1;
      this.centres.push(colors[CENTRE] ?? -1);
    } else {
      // WHERE the run broke, when it broke in exactly one place.
      //
      // The gate keys on the eight, so ONE of THEM flickering between red and orange — the
      // detector's known weak pair — means no run ever completes and the scan simply never
      // captures that side. That is a dead end with no message: the panel says "hold still" for
      // as long as the user is willing to. The settle rule is deliberately NOT relaxed for the
      // eight (a majority vote would let a face still being turned through the frame settle), so
      // what is added is the missing SENTENCE: which sticker keeps changing, so the user can light
      // it better or tap it afterwards. Recorded only for a single-position break, because two
      // positions changing is a cube that moved, which needs no explaining.
      //
      // The CENTRE is no longer one of these: since 2026-09-20 it cannot break a run at all, so it
      // is never named here. A centre that disagrees across a run is reported by `centre()` as
      // unread, and the side is captured and placed by counting instead of being narrated at.
      const previous = this.colors;
      if (previous && previous.length === colors.length) {
        const differing: number[] = [];
        for (let i = 0; i < colors.length; i++) {
          if (colors[i] !== previous[i]) differing.push(i);
        }
        const only = differing.length === 1 ? differing[0] : undefined;
        // Most of the face changing is a cube that MOVED — another side, or the same side turned —
        // and what the last subject's stickers did says nothing about this one: without this, a face
        // turned straight into another fully read one was described by the old face's red/orange
        // flicker (audit, 2026-09-19). Two or three positions at once is a noisy frame, not a new
        // subject, and wiping the history there would keep a real flicker from ever being named —
        // UNLESS the centre is one of them: a centre is fixed to its side, so a changed centre with
        // anything else changed is another side, however many of its stickers happen to match the
        // last one's (a near-solved cube's sides can). The centre ALONE no longer reaches here at
        // all — the key excludes it — which is the whole of the logo fix. And a read
        // that is the last one TURNED is the same side turned in the hand: every sticker the history
        // names has moved, though a side with a near-symmetric pattern changes in only two or three
        // places (round-3 audit). Wiping is the safe direction either way — a flicker named later,
        // never the wrong sticker named now.
        const anotherSide = differing.includes(CENTRE) && differing.length >= 2;
        const turned = differing.length >= 2 && turnedFrom(previous, colors);
        if (differing.length >= SUBJECT_CHANGE || anotherSide || turned) {
          this.breaks.clear();
          this.breakColours.clear();
        }
        if (only !== undefined) {
          this.breaks.set(only, (this.breaks.get(only) ?? 0) + 1);
          const seen = this.breakColours.get(only) ?? new Set<number>();
          seen.add(previous[only]!).add(colors[only]!);
          this.breakColours.set(only, seen);
        }
      }
      this.key = key;
      this.count = 1;
      this.since = now;
      this.centres = [colors[CENTRE] ?? -1];
    }
    // The LAST read, not the run's first: a break is described by what changed between two frames,
    // and with the centre free to differ inside a run those are no longer the same thing.
    this.colors = [...colors];
    return this.count >= this.reads && now - this.since >= this.ms;
  }

  /**
   * The centre every read of the run agreed on, or null when they did not.
   *
   * UNANIMOUS, not a majority. A logo cap alternates — blue, white, blue — and a majority would pick
   * one of them and file the side under a colour it may not be, which is the confidently-wrong
   * answer this package refuses everywhere. No agreement means the centre is UNREAD, and an unread
   * centre is what `resolveCentres` exists to place: counting, not seeing.
   */
  centre(): number | null {
    const first = this.centres[0];
    if (first === undefined || first < 0) return null;
    return this.centres.every((c) => c === first) ? first : null;
  }

  /**
   * The one position that keeps breaking the run on its own, or null.
   *
   * `atLeast` breaks before it is reported, so a single unlucky frame is not narrated at the user.
   * When several positions qualify the noisiest wins — naming one sticker is the whole value, and
   * a list of three is the same "hold still" with more words.
   */
  flickering(atLeast = 3): number | null {
    let best: number | null = null;
    let most = atLeast - 1;
    for (const [index, count] of this.breaks) {
      if (count > most) {
        most = count;
        best = index;
      }
    }
    return best;
  }

  /**
   * The colours `position` showed across the breaks it made alone, ascending — what the sticker
   * keeps changing BETWEEN. Two colours is the case worth a sentence: a pair the detector confuses
   * under some light. Empty for a position that never broke a run alone.
   */
  flickerColours(position: number): number[] {
    return [...(this.breakColours.get(position) ?? [])].sort((a, b) => a - b);
  }

  /**
   * Where the current run stands, for the scan trace. Read-only, and never consulted by `offer`:
   * the gate decides from its own fields, so recording this cannot change what it decides. `heldMs`
   * is measured the same way the gate measures it — from the run's FIRST read, on the same clock.
   */
  status(now: number = performance.now()): { run: number; heldMs: number } {
    return { run: this.count, heldMs: this.key === null ? 0 : now - this.since };
  }

  /** Forget the current run — the cube left the frame, or the scan was restarted. */
  reset(): void {
    this.key = null;
    this.colors = null;
    this.count = 0;
    this.since = 0;
    this.centres = [];
    this.breaks.clear();
    this.breakColours.clear();
  }
}
