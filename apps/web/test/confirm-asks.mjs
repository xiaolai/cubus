// The asks a scanner can make, in one place (2026-09-19).
//
// A confirm names a side and a colour BESIDE it on top, so the 24 possible asks differ between the two
// colour arrangements — blue sits under white on a Japanese cube, and yellow opposite green (ADR 0001).
// Both the arithmetic suite (test/confirm-hold.test.mjs) and the renderer one
// (test/browser/confirm-hold.test.mjs) walk the same 24 of each, and two copies of a domain table
// drift apart (audit, 2026-09-19).

import { POSITIONS } from '../lib/scheme.js';

/** The six positions, white up and green front, in the app's own order. */
export const FACES = POSITIONS;

/** Which position sits opposite which, under each arrangement. */
export const OPPOSITE = Object.freeze({
  western: Object.freeze({ U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' }),
  japanese: Object.freeze({ U: 'B', B: 'U', R: 'L', L: 'R', F: 'D', D: 'F' }),
});

/** Every ask a scanner can make under `scheme`: a side, and a colour that is neither it nor its opposite. */
export const asksUnder = (scheme) => FACES.flatMap((face) =>
  FACES.filter((up) => up !== face && up !== OPPOSITE[scheme][face]).map((up) => ({ face, up })));
