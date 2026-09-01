/**
 * "Has this read held still long enough to trust?" — the one question, with the state it needs.
 *
 * It lived inside `onTick` as three fields and a condition, which is why the rule was hard to see
 * and impossible to test on its own: exercising it meant driving a camera, a detector, a timer and
 * a DOM element to reach four lines of arithmetic.
 *
 * The rule is deliberately BOTH a count and a duration. A count alone is a lie about time, because
 * the two runtimes tick at very different rates — three identical reads span 180 ms on the 60 ms
 * native tick and 600 ms on the 200 ms web one, so a count that means "still" on one path means
 * "glimpsed" on the other. A duration alone would accept a cube that drifted through several
 * different readings during the window. Requiring both is what makes a captured frame a frame
 * somebody actually held.
 */
export class Stillness {
  private key = '';
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
   */
  offer(colors: readonly number[], now: number = Date.now()): boolean {
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
    this.key = '';
    this.count = 0;
    this.since = 0;
  }
}
