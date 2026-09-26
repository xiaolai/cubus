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

import { FACES, type Face } from './types.js';

/** How one side of one session ended. */
export interface SideOutcome {
  /**
   * The slot it was filed under.
   *
   * A `Face`, and no longer nullable: a capture without a name belonged to the centre resolution,
   * removed 2026-09-23. A list of these is keyed BY this field — see `observationsOf` — so an
   * unnamed one would have been an observation of nothing.
   */
  face: Face;
  /**
   * Which kind of filing this was: a first reading, a re-shown side, or a confirming look.
   *
   * Carried so that `observationsOf` can be the ONE place that turns a log of filings into one
   * observation per face, without the replay having to throw away when a re-looked side was
   * actually settled — which is the number being measured.
   */
  kind: 'side' | 'reread' | 'confirm';
  /**
   * Milliseconds from the session's start to the capture, or null for a side never captured.
   *
   * Null is the CENSORED case and is the reason this type exists: a `number | null` forces every
   * reader to decide what a non-finisher means instead of quietly averaging over the finishers.
   */
  capturedAt: number | null;
}

/**
 * One identity question the scan raised, and what the person did with it
 * (`dev-docs/asking-which-side-plan.md` §5, §6).
 *
 * The question is the one interaction the scan has that is neither showing a side nor tapping a
 * sticker, so it is recorded in full rather than counted: WHICH colour was answered matters, and
 * whether that answer was right is a separate fact from whether one was given.
 */
