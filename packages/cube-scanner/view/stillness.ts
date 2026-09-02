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
      this.key = key;
      this.count = 1;
      this.since = now;
    }
    return this.count >= this.reads && now - this.since >= this.ms;
  }

  /** Forget the current run — the cube left the frame, or the scan was restarted. */
  reset(): void {
    this.key = null;
    this.count = 0;
    this.since = 0;
  }
}
