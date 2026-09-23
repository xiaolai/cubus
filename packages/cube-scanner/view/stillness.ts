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
 * THE RUN IS KEYED ON ALL NINE, THE CENTRE INCLUDED. It was keyed on the eight between 2026-09-20
 * and 2026-09-23, so that a logo cap alternating between two colours could not stop a side being
 * captured; the side was then filed with its centre UNREAD and placed by elimination at six. That
 * whole mechanism was removed on the owner's call (see `ai-scan-panel.ts`), and with nothing left
 * to place an unnamed side, letting the centre disagree inside a run buys nothing and costs the
 * guard: a centre is fixed to its side, so a run whose centre changed is not one subject.
 *
 * What a centre that never settles gets instead is words. It breaks the run alone, so `flickering()`
 * names it like any other sticker, and a scan that captures nothing for the panel's bound says the
 * cube is not being read and offers painting. Both are true of what was measured; neither invents a
 * side.
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

/**
 * What one frame-to-frame change MEANS: the single ring sticker that changed, and whether the
 * flicker history should be forgotten because the subject changed.
 *
 * Pure, and lifted out of `offer` (audit, 2026-09-20) so the rule can be read and tested without a
 * run, a clock or a gate. Every one of its three answers is a decision this class got wrong at least
 * once: what counts as one changed sticker, what counts as another side, and whether a turn counts
 * as either.
 */
