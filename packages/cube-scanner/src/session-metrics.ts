/**
 * What a replayed session is SCORED on — the five measurements the audit's Stage 0 names, computed
 * from an outcome record and nothing else.
 *
 * Pure, and kept apart from the harness that produces the outcomes, because the arithmetic here is
 * the part that must not drift: every later stage is gated on these numbers
 * (`dev-docs/scan-pipeline-audit-2026-09-23.md` §4), so a change to how a quantile is taken would
 * silently move every gate at once. Driving a panel to test a quantile is also absurd.
 *
 * TWO THINGS THIS REFUSES TO DO, both of them the repository's standing rule that a statistic which
 * cannot be computed is a dash and not a number:
 *
 *   - **A non-finisher is not dropped, and not counted as its deadline.** Dropping it reports the
 *     time of the sessions that happened to work, which is the number that made every previous fix
 *     look fine. Counting it AS the deadline invents a completion that never happened. It is
 *     right-CENSORED: known to exceed the deadline, unknown by how much, and the estimator below
 *     says so — including by answering `null` for a quantile the data cannot reach.
 *   - **Zero wrong cubes is not "zero".** A finite corpus bounds a rate; it does not prove it
 *     absent. `wrongCubeRateBound` reports the bound the corpus actually supports.
 */

/** How one side of one session ended. */
export interface SideOutcome {
  /** The slot it was filed under, or null for a side filed without a name. */
  face: string | null;
  /**
   * Milliseconds from the session's start to the capture, or null for a side never captured.
   *
   * Null is the CENSORED case and is the reason this type exists: a `number | null` forces every
   * reader to decide what a non-finisher means instead of quietly averaging over the finishers.
   */
  capturedAt: number | null;
}

/** How one replayed session ended. */
export interface SessionOutcome {
  sessionId: string;
  cube: string;
  /** The deadline the replay ran to, in milliseconds. Censoring time for every uncaptured side. */
  deadlineMs: number;
  /** Did the scan finish — six sides accepted and a cube reported — within the deadline? */
  completed: boolean;
  /**
   * What the scan reported, or null if it never reported. Compared with the session's truth to
   * decide `wrong`; kept so a disagreement can be looked at rather than merely counted.
   */
  reported: string | null;
  /** The cube as it physically was — the session's independently entered truth. */
  truth: string;
  /** The six sides, in the order the scan filed them. Fewer than six when it did not finish. */
  sides: SideOutcome[];
  /** How many times the scan asked for another look (a confirm, or a side again). */
  looksAsked: number;
  /**
   * Every span the replay spent inside the panel on one tick, in milliseconds.
   *
   * The scan's own work per frame, which on a real page is work the main thread cannot spend
   * drawing. The audit's `A3` — a centre resolution that blocked for 606 ms, since removed — is
   * the kind of measurement this exists to catch, and it is a MAXIMUM question, not a mean one,
   * which is why the spans are kept rather than summarised here.
   */
  blockingMs: number[];
}

/**
 * A scan that reported a cube that is not the cube.
 *
 * The one thing the scanner promises never to do, so it is a named predicate rather than an
 * inline comparison: a scan that never reported is NOT wrong, it is incomplete, and conflating the
 * two would let a change that refuses everything score as a change that fixed everything.
 */
export function isWrongCube(outcome: SessionOutcome): boolean {
  return outcome.reported !== null && outcome.reported !== outcome.truth;
}

/**
 * The Kaplan–Meier estimate of P(time-to-side > t), as a step function.
 *
 * Right-censored data is not a list of numbers with holes in it. A side still uncaptured at the
 * deadline contributes what it knows — that it took LONGER than the deadline — and nothing more,
 * and the product-limit estimator is the standard way to use exactly that much. Doing the obvious
 * thing instead (drop the censored, or set them to the deadline) biases the answer in two
 * directions at once, and the first of those is how a stuck scan disappears from a mean.
 *
 * Returns the distinct capture times ascending, each with the survival probability AFTER it.
 */
export function survivalCurve(
  observations: readonly { time: number; captured: boolean }[],
): { time: number; survival: number }[] {
  const sorted = [...observations].sort(
    (a, b) => a.time - b.time || Number(a.captured) - Number(b.captured),
  );
  const out: { time: number; survival: number }[] = [];
  let survival = 1;
  let atRisk = sorted.length;
  let i = 0;
  while (i < sorted.length) {
    const time = sorted[i]!.time;
    let events = 0;
    let leaving = 0;
    while (i < sorted.length && sorted[i]!.time === time) {
      if (sorted[i]!.captured) events += 1;
      leaving += 1;
      i += 1;
    }
    if (events > 0 && atRisk > 0) {
      survival *= 1 - events / atRisk;
      out.push({ time, survival });
    }
    atRisk -= leaving;
  }
  return out;
}