export interface IdentityAnswer {
  /** Milliseconds from the session's start to the moment the question was raised. */
  askedAt: number;
  /** The colour both sides read as — what made this a question. */
  claimed: number;
  /** The colours offered when it was raised. */
  choices: number[];
  /**
   * The colour answered, `'skip'` for a question set aside, or null for one left standing.
   *
   * THREE OUTCOMES, NOT TWO. A question nobody answers is not a skip: the scan carries on either
   * way, but one is a person deciding and the other is a person not looking, and an intervention
   * count that merged them would measure the wrong thing.
   */
  answered: number | 'skip' | null;
  /**
   * Did that answer name the side actually in hand? Null when none was given, or when the truth
   * cannot say — a capture that matches no side of the cube well enough to be told apart.
   *
   * DECIDED AGAINST THE SESSION'S TRUTH, never against the scan's own reading: the scan is the
   * thing being measured, and a corpus labelled by it measures nothing (`session-record.ts`).
   *
   * AND IT IS A TAUTOLOGY FOR THE BUILT-IN POLICIES — said here rather than left for a number to be
   * read for more than it is (round-3 audit, 2026-09-25). `namesTheSideInHand` DERIVES its answer
   * from `sideShownIn` and this re-asks `sideShownIn`, so that policy scores `true` whenever it
   * answered, by construction, and `namesTheWrongSide` scores `false` by construction. What the
   * pair actually measure is THE SCAN's behaviour under a right and a wrong answer, which is what
   * §6 asks of them; they do not measure whether the oracle is right about the cube. Only a policy
   * deciding on something else — a person, a recorded annotation — makes this an independent check,
   * and the corpus carries no per-frame record of which side was being held, so nothing here can do
   * better yet. `dev-docs/asking-which-side-plan.md` §6 states that confound.
   */
  right: boolean | null;
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
   * Milliseconds from the session's start to the cube being reported, or null for a scan that did
   * not finish — RIGHT-CENSORED at the deadline, like a side that was never captured.
   *
   * TIME-TO-SIDE IS NOT TIME-TO-COMPLETION (§6, item 2), and the harness had only the first: the
   * timestamps belonged to individual filings, and a scan that filed five sides quickly and never
   * obtained the sixth looked fast by every number the run produced. Completion is the deciding
   * output; this is the one place it has a time.
   */
  completedAt: number | null;
  /**
   * What the scan reported, or null if it never reported. Compared with the session's truth to
   * decide `wrong`; kept so a disagreement can be looked at rather than merely counted.
   */
  reported: string | null;
  /** The cube as it physically was — the session's independently entered truth. */
  truth: string;
  /**
   * Every side the scan filed, in the order it filed them — FEWER than six when it did not finish,
   * and MORE than six entries when a side was looked at again.
   *
   * It is a log of filings, not a set of sides, and treating it as the latter is what the
   * normalisation in `observationsOf` exists for: five faces plus one reread used to score as six
   * captured sides with nothing censored, so a scan that never obtained its sixth side reported a
   * complete set and a reachable p90.
   */
  sides: SideOutcome[];
  /** How many times the scan asked for another look (a confirm, or a side again). */
  looksAsked: number;
  /**
   * Every identity question raised, in order, with what was done about it.
   *
   * `looksAsked` COUNTS ASKS, NOT INTERVENTIONS (§6, item 3), and that was the whole of what the
   * harness could say about what a person had to do. It cannot see compliance (an ask answered
   * against an ask ignored), a mistaken answer, or a recovery. This can, for the one interaction
   * whose whole content is a person's decision.
   */
  identity: IdentityAnswer[];
  /**
   * Every span the replay spent inside the panel on one tick, in milliseconds.
   *
   * The scan's own work per frame, which on a real page is work the main thread cannot spend
   * drawing. The audit's `A3` — a centre resolution that blocked for 606 ms, since removed — is
   * the kind of measurement this exists to catch, and it is a MAXIMUM question, not a mean one,
   * which is why the spans are kept rather than summarised here.
   */
  blockingMs: number[];
  /**
   * Whether this run could answer a question about pixels at all.
   *
   * Reported rather than assumed: a replay is given a pixel resolver or it is not, and a session's
   * frames carry pixel references or they do not. The header claims the WHOLE pipeline was run, and
   * without this that claim quietly covered every pixel-dependent path never executing.
   */
  pixelsAvailable: boolean;
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
  // A NaN TIME HANGS THIS FUNCTION FOR EVER, and it did: the inner loop advances while the next
  // time EQUALS the current one, and nothing equals NaN — so `i` never moves, the outer loop never
  // ends, and a corpus run with one bad timestamp simply never returns. Reproduced in a subprocess
  // that had to be killed. A negative time is the same class of nonsense one step milder: these are
  // elapsed milliseconds from the session's start.
  for (const o of observations) {
    if (!Number.isFinite(o.time) || o.time < 0) {
      throw new RangeError(
        `an observation time of ${o.time} is not an elapsed number of milliseconds`,
      );
    }
  }
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
 * Null is the honest answer and the whole reason this is not a sort-and-index: where the estimated
 * survival never falls to 1 − q, the quantile does not exist in the record and any number returned
 * for it would be invented. A gate written on this must therefore handle null — "the p90 could not
 * be reached" is a result, and on today's stuck session it is THE result.
 *
 * WHICH IS NOT THE SAME AS "a tenth of the sides were never captured", and the difference is not
 * pedantic: the censoring times need not be equal, and a side censored EARLY leaves the risk set
 * before the later captures, so each of those removes a larger share of what remains. A curve can
 * therefore reach 1 − q with well under q of the sides ever captured. The curve decides.
 */
export function censoredQuantile(
  observations: readonly { time: number; captured: boolean }[],
  q: number,
): number | null {
  return quantileFrom(survivalCurve(observations), q);
}

/**
 * How far a survival probability may sit above its threshold and still count as having reached it.
 *
 * NOT DECORATION — WITHOUT IT THE ANSWER IS WRONG (2026-09-25). Survival is a running product, so
 * ten sides captured at 1…10 ms leave it holding 0.10000000000000002 after the ninth while `1 - 0.9`
 * evaluates to 0.09999999999999998: the p90 skipped its own answer and reported 10, and with nine
 * captures and one later censor it reported `null` — "the corpus cannot reach a p90" — for a corpus
 * that reaches it comfortably. A gate is written on these numbers.
 *
 * 1e-9 is justified from both sides: the product accumulates at most a few ulps per step, so ~1e-13
 * over any corpus this will ever see, and the smallest real gap between two survival levels is
 * 1/n — 1e-4 even at ten thousand observations. Every value in between separates error from signal.
 */
const SURVIVAL_TOLERANCE = 1e-9;

/** The quantile of an already-computed curve — so a scorer needing two does not build it twice. */
export function quantileFrom(
  curve: readonly { time: number; survival: number }[],
  q: number,
): number | null {
  if (!(q > 0 && q < 1)) throw new RangeError(`quantile ${q} must lie strictly between 0 and 1`);
  for (const step of curve) {
    // Survival is P(T > t); the q-quantile is the first t where it has fallen to 1 − q or below.
    if (step.survival <= 1 - q + SURVIVAL_TOLERANCE) return step.time;
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
  // CHECKED, BECAUSE THE WRONG ANSWERS LOOK RIGHT. `wrongCubeRateBound(-1, 60)` returned about
  // −0.0167 — a negative probability, reported as a rate a gate could be written on — and an
  // `alpha` outside (0,1) produced numbers just as plausible. A statistic that cannot be computed
  // is a refusal here, not a number.
  if (
    !Number.isSafeInteger(wrong) ||
    !Number.isSafeInteger(sessions) ||
    wrong < 0 ||
    sessions < 0
  ) {
    throw new RangeError(
      `${wrong} of ${sessions} is not a whole number of failures out of a whole number of trials`,
    );
  }
  if (wrong > sessions) {
    throw new RangeError(
      `${wrong} failures out of ${sessions} trials is more failures than trials`,
    );
  }
  if (!(Number.isFinite(alpha) && alpha > 0 && alpha < 1)) {
    throw new RangeError(`a confidence level of ${alpha} is not strictly between 0 and 1`);
  }
  // NO TRIALS BOUNDS NOTHING, and that is a policy rather than an accident: a bound of 1 says the
  // corpus permits any rate at all, which is exactly true of a corpus with nothing in it.
  if (sessions === 0) return 1;
  if (wrong >= sessions) return 1;
  if (wrong === 0) return 1 - alpha ** (1 / sessions);
  // P(X <= wrong | p, n), the exact binomial tail. The bound is the p where it equals alpha.
  //
  // The coefficients are computed ONCE, by the recurrence C(n,k) = C(n,k-1)·(n-k+1)/k in logs:
  // recomputing them inside the tail made each evaluation O(wrong²) and the bisection repeated that
  // work for a fixed 200 rounds, long after the bracket had stopped moving.
  const logC: number[] = [0];
  for (let k = 1; k <= wrong; k++)
    logC.push(logC[k - 1]! + Math.log(sessions - k + 1) - Math.log(k));
  const tail = (p: number): number => {
    let sum = 0;
    for (let k = 0; k <= wrong; k++) {
      sum += Math.exp(logC[k]! + k * Math.log(p) + (sessions - k) * Math.log1p(-p));
    }
    return sum;
  };
  let lo = wrong / sessions;
  let hi = 1;
  // Bisection to the limit of the representation: 100 halvings takes any bracket below 1e-30, and
  // the loop leaves as soon as the two ends are adjacent doubles, which is sooner.
  for (let i = 0; i < 100 && hi - lo > Number.EPSILON * Math.max(1, hi); i++) {
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
  /**
   * SESSIONS that reported a cube that is not the cube — out of `sessions`.
   *
   * It was called `wrongCubes` and counted sessions, beside a local of the same name that counted
   * cubes, beside a bound taken over cubes. Two sittings of one cube going wrong read as "2 wrong
   * cubes" next to a bound computed from one. The names now say which denominator each belongs to.
   */
  wrongSessions: number;
  /** Distinct CUBES that went wrong — out of `cubes`, and the numerator the bound below uses. */
  distinctWrongCubes: number;
  /**
   * WHICH cubes went wrong, sorted.
   *
   * Identities, not a count, because "zero NEW wrong cubes" is not a statement about a total:
   * repairing cube A while newly breaking cube B leaves the count where it was, and a gate reading
   * only the count passes a change that broke a cube it used to read correctly.
   */
  wrongCubeNames: string[];
  /**
   * WHICH sessions reported the wrong cube, sorted.
   *
   * Beside the cube names because they answer different questions, and the cube names alone miss
   * one: two sittings of ONE cube, where the fix repairs the first and breaks the second, leave
   * `wrongCubeNames` exactly as it was. That is a cube the scanner now reads wrong in a sitting it
   * used to read right, and a gate reading only the cube set passes it.
   */
  wrongSessionIds: string[];
  /** The 95% upper bound on the wrong-cube rate over independent cubes. Never zero. */
  wrongCubeRateUpperBound: number;
  /**
   * Median time-to-side, censored — null when the estimated survival never falls to 0.5.
   *
   * Not "when fewer than half the sides were captured", which was the old wording and is false
   * whenever the censoring times differ: a side censored EARLY leaves the risk set before the later
   * captures, so each of those removes a larger share of what remains and the curve can cross 0.5
   * with well under half the sides ever captured. The curve decides, not the raw fraction.
   */
  timeToSideMedianMs: number | null;
  /** p90 time-to-side, censored. Null when the corpus cannot reach it — a result, not a gap. */
  timeToSideP90Ms: number | null;
  /** Sides captured, and sides that were never captured before the deadline. */
  sidesCaptured: number;
  sidesCensored: number;
  looksAsked: number;
  /**
   * Median and p90 time from a session's start to the cube being reported, CENSORED.
   *
   * A scan that did not finish contributes what it knows — that it took longer than its deadline —
   * exactly as an uncaptured side does, so the same estimator is used and null is the same honest
   * answer: the corpus cannot reach that quantile. Reported beside `completionRate`, because the
   * two are different questions and the old harness could answer neither.
   */
  timeToCompleteMedianMs: number | null;
  timeToCompleteP90Ms: number | null;
  /** What the people in these sessions actually had to DO — see `Interventions`. */
  interventions: Interventions;
  /** The worst single tick anywhere in the run, and the p99 over every tick. */
  blockingMaxMs: number | null;
  blockingP99Ms: number | null;
}

/**
 * What a scan cost the person beyond showing six sides once (§6, item 3).
 *
 * `looksAsked` was the only number here and it counts ASKS. An ask nobody answered and an ask
 * answered twice are the same number; a mistaken answer is invisible; a side shown again to recover
 * from one is invisible. These are the acts, counted separately, because a change that halves the
 * asks by making each one harder to get right is not an improvement and the old number would have
 * called it one.
 */
export interface Interventions {
  /** Confirm requests raised — a transition into a confirm, not a compliance. */
  looksAsked: number;
  /** Confirming looks actually given: a filing of kind `'confirm'`. */
  looksGiven: number;
  /** Identity questions raised. */
  identityAsked: number;
  /** Identity questions answered with a colour. */
  identityAnswered: number;
  /** Of those, the ones that named a side that is not the side in hand. */
  identityWrong: number;
  /** Identity questions the person set aside. */
  identitySkipped: number;
  /** Identity questions left standing — nobody decided either way. */
  identityIgnored: number;
  /** Sides shown again over a reading already filed: a filing of kind `'reread'`. */
  rereads: number;
  /**
   * Every act above that a PERSON performed, in one number — the "intervention cost" §6 names.
   *
   * Asks are not in it. An ask is what the scan did; the cost is what the person had to do about
   * it, and a scan that asks a hundred questions nobody answers cost nobody anything but time,
   * which `timeToComplete*` measures separately.
   */
  acts: number;
}

/** Add up the acts across a set of replayed sessions. */
export function countInterventions(outcomes: readonly SessionOutcome[]): Interventions {
  const out: Interventions = {
    looksAsked: 0,
    looksGiven: 0,
    identityAsked: 0,
    identityAnswered: 0,
    identityWrong: 0,
    identitySkipped: 0,
    identityIgnored: 0,
    rereads: 0,
    acts: 0,
  };
  for (const o of outcomes) {
    out.looksAsked += o.looksAsked;
    out.looksGiven += o.sides.filter((s) => s.kind === 'confirm').length;
    out.rereads += o.sides.filter((s) => s.kind === 'reread').length;
    for (const ask of o.identity) {
      out.identityAsked += 1;
      if (ask.answered === null) out.identityIgnored += 1;
      else if (ask.answered === 'skip') out.identitySkipped += 1;
      else {
        out.identityAnswered += 1;
        // `right === null` is "the truth could not say", which is not evidence of a wrong answer.
        if (ask.right === false) out.identityWrong += 1;
      }
    }
  }
  out.acts = out.looksGiven + out.identityAnswered + out.identitySkipped + out.rereads;
  return out;
}

/**
 * THE GATE (§6): no configuration may report a cube that is not the cube.
 *
 * Stated on its own, and not as "no NEW wrong cubes", because those are different promises. A
 * regression check asks whether a change made things worse; this asks whether the scanner kept the
 * one promise it makes at all, and a corpus that has always misread one cube fails it every time
 * until that cube is read right or the reason is understood. Both are used: `passesStageGate`
 * requires this as well as an improvement.
 */
export function reportsOnlyTheCube(metrics: CorpusMetrics): { ok: boolean; reasons: string[] } {
  if (metrics.wrongSessions === 0) return { ok: true, reasons: [] };
  return {
    ok: false,
    reasons: [
      `${metrics.wrongSessions} session(s) reported a cube that is not the cube: ${metrics.wrongSessionIds.join(', ')}`,
    ],
  };
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
  // ONE TOTAL, NOT TWO. `countInterventions` already adds the asks up, and this scorer calls it —
  // so a second loop here was a second implementation of the same number, free to drift from the
  // one every gate reads (Codex audit, 2026-09-25).
  const interventions = countInterventions(outcomes);
  for (const o of outcomes) {
    observations.push(...observationsOf(o));
    // A loop, not `push(...spans)`, for `largest`'s reason and found the same way: the spread is an
    // argument list, and one session of a long corpus run already carries more spans than an
    // engine will accept. The test that pinned `largest` failed HERE first.
    for (const span of o.blockingMs) blocking.push(span);
  }
  const cubes = new Set(outcomes.map((o) => o.cube)).size;
  const wrong = outcomes.filter(isWrongCube);
  // THE BOUND'S NUMERATOR AND DENOMINATOR MUST COUNT THE SAME THING. The bound is taken over
  // independent CUBES — sittings of one cube are not independent — so a cube that failed twice is
  // one failing cube, not two. Counting wrong SESSIONS against distinct cubes can make the
  // numerator exceed the denominator, which collapses the bound to 1 and reports "we can say
  // nothing" about a corpus that says plenty.
  const wrongCubeNames = [...new Set(wrong.map((o) => o.cube))].sort();
  const wrongSessionIds = wrong.map((o) => o.sessionId).sort();
  const completed = outcomes.filter((o) => o.completed).length;
  // ONE CURVE, TWO QUESTIONS. It was built twice, from the same observations, for the median and
  // the p90 — the same O(n log n) sort and pass, and two places a change could be made to one of.
  const curve = survivalCurve(observations);
  // COMPLETION IS CENSORED EXACTLY AS A SIDE IS. A scan that did not finish is not dropped and is
  // not counted AS its deadline: it is known to have taken longer, and nothing more.
  const finishes = outcomes.map((o) =>
    o.completedAt === null
      ? { time: o.deadlineMs, captured: false }
      : { time: o.completedAt, captured: true },
  );
  const finishCurve = survivalCurve(finishes);
  return {
    sessions: outcomes.length,
    cubes,
    completed,
    completionRate: outcomes.length === 0 ? 0 : completed / outcomes.length,
    wrongSessions: wrong.length,
    distinctWrongCubes: wrongCubeNames.length,
    wrongCubeNames,
    wrongSessionIds,
    wrongCubeRateUpperBound: wrongCubeRateBound(wrongCubeNames.length, cubes),
    timeToSideMedianMs: quantileFrom(curve, 0.5),
    timeToSideP90Ms: quantileFrom(curve, 0.9),
    sidesCaptured: observations.filter((x) => x.captured).length,
    sidesCensored: observations.filter((x) => !x.captured).length,
    looksAsked: interventions.looksAsked,
    timeToCompleteMedianMs: quantileFrom(finishCurve, 0.5),
    timeToCompleteP90Ms: quantileFrom(finishCurve, 0.9),
    interventions,
    blockingMaxMs: largest(blocking),
    blockingP99Ms: quantile(blocking, 0.99),
  };
}

/**
 * One session as exactly SIX observations — one per face, captured or censored.
 *
 * A SCAN HAS SIX SIDES, AND `sides` IS A LOG OF FILINGS. The replay appends an entry for every
 * `scan-capture`, and a confirm or a re-shown side is one: five faces plus one reread scored as six
 * captured sides with nothing censored, so a scan that never obtained its sixth side reported a
 * complete set and a reachable p90 — the exact shape of failure this whole harness exists to make
 * visible. Keying on the face is what makes an extra look an extra look rather than a side.
 *
 * THE LAST ACCEPTED CAPTURE IS THE ONE THAT COUNTS. A side looked at again was not settled by the
 * first reading — that reading is precisely what the second look replaced — so time-to-side is when
 * the scan arrived at the answer it kept, not when it first wrote something down.
 *
 * A face never filed is CENSORED at the deadline, never dropped and never counted as the deadline:
 * dropping it scores a scan that captured one side and stalled as a fast scan, and the old code
 * reached the same conclusion twice, in two places, once for a face filed with no time and once for
 * a face missing from the list.
 */
export function observationsOf(outcome: SessionOutcome): { time: number; captured: boolean }[] {
  const at = new Map<Face, number>();
  for (const side of outcome.sides) {
    if (side.capturedAt !== null) at.set(side.face, side.capturedAt);
  }
  return FACES.map((face) => {
    const time = at.get(face);
    return time === undefined
      ? { time: outcome.deadlineMs, captured: false }
      : { time, captured: true };
  });
}

/**
 * Cubes that go wrong in `after` and did not in `before` — the whole of "zero NEW wrong cubes".
 *
 * A COUNT CANNOT ANSWER THIS, and it was the count that was being asked. Repairing cube A while
 * newly misreading cube B leaves `distinctWrongCubes` exactly where it was, so a change that broke
 * a cube the scanner used to read correctly passed a gate whose stated purpose was to catch it.
 * The identities are kept for this one question.
 */
export function newlyWrongCubes(before: CorpusMetrics, after: CorpusMetrics): string[] {
  const known = new Set(before.wrongCubeNames);
  return after.wrongCubeNames.filter((c) => !known.has(c));
}

/**
 * Sessions that report the wrong cube in `after` and did not in `before`.
 *
 * THE CASE THE CUBE NAMES MISS. Two sittings of one cube, the fix repairing the first and breaking
 * the second, leaves the cube set untouched — and a gate reading only that set waves through a
 * sitting the scanner used to read correctly. Both questions are asked because both are "did this
 * change break something that worked", at the two units the corpus has.
 */
export function newlyWrongSessions(before: CorpusMetrics, after: CorpusMetrics): string[] {
  const known = new Set(before.wrongSessionIds);
  return after.wrongSessionIds.filter((id) => !known.has(id));
}

/**
 * Whether `after` is no WORSE than `before` — a regression check, and only that.
 *
 * Useful on its own (a refactor is expected to move nothing), and deliberately separate from
 * `passesStageGate`: identical metrics pass here and must NOT pass there, which was the confusion
 * — a function documented as "completion up, p90 down" that accepted completion unchanged and a
 * p90 unchanged, including two empty corpora and two runs that both failed to reach a p90 at all.
 */
export function noRegression(
  before: CorpusMetrics,
  after: CorpusMetrics,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (after.completionRate < before.completionRate) {
    reasons.push(
      `completion fell from ${(before.completionRate * 100).toFixed(1)}% to ${(after.completionRate * 100).toFixed(1)}%`,
    );
  }
  const fresh = newlyWrongCubes(before, after);
  if (fresh.length > 0) {
    reasons.push(`cubes newly read wrong: ${fresh.join(', ')}`);
  }
  // AND at the session unit, which the cube set cannot see: see `newlyWrongSessions`. Reported only
  // where no cube is newly wrong, so one change does not produce two lines about the same failure.
  const freshSessions = newlyWrongSessions(before, after);
  if (fresh.length === 0 && freshSessions.length > 0) {
    reasons.push(`sessions newly read wrong: ${freshSessions.join(', ')}`);
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

/**
 * Whether `after` may be ACCEPTED as a Stage 2 improvement over `before` — the gate §4 states.
 *
 * Stated as a function because a gate that lives in prose is a gate each change re-interprets. The
 * three conditions are the plan's and every one of them is a STRICT improvement or a strict
 * absence: completion up, censored p90 time-to-side down, and zero NEW wrong cubes. It also
 * requires evidence — two empty corpora satisfy "nothing got worse" perfectly and say nothing at
 * all, and so do two runs neither of which reached a p90.
 *
 * A p90 that could not be reached before and can now is an improvement; one that could be reached
 * before and cannot now is a regression — null is not a free pass in either direction.
 */
export function passesStageGate(
  before: CorpusMetrics,
  after: CorpusMetrics,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [...noRegression(before, after).reasons];
  // THE GATE FIRST (§6). "No NEW wrong cubes" is a regression check and `noRegression` above is
  // where it belongs; this is the promise itself, and a configuration that breaks it is not a
  // candidate however much else it improved.
  reasons.push(...reportsOnlyTheCube(after).reasons);
  // USABLE EVIDENCE FIRST. Without this the gate is satisfied by a corpus that measured nothing.
  if (after.sessions === 0 || before.sessions === 0) {
    reasons.push('a stage cannot be accepted on a corpus with no sessions in it');
  }
  if (after.completionRate <= before.completionRate) {
    reasons.push(
      `completion did not rise: ${(before.completionRate * 100).toFixed(1)}% to ${(after.completionRate * 100).toFixed(1)}%`,
    );
  }
  const b = before.timeToSideP90Ms;
  const a = after.timeToSideP90Ms;
  if (a === null) {
    reasons.push(
      'the p90 time-to-side is still out of reach, so it cannot be shown to have fallen',
    );
  } else if (b !== null && a >= b) {
    reasons.push(`p90 time-to-side did not fall: ${b} ms to ${a} ms`);
  }
  return { ok: reasons.length === 0, reasons };
}
