// T0 verification: the engine's group facts, the successor / ball-size / observability
// claims from dev-docs/research/verify-tracker-claims.mjs promoted to regression tests,
// plus the independent cubejs cross-check the plan requires (§12/#19).
import Cube from 'cubejs';
import { describe, expect, it } from 'vitest';
import {
  type CubeState,
  MOVES,
  MOVE_NAMES,
  ORIENTATIONS,
  SOLVED_STATE,
  applyMove,
  applySequence,
  decodeFacelets,
  encodeFacelets,
  faceIndices,
  isSolvable,
  isStructurallyValid,
  multiply,
  stateKey,
  statesEqual,
} from '../src/cube.js';

const seq = (s: string): CubeState => applySequence(SOLVED_STATE, s);
const isSolved = (s: CubeState): boolean => statesEqual(s, SOLVED_STATE);

function order(m: CubeState): number {
  let s = multiply(SOLVED_STATE, m);
  let n = 1;
  while (!isSolved(s)) {
    s = multiply(s, m);
    n++;
    if (n > 5000) return -1;
  }
  return n;
}

// seeded RNG (LCG) so scrambles are reproducible
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

describe('engine self-validation (known group facts)', () => {
  it('each single-face move has order 4', () => {
    for (const f of ['U', 'R', 'F', 'D', 'L', 'B'] as const) expect(order(MOVES[f])).toBe(4);
  });
  it("sexy move R U R' U' has order 6", () => expect(order(seq("R U R' U'"))).toBe(6));
  it('R U has order 105', () => expect(order(seq('R U'))).toBe(105));
  it("Sune R U R' U R U2 R' has order 6", () => expect(order(seq("R U R' U R U2 R'"))).toBe(6));
  it('superflip is an involution (order 2)', () =>
    expect(order(seq("U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2"))).toBe(2));
  it('R R R R = solved', () => expect(isSolved(seq('R R R R'))).toBe(true));
  it("R U F F' U' R' = solved", () => expect(isSolved(seq("R U F F' U' R'"))).toBe(true));
});

describe('successor set and orientations', () => {
  it('a state has 19 distinct legal successors (identity + 18 moves)', () => {
    const s = scramble(makeRng(1), 25);
    const succ = new Set([stateKey(s)]);
    for (const m of MOVE_NAMES) {
      const t = applyMove(s, m);
      succ.add(stateKey(t));
      expect(isSolvable(t)).toBe(true);
    }
    expect(succ.size).toBe(19);
  });
  it('there are exactly 24 whole-cube orientations', () => {
    expect(ORIENTATIONS.length).toBe(24);
    expect(new Set(ORIENTATIONS.map((o) => o.join(''))).size).toBe(24);
  });
  it('19 successors + 24 orientations = 43 candidates', () => {
    expect(19 + ORIENTATIONS.length).toBe(43);
  });
});

describe('HTM ball sizes (recovery candidate counts)', () => {
  function ball(maxDepth: number): { atDepth: number[]; cumulative: number[] } {
    let frontier = new Map<string, CubeState>([[stateKey(SOLVED_STATE), SOLVED_STATE]]);
    const seen = new Set([stateKey(SOLVED_STATE)]);
    const atDepth = [1];
    const cumulative = [1];
    for (let d = 1; d <= maxDepth; d++) {
      const next = new Map<string, CubeState>();
      for (const st of frontier.values()) {
        for (const m of MOVE_NAMES) {
          const t = applyMove(st, m);
          const k = stateKey(t);
          if (!seen.has(k)) {
            seen.add(k);
            next.set(k, t);
          }
        }
      }
      atDepth.push(next.size);
      cumulative.push(seen.size);
      frontier = next;
    }
    return { atDepth, cumulative };
  }
  it('distinct-per-depth matches published HTM counts, cumulative matches the corrected ball', () => {
    const { atDepth, cumulative } = ball(4);
    expect(atDepth).toEqual([1, 18, 243, 3240, 43239]);
    // Recovery ball after N unknown moves: N=1->19, N=2->262, N=3->3502, N=4->46741.
    expect(cumulative).toEqual([1, 19, 262, 3502, 46741]);
  });
});

