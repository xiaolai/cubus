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
  it('reads this cube, and never reports one that is not the cube', async () => {
    // THE BASELINE. At the 60 ms tick the desktop app runs, today's pipeline captures all six sides
    // of the 09-18 sitting and reports no cube — since D1 it asks for one look at the white side
    // before accepting a repair, and a twenty-second clip holds no frames after the ask to answer
    // it. What it must never do, and does not, is complete with something that is not the truth.
    const outcomes = await run(60);
    const m = scoreSessions(outcomes);
    expect(m.sessions).toBe(1);
    expect(m.wrongCubes).toBe(0);
    for (const o of outcomes) {
      if (o.reported !== null) expect(o.reported).toBe(LOGO_CUBE_TRUTH);
    }
    // Six sides captured, each with the time it took — the censored time-to-side is computed from
    // exactly these, and they are what a later stage has to beat.
    expect(m.sidesCaptured).toBe(6);
    expect(m.sidesCensored).toBe(0);
    expect(m.timeToSideMedianMs).not.toBeNull();
    expect(m.timeToSideP90Ms).not.toBeNull();
    expect(m.timeToSideP90Ms!).toBeLessThanOrEqual(20_000);
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
    // THE BASELINE ITSELF, measured 2026-09-23 and pinned so a later stage is compared with it
    // rather than with a memory of it:
    //
    //   | tick   | six sides | looks asked | median time-to-side | p90      | wrong cubes |
    //   |--------|-----------|-------------|---------------------|----------|-------------|
    //   |  60 ms | yes       | 1           | 6,420 ms            | 17,040 ms| 0           |
    //   | 100 ms | yes       | 1           | 6,500 ms            | 17,100 ms| 0           |
    //   | 200 ms | yes       | 1           | 6,600 ms            | 17,200 ms| 0           |
    //
    // The bands below are a tick wide: a capture lands on a tick, so the same scan read at a
    // different rate moves by at most one, and a band tighter than that would fail on arithmetic
    // rather than on a regression.
    for (const [tickMs, median, p90] of [
      [60, 6420, 17040],
      [100, 6500, 17100],
      [200, 6600, 17200],
    ] as const) {
      const m = scoreSessions(await run(tickMs));
      expect(m.wrongCubes, `${tickMs} ms`).toBe(0);
      expect(m.sidesCaptured, `${tickMs} ms`).toBe(6);
      expect(m.timeToSideMedianMs, `${tickMs} ms median`).toBeGreaterThanOrEqual(median - tickMs);
      expect(m.timeToSideMedianMs, `${tickMs} ms median`).toBeLessThanOrEqual(median + tickMs);
      expect(m.timeToSideP90Ms, `${tickMs} ms p90`).toBeGreaterThanOrEqual(p90 - tickMs);
      expect(m.timeToSideP90Ms, `${tickMs} ms p90`).toBeLessThanOrEqual(p90 + tickMs);
      // One look, at every cadence: D1's ask for the white side's repaired sticker.
      expect(m.looksAsked, `${tickMs} ms looks`).toBe(1);
    }
  });
});
