// The center-color palette: nearest-label matching and rolling EMA adaptation.
import { describe, expect, it } from 'vitest';
import { CANONICAL_CENTERS, type RGB, ciede2000 } from '../src/perception/color.js';
import { nearestLabel, rollingPalette, staticPalette } from '../src/perception/palette.js';

describe('staticPalette', () => {
  it('returns the given centers (a copy)', () => {
    const p = staticPalette();
    expect(p.get().U).toEqual([...CANONICAL_CENTERS.U]);
    expect(p.observe).toBeUndefined(); // static: no adaptation
  });
});

describe('nearestLabel', () => {
  it('matches a sample to the closest reference color', () => {
    expect(nearestLabel([250, 250, 250], CANONICAL_CENTERS)).toBe('U'); // white
    expect(nearestLabel([210, 20, 20], CANONICAL_CENTERS)).toBe('R'); // red
    expect(nearestLabel([10, 160, 80], CANONICAL_CENTERS)).toBe('F'); // green
  });
});

describe('rollingPalette', () => {
  it("adapts a label toward the cube's actual (off-standard) center color", () => {
    const p = rollingPalette(0.3);
    // a metallic-ish, dim green center seen repeatedly
    const observed: RGB = [40, 120, 70];
    const before = ciede2000(p.get().F, observed);
    for (let i = 0; i < 20; i++) p.observe?.(observed);
    const after = ciede2000(p.get().F, observed);
    expect(after).toBeLessThan(before); // F moved toward the observed green
    expect(after).toBeLessThan(2); // and converged close
  });

  it('routes each observation to the nearest label, not a fixed slot', () => {
    const p = rollingPalette(0.5);
    const reddishOrange: RGB = [235, 90, 20]; // between R and L(orange)
    const label = nearestLabel(reddishOrange, p.get());
    p.observe?.(reddishOrange);
    // the observation nudged exactly the label it matched, leaving others untouched
    expect(p.get()[label]).not.toEqual(CANONICAL_CENTERS[label]);
    const others = (['U', 'R', 'F', 'D', 'L', 'B'] as const).filter((f) => f !== label);
    for (const f of others) expect(p.get()[f]).toEqual([...CANONICAL_CENTERS[f]]);
  });
});
