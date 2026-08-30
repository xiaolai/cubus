// How many wasm threads the runtime is asked for.
//
// This was a hard-coded 1 with the note "so no SharedArrayBuffer / cross-origin-isolation headers
// are needed" — true when written, and the reason every non-Apple build ran a THREADED runtime on
// a single core at 3-4 fps. The headers exist now, so the count is derived; these are the two
// properties that make deriving it safe rather than optimistic.

import { describe, expect, it } from 'vitest';

import { defaultThreadCount } from '../view/onnx-runtime.js';

describe('defaultThreadCount', () => {
  it('asks for exactly one thread when the page is not isolated', () => {
    // Without SharedArrayBuffer the runtime has no threads to give, whatever it is asked for.
    // Asking anyway is how a page ends up throwing instead of quietly running on one core.
    for (const cores of [1, 4, 8, 16, 64]) {
      expect(defaultThreadCount(false, cores)).toBe(1);
    }
  });

  it('leaves two cores for the camera and the renderer', () => {
    // The benchmark that chose this ran inference on an otherwise idle page. The real app has a
    // camera pipeline and a 3D renderer running beside it, and on a phone it has a thermal
    // budget as well — so the count is deliberately not the core count.
    expect(defaultThreadCount(true, 8)).toBe(6);
    expect(defaultThreadCount(true, 10)).toBe(6);
    expect(defaultThreadCount(true, 4)).toBe(2);
  });

  it('caps at six, because Chromium gets SLOWER beyond it', () => {
    // Measured, 640x640, median of 10 runs: Chromium (10 cores) 9.5 fps at 6 threads and 7.2 at
    // 8 — a regression, not a plateau. WebKit keeps gaining to 11.3 at 8, so the cap costs it
    // about a quarter of its peak. One number for both engines, chosen for the one that can be
    // hurt rather than the one that cannot.
    expect(defaultThreadCount(true, 32)).toBe(6);
    expect(defaultThreadCount(true, 128)).toBe(6);
  });

  it('never asks for fewer than one, whatever the machine reports', () => {
    // navigator.hardwareConcurrency is not guaranteed sane; 0 or 1 must not become 0 or -1.
    expect(defaultThreadCount(true, 1)).toBe(1);
    expect(defaultThreadCount(true, 2)).toBe(1);
    expect(defaultThreadCount(true, 0)).toBe(1);
  });
});
