// Integration of the live loop (motion gate → localize → track), offline, with an
// injected localizer. Frame pixels drive the motion gate; the injected localizer
// supplies the cells — so a still period, a motion episode, then a move are all
// exercised end-to-end without a camera.
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
import { LiveTracker } from '../src/live.js';
import { type CameraCell, render } from '../src/orientation.js';
import type { Localizer } from '../src/perception/localize.js';
import type { Frame } from '../src/perception/motion.js';

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
function camCells(state: CubeState, o: number): CameraCell[] {
  const seen = render(encodeFacelets(state), o);
  const cells: CameraCell[] = [];
  for (const face of ['U', 'F', 'R'] as Face[])
    for (const slot of faceIndices(face))
      cells.push({ slot, soft: sharpSoft(seen[slot] as Face, 0.95) });
  return cells;
}
function constFrame(fill: number, size = 24): Frame {
  const data = new Uint8ClampedArray(size * size * 4);
  data.fill(fill);
  return { data, width: size, height: size };
}

describe('LiveTracker end-to-end (offline, injected localizer)', () => {
  it('holds through a still period, then commits the move after the motion episode', () => {
    const s0 = scramble(makeRng(4), 18);
    let cells: CameraCell[] = camCells(s0, 0);
    const localizer: Localizer = { detect: () => ({ cells, alignedGeometry: true }) };
    const live = new LiveTracker(localizer, {
      recOpts: { maxDepth: 3, fitFloor: 0.8, margin: 0.02 },
      stabilityThreshold: 6,
      stabilityFrames: 2,
    });
    live.seed(s0);

    // still at s0 — many low-diff frames; no move must be committed
    const still = constFrame(100);
    for (let i = 0; i < 6; i++) live.pushFrame(still, i);
    expect(statesEqual(live.state()!, s0)).toBe(true);

    // a move happens: a high-diff transition frame, then a new still period at s0·F
    const moved = constFrame(200);
    cells = camCells(applyMove(s0, 'F'), 0);
    live.pushFrame(moved, 6); // high diff — the motion episode

    let didMove = false;
    const viewpoints = [1, 8, 15, 2, 9, 17, 3, 11];
    for (let i = 0; i < viewpoints.length; i++) {
      cells = camCells(applyMove(s0, 'F'), viewpoints[i]!);
      const u = live.pushFrame(moved, 7 + i); // same pixels → stable again after the gate refills
      if (u.kind === 'move') {
        expect(u.move).toBe('F');
        didMove = true;
      }
    }
    expect(didMove).toBe(true);
    expect(statesEqual(live.state()!, applySequence(s0, 'F'))).toBe(true);
    expect(live.status()).toBe('tracking');
    expect(live.disambiguationPrompt()).toBeNull();
    live.reset();
    expect(live.state()).toBeNull();
  });
});

