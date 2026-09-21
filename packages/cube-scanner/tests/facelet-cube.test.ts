// S2 verification (pure cube logic): decode/encode round-trip and the
// solvability gate. cubejs is used here as an independent oracle for the strings this file
// ACCEPTS — each must parse and round-trip through it unchanged. It is not a second solvability
// gate: its round trip succeeds on every malformed string below too, which one case pins.

import Cube from 'cubejs';
import { describe, expect, it } from 'vitest';
import {
  CENTER_INDEX,
  CORNER_COLOR,
  CORNER_FACELET,
  centersOk,
  decodeFacelets,
  EDGE_COLOR,
  EDGE_FACELET,
  encodeFacelets,
  FACE_NEIGHBOURS,
  isSolvable,
  isStructurallyValid,
  rotateFace,
  type Side,
  SOLVED_FACELETS,
} from '../src/facelet-cube.js';
import type { Face } from '../src/types.js';
import { scrambleFacelets } from './helpers.js';

const SCRAMBLES = [
  "R U R' U R U2 R'", // Sune
  "R U R' U' R' F R2 U' R' U' R U R' F'", // T-perm
  'F2 B2 U2 D2 L2 R2',
  'R L U D F B R2 L2',
  "U F R D B L U' F' R' D' B' L'",
];

