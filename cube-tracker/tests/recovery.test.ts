// T3 verification: exact-depth ball fixtures (§12/#23), state recovery within N_max,
// re-acquire beyond it (§12/#6), ambiguity when the view can't separate candidates,
// and the cold-start assembler + legality gate.
//
// Depths are kept small on purpose — the depth-5/6 ball is ~10^5–10^6 states and OOMs
// a naive BFS (the very §12/#16 cost that makes recovery a bounded subsystem). Beyond-
// N_max fixtures are produced by a known non-reducing sequence + a membership check,
// never by enumerating a deep shell.
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
import { type CubeView, type ViewCell, sharpSoft, unknownSoft } from '../src/likelihood.js';
import { type CameraCell, render } from '../src/orientation.js';
import {
  acquireState,
  ballWithinDepth,
  exactDepthShell,
  packKey,
  recoverState,
} from '../src/recovery.js';

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
function cameraObs(state: CubeState, o: number, faces: Face[], p = 0.95): CameraCell[] {
  const seen = render(encodeFacelets(state), o);
  const out: CameraCell[] = [];
  for (const face of faces)
    for (const slot of faceIndices(face))
      out.push({ slot, soft: sharpSoft(seen[slot] as Face, p) });
  return out;
}
function cubeViewOf(state: CubeState, faces: Face[], p = 0.95): CubeView {
  const f = encodeFacelets(state);
  const cells: ViewCell[] = [];
  for (const face of faces)
    for (const idx of faceIndices(face))
      cells.push({ index: idx, soft: sharpSoft(f[idx] as Face, p) });
  return { cells };
}
const OPTS3 = { maxDepth: 3, fitFloor: 0.8, margin: 0.02 };

describe('recovery ball & exact-depth shell', () => {
  it('exact-depth shells match the published HTM per-depth counts', () => {
    expect(exactDepthShell(SOLVED_STATE, 1).length).toBe(18);
    expect(exactDepthShell(SOLVED_STATE, 2).length).toBe(243);
  });
  it('every fixture in an exact-depth-3 shell really is beyond depth 2', () => {
    const shell3 = exactDepthShell(SOLVED_STATE, 3);
    const ball2 = ballWithinDepth(SOLVED_STATE, 2);
    for (const s of shell3.slice(0, 100)) expect(ball2.has(packKey(s))).toBe(false);
  });
});

describe('recoverState: resync within N_max, re-acquire beyond it', () => {
  it('recovers the exact state after a 3-move occlusion (depth 3 ≤ N_max)', () => {
    const rng = makeRng(6);
    for (let t = 0; t < 5; t++) {
      const committed = scramble(rng, 18);
      const shell = exactDepthShell(committed, 3);
      const truth = shell[Math.floor(rng() * shell.length)]!;
      const obs = cameraObs(truth, Math.floor(rng() * 24), ['U', 'F', 'R']);
      const res = recoverState(committed, obs, OPTS3);
      expect(res.kind).toBe('resync');
      if (res.kind === 'resync') expect(statesEqual(res.state, truth)).toBe(true);
    }
  });

  it('re-acquires (does not falsely resync) when the truth is beyond N_max', () => {
    const committed = scramble(makeRng(15), 18);
    const truth = applySequence(committed, 'R U F L D B'); // 6 non-reducing moves
    // precondition: truth is genuinely outside the depth-3 ball
    expect(ballWithinDepth(committed, 3).has(packKey(truth))).toBe(false);
    const obs = cameraObs(truth, 7, ['U', 'F', 'R']);
    expect(recoverState(committed, obs, OPTS3).kind).not.toBe('resync');
  });

  it('reports ambiguous when the view leaves the changed layer hidden', () => {
    const committed = scramble(makeRng(30), 18);
    // occlude a U move, then show only D — which U/U'/U2 all leave unchanged
    const truth = applyMove(committed, 'U');
    const obs = cameraObs(truth, 0, ['D']);
    const res = recoverState(committed, obs, { maxDepth: 1, fitFloor: 0.8, margin: 0.02 });
    expect(res.kind).toBe('ambiguous');
    if (res.kind === 'ambiguous') expect(res.candidates.length).toBeGreaterThan(1);
  });

  it('an occluded (all-unknown) view re-acquires rather than guessing', () => {
    const committed = scramble(makeRng(40), 18);
    const cells: CameraCell[] = faceIndices('U').map((slot) => ({ slot, soft: unknownSoft() }));
    expect(recoverState(committed, cells, OPTS3).kind).toBe('reacquire');
  });
});

describe('acquireState: assemble one legal state from full coverage, reject bad reads', () => {
  it('recovers a scrambled state from six clean face-views', () => {
    const truth = scramble(makeRng(77), 25);
    const views = (['U', 'R', 'F', 'D', 'L', 'B'] as Face[]).map((f) => cubeViewOf(truth, [f]));
    const acq = acquireState(views);
    expect(acq).not.toBeNull();
    expect(statesEqual(acq!.state, truth)).toBe(true);
  });
  it('returns null until all six faces are covered', () => {
    const truth = scramble(makeRng(78), 25);
    const partial = (['U', 'R', 'F'] as Face[]).map((f) => cubeViewOf(truth, [f]));
    expect(acquireState(partial)).toBeNull();
  });
  it('rejects an inconsistent (unsolvable) full read instead of trusting it', () => {
    // swap a U-edge sticker with an F-edge sticker -> an impossible F/B edge slot
    const bad = encodeFacelets(SOLVED_STATE)
      .split('')
      .map((c, i) => (i === 1 ? 'F' : i === 19 ? 'U' : c))
      .join('');
    const cells: ViewCell[] = bad
      .split('')
      .map((c, i) => ({ index: i, soft: sharpSoft(c as Face, 0.99) }));
    expect(acquireState([{ cells }])).toBeNull();
  });
});
