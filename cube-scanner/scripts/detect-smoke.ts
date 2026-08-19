// Wiring smoke check for the OpenCV.js detector — run with `npm run smoke:detect`.
// It confirms detect.ts's OpenCV calls are named correctly, the Mat cleanup runs,
// and corner extraction works, by detecting an obvious high-contrast square. It
// does NOT test real-world accuracy — that needs a real cube, tuned on-device.
//
// OpenCV.js is a CommonJS emscripten module, so we load it via createRequire
// (importing it as ESM trips the "thenable module" gotcha in some runners).

import { createRequire } from 'node:module';
import { detectFaceQuad } from '../src/detect.js';
import type { Frame, RGB } from '../src/types.js';

const require = createRequire(import.meta.url);
// v5 of @techstark/opencv-js resolves to the ready module via a thenable, rather
// than firing onRuntimeInitialized — so we await the loader.
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

async function main(): Promise<void> {
  console.log('OpenCV.js ready. Mat is', typeof cv.Mat);

  const frame = makeFrame(240, 240, (x, y) =>
    x >= 40 && x < 200 && y >= 40 && y < 200 ? [210, 210, 210] : [12, 12, 12],
  );
  const quad = detectFaceQuad(cv, frame, { minAreaFraction: 0.05 });
  console.log('detected quad:', JSON.stringify(quad));
  if (!quad) throw new Error('FAIL: no quad detected on an obvious square');
  const near = (a: number, t: number) => Math.abs(a - t) <= 6;
  const ok =
    near(quad.tl[0], 40) && near(quad.tl[1], 40) && near(quad.br[0], 199) && near(quad.br[1], 199);
  if (!ok) throw new Error(`FAIL: corners off: ${JSON.stringify(quad)}`);

  const flat = makeFrame(160, 160, () => [128, 128, 128]);
  if (detectFaceQuad(cv, flat, {}) !== null) throw new Error('FAIL: found a quad on a flat frame');

  console.log('PASS: detector wiring OK (obvious square found, flat frame rejected)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
