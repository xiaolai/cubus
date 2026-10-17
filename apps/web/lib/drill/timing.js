// A drill rep's time, on the cube's own clock, or a refusal saying why there is none.
//
// dev-docs/algorithm-drill-v2-plan.md §3.5. The first Drill's timer refused every one-turn algorithm and was
// biased 10–25% on a seven-turn one, because it estimated the first turn's own duration
// (`algorithm-drills-plan.md` §0). This one estimates nothing: a report is stamped when the cube registers a
// quarter turn ENDING, so the span from the first report to the last holds every turn after the first and
// none of the first — and it is reported as exactly that, "first turn to last turn".
//
// REFUSED, with the time null, and never guessed:
//   one-turn        an algorithm of one turn has no span between two reports of it
//   stream-gap      a turn was lost during the rep, so its reports are not the turns that were made
//   no-cube-clock   a report in the span had no cube timestamp (Giiker, GoCube, a GAN gap-recovered move);
//                   the host's arrival time carries radio latency and is not a substitute
//   clock-reset     the cube's clock went backwards inside the span
//   no-span         the first and last reports carry one time
//
// WHAT THIS CANNOT SEE: a finite `cubeTimestamp` is taken as the cube's clock, and from two decoders it is not
// always. Both are in vendor/smartcube.js, and neither marks the move it changes:
//   GAN Gen2  `GanGen2ProtocolDriver` sums the cube's per-move intervals, and where the cube sends an interval
//             of ZERO it adds the host's time since the previous move packet instead. Upstream's comment puts
//             that at the 16-bit interval register overflowing, more than 65.5 s after the last turn; whether
//             a Gen2 cube also sends zero for two faces registered in one millisecond is not measured here.
//   MoYu32    `Moyu32Connection`'s handleMoves re-anchors its device clock to the host's whenever the host's
//             arrival and the cube's own intervals disagree by more than 2 s, and a radio stall that long is
//             enough. The interval before that packet's first move is then the host's.
// A report reaches this module as notation, host time, cube time and serial, and in those such an interval
// looks like a measured one. Even an exact match of the two clocks' deltas is no tell, since 4 of the 87
// measured intervals in the vendored Gen2 captures (test/fixtures/smartcube/) have one, and both clocks are
// whole milliseconds (the bundle's host clock is `Math.floor(performance.now())`). So a span holding such an
// interval is timed, partly on the host's clock. The fix belongs in the protocol layer, in the owner's fork
// this repository pins and rebuilds (xiaolai/smartcube-web-bluetooth, in its gan-protocol-drivers and moyu32
// sources): give each such move a null `cubeTimestamp`, as the Gen3/Gen4 drivers do for a recovered move, and
// this module refuses the span as no-cube-clock with no change here. test/drill-engine.test.mjs runs both
// drivers' own code from the bundle and fails the day either marks the move, so this paragraph cannot
// outlive the defect (audit-fix 2026-10-18 #14, r2 #11, r3 #14).
//
// TPS is in the half-turn metric, counting only the turns the span holds — every one that ENDS after the
// first report — and names its metric, because "turns per second" in an unnamed metric is a different
// number in each. It is withheld from a rep that was not the algorithm alone (it left the algorithm, or
// took a turn back), whose span holds turns the algorithm does not.
//
// A PAUSE is a gap between two reports over PAUSE_FACTOR times the rep's usual gap BETWEEN TURNS: the median
// of the gaps that follow a report ending a turn. A gap inside one turn — between a slice's two faces, or a
// half turn's two quarters — is part of a turn, not time between turns, and it is short: a GAN 16 ui
// stamped both faces of 29 of its 75 recorded slices on one millisecond (test/fixtures/hardware/
// gan16ui-2026-10-17.mjs). Counted in, those gaps made a slice algorithm's median zero, so no gap was ever
// marked; a few milliseconds instead of none made every ordinary gap between turns a "pause" (audit-fix
// 2026-10-18 #15). A zero gap between turns is two turns stamped at one instant, which says nothing about how
// long a hand waits, so it is left out too. A rep with no gap between turns has nothing to stand out from.

