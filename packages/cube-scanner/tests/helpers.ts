// Shared test helpers: turn a facelet string into synthetic per-face sticker
// colors (so the pipeline can be exercised with zero hardware), and generate
// ground-truth facelet strings via cubejs.

import Cube from 'cubejs';
import { FACES, type Face, type Frame, type RGB } from '../src/types.js';

/** Six mutually distinct, cube-like sticker colors keyed by face letter. */
export const CANONICAL: Readonly<Record<Face, RGB>> = {
  U: [246, 247, 248], // white
  R: [208, 32, 42], // red
  F: [4, 158, 74], // green
  D: [255, 212, 0], // yellow
  L: [255, 106, 0], // orange
  B: [0, 87, 200], // blue
};

/** Colorize a 54-char facelet string into 6 faces of 9 sticker colors each. */
export function facesFromFacelets(f: string): Record<Face, RGB[]> {
  if (f.length !== 54) throw new Error(`expected 54 facelets, got ${f.length}`);
  const faces = {} as Record<Face, RGB[]>;
  FACES.forEach((face, fi) => {
    const stickers: RGB[] = [];
    for (let k = 0; k < 9; k++) {
      const letter = f[fi * 9 + k] as Face;
      stickers.push([...CANONICAL[letter]] as RGB); // fresh tuple so callers can mutate
    }
    faces[face] = stickers;
  });
  return faces;
}

/** Ground-truth facelets after applying an algorithm from solved (via cubejs). */
export function scrambleFacelets(alg: string): string {
  return new Cube().move(alg).asString();
}

/** Build a frame whose pixels are painted by a per-pixel color function. */
export function makeFrame(
  width: number,
  height: number,
  paint: (x: number, y: number) => RGB,
): Frame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Paint one face (9 letters) as a full-frame 3x3 grid of canonical colors. */
export function paintFace(letters: string, size = 90): Frame {
  const cell = size / 3;
  return makeFrame(size, size, (x, y) => {
    const col = Math.min(2, Math.floor(x / cell));
    const row = Math.min(2, Math.floor(y / cell));
    return CANONICAL[letters[row * 3 + col] as Face];
  });
}

/** A region function covering the whole frame (used with paintFace's grid). */
export const fullRegion = (f: { width: number; height: number }) => ({
  x: 0,
  y: 0,
  w: f.width,
  h: f.height,
});
