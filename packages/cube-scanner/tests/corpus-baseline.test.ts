// @vitest-environment happy-dom
//
// THE BASELINE (`dev-docs/scan-pipeline-audit-2026-09-23.md` §4, Stage 0.4): the pipeline as it
// stands, measured end to end over the corpus as it stands, through the real panel.
//
// This is the number every later stage is compared against, and it is the first one this project
// has ever had. §1.1's six fixes were each judged on unit tests and on this same clip read by eye;
// what changes here is that the clip is now a corpus ENTRY, replayed through `Detector` at a chosen
// cadence, and scored by arithmetic that censors what it could not observe.
//
// WHAT ONE SITTING CAN AND CANNOT SAY. It can say whether today's pipeline reads this cube, how long
// each side took, and whether it ever reports a cube that is not the cube. It cannot say anything
// about the next cube: one cube in one light on one camera is not a sample, and the shortfalls are
// asserted here rather than left for a reader to remember. The wrong-cube bound over ONE independent
// cube is 95% — which is the honest answer and the reason the corpus has to grow.

import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { describeCorpus, loadCorpus, MIN_CUBES, MIN_LIGHTINGS, sessionsIn } from '../src/corpus.js';
import { colourOfSlot } from '../src/scheme.js';
import {
  countInterventions,
  reportsOnlyTheCube,
  type SessionOutcome,
  scoreSessions,
} from '../src/session-metrics.js';
import { type RecordedSession, sessionFps, sessionTicks } from '../src/session-record.js';
import {
  type IdentityPolicy,
  namesTheSideInHand,
  namesTheWrongSide,
  replaySession,
} from '../view/session-replay.js';
import { corpusEntries, LOGO_CUBE_TRUTH } from './fixtures/corpus.js';

// Named through the scheme rather than written as 0 and 3, so a colour never has to be looked up.
const WHITE = colourOfSlot('U');
const YELLOW = colourOfSlot('D');

// A PATH, not `new URL(…, import.meta.url)`: under happy-dom the module's URL is not a file URL —
// the same trap `real-clip.test.ts` records.
const FIXTURES = join(import.meta.dirname, 'fixtures');
const corpus = loadCorpus(corpusEntries(FIXTURES));

const advance = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

/** Replay every session in the corpus at `tickMs` and score the lot. `answerIdentity` is the
 *  person standing in for whoever is holding the cube (plan §6, item 1). */
async function run(
  tickMs: number,
  person?: (session: RecordedSession) => IdentityPolicy,
): Promise<SessionOutcome[]> {
  const outcomes: SessionOutcome[] = [];
  for (const session of corpus.sessions) {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'Date',
        'performance',
      ],
    });
    try {
      outcomes.push(
        await replaySession(session, { advance, tickMs, answerIdentity: person?.(session) }),
      );
    } finally {
      vi.useRealTimers();
      document.body.replaceChildren();
    }
  }
  return outcomes;
}

describe('the corpus describes itself before anything is measured over it', () => {
  it('holds the 09-18 sitting, and says what it is short of', () => {
    const cover = describeCorpus(corpus);
    expect(cover.sessions).toBe(1);
    expect(cover.cubes).toBe(1);
    // Every floor §4 sets, named. A run that quoted a completion rate without this would be a
    // statement about one cube in one light dressed as a statement about the scanner.
    expect(cover.shortfalls.join(' ')).toMatch(new RegExp(`1 of ${MIN_CUBES} cubes`));
    expect(cover.shortfalls.join(' ')).toMatch(new RegExp(`1 of ${MIN_LIGHTINGS} lighting`));
    expect(cover.shortfalls.join(' ')).toMatch(/no session carries pixels/);
  });

  it('is entirely on one side of the split, which is what one cube means', () => {
    // Whole cubes are held out, so a corpus of one cube has either a training set or a held-out set
    // and never both. Nothing can be measured OUT OF SAMPLE until there is a second cube.
    const train = sessionsIn(corpus, 'train').length;
    const heldout = sessionsIn(corpus, 'heldout').length;
    expect(train + heldout).toBe(1);
    expect(Math.min(train, heldout)).toBe(0);
  });

  it('carries the frames the clip carries, at the rate they were recorded', () => {
    const [session] = corpus.sessions;
    expect(session!.frames).toHaveLength(612);
    expect(Math.round(sessionFps(session!) ?? 0)).toBe(30);
    // No frame was re-served: the clip is one picture per entry. The gap between these two is C3's
    // size, and it is zero here because this recording predates the frame identity that measures it.
    expect(sessionTicks(session!)).toBe(612);
    expect(session!.truth.facelets).toBe(LOGO_CUBE_TRUTH);
  });
});

