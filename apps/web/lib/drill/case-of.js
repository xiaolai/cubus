// The case a row's algorithm solves, as the cube draws it, and the pieces that case is about — one copy for the
// practice page's cube and the library's pictures (dev-docs/practice-redesign-plan.md §3.1, §3.6).
//
// Moved here from lib/screens/practice.js: the library's photographer (lib/case-photo.js) is a service, a service
// must not import a screen, and the page and the photographer must draw one case from one function.

import { CORNER_FACELETS, EDGE_FACELETS } from '../cube-layout.js';
import { run } from '../cube-moves.js';
import { orientationPerm } from '../cube-orientation.js';
import { CORNERS, EDGES, SOLVED, invert, toFacelets } from '../cube-pieces.js';

/** The case of a row as the cube draws it: its inverse played on a solved cube in the row's hold, the pieces in the
 *  cube's own frame, and the hold the algorithm starts in (the ledger's `caseOf`, as pieces). */
export function caseOf(row) {
  const played = run(invert(row.alg), row.hold, SOLVED);
  return { facelets: toFacelets(played.state), hold: [...played.hold] };
}

/** The goal regions that leave the TOP layer of the hold free: the F2L family. An algorithm for one of them moves
 *  top-layer pieces too, but the case is not about them, and marking them would mark most of the top of every tile. */
export const TOP_FREE = Object.freeze(['cross', 'first-layer', 'first-two-layers', 'bottom-corners']);

/**
 * The pieces a row's case is about: every piece the algorithm moves — displaced or twisted, by identity — except, for
 * a goal in `TOP_FREE`, the pieces of the top layer of the hold. `names` are the pieces' own names (`URF`, `FR`), the
 * renderer's `piece:` selectors; `viewed[i]` are piece i's stickers where the case puts them, as VIEWED in the hold
 * the algorithm starts in — the index space a case picture's rects carry, where 0-26 are the up, right and front faces
 * the renderer's camera shows.
 *
 * @param {{ alg: string, hold: string[] }} row
 * @param {string|null} region  the row's set's goal region (`catalogue.sets[row.set].region`)
 */
export function movedPieces(row, region) {
  const played = run(invert(row.alg), row.hold, SOLVED);
  const st = played.state;
  const moved = [
    ...st.cp.map((p, i) => (p !== i || st.co[i] !== 0 ? { name: CORNERS[p], at: CORNER_FACELETS[i] } : null)),
    ...st.ep.map((p, i) => (p !== i || st.eo[i] !== 0 ? { name: EDGES[p], at: EDGE_FACELETS[i] } : null)),
  ].filter(Boolean);
  const top = played.hold[0];
  const about = TOP_FREE.includes(region) ? moved.filter((x) => !x.name.includes(top)) : moved;
  const viewedOf = new Map(orientationPerm(...played.hold).map((scan, v) => [scan, v]));
  return Object.freeze({
    names: Object.freeze(about.map((x) => x.name)),
    viewed: Object.freeze(about.map((x) => Object.freeze(x.at.map((scan) => viewedOf.get(scan))))),
  });
}
