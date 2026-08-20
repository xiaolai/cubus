// The record→replay→score backbone, verified offline on a SYNTHETIC session: a known
// move sequence scripted into frames + a playback localizer. This proves the runner
// scores correctly; a REAL session swaps in the OpenCV detector and recorded frames.
import { describe, expect, it } from 'vitest';
import {
  type CubeState,
  type Face,
  type Move,
  SOLVED_STATE,
  applyMove,
  applySequence,
  encodeFacelets,
  faceIndices,
  statesEqual,
} from '../src/cube.js';
import { sharpSoft } from '../src/likelihood.js';
import { type CameraCell, render } from '../src/orientation.js';
import type { Localizer } from '../src/perception/localize.js';
import type { Frame } from '../src/perception/motion.js';
import { type Session, replaySession } from '../src/replay.js';

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
function scramble(rng: () => number, n: number): CubeState {
  const moves = ['U', 'R', 'F', 'D', 'L', 'B', 'U2', 'R2', "F'", "L'"] as const;
  let s = SOLVED_STATE;
  for (let i = 0; i < n; i++) s = applyMove(s, moves[Math.floor(rng() * moves.length)]!);
  return s;
}
function constFrame(fill: number, size = 24): Frame {
  const data = new Uint8ClampedArray(size * size * 4);
  data.fill(fill);
  return { data, width: size, height: size };
}
function camCells(state: CubeState, o: number): CameraCell[] {
  const seen = render(encodeFacelets(state), o);
  const cells: CameraCell[] = [];
  for (const face of ['U', 'F', 'R'] as Face[])
    for (const slot of faceIndices(face))
      cells.push({ slot, soft: sharpSoft(seen[slot] as Face, 0.95) });
  return cells;
}

/** Script a synthetic session for a move sequence: a still period per state (motion → settle). */
function synthSession(s0: CubeState, moves: Move[]): { session: Session; localizer: Localizer } {
  const frames: { frame: Frame; t: number }[] = [];
  const script: { state: CubeState; o: number }[] = [];
  const views = [0, 1, 8, 15, 2, 9];
  let fill = 100;
  let t = 0;
  const settle = (state: CubeState, motionFirst: boolean): void => {
    if (motionFirst) fill = fill === 100 ? 200 : 100; // flip → a jump at the state transition (motion)
    for (let k = 0; k < 6; k++) {
      frames.push({ frame: constFrame(fill), t: t++ });
      script.push({ state, o: views[k % views.length]! });
    }
  };
  settle(s0, false); // initial still period
  let state = s0;
  for (const m of moves) {
    state = applyMove(state, m);
    settle(state, true); // motion episode + settle at the new state
  }
  let idx = 0;
  const localizer: Localizer = {
    detect: () => {
      const s = script[Math.min(idx++, script.length - 1)]!;
      return { cells: camCells(s.state, s.o), alignedGeometry: true };
    },
  };
  return { session: { frames, truthMoves: moves, initialState: s0 }, localizer };
}

describe('replaySession (e2e backbone)', () => {
  it('recovers a known move sequence with zero false commits', () => {
    const s0 = scramble(makeRng(5), 18);
    const moves: Move[] = ['R', 'U', 'F', "D'"];
    const { session, localizer } = synthSession(s0, moves);
    const report = replaySession(session, localizer, {
      recOpts: { maxDepth: 3, fitFloor: 0.8, margin: 0.02 },
      stabilityThreshold: 6,
      stabilityFrames: 2,
    });
    expect(report.committed).toEqual(moves);
    expect(report.metrics.moveRecall).toBe(1);
    expect(report.metrics.falseCommitRate).toBe(0);
    expect(statesEqual(report.finalState!, applySequence(s0, "R U F D'"))).toBe(true);
    expect(report.latency.p95).toBeGreaterThanOrEqual(0); // latency is measured
  });

  it('scores a partial tracker as reduced recall (the harness gate is not gameable)', () => {
    // A localizer that always returns nothing → no moves committed → recall 0.
    const s0 = scramble(makeRng(6), 18);
    const blind: Localizer = { detect: () => ({ cells: [], alignedGeometry: false }) };
    const { session } = synthSession(s0, ['R', 'U']);
    const report = replaySession(session, blind, { stabilityFrames: 2 });
    expect(report.committed).toEqual([]);
    expect(report.metrics.moveRecall).toBe(0); // an "always-lost" tracker fails the recall gate
    expect(report.metrics.falseCommitRate).toBe(0); // ...even though false commits are trivially 0
  });
});