/**
 * The time by which a `q` fraction of sides are captured, or **null** when the data cannot reach it.
 *
 * Null is the honest answer and the whole reason this is not a sort-and-index: with a third of
 * sides never captured, a p90 does not exist in the record, and any number returned for it would be
 * invented. A gate written on this must therefore handle null — "the p90 could not be reached" is a
 * result, and on today's stuck session it is THE result.
 */
export function censoredQuantile(
  observations: readonly { time: number; captured: boolean }[],
  q: number,
): number | null {
  if (!(q > 0 && q < 1)) throw new RangeError(`quantile ${q} must lie strictly between 0 and 1`);
  for (const step of survivalCurve(observations)) {
    // Survival is P(T > t); the q-quantile is the first t where it has fallen to 1 − q or below.
    if (step.survival <= 1 - q) return step.time;
  }
  return null;
}

/**
 * The one-sided 95% upper bound on the wrong-cube rate, given `wrong` of `sessions`.
 *
 * With no errors this is the Clopper–Pearson bound 1 − α^(1/n), which the audit quotes: sixty clean
 * independent sessions still allow a true rate just under 4.9%. It is reported ALONGSIDE the count
 * because "zero wrong cubes" invites the reading that the rate is zero, and a corpus cannot say
 * that. With errors present the bound is found by bisection on the same exact binomial tail.
 *
 * Sessions of the same cube are not independent, so a corpus that holds several sittings of one
 * cube reports a bound that is optimistic; pass the number of independent GROUPS to be honest.
 */
export function wrongCubeRateBound(wrong: number, sessions: number, alpha = 0.05): number {
  if (sessions <= 0) return 1;
  if (wrong >= sessions) return 1;
  if (wrong === 0) return 1 - alpha ** (1 / sessions);
  // P(X <= wrong | p, n), the exact binomial tail. The bound is the p where it equals alpha.
  const tail = (p: number): number => {
    let sum = 0;
    for (let k = 0; k <= wrong; k++) {
      let logC = 0;
      for (let j = 1; j <= k; j++) logC += Math.log(sessions - k + j) - Math.log(j);
      sum += Math.exp(logC + k * Math.log(p) + (sessions - k) * Math.log1p(-p));
    }
    return sum;
  };
  let lo = wrong / sessions;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tail(mid) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The plain quantile of a complete sample — no censoring involved. Used for blocking spans.
 *
 * NEAREST-RANK, `ceil(q·n) - 1`, and deliberately not the `floor(q·n)` the scan trace uses: at
 * q = 0.99 over exactly 100 samples, floor lands on index 99 and reports the MAXIMUM as the p99,
 * which is the one value a p99 exists to exclude. The trace's copy is diagnostics a person reads;
 * this one is a number a gate is written on, so it is worth the divergence.
 */
function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(q * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]!;
}

/**
 * The largest of `values`, or null when there are none.
 *
 * A fold rather than `Math.max(...values)`: the spread passes every element as an ARGUMENT, and a
 * corpus run collects one blocking span per tick per session — tens of thousands — which is past
 * the engine's argument limit and throws a `RangeError`. A measurement that dies on a big corpus
 * is a measurement that works only where it is not needed.
 */
function largest(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let most = Number.NEGATIVE_INFINITY;
  for (const v of values) if (v > most) most = v;
  return most;
}

/** What a corpus run reports. Every field is a number a gate in §4 is written on. */
export interface CorpusMetrics {
  sessions: number;
  /** Distinct cubes — the independent unit, and what `wrongCubeRateBound` is honestly taken over. */
  cubes: number;
  completed: number;
  completionRate: number;
  wrongCubes: number;
  /** The 95% upper bound on the wrong-cube rate over independent cubes. Never zero. */
  wrongCubeRateUpperBound: number;
  /** Median time-to-side, censored. Null when fewer than half the sides were ever captured. */
  timeToSideMedianMs: number | null;
  /** p90 time-to-side, censored. Null when the corpus cannot reach it — a result, not a gap. */
  timeToSideP90Ms: number | null;
  /** Sides captured, and sides that were never captured before the deadline. */
  sidesCaptured: number;
  sidesCensored: number;
  looksAsked: number;
  /** The worst single tick anywhere in the run, and the p99 over every tick. */
  blockingMaxMs: number | null;
  blockingP99Ms: number | null;
}

