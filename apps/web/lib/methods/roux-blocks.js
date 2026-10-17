// Roux's two blocks, and what "built" means for them — the one definition the stages, the tables and the
// Restore chips share.
//
// Plain data and predicates, importing only the piece model, because the chips read it on the page's thread
// (lib/stage-targets.js) and nothing there may load a table or a repertoire. Measured in the method frame —
// white on D — so the first block is the white-orange 1x2x3 on the left of a cube held white underneath,
// green at the back, and the second is its twin on the right.

import { CORNER, EDGE, allSolved } from '../cube-pieces.js';

/** The left block and the right block, each three edges and two corners, by home slot. */
export const FIRST_BLOCK = Object.freeze({
  edges: Object.freeze([EDGE.DL, EDGE.FL, EDGE.BL]), corners: Object.freeze([CORNER.DLF, CORNER.DBL]),
});
export const SECOND_BLOCK = Object.freeze({
  edges: Object.freeze([EDGE.DR, EDGE.FR, EDGE.BR]), corners: Object.freeze([CORNER.DFR, CORNER.DRB]),
});

const ALL_CORNERS = Object.freeze([...Array(8).keys()]);

/** The first block home, relative to the centres. */
export const firstBlockBuilt = (s) => allSolved(s, FIRST_BLOCK);
/** Both blocks home, relative to the centres — so the middle slice lined up with them as well. */
export const bothBlocksBuilt = (s) => firstBlockBuilt(s) && allSolved(s, SECOND_BLOCK);
/** Both blocks and every corner — where CMLL ends. */
export const blocksAndCornersBuilt = (s) => bothBlocksBuilt(s) && allSolved(s, { corners: ALL_CORNERS });
