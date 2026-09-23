// Which face the evidence is about (`dev-docs/scan-pipeline-audit-2026-09-23.md` §4, Stage 2).
//
// The invariant this module exists for is a negative one: evidence from face A must never reach
// face B. Most of these cases are therefore about a look being REFUSED, and about the two ways a
// track can be wrong — taking in a look it should not, and throwing away a face it should have kept.

import { describe, expect, it } from 'vitest';
import { COLOURS } from '../src/face-evidence.js';
import {
  agreementOf,
  FaceTrack,
  MAX_CONSECUTIVE_MISSES,
  QUARTER_TURN,
  REACQUIRE_AFTER_MS,
  turnReading,
} from '../src/face-track.js';
import type { Detection } from '../src/onnx-postprocess.js';

function sticker(cell: number, colour: number, p = 0.92, origin = 300): Detection {
  const scores = new Array<number>(COLOURS).fill((1 - p) / (COLOURS - 1));
  scores[colour] = p;
  return {
    cx: origin + (cell % 3) * 40,
    cy: origin + Math.floor(cell / 3) * 40,
    w: 26,
    h: 26,
    classId: colour,
    confidence: p,
    scores,
  };
}
const face = (colours: readonly number[], origin = 300): (Detection | null)[] =>
  colours.map((c, i) => (c < 0 ? null : sticker(i, c, 0.92, origin)));

const SIDE_A = [0, 1, 2, 3, 4, 5, 0, 1, 2];
const SIDE_B = [5, 4, 3, 2, 1, 0, 5, 4, 3];

