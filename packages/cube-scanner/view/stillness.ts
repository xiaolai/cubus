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
        for (let i = 0; i < colors.length && differing.length < 2; i++) {
          if (colors[i] !== previous[i]) differing.push(i);
        }
        const only = differing.length === 1 ? differing[0] : undefined;
        if (only !== undefined) this.breaks.set(only, (this.breaks.get(only) ?? 0) + 1);
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

  /** Forget the current run — the cube left the frame, or the scan was restarted. */
  reset(): void {
    this.key = null;
    this.colors = null;
    this.count = 0;
    this.since = 0;
    this.breaks.clear();
  }
}