/**
 * Score a set of replayed sessions.
 *
 * Every side of every session contributes one observation, captured or censored at the deadline —
 * including the sides of a session that never finished, which is the case the old measurements had
 * no way to represent at all (T2: 146 complete and 177 near-complete reads of one side producing
 * nothing appeared nowhere in any number the project had).
 */
export function scoreSessions(outcomes: readonly SessionOutcome[]): CorpusMetrics {
  const observations: { time: number; captured: boolean }[] = [];
  const blocking: number[] = [];
  let looks = 0;
  let captured = 0;
  let censored = 0;
  for (const o of outcomes) {
    for (const side of o.sides) {
      if (side.capturedAt === null) {
        observations.push({ time: o.deadlineMs, captured: false });
        censored += 1;
      } else {
        observations.push({ time: side.capturedAt, captured: true });
        captured += 1;
      }
    }
    // A session that filed fewer than six sides has sides that were never even attempted as far as
    // the record goes. They are censored at the deadline too — leaving them out would score a scan
    // that captured one side and stalled as a fast scan.
    for (let i = o.sides.length; i < 6; i++) {
      observations.push({ time: o.deadlineMs, captured: false });
      censored += 1;
    }
    looks += o.looksAsked;
    // A loop, not `push(...spans)`, for `largest`'s reason and found the same way: the spread is an
    // argument list, and one session of a long corpus run already carries more spans than an
    // engine will accept. The test that pinned `largest` failed HERE first.
    for (const span of o.blockingMs) blocking.push(span);
  }
  const cubes = new Set(outcomes.map((o) => o.cube)).size;
  const wrong = outcomes.filter(isWrongCube).length;
  // THE BOUND'S NUMERATOR AND DENOMINATOR MUST COUNT THE SAME THING. The bound is taken over
  // independent CUBES — sittings of one cube are not independent — so a cube that failed twice is
  // one failing cube, not two. Counting wrong SESSIONS against distinct cubes can make the
  // numerator exceed the denominator, which collapses the bound to 1 and reports "we can say
  // nothing" about a corpus that says plenty.
  const wrongCubes = new Set(outcomes.filter(isWrongCube).map((o) => o.cube)).size;
  const completed = outcomes.filter((o) => o.completed).length;
  return {
    sessions: outcomes.length,
    cubes,
    completed,
    completionRate: outcomes.length === 0 ? 0 : completed / outcomes.length,
    wrongCubes: wrong,
    wrongCubeRateUpperBound: wrongCubeRateBound(wrongCubes, cubes),
    timeToSideMedianMs: censoredQuantile(observations, 0.5),
    timeToSideP90Ms: censoredQuantile(observations, 0.9),
    sidesCaptured: captured,
    sidesCensored: censored,
    looksAsked: looks,
    blockingMaxMs: largest(blocking),
    blockingP99Ms: quantile(blocking, 0.99),
  };
}

/**
 * Whether `after` is allowed to replace `before` — the gate §4 Stage 2 states, written once.
 *
 * Stated as a function because a gate that lives in prose is a gate each change re-interprets. The
 * three conditions are the plan's: completion up, censored p90 time-to-side down, and zero NEW
 * wrong cubes. A p90 that could not be reached before and can now is an improvement; one that could
 * be reached before and cannot now is a regression — null is not a free pass in either direction.
 */
export function passesStageGate(
  before: CorpusMetrics,
  after: CorpusMetrics,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (after.completionRate < before.completionRate) {
    reasons.push(
      `completion fell from ${(before.completionRate * 100).toFixed(1)}% to ${(after.completionRate * 100).toFixed(1)}%`,
    );
  }
  if (after.wrongCubes > before.wrongCubes) {
    reasons.push(`wrong cubes rose from ${before.wrongCubes} to ${after.wrongCubes}`);
  }
  const b = before.timeToSideP90Ms;
  const a = after.timeToSideP90Ms;
  if (b !== null && a === null) {
    reasons.push('the p90 time-to-side was reachable before and is not now');
  } else if (b !== null && a !== null && a > b) {
    reasons.push(`p90 time-to-side rose from ${b} ms to ${a} ms`);
  }
  return { ok: reasons.length === 0, reasons };
}