describe('a turn is a permutation, in the direction it claims', () => {
  it('returns to the identity after four quarters', () => {
    // The direction is the trap: `stillness.ts` carries this permutation as a SOURCE map and this
    // module as a DESTINATION map, and they are inverses. Four turns is the one check that fails
    // for a map applied the wrong way round only if it is not an involution — so the asymmetric
    // reading below is what makes it bite.
    const asymmetric = [0, 1, 2, 3, 4, 5, 0, 0, 0];
    expect(turnReading(asymmetric, 4)).toEqual(asymmetric);
    expect(turnReading(asymmetric, 1)).not.toEqual(asymmetric);
    expect(turnReading(turnReading(asymmetric, 1), 3)).toEqual(asymmetric);
  });

  it('moves a corner the way a quarter turn does', () => {
    const marked = [9, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(turnReading(marked, 1)[QUARTER_TURN[0]!]).toBe(9);
  });
});

describe('agreement is about the cells both sides saw', () => {
  it('ignores a cell either side has not observed', () => {
    const got = agreementOf([0, 1, 2, -1, 4, 5, 0, 1, 2], [0, 1, 2, 3, -1, 5, 0, 1, 2]);
    expect(got.shared).toBe(7);
    expect(got.agreement).toBe(1);
  });

  it('has nothing to say when nothing is shared', () => {
    const got = agreementOf([-1, -1, -1, -1, -1, -1, -1, -1, -1], SIDE_A);
    expect(got.shared).toBe(0);
    expect(got.agreement).toBe(0);
  });
});

describe('a track keeps its own face and refuses another', () => {
  it('takes the first look whatever it is', () => {
    const track = new FaceTrack();
    expect(track.offer({ cells: face(SIDE_A), frameId: 1, now: 0 }).kind).toBe('joined');
    expect(track.started).toBe(true);
  });

  it('joins a second look at the same face', () => {
    const track = new FaceTrack();
    track.offer({ cells: face(SIDE_A), frameId: 1, now: 0 });
    const got = track.offer({ cells: face(SIDE_A, 360), frameId: 2, now: 33 });
    expect(got).toEqual({ kind: 'joined', turns: 0, reacquired: false });
  });

  it('refuses a different face, and keeps nothing from it', () => {
    // THE INVARIANT. A rejected look must not leave a trace, because `verdict` may be read between
    // frames and a capture reached with foreign evidence is the wrong cube this stage exists to stop.
    const track = new FaceTrack();
    track.offer({ cells: face(SIDE_A), frameId: 1, now: 0 });
    const before = track.belief();
    const got = track.offer({ cells: face(SIDE_B), frameId: 2, now: 33 });
    expect(got.kind).toBe('rejected');
    expect(track.belief()).toEqual(before);
  });

  it('follows the same face turned in the hand, and carries its evidence round', () => {
    const track = new FaceTrack();
    track.offer({ cells: face(SIDE_A), frameId: 1, now: 0 });
    const turned = turnReading(SIDE_A, 1);
    const got = track.offer({ cells: face(turned), frameId: 2, now: 33 });
    expect(got.kind).toBe('joined');
    if (got.kind === 'joined') expect(got.turns).toBe(1);
    expect(track.quarterTurns).toBe(1);
    // The belief is now in the turned frame — the evidence travelled with the stickers rather than
    // fighting the new reading, which is what keeps a turn from collapsing the margin.
    expect(track.belief()).toEqual(turned);
  });
});

describe('one bad frame is noise; three in a row is another face', () => {
  it('survives a single disagreeing look', () => {
    // MEASURED, not assumed: a 74-frame stretch of ONE side held still on the 09-18 clip contains 3
    // frames the fit reads in a different order. Killing the track on each restarted the clock 18
    // times over twelve seconds, so a stall could never reach its own bound.
    const track = new FaceTrack();
    track.offer({ cells: face(SIDE_A), frameId: 1, now: 0 });
    expect(track.offer({ cells: face(SIDE_B), frameId: 2, now: 33 }).kind).toBe('rejected');
    expect(track.lost).toBe(false);
    expect(track.offer({ cells: face(SIDE_A), frameId: 3, now: 66 }).kind).toBe('joined');
    expect(track.lost).toBe(false);
  });

  it('is lost after enough disagreement in a row', () => {
    const track = new FaceTrack();
    track.offer({ cells: face(SIDE_A), frameId: 0, now: 0 });
    for (let k = 1; k <= MAX_CONSECUTIVE_MISSES; k++) {
      expect(track.offer({ cells: face(SIDE_B), frameId: k, now: k * 33 }).kind).toBe('rejected');
    }
    expect(track.lost).toBe(true);
  });

  it('forgets the misses as soon as the face comes back', () => {
    // CONSECUTIVE, not cumulative. A long scan of a face that drops a frame now and then must never
    // add those up into a lost track — over a 612-frame clip an occasional bad read is certain, and
    // a counter that only ever climbs would eventually discard every face. Interleaved well past
    // `MAX_CONSECUTIVE_MISSES` for exactly that reason: a handful of misses with joins between them
    // stays below the bound only if each join clears the count.
    const track = new FaceTrack();
    track.offer({ cells: face(SIDE_A), frameId: 0, now: 0 });
    for (let k = 1; k <= MAX_CONSECUTIVE_MISSES * 3; k++) {
      const cells = face(k % 2 === 1 ? SIDE_B : SIDE_A);
      track.offer({ cells, frameId: k, now: k * 33 });
      expect(track.lost, `after ${k} alternating looks`).toBe(false);
    }
  });
});

describe('a gap is re-acquired explicitly', () => {
  it('says so when a look returns after a gap', () => {
    const track = new FaceTrack();
    track.offer({ cells: face(SIDE_A), frameId: 1, now: 0 });
    const got = track.offer({
      cells: face(SIDE_A),
      frameId: 2,
      now: REACQUIRE_AFTER_MS + 100,
    });
    expect(got).toEqual({ kind: 'joined', turns: 0, reacquired: true });
  });

  it('does not re-acquire something that is not the face', () => {
    // Resuming on anything at all is how evidence from face A reaches face B. After a gap the look
    // still has to earn its way back in.
    const track = new FaceTrack();
    track.offer({ cells: face(SIDE_A), frameId: 1, now: 0 });
    const got = track.offer({
      cells: face(SIDE_B),
      frameId: 2,
      now: REACQUIRE_AFTER_MS + 100,
    });
    expect(got.kind).toBe('rejected');
  });

  it('reports no gap when looks keep arriving', () => {
    const track = new FaceTrack();
    track.offer({ cells: face(SIDE_A), frameId: 1, now: 0 });
    const got = track.offer({ cells: face(SIDE_A), frameId: 2, now: REACQUIRE_AFTER_MS - 1 });
    expect(got).toEqual({ kind: 'joined', turns: 0, reacquired: false });
  });
});
