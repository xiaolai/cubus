// T5 integration: the orchestrator end-to-end over synthetic camera observations —
// track a move, ignore a whole-cube rotation, recover a small occluded gap, and
// re-acquire past N_max. (The live camera + real localizer are the only unverified
// piece — they produce the CameraObservation this consumes.)
import { describe, expect, it } from 'vitest';
import {
  type CubeState,
  type Face,
  SOLVED_STATE,
  applyMove,
  applySequence,
  encodeFacelets,
  faceIndices,
  statesEqual,
} from '../src/cube.js';
import { sharpSoft } from '../src/likelihood.js';
import { type CameraCell, render } from '../src/orientation.js';
import { CubeTracker } from '../src/tracker.js';

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
function obsOf(state: CubeState, o: number, faces: Face[] = ['U', 'F', 'R'], p = 0.95) {
  const seen = render(encodeFacelets(state), o);
  const cells: CameraCell[] = [];
  for (const face of faces)
    for (const slot of faceIndices(face))
      cells.push({ slot, soft: sharpSoft(seen[slot] as Face, p) });
  return { cells, stable: true, alignedGeometry: true, t: 0 };
}
const OPTS3 = { maxDepth: 3, fitFloor: 0.8, margin: 0.02 };

describe('tracker: tracks an observed move', () => {
  it('commits the move performed in front of the camera', () => {
    const s0 = scramble(makeRng(3), 18);
    const t = new CubeTracker(undefined, OPTS3);
    t.seed(s0);
    let moved = false;
    for (const o of [1, 8, 15]) {
      const u = t.update(obsOf(applyMove(s0, 'F'), o));
      if (u.kind === 'move') {
        expect(u.move).toBe('F');
        moved = true;
      }
    }
    expect(moved).toBe(true);
    expect(statesEqual(t.state()!, applySequence(s0, 'F'))).toBe(true);
  });
});

describe('tracker: no stale accumulation across a state change', () => {
  it('commits a move performed AFTER the cube sat still for several frames', () => {
    const s0 = scramble(makeRng(50), 18);
    const t = new CubeTracker(undefined, OPTS3);
    t.seed(s0);
    // the cube sits still at s0 for several frames (would penalise the move candidate)
    for (const o of [0, 3, 6, 9]) t.update(obsOf(s0, o));
    // a motion episode (the turn happening) — a non-stable frame
    t.update({ ...obsOf(applyMove(s0, 'R'), 0), stable: false });
    // now still at s0·R — the move must commit despite the earlier still frames
    let moved = false;
    for (const o of [1, 8, 15]) {
      const u = t.update(obsOf(applyMove(s0, 'R'), o));
      if (u.kind === 'move') {
        expect(u.move).toBe('R');
        moved = true;
      }
    }
    expect(moved).toBe(true);
    expect(statesEqual(t.state()!, applySequence(s0, 'R'))).toBe(true);
  });
});

describe('tracker: a whole-cube rotation is not a move', () => {
  it('the same state seen under different orientations commits nothing', () => {
    const s0 = scramble(makeRng(8), 18);
    const t = new CubeTracker(undefined, OPTS3);
    t.seed(s0);
    for (const o of [0, 6, 11, 20]) {
      const u = t.update(obsOf(s0, o));
      expect(u.kind).not.toBe('move');
      expect(u.kind).not.toBe('resync');
    }
    expect(statesEqual(t.state()!, s0)).toBe(true);
  });
});

describe('tracker: recovers a small occluded gap, re-acquires a large one', () => {
  it('resyncs state after a 2-move occlusion (within N_max)', () => {
    const s0 = scramble(makeRng(12), 18);
    const truth = applySequence(s0, 'U D'); // 2 independent moves, depth 2
    const t = new CubeTracker(undefined, OPTS3);
    t.seed(s0);
    const u = t.update(obsOf(truth, 4));
    expect(u.kind).toBe('resync');
    if (u.kind === 'resync') expect(statesEqual(u.state, truth)).toBe(true);
    expect(statesEqual(t.state()!, truth)).toBe(true);
  });

  it('re-acquires (goes lost) when the gap exceeds N_max', () => {
    const s0 = scramble(makeRng(19), 18);
    const truth = applySequence(s0, 'R U F L D B'); // depth 6 > maxDepth 3
    const t = new CubeTracker(undefined, OPTS3);
    t.seed(s0);
    const u = t.update(obsOf(truth, 2));
    expect(u.kind).toBe('lost');
    expect(t.state()).toBeNull(); // must re-acquire, not resync to a wrong state
  });
});

describe('tracker: max-information disambiguation (§12/#22)', () => {
  it('returns null while tracking, and a splitting face when ambiguous', () => {
    const s0 = applySequence(SOLVED_STATE, 'B R2 D F R2');
    const t = new CubeTracker();
    t.seed(s0);
    expect(t.disambiguationPrompt()).toBeNull(); // tracking -> no prompt
    // a persistent glare reads the cube as B2, but B/B2 differ by one visible cell here
    const glare = obsOf(applyMove(s0, 'B2'), 0);
    let last: ReturnType<CubeTracker['update']> | undefined;
    for (const _ of ['a', 'b', 'c']) last = t.update(glare);
    expect(last?.kind).not.toBe('move');
    expect(t.status()).toBe('ambiguous');
    expect(t.disambiguationPrompt()).not.toBeNull(); // offer the face that splits the tie
  });
});

describe('tracker: perception gates', () => {
  it('a non-stable or mid-turn frame advances nothing', () => {
    const s0 = scramble(makeRng(25), 18);
    const t = new CubeTracker(undefined, OPTS3);
    t.seed(s0);
    const base = obsOf(applyMove(s0, 'R'), 0);
    expect(t.update({ ...base, stable: false }).kind).toBe('hold');
    expect(t.update({ ...base, alignedGeometry: false }).kind).toBe('hold');
    expect(statesEqual(t.state()!, s0)).toBe(true);
  });
});
