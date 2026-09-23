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
import { type SessionOutcome, scoreSessions } from '../src/session-metrics.js';
import { sessionFps, sessionTicks } from '../src/session-record.js';
import { replaySession } from '../view/session-replay.js';
import { corpusEntries, LOGO_CUBE_TRUTH } from './fixtures/corpus.js';

// A PATH, not `new URL(…, import.meta.url)`: under happy-dom the module's URL is not a file URL —
// the same trap `real-clip.test.ts` records.
const FIXTURES = join(import.meta.dirname, 'fixtures');
const corpus = loadCorpus(corpusEntries(FIXTURES));

const advance = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

/** Replay every session in the corpus at `tickMs` and score the lot. */
async function run(tickMs: number): Promise<SessionOutcome[]> {
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
      outcomes.push(await replaySession(session, { advance, tickMs }));
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
    expect(m.wrongCubes).toBe(0);
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
    // THE BASELINE ITSELF, re-measured 2026-09-23 after the logo machinery came out, and pinned so
    // a later stage is compared with it rather than with a memory of it:
    //
    //   | tick   | sides read | looks asked | median time-to-side | p90       | wrong cubes |
    //   |--------|------------|-------------|---------------------|-----------|-------------|
    //   |  60 ms | 5 of 6     | 0           | 10,200 ms           | censored  | 0           |
    //   | 100 ms | 5 of 6     | 0           | 10,200 ms           | censored  | 0           |
    //   | 200 ms | 5 of 6     | 0           | 10,200 ms           | censored  | 0           |
    //
    // NO LOOK IS ASKED FOR NOW, at any cadence: the repair D1 asks about was the white side's, and
    // the white side is never filed. The median is the same at all three because the captures fall
    // on the same underlying frames; the per-side times move by at most one tick, which is why the
    // band below is a tick wide rather than exact.
    for (const [tickMs, median] of [
      [60, 10_200],
      [100, 10_200],
      [200, 10_200],
    ] as const) {
      const m = scoreSessions(await run(tickMs));
      expect(m.wrongCubes, `${tickMs} ms`).toBe(0);
      expect(m.sidesCaptured, `${tickMs} ms`).toBe(5);
      expect(m.sidesCensored, `${tickMs} ms`).toBe(1);
      expect(m.timeToSideMedianMs, `${tickMs} ms median`).toBeGreaterThanOrEqual(median - tickMs);
      expect(m.timeToSideMedianMs, `${tickMs} ms median`).toBeLessThanOrEqual(median + tickMs);
      expect(m.timeToSideP90Ms, `${tickMs} ms p90`).toBeNull();
      expect(m.looksAsked, `${tickMs} ms looks`).toBe(0);
    }
  });
});