describe('the pipeline as it stands, over the corpus as it stands', () => {
  it('reads five of this cube\u2019s six sides, and never reports one that is not the cube', async () => {
    // THE BASELINE, RE-MEASURED 2026-09-23 after the logo machinery was removed (the owner's call;
    // `view/ai-scan-panel.ts`, `view/stillness.ts`). It read six sides before, on a mechanism that
    // filed the white side with its centre UNREAD and placed it by elimination once six were in.
    // With that gone a side is its centre, and the detector does not read this cube's white centre
    // as white on any frame of this sitting — so the scan captures FIVE and the sixth is the
    // person's to paint.
    //
    // This number is the price of the decision, stated where a later stage will be compared with
    // it. What did not change is the property the corpus exists for: no wrong cube, ever.
    const outcomes = await run(60);
    const m = scoreSessions(outcomes);
    expect(m.sessions).toBe(1);
    expect(m.wrongSessions).toBe(0);
    for (const o of outcomes) {
      if (o.reported !== null) expect(o.reported).toBe(LOGO_CUBE_TRUTH);
    }
    expect(m.completed).toBe(0);
    // Five sides captured and one CENSORED — the sixth was never observed, so it is not a slow
    // capture that can be averaged in, it is an absence the arithmetic has to carry.
    expect(m.sidesCaptured).toBe(5);
    expect(m.sidesCensored).toBe(1);
    expect(m.timeToSideMedianMs).not.toBeNull();
    // AND THE P90 IS NULL, which is the censoring doing its job: one side of six unobserved puts
    // the 90th percentile past the last event, and `censoredQuantile` answers null for a quantile
    // the data cannot reach rather than quoting the largest number it has.
    expect(m.timeToSideP90Ms).toBeNull();
  });

  it('reports a wrong-cube bound of 95%, because one cube cannot say less', async () => {
    // "Zero wrong cubes" invites the reading that the rate is zero. Over ONE independent cube the
    // most a clean run supports is 1 − 0.05^(1/1) = 95%, and saying so is the whole reason the
    // corpus has to grow. Sixty clean sittings of sixty cubes would bring it under 4.9%.
    const m = scoreSessions(await run(60));
    expect(m.cubes).toBe(1);
    expect(m.wrongCubeRateUpperBound).toBeCloseTo(0.95, 6);
  });

  it('is measured at three cadences, because the cadence changes the answer', async () => {
    // T1: the gate needs an unbroken run of max(3, ceil(0.5·fps)+1) reads, so the FASTER runtime
    // needs the LONGER run — 4 frames at 5 fps, 9 at 15.7, 16 at 30. A baseline taken only at the
    // cadence of the machine it was written on is not a baseline.
    //
    // THE BASELINE ITSELF, re-measured 2026-09-25 after the harness was found not to be varying
    // the cadence at all, and pinned so a later stage is compared with it rather than with a
    // memory of it:
    //
    //   | tick   | sides read | looks asked | median time-to-side | p90       | wrong cubes |
    //   |--------|------------|-------------|---------------------|-----------|-------------|
    //   |  60 ms | 5 of 6     | 0           | 10,140 ms           | censored  | 0           |
    //   | 100 ms | 5 of 6     | 0           | 10,000 ms           | censored  | 0           |
    //   | 200 ms | 5 of 6     | 0           | 10,200 ms           | censored  | 0           |
    //
    // WHAT THE RE-MEASUREMENT CHANGED, AND WHAT IT DID NOT. `tickMs` used to set only the size of
    // the batch the faked timers were advanced by, while the panel went on scheduling itself at its
    // own 60 ms floor — so all three rows were ONE cadence measured three times, and the sweep this
    // table exists for was not being run. It is run now (`panel.tickFloorMs`), and the conclusion
    // survives it: five of six sides at every cadence, no look asked, no wrong cube. The medians
    // moved by at most a tick, which is the whole of the difference.
    //
    // THE GRID IS THE PROOF, and it is asserted rather than admired: each row's capture times are
    // multiples of ITS OWN tick — 660/3540/… at 60 ms, 600/3500/… at 100, 800/3600/… at 200 —
    // where under the old harness every row landed on the 60 ms grid whatever `tickMs` said.
    //
    // NO LOOK IS ASKED FOR NOW, at any cadence: the repair D1 asks about was the white side's, and
    // the white side is never filed.
    for (const [tickMs, median] of [
      [60, 10_140],
      [100, 10_000],
      [200, 10_200],
    ] as const) {
      const outcomes = await run(tickMs);
      const m = scoreSessions(outcomes);
      expect(m.wrongSessions, `${tickMs} ms`).toBe(0);
      expect(m.sidesCaptured, `${tickMs} ms`).toBe(5);
      expect(m.sidesCensored, `${tickMs} ms`).toBe(1);
      // EXACT, because a replay is deterministic: a band a tick wide hid the fact that the three
      // rows were identical runs, and would hide it again.
      expect(m.timeToSideMedianMs, `${tickMs} ms median`).toBe(median);
      expect(m.timeToSideP90Ms, `${tickMs} ms p90`).toBeNull();
      expect(m.looksAsked, `${tickMs} ms looks`).toBe(0);
      for (const side of outcomes[0]!.sides) {
        expect(side.capturedAt! % tickMs, `${tickMs} ms: ${side.face} off the grid`).toBe(0);
      }
    }
  });
});

