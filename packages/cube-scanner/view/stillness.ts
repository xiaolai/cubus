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
 */
/** Positions that must change at once for a read to be a different subject, not a noisy frame. */
const SUBJECT_CHANGE = 4;
/** The centre's position. Every side has its own centre colour, so another side always changes it. */
const CENTRE = 4;
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
    const key = colors.join(',');
    if (key === this.key) {
      this.count += 1;
    } else {
      // WHERE the run broke, when it broke in exactly one place.
      //
      // The gate keys on all nine colours, so ONE sticker flickering between red and orange — the
      // detector's known weak pair — means no run ever completes and the scan simply never
      // captures that side. That is a dead end with no message: the panel says "hold still" for
      // as long as the user is willing to. The settle rule is deliberately NOT relaxed (a
      // majority vote would let a face still being turned through the frame settle), so what is
      // added is the missing SENTENCE: which sticker keeps changing, so the user can light it
      // better or tap it afterwards. Recorded only for a single-position break, because two
      // positions changing is a cube that moved, which needs no explaining.
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
        // last one's (a near-solved cube's sides can). The centre ALONE is still a flicker: a logo
        // reads as more than one colour, and that is exactly the sticker worth naming. And a read
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
      this.colors = [...colors];
      this.count = 1;
      this.since = now;
    }
    return this.count >= this.reads && now - this.since >= this.ms;
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
    this.breaks.clear();
    this.breakColours.clear();
  }
}
