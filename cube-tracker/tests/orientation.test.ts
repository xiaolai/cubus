// T2 verification: the 24-orientation facelet model, the resolver (unique for a
// 3-face view, ambiguous for a symmetric single-face view — §12/#2), and that a
// whole-cube rotation is read as an orientation change, not a spurious move.
import { describe, expect, it } from 'vitest';
import { Belief } from '../src/belief.js';
import {
  type CubeState,
  type Face,
  ORIENTATIONS,
  SOLVED_STATE,
  applyMove,
  applySequence,
  encodeFacelets,
  faceIndices,
  statesEqual,
} from '../src/cube.js';
import { sharpSoft } from '../src/likelihood.js';
import {
  type CameraCell,
  ORIENTATION_COUNT,
  PERMS,
  faceMapOf,
  render,
  resolveOrientations,
  toCubeView,
} from '../src/orientation.js';

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
function scramble(rng: () => number, n: number): CubeState {
  let s = SOLVED_STATE;
  const moves = ['U', 'R', 'F', 'D', 'L', 'B', 'U2', 'R2', "F'", "L'"] as const;
  for (let i = 0; i < n; i++) s = applyMove(s, moves[Math.floor(rng() * moves.length)]!);
  return s;
}
/** A camera observation of `state` under orientation `o`, over the given camera faces. */
function cameraObs(state: CubeState, o: number, faces: Face[], p = 0.95): CameraCell[] {
  const seen = render(encodeFacelets(state), o);
  const out: CameraCell[] = [];
  for (const face of faces)
    for (const slot of faceIndices(face))
      out.push({ slot, soft: sharpSoft(seen[slot] as Face, p) });
  return out;
}

describe('orientation model: group properties', () => {
  it('has exactly 24 distinct facelet permutations', () => {
    expect(ORIENTATION_COUNT).toBe(24);
    expect(new Set(PERMS.map((p) => p.join(','))).size).toBe(24);
  });
  it('every permutation is a bijection of the 54 facelets', () => {
    for (const p of PERMS) expect(new Set(p).size).toBe(54);
  });
  it('rendering the solved cube keeps every camera face uniform', () => {
    const solved = encodeFacelets(SOLVED_STATE);
    for (let o = 0; o < ORIENTATION_COUNT; o++) {
      const seen = render(solved, o);
      for (const face of ['U', 'R', 'F', 'D', 'L', 'B'] as Face[]) {
        const block = faceIndices(face).map((i) => seen[i]);
        expect(new Set(block).size).toBe(1);
      }
    }
  });
  it('the induced face-maps match the independent enumeration in cube.ts', () => {
    const fromGeometry = new Set(Array.from({ length: 24 }, (_, o) => faceMapOf(o).join('')));
    const fromCube = new Set(ORIENTATIONS.map((o) => o.join('')));
    expect(fromGeometry).toEqual(fromCube);
  });
});

describe('orientation resolver', () => {
  it('a 3-face view of a scrambled cube resolves to a unique orientation', () => {
    const rng = makeRng(4);
    for (let t = 0; t < 30; t++) {
      const s = scramble(rng, 20);
      const oTrue = Math.floor(rng() * 24);
      const obs = cameraObs(s, oTrue, ['U', 'F', 'R']);
      const resolved = resolveOrientations(encodeFacelets(s), obs);
      expect(resolved).toEqual([oTrue]);
    }
  });
  it('a single-face view of a symmetric (solved) face is genuinely ambiguous (§12/#2)', () => {
    const obs = cameraObs(SOLVED_STATE, 0, ['F']);
    const resolved = resolveOrientations(encodeFacelets(SOLVED_STATE), obs);
    expect(resolved.length).toBeGreaterThan(1); // a single fixed O would be wrong
  });
});

describe('orientation + belief: a whole-cube rotation is not a move (§12/#3)', () => {
  it('the same state seen under different orientations yields no move commit', () => {
    const s = scramble(makeRng(8), 20);
    const belief = new Belief(s);
    // three different camera orientations of the SAME physical state
    for (const [i, oTrue] of [2, 9, 17].entries()) {
      const obs = cameraObs(s, oTrue, ['U', 'F', 'R']);
      const resolved = resolveOrientations(encodeFacelets(s), obs);
      expect(resolved.length).toBe(1);
      const view = toCubeView(obs, resolved[0]!);
      const u = belief.update(view, `rot-${i}`, `vp-${oTrue}`);
      expect(u.kind).not.toBe('move'); // rotation only — no spurious move
    }
    expect(statesEqual(belief.currentState(), s)).toBe(true);
  });

  it('a genuine face turn (under a resolved orientation) does commit', () => {
    const s = scramble(makeRng(21), 20);
    const oTrue = 5;
    const truth = applyMove(s, 'R');
    const belief = new Belief(s);
    let committed: CubeState | null = null;
    for (const vp of ['a', 'b', 'c']) {
      const obs = cameraObs(truth, oTrue, ['U', 'F', 'R']);
      const resolved = resolveOrientations(encodeFacelets(truth), obs); // 3-face -> unique
      const view = toCubeView(obs, resolved[0]!);
      const u = belief.update(view, `${vp}`, vp);
      if (u.kind === 'move') {
        expect(u.move).toBe('R');
        committed = u.state;
      }
    }
    expect(committed).not.toBeNull();
    expect(statesEqual(committed!, applySequence(s, 'R'))).toBe(true);
  });
});
