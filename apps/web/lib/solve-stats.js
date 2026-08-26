// Statistics over a session's solves.
//
// Everything here returns null rather than a number when there is not enough to compute one, and
// every caller is expected to render that null as "—". That is the whole design intent: this
// screen used to show a hardcoded 14.82 single, a 21.44 ao5 and a twenty-bar session chart built
// from a literal array, for a user who had never solved anything. **Placeholder data that looks
// real is worse than nothing**, and a statistics screen is where that costs the most — it is the
// one place a person goes specifically to find out what is true.
//
// Pure: no DOM, no storage, no globals.

/** A plain decimal number of seconds, as `pushSolve` writes it. Deliberately strict rather than
 *  `Number()`: coercion turns `true` into 1 second, `["12.5"]` into 12.5 and `"0x10"` into 16,
 *  so a hostile or corrupt localStorage could fabricate a personal best out of a boolean. */
const TIME_RE = /^\d+(\.\d+)?$/;

/** A finite, positive number of seconds, or null. Times are stored as strings. */
function secondsOf(solve) {
  const raw = solve?.time;
  if (typeof raw !== 'string' || !TIME_RE.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Smallest of a list, without spreading it into arguments — a hostile list long enough to exceed
 *  the engine's argument limit would otherwise throw RangeError rather than returning a figure. */
const smallest = (a) => a.reduce((lo, v) => (v < lo ? v : lo), Number.POSITIVE_INFINITY);
const largest = (a) => a.reduce((hi, v) => (v > hi ? v : hi), Number.NEGATIVE_INFINITY);

/** The session's times, most recent first, with unusable entries dropped. */
export function times(solves) {
  return (Array.isArray(solves) ? solves : []).map(secondsOf).filter((n) => n !== null);
}

/** Fastest single, or null. */
export function best(solves) {
  const t = times(solves);
  return t.length ? smallest(t) : null;
}

/**
 * A WCA average of `n`: over the most recent n solves, drop the fastest and slowest 5% (at least
 * one each end) and take the mean of the rest. Null unless there are at least n.
 *
 * Two things here are easy to get wrong, and both were:
 *
 * 1. **The trim is proportional, not one.** ao5 and ao12 drop one at each end, which makes "drop
 *    the best and the worst" look like the general rule. It is not: ao100 drops five at each end.
 *    Hardcoding one gave an ao100 of 13.31 where the correct answer was 10.00.
 * 2. **The window is chosen before the filtering, not after.** Dropping unusable rows first lets
 *    an older solve slide into the recent window and silently stand in for a missing one. If any
 *    of the latest n is unusable there is no honest ao-n, so the answer is null.
 */
export function averageOf(solves, n) {
  if (!Number.isInteger(n) || n < 3 || n > 10000) return null;
  const list = Array.isArray(solves) ? solves : [];
  if (list.length < n) return null;
  // Indexed, because `map`/`some` skip holes — a sparse array of the right length would report no
  // unusable entries while containing no entries at all.
  const window = [];
  for (let i = 0; i < n; i++) {
    const v = secondsOf(list[i]);
    if (v === null) return null;
    window.push(v);
  }
  const trim = Math.ceil(n / 20);
  const kept = [...window].sort((a, b) => a - b).slice(trim, n - trim);
  if (!kept.length) return null;
  const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
  return Number.isFinite(mean) ? mean : null;
}

/**
 * Solve counts for the last `days` days, oldest first, as `{ label, count, best }`.
 *
 * A solve with no timestamp is counted nowhere rather than counted today: solves recorded before
 * timestamps existed would otherwise pile onto whatever day the user first opened this screen and
 * invent a spike that never happened.
 */
export function byDay(solves, now, days = 7) {
  // Both arguments validated. `days: Infinity` used to spin forever, because decrementing Infinity
  // leaves it unchanged — a frozen tab from one bad argument.
  // Bounded at both ends, not merely positive. MAX_SAFE_INTEGER is a safe integer and a valid
  // argument by that test, and it produces an Invalid Date — seven buckets labelled `undefined`.
  if (!Number.isSafeInteger(now) || now < 1_000_000_000_000 || now > 100_000_000_000_000) return [];
  if (!Number.isSafeInteger(days) || days < 1 || days > 366) return [];

  // Local midnights derived by calendar arithmetic, not by subtracting a fixed 86 400 000 ms. A
  // day is 23 or 25 hours across a daylight-saving change, so fixed-width buckets slide off the
  // real days and file solves under the wrong bar twice a year.
  const midnights = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    midnights.push(d);
  }
  const end = new Date(midnights[midnights.length - 1]);
  end.setDate(end.getDate() + 1);
  const bounds = [...midnights.map((d) => d.getTime()), end.getTime()];

  const list = Array.isArray(solves) ? solves : [];
  return midnights.map((d, i) => {
    const from = bounds[i], to = bounds[i + 1];
    // Counted only if the row is usable as a SOLVE, not merely as a timestamp. Counting a row
    // whose time is unreadable made the daily bars disagree with the session count above them.
    // A future timestamp is excluded too: a solve cannot have happened after now.
    const t = list
      .filter((s) => Number.isSafeInteger(s?.at) && s.at >= from && s.at < to && s.at <= now)
      .map(secondsOf)
      .filter((v) => v !== null);
    return {
      label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()],
      count: t.length,
      best: t.length ? smallest(t) : null,
    };
  });
}

/** Everything the Stats screen needs. (Several passes over the list, not one — it is at most a
 *  few hundred records and clarity is worth more here than a fused loop.) */
export function summarize(solves, now) {
  const list = Array.isArray(solves) ? solves : [];
  return {
    count: times(list).length,
    best: best(list),
    ao5: averageOf(list, 5),
    ao12: averageOf(list, 12),
    ao100: averageOf(list, 100),
    week: byDay(list, now),
  };
}