/**
 * How many times a rep's usual gap between turns a gap must exceed to be marked as a pause. A plan decision
 * (dev-docs/algorithm-drill-v2-plan.md §3.5, after csTimer's 2–3× of the mean), not a measurement.
 */
export const PAUSE_FACTOR = 3;

/** The reasons a rep's time is refused — the whole vocabulary, so a screen can word every one. */
export const TIME_REFUSAL = Object.freeze({
  ONE_TURN: 'one-turn',
  STREAM_GAP: 'stream-gap',
  NO_CUBE_CLOCK: 'no-cube-clock',
  CLOCK_RESET: 'clock-reset',
  NO_SPAN: 'no-span',
});

const stamp = (report) => (typeof report?.cubeTimestamp === 'number' && Number.isFinite(report.cubeTimestamp)
  ? report.cubeTimestamp : null);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The time of one completed rep.
 *
 * `reports` are the rep's reports from its first MATCHED one to the one that completed it, in order.
 * `htm` is the algorithm's length in the half-turn metric; `turnsTimed` how many of those end after the
 * first report. `streamBroken` says a turn was lost during the rep; `clean` that the reports were the
 * algorithm's own and no others. `splits` are `[{ from, to, start, end }]`: token ranges and the indices into `reports`
 * of the report that reached each boundary (null when none did). `moveEnds` are the indices into `reports` of
 * the reports that ended a turn — that left the cube on a position of the algorithm rather than part way
 * through one — which is what separates a gap between turns from a gap inside one.
 */
export function timeRep({ reports, htm, turnsTimed, streamBroken, clean, splits = [], moveEnds }) {
  if (!Array.isArray(moveEnds)) throw new Error('timing: which reports end a turn is given, never assumed');
  const refuse = (reason) => Object.freeze({
    ms: null,
    refused: reason,
    span: 'first-turn-to-last-turn',
    tps: null,
    splits: Object.freeze(splits.map(({ from, to }) => Object.freeze({ from, to, ms: null }))),
    pauses: Object.freeze([]),
  });
  if (htm < 2) return refuse(TIME_REFUSAL.ONE_TURN);
  if (streamBroken) return refuse(TIME_REFUSAL.STREAM_GAP);
  const stamps = reports.map(stamp);
  if (!stamps.length || stamps.some((t) => t === null)) return refuse(TIME_REFUSAL.NO_CUBE_CLOCK);
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
  if (gaps.some((g) => g < 0)) return refuse(TIME_REFUSAL.CLOCK_RESET);
  const ms = stamps.at(-1) - stamps[0];
  if (!(ms > 0)) return refuse(TIME_REFUSAL.NO_SPAN);

  // `gaps[i]` follows report i, so it is a gap between turns exactly when report i ended one.
  const ends = new Set(moveEnds);
  const between = gaps.filter((g, i) => ends.has(i) && g > 0);
  const typical = between.length ? median(between) : null;
  const pauses = typical === null ? [] : gaps
    .map((g, i) => ({ afterReport: i, ms: g }))
    .filter(({ ms: g }) => g > PAUSE_FACTOR * typical);

  const at = (i) => (i === null || i === undefined ? null : stamps[i]);
  const timedSplits = splits.map(({ from, to, start, end }) => {
    const a = at(start);
    const b = at(end);
    return Object.freeze({ from, to, ms: a === null || b === null || b < a ? null : b - a });
  });

  return Object.freeze({
    ms,
    refused: null,
    span: 'first-turn-to-last-turn',
    tps: !clean ? null : Object.freeze({ value: turnsTimed / (ms / 1000), metric: 'HTM', turns: turnsTimed }),
    splits: Object.freeze(timedSplits),
    pauses: Object.freeze(pauses.map((p) => Object.freeze(p))),
  });
}