export function classify(
  previous: readonly number[],
  colors: readonly number[],
): { only: number | null; forget: boolean } {
  const differing: number[] = [];
  for (let i = 0; i < colors.length; i++) {
    if (colors[i] !== previous[i]) differing.push(i);
  }
  // Most of the face changing is a cube that MOVED — another side, or the same side turned — and
  // what the last subject's stickers did says nothing about this one: without this, a face turned
  // straight into another fully read one was described by the old face's red/orange flicker (audit,
  // 2026-09-19). Two or three positions at once is a noisy frame, not a new subject, and wiping the
  // history there would keep a real flicker from ever being named.
  //
  // A CHANGED CENTRE BESIDE ANYTHING ELSE IS ANOTHER SIDE, however many of its stickers happen to
  // match the last one's — a near-solved cube's sides can match in most places. The centre ALONE is
  // still a flicker, and since 2026-09-23 it is one that breaks the run, so it is exactly the
  // sticker worth naming: a logo reads as more than one colour and this is how the person is told
  // which sticker to light better or tap afterwards.
  //
  // And a read that is the last one TURNED is the same side turned in the hand: every sticker the
  // history names has moved, though a side with a near-symmetric pattern changes in only two or
  // three places (round-3 audit). Wiping is the safe direction either way — a flicker named later,
  // never the wrong sticker named now.
  const anotherSide = differing.includes(CENTRE) && differing.length >= 2;
  const turned = differing.length >= 2 && turnedFrom(previous, colors);
  return {
    only: differing.length === 1 ? differing[0]! : null,
    forget: differing.length >= SUBJECT_CHANGE || anotherSide || turned,
  };
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
  /**
   * The frame the last counted read came from, or null when none has been counted or the source
   * cannot identify its frames.
   *
   * D2 (`dev-docs/scan-pipeline-audit-2026-09-23.md` §3). The native camera serves its cached frame
   * on every tick for up to a second — sixteen ticks at the native rate — and the browser's
   * `<video>` repeats its last painted frame whenever the loop outruns the stream. Nothing here
   * could tell that from a stream of new frames, so ONE physical frame could satisfy "three
   * identical reads" on its own, and a side was captured on a single observation while the gate
   * reported a run of three.
   */
  private lastFrame: number | null = null;
  /** Per position, how many times a run has been broken by that position alone. */
  private readonly breaks = new Map<number, number>();
  /**
   * Per position, the two colours of its MOST RECENT break — what it is alternating between now.
   *
   * The latest pair, not every colour ever seen (2026-09-23, with D8). While the history was wiped
   * on every abstaining frame it could not grow, so a set and a pair were the same thing; now that
   * it survives, a set would accumulate every colour a sticker had shown all scan and the sentence
   * would name four. The sentence exists to say which TWO colours a sticker is swapping between,
   * and the light remark is added only for a pair the light is known to confuse — a growing set
   * would eventually contain such a pair by accident and attach the remark to a sticker that never
   * showed it.
   */
  private readonly breakColours = new Map<number, [number, number]>();

  /**
   * @param reads Identical consecutive reads required — all nine stickers, the centre included.
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
   *
   * A FRAME ALREADY COUNTED IS NOT COUNTED AGAIN (D2, 2026-09-23). `frameId` identifies the picture
   * the read came from; offering the same one twice advances nothing — not the count, not the
   * centre tally — and the gate's verdict is re-reported from the state the first offer left. The
   * DURATION still runs, because wall-clock time passing is real whether or not the camera
   * delivered; what a repeated frame cannot do is stand in for a second look at the cube.
   *
   * `undefined` means the source cannot identify its frames, and is counted exactly as before —
   * a runtime that does not know must not have an answer invented for it, since a fabricated id
   * reads as "always a new frame", which is the belief this corrects.
   */
  offer(colors: readonly number[], now: number = performance.now(), frameId?: number): boolean {
    const key = colors.join(',');
    // A repeat of the frame the last counted read came from: no new evidence, so nothing moves.
    // Checked before the key comparison, because a repeated frame necessarily has the same key and
    // would otherwise be indistinguishable from a genuine second look at a still cube — which is
    // precisely the confusion that let one frame settle a side.
    if (frameId !== undefined && frameId === this.lastFrame) {
      return this.count >= this.reads && now - this.since >= this.ms;
    }
    if (frameId !== undefined) this.lastFrame = frameId;
    if (key === this.key) {
      this.count += 1;
    } else {
      // WHERE the run broke, when it broke in exactly one place.
      //
      // The gate keys on all nine, so ONE sticker flickering between red and orange — the
      // detector's known weak pair — means no run ever completes and the scan simply never
      // captures that side. That is a dead end with no message: the panel says "hold still" for
      // as long as the user is willing to. The settle rule is deliberately NOT relaxed for the
      // eight (a majority vote would let a face still being turned through the frame settle), so
      // what is added is the missing SENTENCE: which sticker keeps changing, so the user can light
      // it better or tap it afterwards. Recorded only for a single-position break, because two
      // positions changing is a cube that moved, which needs no explaining.
      const previous = this.colors;
      if (previous && previous.length === colors.length) {
        const { only, forget } = classify(previous, colors);
        if (forget) {
          this.breaks.clear();
          this.breakColours.clear();
        }
        if (only !== null) {
          this.breaks.set(only, (this.breaks.get(only) ?? 0) + 1);
          this.breakColours.set(only, [previous[only]!, colors[only]!]);
        }
      }
      this.key = key;
      this.count = 1;
      this.since = now;
    }
    // The LAST read, not the run's first. Identical inside a run now that the key is all nine, and
    // kept as the last one because that is what a break is described against: what changed between
    // two consecutive frames.
    this.colors = [...colors];
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
    return [...new Set(this.breakColours.get(position) ?? [])].sort((a, b) => a - b);
  }

  /**
   * Where the current run stands, for the scan trace. Read-only, and never consulted by `offer`:
   * the gate decides from its own fields, so recording this cannot change what it decides. `heldMs`
   * is measured the same way the gate measures it — from the run's FIRST read, on the same clock.
   */
  status(now: number = performance.now()): { run: number; heldMs: number } {
    return { run: this.count, heldMs: this.key === null ? 0 : now - this.since };
  }

  /**
   * Forget the current RUN — the cube left the frame, a frame could not be read, the read was spent.
   *
   * THE FLICKER HISTORY SURVIVES IT (D8, `dev-docs/scan-pipeline-audit-2026-09-23.md` §3). The panel
   * resets on every abstaining frame, and a side that will not settle abstains constantly — so
   * wiping `breaks` here meant "which sticker keeps changing" could never reach the three breaks
   * `flickering()` asks for, and the one specific thing the scan can tell a person was replaced by
   * "hold still" for as long as they were willing to hold it. The history is about a SUBJECT, not
   * about a run: `classify`'s `forget` clears it when the subject actually changes, and
   * `forgetFlicker()` clears it when the caller knows it has.
   *
   * The last counted frame does not go either, and for a related reason (D2). A reset means the run
   * is void, not that the camera delivered something new — so if the very next offer carries the
   * same frame id, it is still the same picture and still not a second look. Clearing it here would
   * give a re-served frame a fresh vote after every abstention, which on the native path is a vote
   * it could cast sixteen times a second.
   */
  reset(): void {
    this.key = null;
    this.colors = null;
    this.count = 0;
    this.since = 0;
  }

  /**
   * Forget which sticker was flickering — this is a different subject, or a different scan.
   *
   * Called where the caller KNOWS the subject changed and `classify` will not see it: a side was
   * captured (the next side is a new subject with no frame in between to compare), or the scan was
   * restarted. Keeping it across those would name a sticker of the side before last.
   */
  forgetFlicker(): void {
    this.breaks.clear();
    this.breakColours.clear();
  }

  /**
   * Forget which frame was last counted — the camera itself changed, so its ids mean nothing here.
   *
   * Separate from `reset()` because the two answer different questions: a reset says this RUN is
   * void, and this says the numbering is. A reopened camera or a switched device may restart its
   * counter, and a new frame that happened to reuse the last id would otherwise be discarded as a
   * repeat — silently, and for exactly one frame, which is the kind of fault that is never found.
   */
  forgetFrames(): void {
    this.lastFrame = null;
  }
}
