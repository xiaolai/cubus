// T1 verification of the belief core, over SYNTHETIC cube-coordinate observations
// (the belief math in isolation — orientation resolution is T2, tested separately).
import { describe, expect, it } from 'vitest';
import { Belief } from '../src/belief.js';
import {
  type CubeState,
  type Face,
  MOVE_NAMES,
  type Move,
  SOLVED_STATE,
  applyMove,
  applySequence,
  encodeFacelets,
  faceIndices,
  statesEqual,
} from '../src/cube.js';
import {
  type CubeView,
  type ViewCell,
  discrimCells,
  sharpSoft,
  unknownSoft,
} from '../src/likelihood.js';

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
function scramble(rng: () => number, n: number): CubeState {
  let s = SOLVED_STATE;
  for (let i = 0; i < n; i++) s = applyMove(s, MOVE_NAMES[Math.floor(rng() * 18)]!);
  return s;
}
/** A cube-coordinate view of `state` over the given faces, each cell a confident soft color. */
function viewOf(state: CubeState, faces: Face[], p = 0.95): CubeView {
  const f = encodeFacelets(state);
  const cells: ViewCell[] = [];
  for (const face of faces)
    for (const idx of faceIndices(face))
      cells.push({ index: idx, soft: sharpSoft(f[idx] as Face, p) });
  return { cells };
}

describe('belief: commits the correct observed move', () => {
  it('commits the true move after a few viewpoint-diverse clean frames', () => {
    const s0 = scramble(makeRng(3), 20);
    const truth = applyMove(s0, 'F');
    const belief = new Belief(s0);
    const updates = [] as string[];
    let committed: CubeState | null = null;
    for (const vp of ['v1', 'v2', 'v3']) {
      const u = belief.update(viewOf(truth, ['U', 'F', 'R']), `${vp}-hash`, vp);
      updates.push(u.kind);
      if (u.kind === 'move') {
        expect(u.move).toBe('F');
        committed = u.state;
      }
    }
    expect(updates).toContain('move');
    expect(committed).not.toBeNull();
    expect(statesEqual(committed!, truth)).toBe(true);
  });
});

describe('belief: rejects an off-model view (U F U2 is >1 move away) — never a wrong move', () => {
  it('goes to recovery/lost, never commits a single move', () => {
    const s0 = scramble(makeRng(5), 20);
    const truth = applySequence(s0, 'U F U2'); // 3 moves from committed
    const belief = new Belief(s0);
    let sawLost = false;
    for (const vp of ['v1', 'v2', 'v3', 'v4', 'v5']) {
      const u = belief.update(viewOf(truth, ['U', 'F', 'R']), `${vp}-hash`, vp);
      expect(u.kind).not.toBe('move'); // must never fabricate a single move
      if (u.kind === 'lost') sawLost = true;
    }
    expect(sawLost).toBe(true);
  });
});

describe('belief: correlated one-cell error does not become a confident wrong commit (§12/#12)', () => {
  it('B vs B2 differing by one visible cell, repeated from one viewpoint, stays ambiguous', () => {
    const s0 = applySequence(SOLVED_STATE, 'B R2 D F R2');
    const view = ['U', 'F', 'R'] as Face[];
    // sanity: B and B2 differ by exactly one visible cell here
    const bView = viewOf(applyMove(s0, 'B'), view);
    expect(
      discrimCells(encodeFacelets(applyMove(s0, 'B')), encodeFacelets(applyMove(s0, 'B2')), bView),
    ).toBe(1);

    // a persistent glare makes the observation read exactly like B2 (the wrong move)
    const glare = viewOf(applyMove(s0, 'B2'), view);
    const belief = new Belief(s0);
    let lastStatus = 'tracking';
    for (const f of ['f1', 'f2', 'f3']) {
      const u = belief.update(glare, f, 'same-viewpoint'); // distinct frames, SAME viewpoint
      expect(u.kind).not.toBe('move'); // the diversity guard blocks the correlated error
      if (u.kind === 'hold') lastStatus = u.status;
    }
    expect(lastStatus).toBe('ambiguous');
  });
});

describe('belief: never commits on an uninformative or contradictory read', () => {
  it('an all-unknown (occluded) view holds without committing', () => {
    const s0 = scramble(makeRng(9), 20);
    const belief = new Belief(s0);
    const cells: ViewCell[] = faceIndices('U').map((idx) => ({ index: idx, soft: unknownSoft() }));
    const u = belief.update({ cells }, 'occluded', 'v');
    expect(u.kind).not.toBe('move');
    expect(statesEqual(belief.currentState(), s0)).toBe(true);
  });
});

describe('belief: idempotent on duplicate frames (§12/#5)', () => {
  it('feeding the same frame 3× equals feeding it once (no phantom accumulation)', () => {
    const s0 = scramble(makeRng(13), 20);
    const truth = applyMove(s0, 'R');
    const one = new Belief(s0);
    one.update(viewOf(truth, ['U', 'F', 'R']), 'same', 'v');
    const three = new Belief(s0);
    three.update(viewOf(truth, ['U', 'F', 'R']), 'same', 'v');
    three.update(viewOf(truth, ['U', 'F', 'R']), 'same', 'v');
    three.update(viewOf(truth, ['U', 'F', 'R']), 'same', 'v');
    // neither committed (only one distinct frame < N), and states match
    expect(statesEqual(one.currentState(), s0)).toBe(true);
    expect(statesEqual(three.currentState(), s0)).toBe(true);
    expect(one.currentStatus()).toBe(three.currentStatus());
  });
});

describe('belief: false-commit rate is 0 on clean input (property test)', () => {
  it('over 50 random (state, move) pairs, commits exactly the true move and never a wrong one', () => {
    const rng = makeRng(2024);
    let committedCount = 0;
    for (let t = 0; t < 50; t++) {
      const s0 = scramble(rng, 20);
      const move = MOVE_NAMES[Math.floor(rng() * 18)]! as Move;
      const truth = applyMove(s0, move);
      const belief = new Belief(s0);
      for (const vp of ['v1', 'v2', 'v3']) {
        const u = belief.update(viewOf(truth, ['U', 'F', 'R']), `${vp}-${t}`, vp);
        if (u.kind === 'move') {
          expect(u.move).toBe(move); // never a wrong move
          expect(statesEqual(u.state, truth)).toBe(true);
          committedCount++;
        }
      }
    }
    expect(committedCount).toBeGreaterThan(0); // it does commit clean moves
  });
});