describe('observability (pairwise injectivity of the 19 candidate projections)', () => {
  const project = (s: CubeState, idx: number[]): string => {
    const f = encodeFacelets(s);
    return idx.map((i) => f[i]).join('');
  };
  const candidates = (s: CubeState): CubeState[] => [s, ...MOVE_NAMES.map((m) => applyMove(s, m))];
  const distinct = (s: CubeState, view: number[]): boolean => {
    const seen = new Set<string>();
    for (const c of candidates(s)) {
      const p = project(c, view);
      if (seen.has(p)) return false;
      seen.add(p);
    }
    return true;
  };
  const U = faceIndices('U');
  const F = faceIndices('F');
  const R = faceIndices('R');

  it('the 1-face blind spot is exactly {D, D2, D′}', () => {
    const rng = makeRng(7);
    const invariant = new Set(MOVE_NAMES);
    for (let t = 0; t < 200; t++) {
      const s = scramble(rng, 30);
      const base = project(s, U);
      for (const m of MOVE_NAMES) if (project(applyMove(s, m), U) !== base) invariant.delete(m);
    }
    expect([...invariant].sort()).toEqual(['D', "D'", 'D2']);
  });

  it('1 face never identifies the move, 3 faces always do (sampled)', () => {
    const rng = makeRng(11);
    let oneInj = 0;
    let threeInj = 0;
    const N = 300;
    for (let t = 0; t < N; t++) {
      const s = scramble(rng, 30);
      if (distinct(s, U)) oneInj++;
      if (distinct(s, [...U, ...F, ...R])) threeInj++;
    }
    expect(oneInj).toBe(0);
    expect(threeInj).toBe(N); // 100% for a 3-face corner view
  });

  it('2 faces are almost-but-not-always sufficient: U2 R2 makes D and D′ collide under U∪F', () => {
    const w = seq('U2 R2');
    const uf = [...U, ...F];
    expect(project(applyMove(w, 'D'), uf)).toBe(project(applyMove(w, "D'"), uf));
    expect(distinct(w, uf)).toBe(false);
  });
});

describe('facelet encode/decode', () => {
  it('round-trips random solvable states', () => {
    const rng = makeRng(42);
    for (let t = 0; t < 200; t++) {
      const s = scramble(rng, 25);
      const back = decodeFacelets(encodeFacelets(s));
      expect(back).not.toBeNull();
      expect(statesEqual(back!, s)).toBe(true);
      expect(isStructurallyValid(encodeFacelets(s))).toBe(true);
    }
  });
  it('applySequence fails loud on an unknown move token', () => {
    expect(() => applySequence(SOLVED_STATE, 'R U X')).toThrow(/unknown move/);
  });
  it('rejects impossible sticker strings', () => {
    expect(decodeFacelets('U'.repeat(54))).toBeNull(); // all one color: no valid corners
    expect(isStructurallyValid('U'.repeat(54))).toBe(false);
  });
});

describe('cubejs cross-check (independent oracle — guards the facelet convention)', () => {
  it('solved state matches cubejs', () => {
    expect(encodeFacelets(SOLVED_STATE)).toBe(new Cube().asString());
  });
  it('random move sequences match cubejs facelet-for-facelet', () => {
    const rng = makeRng(99);
    for (let t = 0; t < 50; t++) {
      const moves = Array.from({ length: 12 }, () => MOVE_NAMES[Math.floor(rng() * 18)]!);
      const alg = moves.join(' ');
      const ours = encodeFacelets(applySequence(SOLVED_STATE, moves));
      const theirs = new Cube().move(alg).asString();
      expect(ours).toBe(theirs);
    }
  });
});
