// The session recorder: collect frames + ground-truth moves → a scorable Session,
// with clock-offset windowing so off-camera pre-roll turns are not scored.
import { describe, expect, it } from 'vitest';
import { SOLVED_STATE, statesEqual } from '../src/cube.js';
import type { Frame } from '../src/perception/motion.js';
import { SessionRecorder } from '../src/record.js';

const frame = (): Frame => ({ data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 });

describe('SessionRecorder', () => {
  it('collects frames + moves within the recorded span into a Session', () => {
    const rec = new SessionRecorder(SOLVED_STATE);
    rec.addFrame(frame(), 100);
    rec.addFrame(frame(), 200);
    rec.addFrame(frame(), 300);
    rec.addMove('R', 150);
    rec.addMove('U', 250);
    expect(rec.frameCount()).toBe(3);
    expect(rec.moveCount()).toBe(2);
    const s = rec.finish();
    expect(s.truthMoves).toEqual(['R', 'U']);
    expect(s.frames.length).toBe(3);
    expect(statesEqual(s.initialState, SOLVED_STATE)).toBe(true);
  });

  it('drops a move that falls outside the frame span, and the clock offset can rescue it', () => {
    const rec = new SessionRecorder(SOLVED_STATE);
    rec.addFrame(frame(), 100);
    rec.addFrame(frame(), 300);
    rec.addMove('D', 50); // before the first frame (off-camera pre-roll)
    expect(rec.finish().truthMoves).toEqual([]); // dropped
    expect(rec.finish(60).truthMoves).toEqual(['D']); // +60 → 110, now in span
  });

  it('reset clears the buffers', () => {
    const rec = new SessionRecorder(SOLVED_STATE);
    rec.addFrame(frame(), 1);
    rec.addMove('R', 1);
    rec.reset();
    expect(rec.frameCount()).toBe(0);
    expect(rec.finish().truthMoves).toEqual([]);
  });
});