describe('LiveTracker robustness (F3/F6/F7)', () => {
  const OPTS3 = { maxDepth: 3, fitFloor: 0.8, margin: 0.02 };

  it('surfaces lost after the cube leaves the frame, keeping the belief for re-entry (F7)', () => {
    const s0 = scramble(makeRng(7), 18);
    const localizer: Localizer = { detect: () => ({ cells: [], alignedGeometry: false }) };
    const live = new LiveTracker(localizer, {
      recOpts: OPTS3,
      stabilityThreshold: 6,
      stabilityFrames: 2,
    });
    live.seed(s0);
    for (let i = 0; i < 15; i++) live.pushFrame(constFrame(100), i); // cube never detected
    expect(live.status()).toBe('lost');
    expect(statesEqual(live.state()!, s0)).toBe(true); // belief preserved for recovery on return
  });

  it('ignores background motion outside the ROI — a move still commits despite churn (F3)', () => {
    const s0 = scramble(makeRng(9), 18);
    let cells = camCells(s0, 0);
    const localizer: Localizer = {
      detect: () => ({ cells, alignedGeometry: true, roi: { x: 0, y: 0, w: 8, h: 8 } }),
    };
    const live = new LiveTracker(localizer, {
      recOpts: OPTS3,
      stabilityThreshold: 6,
      stabilityFrames: 2,
    });
    live.seed(s0);
    // top-left pixel encodes cube stillness (inside the ROI); everything else churns.
    const churn = (roiVal: number, i: number): Frame => {
      const f = constFrame((i * 70) % 256, 24);
      f.data[0] = f.data[1] = f.data[2] = roiVal;
      return f;
    };
    for (let i = 0; i < 4; i++) live.pushFrame(churn(50, i), i); // still cube, churning background
    live.pushFrame(churn(200, 99), 4); // the turn — the ROI pixel changes once
    const views = [1, 8, 15, 2, 9, 17, 3, 11];
    let didMove = false;
    for (let i = 0; i < views.length; i++) {
      cells = camCells(applyMove(s0, 'F'), views[i]!);
      const u = live.pushFrame(churn(200, i), 5 + i); // new still state, background still churning
      if (u.kind === 'move') {
        expect(u.move).toBe('F');
        didMove = true;
      }
    }
    expect(didMove).toBe(true); // only possible if the ROI diff ignored the background churn
    expect(statesEqual(live.state()!, applySequence(s0, 'F'))).toBe(true);
  });

  it('a stable-but-unaligned frame commits nothing even across distinct viewpoints (F9/#14)', () => {
    const s0 = scramble(makeRng(11), 18);
    let cells = camCells(s0, 0);
    const localizer: Localizer = { detect: () => ({ cells, alignedGeometry: false }) }; // never aligned
    const live = new LiveTracker(localizer, {
      recOpts: OPTS3,
      stabilityThreshold: 6,
      stabilityFrames: 2,
    });
    live.seed(s0);
    for (const [i, o] of [1, 8, 15, 2, 9].entries()) {
      cells = camCells(applyMove(s0, 'R'), o); // distinct viewpoints of s0·R — WOULD commit if aligned
      expect(live.pushFrame(constFrame(100), i).kind).not.toBe('move');
    }
    expect(statesEqual(live.state()!, s0)).toBe(true);
  });

  it('seed() ALONE clears the off-frame timeout — a reused tracker does not inherit lost (regression)', () => {
    const localizer: Localizer = { detect: () => ({ cells: [], alignedGeometry: false }) };
    const live = new LiveTracker(localizer, {
      recOpts: OPTS3,
      stabilityThreshold: 6,
      stabilityFrames: 2,
    });
    live.seed(scramble(makeRng(3), 18));
    for (let i = 0; i < 15; i++) live.pushFrame(constFrame(100), i); // → lost
    expect(live.status()).toBe('lost');
    live.seed(scramble(makeRng(4), 18)); // reseed WITHOUT reset() — seed() itself must clear the timeout
    expect(live.pushFrame(constFrame(100), 0).kind).not.toBe('lost');
    expect(live.status()).not.toBe('lost');
  });

  it('a tracker reseeded mid-life still tracks a fresh move (wasStable/ambiguous cleared)', () => {
    const s0 = scramble(makeRng(20), 18);
    let cells = camCells(s0, 0);
    const localizer: Localizer = { detect: () => ({ cells, alignedGeometry: true }) };
    const live = new LiveTracker(localizer, {
      recOpts: OPTS3,
      stabilityThreshold: 6,
      stabilityFrames: 2,
    });
    live.seed(s0);
    for (let i = 0; i < 4; i++) live.pushFrame(constFrame(100), i); // use the tracker a bit
    const s1 = scramble(makeRng(21), 18);
    live.seed(s1); // reseed the SAME tracker to a new state
    cells = camCells(s1, 0); // now observing s1
    for (let i = 0; i < 3; i++) live.pushFrame(constFrame(50), 10 + i); // settle at s1
    const moved = constFrame(200);
    cells = camCells(applyMove(s1, 'U'), 0);
    live.pushFrame(moved, 20); // motion episode
    let didMove = false;
    for (const [i, o] of [1, 8, 15, 2, 9].entries()) {
      cells = camCells(applyMove(s1, 'U'), o);
      const u = live.pushFrame(moved, 21 + i);
      if (u.kind === 'move') {
        expect(u.move).toBe('U');
        didMove = true;
      }
    }
    expect(didMove).toBe(true);
    expect(statesEqual(live.state()!, applySequence(s1, 'U'))).toBe(true);
  });

  it('rejects invalid stability options (F11)', () => {
    const localizer: Localizer = { detect: () => ({ cells: [], alignedGeometry: false }) };
    expect(() => new LiveTracker(localizer, { stabilityFrames: 0 })).toThrow(/positive integer/);
    expect(() => new LiveTracker(localizer, { stabilityThreshold: Number.NaN })).toThrow(/finite/);
  });
});
