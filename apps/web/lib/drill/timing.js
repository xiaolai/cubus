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
// TPS is in the half-turn metric, counting only the turns the span holds — every one that ENDS after the
// first report — and names its metric, because "turns per second" in an unnamed metric is a different
// number in each. It is withheld from a rep that was not the algorithm alone (it left the algorithm, or
// took a turn back), whose span holds turns the algorithm does not.

/**
 * How many times a rep's median gap a gap must exceed to be marked as a pause. A plan decision
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
 * of the report that reached each boundary (null when none did).
 */
export function timeRep({ reports, htm, turnsTimed, streamBroken, clean, splits = [] }) {
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

  const typical = median(gaps);
  const pauses = gaps
    .map((g, i) => ({ afterReport: i, ms: g }))
    .filter(({ ms: g }) => typical > 0 && g > PAUSE_FACTOR * typical);

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
