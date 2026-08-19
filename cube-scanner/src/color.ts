// Color science, thin wrapper over culori (MIT). We never hand-roll color math:
// sRGB -> CIELAB and the CIEDE2000 perceptual distance are both delegated to
// culori's reference implementation. The rest of the pipeline compares stickers
// only through `ciede2000`, so it stays lighting-tolerant and calibration-free.

import { converter, differenceCiede2000 } from 'culori';
import type { Lab, RGB } from './types.js';

// D65 CIELAB (culori's `lab65`). sRGB's native white point is D65, and culori's
// `differenceCiede2000` also works in lab65 internally — so labelling our colors
// lab65 both keeps the pipeline in one space and lets CIEDE2000 run on the raw
// L*/a*/b* numbers (no hidden D50<->D65 shift), matching the standard's vectors.
const toLabColor = converter('lab65');
const dE00 = differenceCiede2000();

/** Convert an sRGB triple (0..255 per channel) to D65 CIELAB. */
export function toLab([r, g, b]: RGB): Lab {
  const c = toLabColor({ mode: 'rgb', r: r / 255, g: g / 255, b: b / 255 });
  return { l: c.l, a: c.a, b: c.b };
}

/** CIEDE2000 perceptual distance between two CIELAB (D65) colors. */
export function ciede2000(a: Lab, b: Lab): number {
  return dE00({ mode: 'lab65', l: a.l, a: a.a, b: a.b }, { mode: 'lab65', l: b.l, a: b.a, b: b.b });
}

/** CIEDE2000 distance directly between two sRGB triples (convenience). */
export function rgbDistance(a: RGB, b: RGB): number {
  return ciede2000(toLab(a), toLab(b));
}
