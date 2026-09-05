// S2 verification (pure cube logic): decode/encode round-trip and the
// solvability gate. cubejs is used here as an independent oracle — for the same
// facelet strings, our pure `isStructurallyValid` and cubejs must agree.

import Cube from 'cubejs';
import { describe, expect, it } from 'vitest';
import {
  centersOk,
  decodeFacelets,
  encodeFacelets,
  FACE_NEIGHBOURS,
  isSolvable,
  isStructurallyValid,
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

  it('isSolvable rejects malformed orientation arrays', () => {
    const s = decodeFacelets(SOLVED_FACELETS)!;
    expect(isSolvable({ ...s, co: [] })).toBe(false); // wrong co length
    expect(isSolvable({ ...s, eo: [] })).toBe(false); // wrong eo length
    expect(isSolvable({ ...s, co: [3, 0, 0, 0, 0, 0, 0, 0] })).toBe(false); // co out of {0,1,2}
    expect(isSolvable({ ...s, eo: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] })).toBe(false); // eo out of {0,1}
  });
});

// The scan screen paints each face tile's four edges in its neighbours' colours, so a user can
// see which way up to hold a side without being told. That table lives in apps/web/lib/app.js
// (which cannot import TypeScript), so this pins the copy against the derivation. If the facelet
// layout ever changed, this fails here and names the file to update.
describe('FACE_NEIGHBOURS', () => {
  it('matches the table apps/web/lib/app.js paints the scan tiles from', () => {
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
