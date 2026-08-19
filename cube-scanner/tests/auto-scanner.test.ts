// The auto-capture + confirm loop, hardware-free: a fake camera + fake detector
// drive AutoCubeScanner through all 6 sides. OpenCV.js is never involved (the
// detector is injected), so this verifies the entire orchestration offline.

import { describe, expect, it } from 'vitest';
import { AutoCubeScanner } from '../src/auto-scanner.js';
import type { FrameSource } from '../src/camera.js';
import type { Quad } from '../src/homography.js';
import { FACES, type Frame } from '../src/types.js';
import { facesFromFacelets, makeFrame, paintFace, scrambleFacelets } from './helpers.js';

const SCRAMBLE = scrambleFacelets("R U R' U' F2 L D' B");
const BLACK = makeFrame(90, 90, () => [0, 0, 0]);
const fullQuad = (f: Frame): Quad => ({
  tl: [0, 0],
  tr: [f.width, 0],
  br: [f.width, f.height],
  bl: [0, f.height],
});

function harness() {
  let current: Frame = BLACK;
  const source: FrameSource = { grab: () => current, stop: () => {} };
  // "Finds a face" whenever the frame isn't all-black (i.e. a side is shown).
  const detectFace = (f: Frame): Quad | null =>
    f.data[0] === 0 && f.data[1] === 0 && f.data[2] === 0 ? null : fullQuad(f);
  const scanner = new AutoCubeScanner({
    source,
    detectFace,
    steady: { threshold: 6, framesNeeded: 2 },
  });
  return {
    scanner,
    show: (frame: Frame) => {
      current = frame;
    },
    blank: () => {
      current = BLACK;
    },
  };
}

function tickUntilProposed(scanner: AutoCubeScanner) {
  for (let i = 0; i < 12; i++) {
    const status = scanner.tick();
    if (status.kind === 'proposed') return status.proposal;
  }
  throw new Error('no proposal within 12 ticks');
}

describe('AutoCubeScanner', () => {
  it('reports searching while the frame moves or shows no face', () => {
    const { scanner, blank } = harness();
    blank();
    expect(scanner.tick()).toEqual({ kind: 'searching', reason: 'moving' }); // first frame
    // steady but blank -> a face is not found
    scanner.tick();
    expect(scanner.tick()).toEqual({ kind: 'searching', reason: 'no-face' });
  });

  it('proposes each side, and confirm advances to the next', () => {
    const { scanner, show } = harness();
    FACES.forEach((face, fi) => {
      show(paintFace(SCRAMBLE.slice(fi * 9, fi * 9 + 9)));
      const proposal = tickUntilProposed(scanner);
      expect(proposal.face).toBe(face);
      expect(proposal.samples).toEqual(facesFromFacelets(SCRAMBLE)[face]);
      scanner.confirm();
    });
    const result = scanner.result();
    expect(result?.facelets).toBe(SCRAMBLE);
    expect(result?.valid).toBe(true);
  });

  it('confirm on the last side returns a complete status', () => {
    const { scanner, show } = harness();
    let last: ReturnType<AutoCubeScanner['confirm']> = { kind: 'idle' };
    FACES.forEach((_face, fi) => {
      show(paintFace(SCRAMBLE.slice(fi * 9, fi * 9 + 9)));
      tickUntilProposed(scanner);
      last = scanner.confirm();
    });
    expect(last.kind).toBe('complete');
  });

  it('reject discards the proposal and re-scans the same side', () => {
    const { scanner, show } = harness();
    show(paintFace(SCRAMBLE.slice(0, 9)));
    expect(tickUntilProposed(scanner).face).toBe('U');
    scanner.reject();
    // still on U, nothing captured
    expect(scanner.progress()).toEqual([]);
    expect(tickUntilProposed(scanner).face).toBe('U');
  });

  it('throws if confirm is called with no proposal', () => {
    const { scanner } = harness();
    expect(() => scanner.confirm()).toThrow(/no proposed face/);
  });

  it('reset clears progress and any pending proposal', () => {
    const { scanner, show } = harness();
    show(paintFace(SCRAMBLE.slice(0, 9)));
    tickUntilProposed(scanner);
    scanner.reset();
    expect(scanner.progress()).toEqual([]);
    expect(scanner.next()).toBe('U');
  });
});
