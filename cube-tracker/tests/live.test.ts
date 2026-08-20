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
