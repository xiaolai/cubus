// S2 verification (pure cube logic): decode/encode round-trip and the
// solvability gate. cubejs is used here as an independent oracle — for the same
// facelet strings, our pure `isStructurallyValid` and cubejs must agree.

import Cube from 'cubejs';
import { describe, expect, it } from 'vitest';
import {
  SOLVED_FACELETS,
  centersOk,
  decodeFacelets,
  encodeFacelets,
  isSolvable,
  isStructurallyValid,
} from '../src/facelet-cube.js';
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
