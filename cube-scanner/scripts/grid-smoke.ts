// Smoke check for the sticker-GRID detector — run with `npm run smoke:grid`. It paints a
// synthetic cube face (a 3x3 grid of coloured squares separated by black gaps) and
// confirms detectStickerGrid finds the nine stickers and reads their colours, and that a
// flat frame yields no grid. Real accuracy still needs a real cube; this proves the
// OpenCV contour → candidate → findGrid → colour pipeline is wired correctly.

import { createRequire } from 'node:module';
import { detectStickerGrid } from '../src/grid-detect.js';
import type { Frame, RGB } from '../src/types.js';

const require = createRequire(import.meta.url);
const loader = require('@techstark/opencv-js');
const cv: any = typeof loader?.then === 'function' ? await loader : loader;

function makeFrame(w: number, h: number, paint: (x: number, y: number) => RGB): Frame {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

// A 3x3 face: nine 50px stickers with a 6px black gap, on a dark table.
const STICKERS: RGB[] = [
  [235, 235, 235],
  [200, 30, 30],
  [0, 150, 70],
  [255, 215, 0],
  [255, 120, 0],
  [0, 80, 200],
  [235, 235, 235],
  [200, 30, 30],
  [0, 150, 70],
];
const ORIGIN = 40;
const CELL = 50;
const GAP = 6;
const STEP = CELL + GAP;

function faceColor(x: number, y: number): RGB {
  const gx = x - ORIGIN;
  const gy = y - ORIGIN;
  if (gx < 0 || gy < 0) return [15, 15, 15];
  const col = Math.floor(gx / STEP);
  const row = Math.floor(gy / STEP);
  if (col > 2 || row > 2) return [15, 15, 15];
  const inCellX = gx - col * STEP;
  const inCellY = gy - row * STEP;
  if (inCellX >= CELL || inCellY >= CELL) return [10, 10, 10]; // black gap
  return STICKERS[row * 3 + col]!;
}

async function main(): Promise<void> {
  console.log('OpenCV.js ready. Mat is', typeof cv.Mat);

  const frame = makeFrame(240, 240, faceColor);
  const grid = detectStickerGrid(cv, frame);
  if (!grid) throw new Error('FAIL: no 3x3 grid detected on a synthetic cube face');
  if (grid.colors.length !== 9)
    throw new Error(`FAIL: expected 9 stickers, got ${grid.colors.length}`);
  const near = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 40;
  const centerOk = near(grid.colors[4]!, STICKERS[4]!);
  if (!centerOk)
    throw new Error(`FAIL: center colour off: got ${grid.colors[4]}, want ${STICKERS[4]}`);
  console.log('detected 9 stickers, center colour', grid.colors[4]);

  const flat = makeFrame(200, 200, () => [128, 128, 128]);
  if (detectStickerGrid(cv, flat) !== null) throw new Error('FAIL: found a grid on a flat frame');

  console.log('PASS: grid detector wiring OK (synthetic face found, flat frame rejected)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