describe('what the identity question costs and buys on this sitting (plan §6)', () => {
  // THE DECIDING OUTPUTS §6 NAMES — correct completion, time to complete, manual interventions and
  // wrong acceptance — measured on the one sitting the corpus has, under the three things a person
  // can do about the question. The numbers are pinned so a later stage is compared with them rather
  // than with a memory of them.
  //
  // WHAT THIS SITTING CANNOT SHOW, and it is the finding rather than a shortfall: here the logo side
  // is shown FIRST, so it takes yellow's slot by its own centre with no collision at all, and the
  // question is raised about the REAL yellow side — whose colour is already held. §5's question
  // names the FREE slots, so the right answer is not on offer. `real-clip.test.ts` measures that
  // exchange sticker by sticker; this file measures what it costs.

  it('raises exactly one question, and nobody answering costs nobody an act', async () => {
    const outcomes = await run(60);
    const acts = countInterventions(outcomes);
    expect(acts.identityAsked).toBe(1);
    expect(acts.identityIgnored).toBe(1);
    expect(acts.acts, 'a question nobody answered was counted as work somebody did').toBe(0);
    // No completion, so no completion time — censored at the deadline, never dropped and never
    // counted AS the deadline.
    const m = scoreSessions(outcomes);
    expect(outcomes[0]?.completedAt).toBeNull();
    expect(
      m.timeToCompleteMedianMs,
      'a sitting that never finished was given a finishing time',
    ).toBeNull();
  });

  it('the truthful answer is among the choices, and costs two answers', async () => {
    // THE ORDERING THIS SITTING HAS, and the one the free-colours-only rule could not serve: the
    // white side is filed under YELLOW at 720 ms by its own logo-printed centre, so the question is
    // raised about the real yellow side — whose true answer was not on the list until the owner's
    // call of 2026-09-25. It is now, and taking it raises a second question about the displaced
    // reading, which is answered with white. Two acts, both by the same person, and measured.
    const outcomes = await run(60, namesTheSideInHand);
    const asks = outcomes[0]!.identity;
    expect(asks, 'no question was raised, so this case measures nothing').toHaveLength(2);
    expect(asks[0]!.claimed).toBe(YELLOW);
    expect(asks[0]!.choices, 'the held colour was withheld from its own question').toContain(
      YELLOW,
    );
    expect(asks[0]!.answered).toBe(YELLOW);
    // The second is about the reading just displaced, and may not be handed yellow back.
    expect(asks[1]!.choices).not.toContain(YELLOW);
    expect(asks[1]!.answered).toBe(WHITE);
    const acts = countInterventions(outcomes);
    expect(acts.identityAsked).toBe(2);
    expect(acts.identityAnswered).toBe(2);
    expect(acts.identityWrong).toBe(0);
    expect(acts.acts, 'the cure is two answers, and the count says so').toBe(2);
    const m = scoreSessions(outcomes);
    expect(m.sidesCaptured).toBe(6);
    expect(m.sidesCensored).toBe(0);
    // STILL NO CUBE — one sticker on the logo face is read wrong, which is a misread and not a
    // placement — and, the gate that matters, still no cube that is NOT the cube.
    expect(m.completed).toBe(0);
    expect(m.wrongSessions, 'an answer reported a cube that was not the cube').toBe(0);
  });

  it('a wrong answer buys a sixth side and still reports nothing', async () => {
    // What §5 does deliver here: the dead end is gone. The capture is placed, the scan reaches six
    // sides where it reached five — and the cube those six make is not this cube, so it is refused.
    const outcomes = await run(60, namesTheWrongSide);
    const m = scoreSessions(outcomes);
    expect(new Set(outcomes[0]!.sides.map((s) => s.face)).size).toBe(6);
    expect(m.sidesCaptured).toBe(6);
    expect(m.sidesCensored).toBe(0);
    expect(m.completed).toBe(0);
    expect(countInterventions(outcomes).identityWrong).toBe(1);
    expect(countInterventions(outcomes).acts).toBe(1);
  });

  it('no configuration reports a cube that is not the cube', async () => {
    // THE GATE (§6), over every policy at every cadence this file measures. It is the one promise
    // the scanner makes, and it is asked of the whole grid rather than of a favourite row.
    for (const tickMs of [60, 100, 200]) {
      for (const [name, policy] of [
        ['nobody answers', undefined],
        ['the truth answers', namesTheSideInHand],
        ['the wrong side is named', namesTheWrongSide],
        [
          'the question is set aside',
          (() => () => 'skip') as (s: RecordedSession) => IdentityPolicy,
        ],
      ] as const) {
        const m = scoreSessions(await run(tickMs, policy));
        const gate = reportsOnlyTheCube(m);
        expect(gate.ok, `${tickMs} ms, ${name}: ${gate.reasons.join('; ')}`).toBe(true);
      }
    }
  });
});