describe('decodeFacelets / encodeFacelets', () => {
  it('decodes the solved cube to the identity state', () => {
    const s = decodeFacelets(SOLVED_FACELETS);
    expect(s).not.toBeNull();
    expect(s?.cp).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(s?.co).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(s?.ep).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(s?.eo).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('round-trips decode -> encode for solved and scrambles', () => {
    for (const f of [SOLVED_FACELETS, ...SCRAMBLES.map(scrambleFacelets)]) {
      const s = decodeFacelets(f);
      expect(s).not.toBeNull();
      expect(encodeFacelets(s!)).toBe(f);
    }
  });

  it('decodes an edge pair no cubie carries to nothing', () => {
    const f = SOLVED_FACELETS.split('');
    f[19] = 'D'; // the UF slot now reads (U, D): no edge has both, and every corner is untouched
    expect(decodeFacelets(f.join(''))).toBeNull();
  });

  it('refuses a malformed state instead of encoding it as the solved cube', () => {
    // An orientation outside its domain indexed the slot table with NaN, wrote a named property
    // that join() drops, and handed back SOLVED, which the gate then called a valid cube.
    const s = decodeFacelets(SOLVED_FACELETS)!;
    for (const bad of [
      { ...s, co: [Number.NaN, 0, 0, 0, 0, 0, 0, 0] },
      { ...s, eo: [0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      { ...s, cp: [0, 0, 2, 3, 4, 5, 6, 7] },
      { ...s, ep: [0, 1, 2] },
    ]) {
      expect(() => encodeFacelets(bad)).toThrow(TypeError);
    }
    // A well-formed state no legal turn reaches is still encoded: the misread decoder works with
    // those, and the gate is where they are refused.
    expect(isStructurallyValid(encodeFacelets({ ...s, co: [1, 0, 0, 0, 0, 0, 0, 0] }))).toBe(false);
  });
});

describe('the solved colour tables', () => {
  it('cannot be rewritten, so one bad assignment cannot poison every later scan', () => {
    // A readonly TYPE left each row a mutable array at run time: one CORNER_COLOR[0][0] = 'X'
    // made the solved cube fail its own gate for the rest of the process.
    const corner = CORNER_COLOR[0] as unknown as string[];
    const edge = EDGE_COLOR[0] as unknown as string[];
    const table = CORNER_COLOR as unknown as string[][];
    const was = [corner[0], edge[0]];
    try {
      expect(() => {
        corner[0] = 'X';
      }).toThrow(TypeError);
      expect(() => {
        edge[0] = 'X';
      }).toThrow(TypeError);
      expect(() => table.push(['X', 'X', 'X'])).toThrow(TypeError);
    } finally {
      if (!Object.isFrozen(corner)) corner[0] = was[0]!;
      if (!Object.isFrozen(edge)) edge[0] = was[1]!;
      if (!Object.isFrozen(table) && table.length > 8) table.pop();
    }
    expect(isStructurallyValid(SOLVED_FACELETS)).toBe(true);
  });
});

describe('every exported lookup table', () => {
  it('cannot be rewritten at any level — facelet tables, the neighbour map, the centre indices', () => {
    // The colour tables were frozen after one bad assignment poisoned the process (2026-09-13);
    // the facelet tables they are DERIVED from, and the neighbour map derived from those, were
    // still typed readonly and left mutable at run time — the same defect, one table over. Every
    // decode, encode and solvability check indexes through these.
    const cornerRow = CORNER_FACELET[0] as unknown as number[];
    const edgeRow = EDGE_FACELET[0] as unknown as number[];
    const corners = CORNER_FACELET as unknown as number[][];
    const edges = EDGE_FACELET as unknown as number[][];
    const neighbours = FACE_NEIGHBOURS as unknown as Record<string, Record<string, string>>;
    const centres = CENTER_INDEX as unknown as Record<string, number>;
    const was = {
      corner: cornerRow[0],
      edge: edgeRow[0],
      up: neighbours.U!.top,
      centre: centres.U,
    };
    try {
      expect(() => {
        cornerRow[0] = 99;
      }).toThrow(TypeError);
      expect(() => corners.push([1, 2, 3])).toThrow(TypeError);
      expect(() => {
        edgeRow[0] = 99;
      }).toThrow(TypeError);
      expect(() => edges.push([1, 2])).toThrow(TypeError);
      expect(() => {
        neighbours.U!.top = 'X';
      }).toThrow(TypeError);
      expect(() => {
        neighbours.U = {};
      }).toThrow(TypeError);
      expect(() => {
        centres.U = 0;
      }).toThrow(TypeError);
    } finally {
      // Put back what a non-frozen table would have let through, so a red run here cannot take
      // every later case in the file down with it.
      if (!Object.isFrozen(cornerRow)) cornerRow[0] = was.corner!;
      if (!Object.isFrozen(edgeRow)) edgeRow[0] = was.edge!;
      if (!Object.isFrozen(corners) && corners.length > 8) corners.pop();
      if (!Object.isFrozen(edges) && edges.length > 12) edges.pop();
      if (!Object.isFrozen(neighbours.U)) neighbours.U!.top = was.up!;
      if (!Object.isFrozen(centres)) centres.U = was.centre!;
    }
    expect(isStructurallyValid(SOLVED_FACELETS)).toBe(true);
    expect(FACE_NEIGHBOURS.U.top).toBe('B');
  });
});

describe('rotateFace', () => {
  it('returns a fresh array at every turn, so a caller may keep or change the one it was given', () => {
    const a = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    for (const k of [0, 1, 2, 3, 4, -4]) expect(rotateFace(a, k)).not.toBe(a);
    rotateFace(a, 0)[0] = 99;
    expect(a[0]).toBe(0);
    expect(rotateFace(a, 4)).toEqual(a);
  });
});

describe('solvability gate agrees with cubejs (independent oracle)', () => {
  it('accepts solved + every scramble', () => {
    for (const f of [SOLVED_FACELETS, ...SCRAMBLES.map(scrambleFacelets)]) {
      expect(isStructurallyValid(f)).toBe(true);
      // Independent cross-check: cubejs parses and round-trips the same string.
      expect(Cube.fromString(f).asString()).toBe(f);
    }
  });

  it('rejects a single flipped edge (correct counts, unsolvable parity)', () => {
    const f = SOLVED_FACELETS.split('');
    // Swap the two facelets of edge UF (indices 7 and 19) -> one flipped edge.
    [f[7], f[19]] = [f[19]!, f[7]!];
    const flipped = f.join('');
    expect(centersOk(flipped)).toBe(true); // centers untouched
    expect(isStructurallyValid(flipped)).toBe(false); // our parity math catches it
  });

  it('rejects an impossible corner (a non-cubie sticker combination)', () => {
    const f = SOLVED_FACELETS.split('');
    f[0] = 'R'; // corner ULB now reads (R, L, B) — no U/D sticker
    expect(isStructurallyValid(f.join(''))).toBe(false);
  });

  it('rejects the wrong length and bad centers', () => {
    expect(isStructurallyValid('UUU')).toBe(false);
    const badCenter = SOLVED_FACELETS.split('');
    badCenter[4] = 'R';
    expect(centersOk(badCenter.join(''))).toBe(false);
  });

  it('isSolvable rejects a lone twisted corner directly', () => {
    const s = decodeFacelets(SOLVED_FACELETS)!;
    s.co[0] = 1; // twist one corner -> corner-orientation sum ≡ 1 (mod 3)
    expect(isSolvable(s)).toBe(false);
  });

  it('rejects an edge transposition (decodable, distinct cubies, wrong parity)', () => {
    // Swap facelets 10 (UR's R) and 19 (UF's F): the UR and UF edges trade
    // slots. Counts + orientation sums stay valid, so this reaches the parity
    // comparison specifically (odd edge parity vs even corner parity).
    const f = SOLVED_FACELETS.split('');
    [f[10], f[19]] = [f[19]!, f[10]!];
    const swapped = f.join('');
    const state = decodeFacelets(swapped);
    expect(state).not.toBeNull(); // fully decodable, distinct cubies
    expect(state?.co.reduce((a, b) => a + b, 0)).toBe(0); // twist sum ok
    expect(state?.eo.reduce((a, b) => a + b, 0)).toBe(0); // flip sum ok
    expect(isStructurallyValid(swapped)).toBe(false); // rejected only by parity
  });

  it('rejects a duplicate cubie (non-permutation)', () => {
    const f = SOLVED_FACELETS.split('');
    f[19] = 'R'; // UF slot now reads (U,R) — duplicates the UR edge
    expect(decodeFacelets(f.join(''))).not.toBeNull();
    expect(isStructurallyValid(f.join(''))).toBe(false);
  });

  it('is the ONLY gate for parity, twist, flip and inventory: cubejs round-trips every one of those', () => {
    // What the "independent oracle" above actually checks (scanner audit 2026-09-20, §2.7). cubejs's
    // `fromString` parses the 54 letters into cubies by position and `asString` writes them back;
    // it does not ask whether the cubies it built are a permutation, or whether their twist, flip
    // and permutation parities are those of a real cube. So on every malformed string this suite
    // refuses, the round trip SUCCEEDS — and a reader who took the agreement above for a second
    // solvability check would be wrong. `assemble` calls both; the parity math here is the gate, and
    // cubejs's round trip is a check on the string's shape. The day cubejs starts refusing one of
    // these, this fails and the comment gets stronger, not weaker.
    const flipped = SOLVED_FACELETS.split('');
    [flipped[7], flipped[19]] = [flipped[19]!, flipped[7]!]; // one flipped edge
    const transposed = SOLVED_FACELETS.split('');
    [transposed[10], transposed[19]] = [transposed[19]!, transposed[10]!]; // two edges swapped
    const duplicated = SOLVED_FACELETS.split('');
    duplicated[19] = 'R'; // the UR edge twice
    const twisted = SOLVED_FACELETS.split('');
    // Corner URF's three stickers (U9, R1, F3) cycled: the same cubie, turned a third.
    [twisted[8], twisted[9], twisted[20]] = [twisted[9]!, twisted[20]!, twisted[8]!];
    const twistedState = decodeFacelets(twisted.join(''));
    expect(twistedState).not.toBeNull(); // decodable, distinct cubies
    const twistSum = twistedState?.co.reduce((a, b) => a + b, 0) ?? 0;
    expect(twistSum % 3).not.toBe(0); // and it is a twist
    for (const bad of [flipped, transposed, duplicated, twisted].map((f) => f.join(''))) {
      expect(isStructurallyValid(bad)).toBe(false);
      expect(Cube.fromString(bad).asString()).toBe(bad);
    }
  });

  it('isSolvable rejects malformed orientation arrays', () => {
    const s = decodeFacelets(SOLVED_FACELETS)!;
    expect(isSolvable({ ...s, co: [] })).toBe(false); // wrong co length
    expect(isSolvable({ ...s, eo: [] })).toBe(false); // wrong eo length
    expect(isSolvable({ ...s, co: [3, 0, 0, 0, 0, 0, 0, 0] })).toBe(false); // co out of {0,1,2}
    expect(isSolvable({ ...s, eo: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] })).toBe(false); // eo out of {0,1}
  });
});

// The scan screen paints each face tile's four edges in its neighbours' colours, so a user can
// see which way up to hold a side without being told. The 24 answers are written out once here,
// so a change to EDGE_FACELET fails with the expected layout in front of the reader. The scan
// screen's own copy (apps/web/lib/screens/scan.js, which cannot import TypeScript) is pinned by
// apps/web/test/scan-screen.test.mjs, which derives it again from this file's EDGE_FACELET.
describe('FACE_NEIGHBOURS', () => {
  it('derives the canonical layout: U has B above, R right, F below, L left', () => {
    expect(FACE_NEIGHBOURS).toEqual({
      U: { top: 'B', right: 'R', bottom: 'F', left: 'L' },
      R: { top: 'U', right: 'B', bottom: 'D', left: 'F' },
      F: { top: 'U', right: 'R', bottom: 'D', left: 'L' },
      D: { top: 'F', right: 'R', bottom: 'B', left: 'L' },
      L: { top: 'U', right: 'F', bottom: 'D', left: 'B' },
      B: { top: 'U', right: 'L', bottom: 'D', left: 'R' },
    });
  });

  it('is a consistent map: every neighbour names it back on the opposite side', () => {
    const OPPOSITE = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' } as const;
    for (const [face, sides] of Object.entries(FACE_NEIGHBOURS)) {
      for (const [side, neighbour] of Object.entries(sides)) {
        // A face never borders itself or the face across the cube from it.
        expect(neighbour).not.toBe(face);
        // ...and the adjacency is symmetric, which a hand-written table gets wrong.
        const back = FACE_NEIGHBOURS[neighbour as Face];
        expect(Object.values(back)).toContain(face);
        expect(back[OPPOSITE[side as Side]]).toBeDefined();
      }
    }
  });

  it('gives each face four distinct neighbours', () => {
    for (const sides of Object.values(FACE_NEIGHBOURS)) {
      expect(new Set(Object.values(sides)).size).toBe(4);
    }
  });
});
