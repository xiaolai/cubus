// Orientation recovery: read six faces flat at unknown rotations, solve for the turns
// that make a solvable cube. Proves the user never has to align a face.
import Cube from 'cubejs';
import { describe, expect, it } from 'vitest';
import { CORNER_ANCHORS } from '../src/corner-scan.js';
import { classifyBalanced, rotateFace, solveOrientations } from '../src/orient.js';
import { FACES, type Face, type RGB } from '../src/types.js';

/** A deterministic scrambled, solvable cube as facelets (URFDLB, 9 each). */
function scramble(): string {
  const c = new Cube();
  c.move("R U R' U' F' U2 F R U2 R'");
  return c.asString();
}

/** Split a facelet string into six faces of nine RGB samples via the anchor palette. */
function facesFrom(facelets: string): Record<Face, RGB[]> {
  const out = {} as Record<Face, RGB[]>;
  FACES.forEach((f, i) => {
    out[f] = facelets
      .slice(i * 9, i * 9 + 9)
      .split('')
      .map((letter) => [...CORNER_ANCHORS[letter as Face]] as RGB);
  });
  return out;
}

describe('classifyBalanced', () => {
  it('assigns exactly nine stickers to each color even when some reds look orange', () => {
    const centers = FACES.map((f) => CORNER_ANCHORS[f]);
    const samples: RGB[] = [];
    for (const f of FACES) for (let i = 0; i < 9; i++) samples.push([...CORNER_ANCHORS[f]] as RGB);
    // Corrupt three RED stickers (R = FACES[1] → indices 9..17) toward reddish-orange, the
    // exact confusion that made a plain nearest-color classify report 12 orange / 7 red.
    samples[9] = [220, 80, 30];
    samples[10] = [225, 90, 28];
    samples[11] = [228, 100, 26];
    const { letters } = classifyBalanced(samples, centers);
    const counts: Record<string, number> = {};
    for (const l of letters) counts[l] = (counts[l] ?? 0) + 1;
    for (const f of FACES) expect(counts[f]).toBe(9);
  });
});

describe('solveOrientations', () => {
  it('returns the cube unchanged when every face is already upright', () => {
    const s = scramble();
    const res = solveOrientations(facesFrom(s));
    expect(res.valid).toBe(true);
    expect(res.facelets).toBe(s);
    expect(res.rotations).toEqual({ U: 0, R: 0, F: 0, D: 0, L: 0, B: 0 });
  });

  it('recovers a solvable cube from faces read at arbitrary rotations', () => {
    const s = scramble();
    const faces = facesFrom(s);
    // Rotate the five free faces by assorted turns; U is the reference frame.
    const rotated: Record<Face, RGB[]> = {
      U: faces.U,
      R: rotateFace(faces.R, 1),
      F: rotateFace(faces.F, 2),
      D: rotateFace(faces.D, 3),
      L: rotateFace(faces.L, 1),
      B: rotateFace(faces.B, 2),
    };
    const res = solveOrientations(rotated);
    expect(res.valid).toBe(true);
    // The solvable rotation combination is unique for this scramble → the exact cube.
    expect(res.facelets).toBe(s);
    // And the recovered turns undo the ones we applied (mod 4).
    expect((res.rotations!.R + 1) % 4).toBe(0);
    expect((res.rotations!.F + 2) % 4).toBe(0);
  });

  it('recovers the exact cube even when every face — including the reference — is rotated', () => {
    const s = scramble();
    const faces = facesFrom(s);
    const rotated = Object.fromEntries(
      FACES.map((f, i) => [f, rotateFace(faces[f], (i + 1) % 4)]),
    ) as Record<Face, RGB[]>;
    const res = solveOrientations(rotated);
    expect(res.valid).toBe(true);
    expect(res.facelets).toBe(s); // unique solvable combination → the true cube
    expect(() => Cube.fromString(res.facelets)).not.toThrow();
  });

  it('reports invalid when a sticker is misread (no rotation makes it solvable)', () => {
    const faces = facesFrom(scramble());
    faces.U[0] = [...CORNER_ANCHORS.D] as RGB; // corrupt one sticker → breaks colour counts
    const res = solveOrientations(faces);
    expect(res.valid).toBe(false);
  });
});
