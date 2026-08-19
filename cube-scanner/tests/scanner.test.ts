// S3 verification (orchestrator, hardware-free): the pure ScanSession state
// machine, the frame -> face sampler, and the live CubeScanner driven by an
// injected frame source. Only camera.ts (getUserMedia) needs real hardware.

import { describe, expect, it } from 'vitest';
import type { FrameSource } from '../src/camera.js';
import { SOLVED_FACELETS } from '../src/facelet-cube.js';
import { createCubeScanner } from '../src/live-scanner.js';
import { ScanSession, defaultRegion, sampleFace } from '../src/scanner.js';
import { FACES, type Face, type Frame, type RGB } from '../src/types.js';
import {
  CANONICAL,
  facesFromFacelets,
  fullRegion,
  makeFrame,
  paintFace,
  scrambleFacelets,
} from './helpers.js';

const SCRAMBLE = scrambleFacelets("R U R' U' F2 L D' B");

describe('defaultRegion', () => {
  it('is a centered square over 80% of the short side', () => {
    expect(defaultRegion({ width: 90, height: 90 })).toEqual({ x: 9, y: 9, w: 72, h: 72 });
    const wide = defaultRegion({ width: 100, height: 60 });
    expect(wide.w).toBe(48);
    expect(wide.h).toBe(48);
    expect(wide.y).toBeCloseTo(6, 10);
  });
});

describe('sampleFace', () => {
  it('reads a face frame into 9 sticker colors', () => {
    const frame = paintFace(SCRAMBLE.slice(0, 9));
    const samples = sampleFace(frame, fullRegion);
    expect(samples).toHaveLength(9);
    expect(samples[0]).toEqual(CANONICAL[SCRAMBLE[0] as Face]);
    expect(samples[8]).toEqual(CANONICAL[SCRAMBLE[8] as Face]);
  });
});

describe('ScanSession', () => {
  it('guides capture in URFDLB order and reports progress', () => {
    const s = new ScanSession();
    expect(s.next()).toBe('U');
    expect(s.progress()).toEqual([]);
    expect(s.complete()).toBe(false);
    expect(s.result()).toBeNull();

    s.captureFace('U', facesFromFacelets(SOLVED_FACELETS).U);
    expect(s.next()).toBe('R');
    expect(s.progress()).toEqual(['U']);
  });

  it('assembles once all 6 faces are captured', () => {
    const s = new ScanSession();
    const faces = facesFromFacelets(SCRAMBLE);
    for (const f of FACES) s.captureFace(f, faces[f]);
    expect(s.complete()).toBe(true);
    const result = s.result();
    expect(result?.facelets).toBe(SCRAMBLE);
    expect(result?.valid).toBe(true);
  });

  it('throws on a wrong sticker count', () => {
    const s = new ScanSession();
    expect(() => s.captureFace('U', [CANONICAL.U])).toThrow(/expected 9/);
  });

  it('reset() clears all captures', () => {
    const s = new ScanSession();
    s.captureFace('U', facesFromFacelets(SOLVED_FACELETS).U);
    s.reset();
    expect(s.progress()).toEqual([]);
    expect(s.next()).toBe('U');
  });

  it('honors a custom capture order', () => {
    const order: Face[] = ['F', 'B', 'U', 'D', 'L', 'R'];
    const s = new ScanSession({ order });
    expect(s.next()).toBe('F');
    s.captureFace('F', facesFromFacelets(SOLVED_FACELETS).F);
    expect(s.next()).toBe('B');
  });

  it('rejects a custom order that is not a 6-face permutation', () => {
    expect(() => new ScanSession({ order: ['U', 'R'] as Face[] })).toThrow(/permutation/);
    expect(() => new ScanSession({ order: ['U', 'U', 'R', 'F', 'D', 'L'] as Face[] })).toThrow(
      /permutation/,
    );
  });

  it('copies the custom order — later caller mutation has no effect', () => {
    const order: Face[] = ['F', 'B', 'U', 'D', 'L', 'R'];
    const s = new ScanSession({ order });
    order[0] = 'U';
    expect(s.next()).toBe('F');
  });

  it('deep-copies captured stickers so caller buffer reuse is safe', () => {
    const s = new ScanSession();
    const solved = facesFromFacelets(SOLVED_FACELETS);
    const buffer: RGB[] = solved.U.map((c) => [...c] as RGB); // a reusable scratch buffer
    s.captureFace('U', buffer);
    for (let i = 0; i < 9; i++) buffer[i] = [...solved.R[i]!] as RGB; // reuse for R
    s.captureFace('R', buffer);
    for (const f of ['F', 'D', 'L', 'B'] as Face[]) s.captureFace(f, solved[f]);
    // U must still be white despite the buffer being overwritten with R.
    expect(s.result()?.facelets).toBe(SOLVED_FACELETS);
  });
});

describe('CubeScanner (live orchestrator via injected source)', () => {
  it('captures the 6 faces from a frame source and assembles the scramble', () => {
    let current: Frame = makeFrame(90, 90, () => [0, 0, 0]);
    const source: FrameSource = { grab: () => current, stop: () => {} };
    const scanner = createCubeScanner({ source, region: fullRegion });

    FACES.forEach((face, fi) => {
      current = paintFace(SCRAMBLE.slice(fi * 9, fi * 9 + 9));
      expect(scanner.next()).toBe(face);
      scanner.captureFace(face);
    });

    expect(scanner.next()).toBeNull();
    const result = scanner.result();
    expect(result?.facelets).toBe(SCRAMBLE);
    expect(result?.valid).toBe(true);
  });

  it('throws if captureFace is called before attach', () => {
    const scanner = createCubeScanner();
    expect(() => scanner.captureFace('U')).toThrow(/not attached/);
  });

  it('reset() clears progress', () => {
    let current: Frame = paintFace(SCRAMBLE.slice(0, 9));
    const source: FrameSource = { grab: () => current, stop: () => {} };
    const scanner = createCubeScanner({ source, region: fullRegion });
    scanner.captureFace('U');
    expect(scanner.progress()).toEqual(['U']);
    scanner.reset();
    expect(scanner.progress()).toEqual([]);
    current = paintFace(SCRAMBLE.slice(9, 18));
  });
});
