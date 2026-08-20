// The center-color palette (algorithm §3.3, §12/#13). Classification is RELATIVE to
// the cube's 6 center colors, so a non-standard cube (metallic sheen, off-brand dyes)
// is handled by anchoring to ITS OWN centers instead of standard constants. The
// rolling palette EMA-adapts each label toward the observed center stickers of that
// color — online color-drift correction (Liu et al. 2019) — starting from canonical.

import { FACES, type Face } from '../cube.js';
import { CANONICAL_CENTERS, type RGB, ciede2000 } from './color.js';

/** A source of the 6 center reference colors, optionally self-updating from observations. */
export interface CenterPalette {
  get(): Record<Face, RGB>;
  /** Fold in an observed center-sticker color (called by the localizer per detected face). */
  observe?(rgb: RGB): void;
}

function clone(c: Record<Face, RGB>): Record<Face, RGB> {
  return { U: [...c.U], R: [...c.R], F: [...c.F], D: [...c.D], L: [...c.L], B: [...c.B] };
}

/** A fixed palette (default: standard speedcube colors). */
export function staticPalette(centers: Record<Face, RGB> = CANONICAL_CENTERS): CenterPalette {
  const c = clone(centers);
  return { get: () => c };
}

/** The label whose reference color is nearest `rgb` (CIEDE2000). */
export function nearestLabel(rgb: RGB, centers: Record<Face, RGB>): Face {
  let best: Face = 'U';
  let bestD = Number.POSITIVE_INFINITY;
  for (const f of FACES) {
    const d = ciede2000(rgb, centers[f]);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

/**
 * A per-session rolling palette: each observed center nudges the nearest label toward
 * it (exponential moving average). Adapts to the cube's real colors + the ambient
 * light within a session; starts from canonical so the first frames still classify.
 */
export function rollingPalette(alpha = 0.1): CenterPalette {
  const p = clone(CANONICAL_CENTERS);
  return {
    get: () => p,
    observe(rgb: RGB): void {
      const f = nearestLabel(rgb, p);
      const cur = p[f];
      p[f] = [
        cur[0] + alpha * (rgb[0] - cur[0]),
        cur[1] + alpha * (rgb[1] - cur[1]),
        cur[2] + alpha * (rgb[2] - cur[2]),
      ];
    },
  };
}
