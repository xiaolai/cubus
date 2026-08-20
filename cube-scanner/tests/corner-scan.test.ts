// The two-corner scan: assign quads to faces by center color, reject non-cube corners,
// and assemble a validated cube from the two opposite-corner shots.
import { describe, expect, it } from 'vitest';
import { CORNER_ANCHORS, CornerScanSession, assignCornerShot } from '../src/corner-scan.js';
import type { Quad } from '../src/homography.js';
import type { Face, Frame, RGB } from '../src/types.js';

const frame: Frame = { data: new Uint8ClampedArray([0, 0, 0, 0]), width: 1, height: 1 };
const quad = (tag: number): Quad => ({
  tl: [tag, 0],
  tr: [tag + 1, 0],
  br: [tag + 1, 1],
  bl: [tag, 1],
});
const uniform = (c: RGB): RGB[] => Array.from({ length: 9 }, () => [...c] as RGB);

/** A sampler that returns preset stickers per quad object (identity keyed). */
function sampler(map: Map<Quad, RGB[]>) {
  return (_f: Frame, q: Quad): RGB[] => map.get(q) ?? [];
}

describe('assignCornerShot', () => {
  it('assigns quads to faces by center color, not position', () => {
    // Present the three quads in R, U, F order — assignment must go by color anyway.
    const qR = quad(0);
    const qU = quad(10);
    const qF = quad(20);
    const map = new Map<Quad, RGB[]>([
      [qR, uniform(CORNER_ANCHORS.R)],
      [qU, uniform(CORNER_ANCHORS.U)],
      [qF, uniform(CORNER_ANCHORS.F)],
    ]);
    const res = assignCornerShot(frame, [qR, qU, qF], ['U', 'F', 'R'], { sample: sampler(map) });
    expect(res.ok).toBe(true);
    expect(res.faces.U?.[4]).toEqual(CORNER_ANCHORS.U);
    expect(res.faces.F?.[4]).toEqual(CORNER_ANCHORS.F);
    expect(res.faces.R?.[4]).toEqual(CORNER_ANCHORS.R);
  });

  it('rejects a non-cube corner (three skin-tone centers, no distinct cube colors)', () => {
    const skin: RGB = [205, 165, 140];
    const qs = [quad(0), quad(10), quad(20)];
    const map = new Map<Quad, RGB[]>(qs.map((q) => [q, uniform(skin)]));
    const res = assignCornerShot(frame, qs, ['U', 'F', 'R'], { sample: sampler(map) });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('wrong-corner');
  });

  it('reports need-3-faces when fewer than three quads are found', () => {
    const qs = [quad(0), quad(10)];
    const map = new Map<Quad, RGB[]>([
      [qs[0]!, uniform(CORNER_ANCHORS.U)],
      [qs[1]!, uniform(CORNER_ANCHORS.F)],
    ]);
    const res = assignCornerShot(frame, qs, ['U', 'F', 'R'], { sample: sampler(map) });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('need-3-faces');
  });
});

describe('CornerScanSession', () => {
  it('completes and validates when both shots match', () => {
    const shots: [Face, Face, Face][] = [
      ['U', 'F', 'R'],
      ['D', 'B', 'L'],
    ];
    const map = new Map<Quad, RGB[]>();
    const quadsByShot = shots.map((faces, s) =>
      faces.map((f, i) => {
        const q = quad(s * 100 + i * 10);
        map.set(q, uniform(CORNER_ANCHORS[f]));
        return q;
      }),
    );
    const session = new CornerScanSession({ sample: sampler(map) });
    expect(session.nextShot()).toEqual(['U', 'F', 'R']);
    expect(session.capture(frame, quadsByShot[0]!).ok).toBe(true);
    expect(session.nextShot()).toEqual(['D', 'B', 'L']);
    expect(session.capture(frame, quadsByShot[1]!).ok).toBe(true);
    expect(session.complete()).toBe(true);
    const result = session.result();
    expect(result?.valid).toBe(true);
    expect(result?.lowConfidence).toEqual([]);
  });
});
