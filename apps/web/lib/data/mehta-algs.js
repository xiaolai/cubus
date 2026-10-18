// The Mehta method's algorithms, as its own community publishes them — sourced, never derived here.
//
// HAND-COPIED, AND SOURCED, like `human-algs.js`. Mehta (Yash Mehta, 2020) builds a 1x2x3 block flat on
// the bottom, finishes the middle layer, and then ends almost entirely by algorithm. Two paths are kept:
//
//   THE FULL SETS, from the Mehta-OS algorithm sheet, for the 6CP route the repository models
//   (`bench/solver-phases.mjs`): EOLE (the last middle-layer edge with every edge oriented, 55 cases),
//   6CO (the six free corners oriented, 71), 6CP (those six corners placed, 47 rows) and L5EP (the last
//   five edges placed, 16 cases, each drawn up to three ways).
//
//   THE BEGINNER PATH, from the same sheet's "Beginner Mehta Algs" page: the block and the middle layer
//   by thinking, then EO (5 algorithms), DCAL in two looks (the two free bottom corners, one at a time:
//   8 and 5), CDRLL in two looks (the top corners turned, 7, then placed, 2), the last bottom edge (1),
//   and EPLL (4). Its last steps meet the same cases as CFOP's two-look last layer.
//
// THE HOLD every row is written in: the block underneath at the LEFT (bottom-left and bottom-middle
// columns: DF, DL, DB, DLF, DBL and the bottom centre), the middle layer around it. In this app's
// colours that is white underneath, yellow on top, blue in front, red on the right.
//
// WHAT EACH ROW IS:
//   name      this repository's id: `<set>-<group>-<index>`, or `l5ep-<case>-<where>`
//   set       eole | 6co | 6cp | l5ep — or, on the beginner path, `step`
//   group     the sheet's column, whose meaning the test reads back off every picture:
//               EOLE  where the last middle-layer edge (FR's) is: GG/GB/BG/BB at UF, the first letter its
//                     orientation and the second that of the edge in the FR slot (G good, B bad); `solved`
//                     and `flipped` in FR itself; `dr-good` and `dr-bad` at DR
//               6CO   which side the white sticker of the corner at DFR faces, then of the one at DRB
//               6CP   where the DFR corner is and where the DRB corner is, numbering the six corners
//                     1 UFL, 2 ULB, 3 UBR, 4 URF, 5 DFR, 6 DRB (up to a turn of the top)
//               L5EP  the case's letter
//   index     the row's place in its column, counting from one
//   dEdge     L5EP only: where the gap the block leaves in the bottom layer is as the row is drawn — right,
//             front or back (the bottom turned by `bottom` to put it there, so a slice can reach it)
//   alg       what the app would teach
//   sourceAlg the cell as the sheet wrote it, present only where `alg` differs from it
//   line      which line of a multi-line cell `alg` is, present only where it is not the first
//   pre       the sheet's turn of the top BEFORE the algorithm, written "(U)" in the cell
//   bottom    the turn of the bottom layer the case is drawn with: the algorithm leaves the bottom turned
//             by this, and the inverse turn finishes it (the sheet writes that inverse as "(D)" at the end)
//   note      the sheet's own annotation, kept verbatim
//
// THE PICTURE of a row is the solved cube with its bottom turned by `bottom`, then the inverse of `alg`:
// what the cube looks like after `pre`, the moment before the algorithm. `mehta-algs.test.mjs` draws
// every row that way and holds it to its step: the block, the middle layer and whatever the earlier
// steps finished are in place up to a turn of the top and bottom, and the rows cover every case of the
// step once (6CP's `2-6` and `5-2` columns are the same six cases with the bottom turned first, and the
// test pins exactly those six pairs).
//
// THE CHANGES MADE TO A CELL, and the test admits these and nothing else: a leading "(U…)" moves to
// `pre`; a trailing "(D…)" becomes `bottom`; a trailing ": Right/Front/Back" becomes `dEdge`; `R2'`
// is written `R2`, `R3` is written `R'`, and `’` is `'`. Four EOLE cells (BB 8, flipped 3, dr-good 5,
// dr-bad 3) list first a line that begins with `u'` and assumes the middle layer is one turn off; their
// second line is the one that starts from the middle layer in place, and `line` says so.
//
// Fetched 2026-10-16.

/** Where the rows came from. A row's set names one of these. */
export const SOURCES = Object.freeze({
  'mehta-os': Object.freeze({
    url: 'https://docs.google.com/spreadsheets/d/1qY8c-ypPAn-51pDQOYI-DzpyMPnPAri2qOTh3ZG1fjw',
    what: 'Mehta-OS algorithm sheet — the EOLE, 6CO, 6CP, L5EP and "Beginner Mehta Algs" pages',
    fetched: '2026-10-16',
  }),
  'speedsolving-mehta': Object.freeze({
    url: 'https://www.speedsolving.com/wiki/index.php/Mehta',
    what: 'Speedsolving wiki, Mehta — the case counts: EOLE 55, 6CO 71, 6CP 47, L5EP 16',
    fetched: '2026-10-16',
  }),
});

const entry = (row) => Object.freeze(row);

/** The four full sets, in the order a solve meets them. */
export const MEHTA_ALGS = Object.freeze([
  entry({ name: 'eole-gg-1', set: 'eole', group: 'GG', index: 1, alg: "R U' R'" }),
  entry({ name: 'eole-gg-2', set: 'eole', group: 'GG', index: 2, alg: "U F R F' U2 R'" }),
  entry({ name: 'eole-gg-3', set: 'eole', group: 'GG', index: 3, alg: "U R F' U2 F R'" }),
  entry({ name: 'eole-gg-4', set: 'eole', group: 'GG', index: 4, alg: "U2 F R F' U R'" }),
  entry({ name: 'eole-gg-5', set: 'eole', group: 'GG', index: 5, alg: "S' R U' R' S" }),
  entry({ name: 'eole-gg-6', set: 'eole', group: 'GG', index: 6, alg: "R U' F R2 F' R", sourceAlg: "R U' F R2' F' R" }),
  entry({ name: 'eole-gg-7', set: 'eole', group: 'GG', index: 7, alg: "U2 S' R U R' S" }),
  entry({ name: 'eole-gg-8', set: 'eole', group: 'GG', index: 8, alg: "U S' U S R U2 R'" }),
  entry({ name: 'eole-gb-1', set: 'eole', group: 'GB', index: 1, alg: "U2 R F' U F R'" }),
  entry({ name: 'eole-gb-2', set: 'eole', group: 'GB', index: 2, alg: "R B U' B' R'" }),
  entry({ name: 'eole-gb-3', set: 'eole', group: 'GB', index: 3, alg: "U' R' F R F'" }),
  entry({ name: 'eole-gb-4', set: 'eole', group: 'GB', index: 4, alg: "r U' r' U' r U r'" }),
  entry({ name: 'eole-gb-5', set: 'eole', group: 'GB', index: 5, alg: "S' U R U2 R' S" }),
  entry({ name: 'eole-gb-6', set: 'eole', group: 'GB', index: 6, alg: "R U' R' S' U S" }),
  entry({ name: 'eole-gb-7', set: 'eole', group: 'GB', index: 7, alg: "U2 S' U' R U2 R' S" }),
  entry({ name: 'eole-gb-8', set: 'eole', group: 'GB', index: 8, alg: "U S' U' S U2 R' F R F'" }),
  entry({ name: 'eole-bg-1', set: 'eole', group: 'BG', index: 1, alg: "F R F' R'" }),
  entry({ name: 'eole-bg-2', set: 'eole', group: 'BG', index: 2, alg: "F R' F' R" }),
  entry({ name: 'eole-bg-3', set: 'eole', group: 'BG', index: 3, alg: "U' r U' r' U r U r'" }),
  entry({ name: 'eole-bg-4', set: 'eole', group: 'BG', index: 4, alg: "R U R' F' U' F" }),
  entry({ name: 'eole-bg-5', set: 'eole', group: 'BG', index: 5, alg: "S' U S U R U' R'" }),
  entry({ name: 'eole-bg-6', set: 'eole', group: 'BG', index: 6, alg: "U' S' U S R U R'" }),
  entry({ name: 'eole-bg-7', set: 'eole', group: 'BG', index: 7, alg: "U2 f' U2 F U' S" }),
  entry({ name: 'eole-bg-8', set: 'eole', group: 'BG', index: 8, alg: "r U r' U2 M' U M" }),
  entry({ name: 'eole-bb-1', set: 'eole', group: 'BB', index: 1, alg: "U F' U' F" }),
  entry({ name: 'eole-bb-2', set: 'eole', group: 'BB', index: 2, alg: "F' U F2 R F' R'" }),
  entry({ name: 'eole-bb-3', set: 'eole', group: 'BB', index: 3, alg: "D' r U r' D" }),
  entry({ name: 'eole-bb-4', set: 'eole', group: 'BB', index: 4, alg: "U' D' r B U B' r' D" }),
  entry({ name: 'eole-bb-5', set: 'eole', group: 'BB', index: 5, alg: "U R' D' r U' r' D R" }),
  entry({ name: 'eole-bb-6', set: 'eole', group: 'BB', index: 6, alg: "F R' F2 U' F U R" }),
  entry({ name: 'eole-bb-7', set: 'eole', group: 'BB', index: 7, alg: "U' R' D' r U r' D R" }),
  entry({ name: 'eole-bb-8', set: 'eole', group: 'BB', index: 8, alg: "D' r' U2 R U R' U r2 U r' D", sourceAlg: "D' r' U2' R U R' U r2 U r' D", line: 2 }),
  entry({ name: 'eole-solved-2', set: 'eole', group: 'solved', index: 2, alg: "R' F R2 F' R'" }),
  entry({ name: 'eole-solved-3', set: 'eole', group: 'solved', index: 3, alg: "F R U R' U' F'" }),
  entry({ name: 'eole-solved-4', set: 'eole', group: 'solved', index: 4, alg: "R F R2 F' R" }),
  entry({ name: 'eole-solved-5', set: 'eole', group: 'solved', index: 5, alg: "S' U S" }),
  entry({ name: 'eole-solved-6', set: 'eole', group: 'solved', index: 6, alg: "F R' F' R2 U2 R2 F R F'" }),
  entry({ name: 'eole-flipped-1', set: 'eole', group: 'flipped', index: 1, alg: "R U R' F R F' R'" }),
  entry({ name: 'eole-flipped-2', set: 'eole', group: 'flipped', index: 2, alg: "R' F R F' R U' R'" }),
  entry({ name: 'eole-flipped-3', set: 'eole', group: 'flipped', index: 3, alg: "U D' F' R U' R2 F R D", sourceAlg: "U D' F' R U' R2' F R D", line: 2 }),
  entry({ name: 'eole-flipped-4', set: 'eole', group: 'flipped', index: 4, alg: "F R F2 U' F R'" }),
  entry({ name: 'eole-flipped-5', set: 'eole', group: 'flipped', index: 5, alg: "R' F R F' U' R' F R F'" }),
  entry({ name: 'eole-flipped-6', set: 'eole', group: 'flipped', index: 6, alg: "S' U S R U2 R' F' U' F" }),
  entry({ name: 'eole-dr-good-1', set: 'eole', group: 'dr-good', index: 1, alg: "R' U' R U R" }),
  entry({ name: 'eole-dr-good-2', set: 'eole', group: 'dr-good', index: 2, alg: "R F R' F'" }),
  entry({ name: 'eole-dr-good-3', set: 'eole', group: 'dr-good', index: 3, alg: "R F U R' U' F'" }),
  entry({ name: 'eole-dr-good-4', set: 'eole', group: 'dr-good', index: 4, alg: "f' U f" }),
  entry({ name: 'eole-dr-good-5', set: 'eole', group: 'dr-good', index: 5, alg: "U D' M' U M U' r U r' D", line: 3 }),
  entry({ name: 'eole-dr-good-6', set: 'eole', group: 'dr-good', index: 6, alg: "R2 U2 R' U2 R' S' U' S" }),
  entry({ name: 'eole-dr-bad-1', set: 'eole', group: 'dr-bad', index: 1, alg: "R2 B U' B' R2" }),
  entry({ name: 'eole-dr-bad-2', set: 'eole', group: 'dr-bad', index: 2, alg: "F R F' U' R'" }),
  entry({ name: 'eole-dr-bad-3', set: 'eole', group: 'dr-bad', index: 3, alg: "D' r B U' B' r' D", line: 2 }),
  entry({ name: 'eole-dr-bad-4', set: 'eole', group: 'dr-bad', index: 4, alg: "D' r U' r' D" }),
  entry({ name: 'eole-dr-bad-5', set: 'eole', group: 'dr-bad', index: 5, alg: "S' U S R U' R'" }),
  entry({ name: 'eole-dr-bad-6', set: 'eole', group: 'dr-bad', index: 6, alg: "S' U S U' R' F R F'" }),
  entry({ name: '6co-dd-1', set: '6co', group: 'DD', index: 1, alg: "R' U2 R U R' U' R U R' U R" }),
  entry({ name: '6co-dd-2', set: '6co', group: 'DD', index: 2, alg: "R' U R' U2 R2 U' R' U2 R" }),
  entry({ name: '6co-dd-3', set: '6co', group: 'DD', index: 3, alg: "R U R' U R U2 R'" }),
  entry({ name: '6co-dd-4', set: '6co', group: 'DD', index: 4, alg: "R U2 R' U' R U' R'" }),
  entry({ name: '6co-dd-5', set: '6co', group: 'DD', index: 5, alg: "F U' R2 U R2 U F'", sourceAlg: "(U') F U' R2 U R2 U F'", pre: "U'" }),
  entry({ name: '6co-dd-6', set: '6co', group: 'DD', index: 6, alg: "R D' R U2 R' D R'" }),
  entry({ name: '6co-dd-7', set: '6co', group: 'DD', index: 7, alg: "R D' R U' R' D R'" }),
  entry({ name: '6co-rr-1', set: '6co', group: 'RR', index: 1, alg: "R U' R' U2 R' U' R U2 R U' R" }),
  entry({ name: '6co-rr-2', set: '6co', group: 'RR', index: 2, alg: "R U' R' U' D' R U' R' D R U' R'" }),
  entry({ name: '6co-rr-3', set: '6co', group: 'RR', index: 3, alg: "R U' R' D' U' R U2 R' D" }),
  entry({ name: '6co-rr-4', set: '6co', group: 'RR', index: 4, alg: "R' U R D U R' U2 R D'" }),
  entry({ name: '6co-rr-5', set: '6co', group: 'RR', index: 5, alg: "R U' R U' R' U R U' R' U2 R'" }),
  entry({ name: '6co-rr-6', set: '6co', group: 'RR', index: 6, alg: "R U R2 U' R U2 R U' R" }),
  entry({ name: '6co-rr-7', set: '6co', group: 'RR', index: 7, alg: "R U R U2 R' U R'" }),
  entry({ name: '6co-rr-8', set: '6co', group: 'RR', index: 8, alg: "R U R U' R' U R U' R' U R'" }),
  entry({ name: '6co-fb-1', set: '6co', group: 'FB', index: 1, alg: "R' U' R D R' U' R U' D' R' U' R" }),
  entry({ name: '6co-fb-2', set: '6co', group: 'FB', index: 2, alg: "R U R' U2 R U' R U' R' U' R'", sourceAlg: "(U) R U R' U2 R U' R U' R' U' R'", pre: 'U' }),
  entry({ name: '6co-fb-3', set: '6co', group: 'FB', index: 3, alg: "D' R U' R' D U' R U2 R'" }),
  entry({ name: '6co-fb-4', set: '6co', group: 'FB', index: 4, alg: "D R' U R D' U R' U2 R" }),
  entry({ name: '6co-fb-5', set: '6co', group: 'FB', index: 5, alg: "R2 U2 R' U R' U2 R U R'" }),
  entry({ name: '6co-fb-6', set: '6co', group: 'FB', index: 6, alg: "R' U2 R' U' R U R' U' R U' R" }),
  entry({ name: '6co-fb-7', set: '6co', group: 'FB', index: 7, alg: "R U' R' D' R U' R' U R U R' D" }),
  entry({ name: '6co-fb-8', set: '6co', group: 'FB', index: 8, alg: "R U' R U R' U2 R U' R' U R'" }),
  entry({ name: '6co-rd-1', set: '6co', group: 'RD', index: 1, alg: "R' D' R U R' D R" }),
  entry({ name: '6co-rd-2', set: '6co', group: 'RD', index: 2, alg: "R U2 R U R' U R'" }),
  entry({ name: '6co-rd-3', set: '6co', group: 'RD', index: 3, alg: "R' U2 D' R U R' U D R" }),
  entry({ name: '6co-rd-4', set: '6co', group: 'RD', index: 4, alg: "R U' R' U R U2 R' U R U' R'" }),
  entry({ name: '6co-rd-5', set: '6co', group: 'RD', index: 5, alg: "R U' R' U2 R U' R'" }),
  entry({ name: '6co-rd-6', set: '6co', group: 'RD', index: 6, alg: "R U' D R' U2 R U' D' R'" }),
  entry({ name: '6co-rd-7', set: '6co', group: 'RD', index: 7, alg: "R U' R U' R2 U' R2 U R' U2 R'" }),
  entry({ name: '6co-rd-8', set: '6co', group: 'RD', index: 8, alg: "R' U2 R U R2 U' R U2 R" }),
  entry({ name: '6co-fd-1', set: '6co', group: 'FD', index: 1, alg: "D' R U' R' D R U R'" }),
  entry({ name: '6co-fd-2', set: '6co', group: 'FD', index: 2, alg: "R U' D' R U' R' U2 D R'" }),
  entry({ name: '6co-fd-3', set: '6co', group: 'FD', index: 3, alg: "R U2 R' U R U R'" }),
  entry({ name: '6co-fd-4', set: '6co', group: 'FD', index: 4, alg: "R U R' U2 R U R'" }),
  entry({ name: '6co-fd-5', set: '6co', group: 'FD', index: 5, alg: "D' R U R' U D R U2 R'" }),
  entry({ name: '6co-fd-6', set: '6co', group: 'FD', index: 6, alg: "R2 U R' U R U2 R' U R'" }),
  entry({ name: '6co-fd-7', set: '6co', group: 'FD', index: 7, alg: "R U' R' U' R U' R' U R U2 R'" }),
  entry({ name: '6co-fd-8', set: '6co', group: 'FD', index: 8, alg: "R U2 R' U R U' R' U' R U' R'" }),
  entry({ name: '6co-dr-1', set: '6co', group: 'DR', index: 1, alg: "R D R' U R D' R'" }),
  entry({ name: '6co-dr-2', set: '6co', group: 'DR', index: 2, alg: "R' U R U R' U2 R" }),
  entry({ name: '6co-dr-3', set: '6co', group: 'DR', index: 3, alg: "D' R U2 R' U R U R' D" }),
  entry({ name: '6co-dr-4', set: '6co', group: 'DR', index: 4, alg: "D' R U R' U2 R U R' D" }),
  entry({ name: '6co-dr-5', set: '6co', group: 'DR', index: 5, alg: "R' U R U2 R' U R" }),
  entry({ name: '6co-dr-6', set: '6co', group: 'DR', index: 6, alg: "F R2 U R2 U' F'" }),
  entry({ name: '6co-dr-7', set: '6co', group: 'DR', index: 7, alg: "R U2 R U' R2 U R U2 R'" }),
  entry({ name: '6co-dr-8', set: '6co', group: 'DR', index: 8, alg: "R U2 R' U' R2 U R' U2 R'" }),
  entry({ name: '6co-db-1', set: '6co', group: 'DB', index: 1, alg: "R' D R' U' R D' R" }),
  entry({ name: '6co-db-2', set: '6co', group: 'DB', index: 2, alg: "R2 U2 R' U R' U R U2 R'" }),
  entry({ name: '6co-db-3', set: '6co', group: 'DB', index: 3, alg: "R' U2 R U' R' U' R" }),
  entry({ name: '6co-db-4', set: '6co', group: 'DB', index: 4, alg: "R' U' R U2 R' U' R" }),
  entry({ name: '6co-db-5', set: '6co', group: 'DB', index: 5, alg: "D' R U' R' U2 R U' R' D" }),
  entry({ name: '6co-db-6', set: '6co', group: 'DB', index: 6, alg: "F U R2 U' R2 F'" }),
  entry({ name: '6co-db-7', set: '6co', group: 'DB', index: 7, alg: "R' U R U R' U R U' R' U2 R" }),
  entry({ name: '6co-db-8', set: '6co', group: 'DB', index: 8, alg: "R' U2 R U R' U' R U' R' U' R" }),
  entry({ name: '6co-fr-1', set: '6co', group: 'FR', index: 1, alg: "R U' R U' R' U2 R'" }),
  entry({ name: '6co-fr-2', set: '6co', group: 'FR', index: 2, alg: "R U2 R U' R2 U2 R U R'" }),
  entry({ name: '6co-fr-3', set: '6co', group: 'FR', index: 3, alg: "R U R' U R U R U' R' U2 R'" }),
  entry({ name: '6co-fr-4', set: '6co', group: 'FR', index: 4, alg: "R U2 R' U D' R U R' D" }),
  entry({ name: '6co-fr-5', set: '6co', group: 'FR', index: 5, alg: "R U R' U' R2 U' R2 U' R U R'" }),
  entry({ name: '6co-fr-6', set: '6co', group: 'FR', index: 6, alg: "R U2 R' U R' U R2 U' R" }),
  entry({ name: '6co-fr-7', set: '6co', group: 'FR', index: 7, alg: "R' U R U' R U' R U R'" }),
  entry({ name: '6co-fr-8', set: '6co', group: 'FR', index: 8, alg: "R U' R U2 R' U R' U R U R'" }),
  entry({ name: '6co-rb-1', set: '6co', group: 'RB', index: 1, alg: "R' U R' U R U2 R" }),
  entry({ name: '6co-rb-2', set: '6co', group: 'RB', index: 2, alg: "R2 U' R' U R U2 R' U R'" }),
  entry({ name: '6co-rb-3', set: '6co', group: 'RB', index: 3, alg: "R2 U' D R' U2 R U D' R' U R'" }),
  entry({ name: '6co-rb-4', set: '6co', group: 'RB', index: 4, alg: "D' R U' R' D U2 R U' R'" }),
  entry({ name: '6co-rb-5', set: '6co', group: 'RB', index: 5, alg: "R' U' R U2 R' U' D' R U R' D R" }),
  entry({ name: '6co-rb-6', set: '6co', group: 'RB', index: 6, alg: "R' U' R U2 D R' U' R D'" }),
  entry({ name: '6co-rb-7', set: '6co', group: 'RB', index: 7, alg: "R U' R' U R' U R' U' R" }),
  entry({ name: '6co-rb-8', set: '6co', group: 'RB', index: 8, alg: "R' U' D' R U' R' D R U' R' U' R" }),
  entry({ name: '6cp-5-6-2', set: '6cp', group: '5-6', index: 2, alg: "R U R' F' R U R' U' R' F R2 U' R'" }),
  entry({ name: '6cp-5-6-3', set: '6cp', group: '5-6', index: 3, alg: "R U' R' U R U' D' R2 U R D R U' D' R2", sourceAlg: "R U' R' U R U' D' R2 U R D R U' D' R2 (D)", bottom: "D'" }),
  entry({ name: '6cp-6-5-1', set: '6cp', group: '6-5', index: 1, alg: "F R U R U' R' F' R U' R U R2 U' R" }),
  entry({ name: '6cp-6-5-2', set: '6cp', group: '6-5', index: 2, alg: "R U' R' D' R U R2 D R U' R' D' R", sourceAlg: "R U' R' D' R U R2 D R U' R' D' R (D)", bottom: "D'" }),
  entry({ name: '6cp-6-5-3', set: '6cp', group: '6-5', index: 3, alg: "R D R' U2 R U' D' R' D' R U R'", sourceAlg: "R D R' U2 R U' D' R' D' R U R' (D)", bottom: "D'" }),
  entry({ name: '6cp-2-6-1', set: '6cp', group: '2-6', index: 1, alg: "R2 U2 R2 U' R2 U' R2" }),
  entry({ name: '6cp-2-6-2', set: '6cp', group: '2-6', index: 2, alg: "U' D R2 U2 R2 U R2 U R2", sourceAlg: "U' D R2 U2 R2 U R2 U R2 (D')", bottom: 'D' }),
  entry({ name: '6cp-2-6-3', set: '6cp', group: '2-6', index: 3, alg: "U2 x R' U R U' R' U R U' R' U R U' x'" }),
  entry({ name: '6cp-2-6-4', set: '6cp', group: '2-6', index: 4, alg: "D' R2 U R2 U' R2 D R2" }),
  entry({ name: '6cp-2-6-5', set: '6cp', group: '2-6', index: 5, alg: "U R2 D' R2 U R2 U' R2", sourceAlg: "U R2 D' R2 U R2 U' R2 (D)", bottom: "D'" }),
  entry({ name: '6cp-2-6-6', set: '6cp', group: '2-6', index: 6, alg: "R2 U R2 U' R2 D R2 U' R2 U R2", sourceAlg: "R2 U R2 U' R2 D R2 U' R2 U R2 (D')", bottom: 'D' }),
  entry({ name: '6cp-6-2-1', set: '6cp', group: '6-2', index: 1, alg: "R2 U2 F U F' R2 F U' F'" }),
  entry({ name: '6cp-6-2-2', set: '6cp', group: '6-2', index: 2, alg: "U' R' F' R U R2 U' R' F R U' R2" }),
  entry({ name: '6cp-6-2-3', set: '6cp', group: '6-2', index: 3, alg: "U2 R2 U' D R2 U' R2 U R2", sourceAlg: "U2 R2 U' D R2 U' R2 U R2 (D')", bottom: 'D' }),
  entry({ name: '6cp-6-2-4', set: '6cp', group: '6-2', index: 4, alg: "U' R2 U' R2" }),
  entry({ name: '6cp-6-2-5', set: '6cp', group: '6-2', index: 5, alg: "R2 U' R2 U' R2 D R2 U' R2 U R2", sourceAlg: "R2 U' R2 U' R2 D R2 U' R2 U R2 (D')", bottom: 'D' }),
  entry({ name: '6cp-6-2-6', set: '6cp', group: '6-2', index: 6, alg: "U' x R' D' R U2 R' D R U2 x'" }),
  entry({ name: '6cp-5-2-1', set: '6cp', group: '5-2', index: 1, alg: "D' R2 U2 R2 U' R2 U' R2", sourceAlg: "D' R2 U2 R2 U' R2 U' R2 (D)", bottom: "D'" }),
  entry({ name: '6cp-5-2-2', set: '6cp', group: '5-2', index: 2, alg: "U' R2 U2 R2 U R2 U R2" }),
  entry({ name: '6cp-5-2-3', set: '6cp', group: '5-2', index: 3, alg: "U2 D' x R' U R U' R' U R U' R' U R U' x'", sourceAlg: "U2 D' x R' U R U' R' U R U' R' U R U' x' (D)", bottom: "D'" }),
  entry({ name: '6cp-5-2-4', set: '6cp', group: '5-2', index: 4, alg: "U2 R2 D R2 U' R2 U R2", sourceAlg: "U2 R2 D R2 U' R2 U R2 (D')", bottom: 'D' }),
  entry({ name: '6cp-5-2-5', set: '6cp', group: '5-2', index: 5, alg: "U' D R2 U' R2 U R2 D' R2" }),
  entry({ name: '6cp-5-2-6', set: '6cp', group: '5-2', index: 6, alg: "U' R2 U' R2 U R2 D' R2 U R2 U' R2", sourceAlg: "U' R2 U' R2 U R2 D' R2 U R2 U' R2 (D)", bottom: "D'" }),
  entry({ name: '6cp-2-5-1', set: '6cp', group: '2-5', index: 1, alg: "U' R2 U R2 D' R2 D R2 U R2 D' R2", sourceAlg: "U' R2 U R2 D' R2 D R2 U R2 D' R2 (D)", bottom: "D'" }),
  entry({ name: '6cp-2-5-2', set: '6cp', group: '2-5', index: 2, alg: "U' R2 U F U F' R2 F U' F'" }),
  entry({ name: '6cp-2-5-3', set: '6cp', group: '2-5', index: 3, alg: "U R2 U D' R2 U R2 U' R2", sourceAlg: "U R2 U D' R2 U R2 U' R2 (D)", bottom: "D'" }),
  entry({ name: '6cp-2-5-4', set: '6cp', group: '2-5', index: 4, alg: "U R U2 R' D' R' D R' D' R' U2 R'", sourceAlg: "U R U2 R' D' R' D R' D' R' U2 R' (D)", bottom: "D'" }),
  entry({ name: '6cp-2-5-5', set: '6cp', group: '2-5', index: 5, alg: 'R2 U R2' }),
  entry({ name: '6cp-2-5-6', set: '6cp', group: '2-5', index: 6, alg: "R U R' U R U' R' D' R U R' U' R U' R'", sourceAlg: "R U R' U R U' R' D' R U R' U' R U' R' (D)", bottom: "D'" }),
  entry({ name: '6cp-2-3-1', set: '6cp', group: '2-3', index: 1, alg: "U' R2 U2 R2" }),
  entry({ name: '6cp-2-3-2', set: '6cp', group: '2-3', index: 2, alg: "R2 U' R2 U2 R2 U' D' R2 U R2 U' R2", sourceAlg: "R2 U' R2 U2 R2 U' D' R2 U R2 U' R2 (D)", bottom: "D'" }),
  entry({ name: '6cp-2-3-3', set: '6cp', group: '2-3', index: 3, alg: "U' R F' R2 F R U R' F' R2 F R U R2" }),
  entry({ name: '6cp-2-3-4', set: '6cp', group: '2-3', index: 4, alg: "R2 U R2 U R2 D R2 U' R2 U R2", sourceAlg: "R2 U R2 U R2 D R2 U' R2 U R2 (D')", bottom: 'D' }),
  entry({ name: '6cp-2-3-5', set: '6cp', group: '2-3', index: 5, alg: "U D' R U' R' U2 D R2 U2 R2 D' R U R'", sourceAlg: "U D' R U' R' U2 D R2 U2 R2 D' R U R' (D)", bottom: "D'" }),
  entry({ name: '6cp-2-3-6', set: '6cp', group: '2-3', index: 6, alg: "U2 R2 U R2 U' R2 U' D' R2 U R2 U' R2", sourceAlg: "U2 R2 U R2 U' R2 U' D' R2 U R2 U' R2 (D)", bottom: "D'" }),
  entry({ name: '6cp-3-2-1', set: '6cp', group: '3-2', index: 1, alg: "U2 D' R U' R U R' D R D' R' U R2 U2 R2", sourceAlg: "U2 D' R U' R U R' D R D' R' U R2 U2 R2 (D)", bottom: "D'" }),
  entry({ name: '6cp-3-2-2', set: '6cp', group: '3-2', index: 2, alg: "U2 D' R2 U R2 U D R2 U2 D' R2", sourceAlg: "U2 D' R2 U R2 U D R2 U2 D' R2 (D)", bottom: "D'" }),
  entry({ name: '6cp-3-2-3', set: '6cp', group: '3-2', index: 3, alg: "R2 U2 D' R2 U R2 U' R2", sourceAlg: "R2 U2 D' R2 U R2 U' R2 (D)", bottom: "D'" }),
  entry({ name: '6cp-3-2-4', set: '6cp', group: '3-2', index: 4, alg: "F2 D' r2 D r U' r F2 r' U r", sourceAlg: "F2 D' r2 D r U' r F2 r' U r (D)", bottom: "D'" }),
  entry({ name: '6cp-3-2-5', set: '6cp', group: '3-2', index: 5, alg: "R2 U R2 U' R2 U R2" }),
  entry({ name: '6cp-3-2-6', set: '6cp', group: '3-2', index: 6, alg: "D' R2 U R2 D R2 U' D' R2", sourceAlg: "D' R2 U R2 D R2 U' D' R2 (D)", bottom: "D'" }),
  entry({ name: '6cp-1-3-1', set: '6cp', group: '1-3', index: 1, alg: "R2 U R2 U' R2 U2 R2" }),
  entry({ name: '6cp-1-3-2', set: '6cp', group: '1-3', index: 2, alg: "U R2 U D R2 U' R2 U R2", sourceAlg: "U R2 U D R2 U' R2 U R2 (D')", bottom: 'D' }),
  entry({ name: '6cp-1-3-3', set: '6cp', group: '1-3', index: 3, alg: "U2 R2 U' R2 D' R2 D R2 U' R2 D' R2", sourceAlg: "U2 R2 U' R2 D' R2 D R2 U' R2 D' R2 (D)", bottom: "D'" }),
  entry({ name: '6cp-1-3-4', set: '6cp', group: '1-3', index: 4, alg: "U R2 U R2 D' R2 U R2 U R2 U2 R2", sourceAlg: "U R2 U R2 D' R2 U R2 U R2 U2 R2 (D)", bottom: "D'" }),
  entry({ name: '6cp-1-3-5', set: '6cp', group: '1-3', index: 5, alg: "U R D R' D' R2 U R D R2 U' D' R" }),
  entry({ name: '6cp-1-3-6', set: '6cp', group: '1-3', index: 6, alg: "U2 R2 U' D' R2 U R2 U' R2", sourceAlg: "U2 R2 U' D' R2 U R2 U' R2 (D)", bottom: "D'" }),
  entry({ name: 'l5ep-i-right', set: 'l5ep', group: 'I', dEdge: 'right', alg: "S R2 S' R2", sourceAlg: "S R2' S' R2: Right" }),
  entry({ name: 'l5ep-i-front', set: 'l5ep', group: 'I', dEdge: 'front', alg: "M' U2 M", sourceAlg: "(U') M' U2 M: Front", pre: "U'", bottom: "D'" }),
  entry({ name: 'l5ep-i-back', set: 'l5ep', group: 'I', dEdge: 'back', alg: "M U2 M'", sourceAlg: "(U) M U2 M': Back", pre: 'U', bottom: 'D' }),
  entry({ name: 'l5ep-ua', set: 'l5ep', group: 'Ua', alg: "M2 U M U2 M' U M2" }),
  entry({ name: 'l5ep-ub', set: 'l5ep', group: 'Ub', alg: "M2 U' M U2 M' U' M2" }),
  entry({ name: 'l5ep-pa-right', set: 'l5ep', group: 'Pa', dEdge: 'right', alg: "R U R' U' R' U' R' U R", sourceAlg: "R U R' U' R' U' R' U R: Right" }),
  entry({ name: 'l5ep-pa-right-2', set: 'l5ep', group: 'Pa', dEdge: 'right', alg: "R U R' S R2 S' R' U' R'", sourceAlg: "(U2) R U R' S R2 S' R3 U' R': Right", pre: 'U2' }),
  entry({ name: 'l5ep-pa-front', set: 'l5ep', group: 'Pa', dEdge: 'front', alg: "M U2 M U' M' U2 M'", sourceAlg: "(U') M U2 M U' M' U2 M': Front", pre: "U'", bottom: "D'" }),
  entry({ name: 'l5ep-pa-back', set: 'l5ep', group: 'Pa', dEdge: 'back', alg: "M' U2 M' U' M U2 M", sourceAlg: "(U) M' U2 M' U' M U2 M: Back", pre: 'U', bottom: 'D' }),
  entry({ name: 'l5ep-pb-right', set: 'l5ep', group: 'Pb', dEdge: 'right', alg: "R' U' R U R U R U' R'", sourceAlg: "R' U' R U R U R U' R': Right" }),
  entry({ name: 'l5ep-pb-right-2', set: 'l5ep', group: 'Pb', dEdge: 'right', alg: "R U' R' S R2 S' R' U R'", sourceAlg: "(U2) R U' R' S R2 S' R3 U R': Right", pre: 'U2' }),
  entry({ name: 'l5ep-pb-front', set: 'l5ep', group: 'Pb', dEdge: 'front', alg: "M U2 M U M' U2 M'", sourceAlg: "(U') M U2 M U M' U2 M': Front", pre: "U'", bottom: "D'" }),
  entry({ name: 'l5ep-pb-back', set: 'l5ep', group: 'Pb', dEdge: 'back', alg: "M' U2 M' U M U2 M", sourceAlg: "(U) M' U2 M' U M U2 M: Back", pre: 'U', bottom: 'D' }),
  entry({ name: 'l5ep-h', set: 'l5ep', group: 'H', alg: 'M2 U M2 U2 M2 U M2' }),
  entry({ name: 'l5ep-z', set: 'l5ep', group: 'Z', alg: 'M2 U2 M U M2 U M2 U M' }),
  entry({ name: 'l5ep-z-2', set: 'l5ep', group: 'Z', alg: "M' U M2 U M2 U M' U2 M2" }),
  entry({ name: 'l5ep-ca-right', set: 'l5ep', group: 'Ca', dEdge: 'right', alg: "R U R' U R' U' R2 U' R' U2 R U R U' R'", sourceAlg: "R U R' U R' U' R2 U' R' U2 R U R U' R': Right" }),
  entry({ name: 'l5ep-ca-right-2', set: 'l5ep', group: 'Ca', dEdge: 'right', alg: "r2 B2 U' R2 B2 r2 U' B2", sourceAlg: "r2 B2 U' R2 B2 r2 U' B2: Right" }),
  entry({ name: 'l5ep-ca-front', set: 'l5ep', group: 'Ca', dEdge: 'front', alg: "M U2 M' U M' U2 M' U' M2", sourceAlg: "(U) M U2 M' U M' U2 M' U' M2: Front", pre: 'U', bottom: "D'" }),
  entry({ name: 'l5ep-ca-back', set: 'l5ep', group: 'Ca', dEdge: 'back', alg: "M2 U M' U2 M' U' M' U2 M", sourceAlg: "(U') M2 U M' U2 M' U' M' U2 M: Back", pre: "U'", bottom: 'D' }),
  entry({ name: 'l5ep-cb-right', set: 'l5ep', group: 'Cb', dEdge: 'right', alg: "F2 U' r2 F2 R2 U' F2 r2", sourceAlg: "F2 U' r2 F2 R2 U' F2 r2: Right" }),
  entry({ name: 'l5ep-cb-front', set: 'l5ep', group: 'Cb', dEdge: 'front', alg: "M U2 M' U' M' U2 M' U M2", sourceAlg: "(U) M U2 M' U' M' U2 M' U M2: Front", pre: 'U', bottom: "D'" }),
  entry({ name: 'l5ep-cb-back', set: 'l5ep', group: 'Cb', dEdge: 'back', alg: "M2 U' M' U2 M' U M' U2 M", sourceAlg: "(U') M2 U' M' U2 M' U M' U2 M: Back", pre: "U'", bottom: 'D' }),
  entry({ name: 'l5ep-d-right', set: 'l5ep', group: 'D', dEdge: 'right', alg: 'R U2 R2 U2 R2 U2 R', sourceAlg: 'R U2 R2 U2 R2 U2 R: Right' }),
  entry({ name: 'l5ep-d-front', set: 'l5ep', group: 'D', dEdge: 'front', alg: "M U M2 U2 M2 U M'", sourceAlg: "(U) M U M2 U2 M2 U M': Front", pre: 'U', bottom: "D'" }),
  entry({ name: 'l5ep-d-back', set: 'l5ep', group: 'D', dEdge: 'back', alg: "M' U' M2 U2 M2 U' M", sourceAlg: "(U') M' U' M2 U2 M2 U' M: Back", pre: "U'", bottom: 'D' }),
  entry({ name: 'l5ep-wa-right', set: 'l5ep', group: 'Wa', dEdge: 'right', alg: "S R2 S' R2 U' S R2 S' R2", sourceAlg: "S R2' S' R2 U' S R2' S' R2: Right" }),
  entry({ name: 'l5ep-wa-front', set: 'l5ep', group: 'Wa', dEdge: 'front', alg: "M' U2 M U M' U2 M", sourceAlg: "(U') M' U2 M U M' U2 M: Front", pre: "U'", bottom: "D'" }),
  entry({ name: 'l5ep-wa-back', set: 'l5ep', group: 'Wa', dEdge: 'back', alg: "M U2 M' U M U2 M'", sourceAlg: "(U) M U2 M' U M U2 M': Back", pre: 'U', bottom: 'D' }),
  entry({ name: 'l5ep-wb-right', set: 'l5ep', group: 'Wb', dEdge: 'right', alg: "S R2 S' R2 U S R2 S' R2", sourceAlg: "S R2' S' R2 U S R2' S' R2: Right" }),
  entry({ name: 'l5ep-wb-front', set: 'l5ep', group: 'Wb', dEdge: 'front', alg: "M' U2 M U' M' U2 M", sourceAlg: "(U') M' U2 M U' M' U2 M: Front", pre: "U'", bottom: "D'" }),
  entry({ name: 'l5ep-wb-back', set: 'l5ep', group: 'Wb', dEdge: 'back', alg: "M U2 M' U' M U2 M'", sourceAlg: "(U) M U2 M' U' M U2 M': Back", pre: 'U', bottom: 'D' }),
  entry({ name: 'l5ep-qa-right', set: 'l5ep', group: 'Qa', dEdge: 'right', alg: "R U R' U R' U' R' U' R2 U2 R", sourceAlg: "R U R' U R' U' R' U' R2 U2 R: Right" }),
  entry({ name: 'l5ep-qa-front', set: 'l5ep', group: 'Qa', dEdge: 'front', alg: "M' U2 M' U M' U2 M U M2", sourceAlg: "(U) M' U2 M' U M' U2 M U M2: Front", pre: 'U', bottom: "D'" }),
  entry({ name: 'l5ep-qa-back', set: 'l5ep', group: 'Qa', dEdge: 'back', alg: "M2 U' M U2 M' U' M' U2 M'", sourceAlg: "(U') M2 U' M U2 M' U' M' U2 M': Back", pre: "U'", bottom: 'D' }),
  entry({ name: 'l5ep-qb-right', set: 'l5ep', group: 'Qb', dEdge: 'right', alg: "R U2 R2 U' R' U' R' U R' U R", sourceAlg: "(U') R U2 R2' U' R' U' R3 U R' U R: Right", pre: "U'" }),
  entry({ name: 'l5ep-qb-right-2', set: 'l5ep', group: 'Qb', dEdge: 'right', alg: "R' U' R U' R U R U R2 U2 R'", sourceAlg: "R' U' R U' R U R U R2 U2 R': Right" }),
  entry({ name: 'l5ep-qb-front', set: 'l5ep', group: 'Qb', dEdge: 'front', alg: "M' U2 M' U' M' U2 M U' M2", sourceAlg: "(U) M' U2 M' U' M' U2 M U' M2: Front", pre: 'U', bottom: "D'" }),
  entry({ name: 'l5ep-qb-back', set: 'l5ep', group: 'Qb', dEdge: 'back', alg: "M2 U M U2 M' U M' U2 M'", sourceAlg: "(U') M2 U M U2 M' U M' U2 M': Back", pre: "U'", bottom: 'D' }),
  entry({ name: 'l5ep-oa-right', set: 'l5ep', group: 'Oa', dEdge: 'right', alg: "R' U' R U' R U R U' R2 U2 R", sourceAlg: "R' U' R U' R U R U' R2 U2 R: Right" }),
  entry({ name: 'l5ep-oa-front', set: 'l5ep', group: 'Oa', dEdge: 'front', alg: "M2 U M2 U M U2 M'", sourceAlg: "(U) M2 U M2 U M U2 M': Front", pre: 'U', bottom: "D'" }),
  entry({ name: 'l5ep-oa-back', set: 'l5ep', group: 'Oa', dEdge: 'back', alg: "M2 U M2 U M' U2 M", sourceAlg: "(U') M2 U M2 U M' U2 M: Back", pre: "U'", bottom: 'D' }),
  entry({ name: 'l5ep-ob-right', set: 'l5ep', group: 'Ob', dEdge: 'right', alg: "R U R' U R' U' R' U R2 U2 R'", sourceAlg: "R U R' U R' U' R' U R2 U2 R': Right" }),
  entry({ name: 'l5ep-ob-front', set: 'l5ep', group: 'Ob', dEdge: 'front', alg: "M2 U' M2 U' M U2 M'", sourceAlg: "(U) M2 U' M2 U' M U2 M': Front", pre: 'U', bottom: "D'" }),
  entry({ name: 'l5ep-ob-back', set: 'l5ep', group: 'Ob', dEdge: 'back', alg: "M2 U' M2 U' M' U2 M", sourceAlg: "(U') M2 U' M2 U' M' U2 M: Back", pre: "U'", bottom: 'D' }),
]);

/** The beginner path, step by step, in the order a solve meets them. */
export const MEHTA_BEGINNER = Object.freeze([
  entry({ name: 'beginner-eo-1', step: 'eo', alg: "F R U R' U' F'" }),
  entry({ name: 'beginner-eo-2', step: 'eo', alg: "R F R2 F' R" }),
  entry({ name: 'beginner-eo-3', step: 'eo', alg: "R' F R2 F' R'", note: '(UF-DR)' }),
  entry({ name: 'beginner-eo-4', step: 'eo', alg: "S' U S", note: '(UF-UR-UB-DR)' }),
  entry({ name: 'beginner-eo-5', step: 'eo', alg: "R2 U2 R2 S' U S" }),
  entry({ name: 'beginner-dcal-1-1', step: 'dcal-1', alg: "R2 U' R2", sourceAlg: "(U) R2 U' R2", pre: 'U' }),
  entry({ name: 'beginner-dcal-1-2', step: 'dcal-1', alg: "R' D R' U R D' R" }),
  entry({ name: 'beginner-dcal-1-3', step: 'dcal-1', alg: "R' U R' U2 R U R", sourceAlg: "(U2) R' U R' U2 R U R", pre: 'U2' }),
  entry({ name: 'beginner-dcal-1-4', step: 'dcal-1', alg: 'R2 U R2' }),
  entry({ name: 'beginner-dcal-1-5', step: 'dcal-1', alg: "R2 U' R' D R' U R D' R'" }),
  entry({ name: 'beginner-dcal-1-6', step: 'dcal-1', alg: "R2 U2 R' S' U2 S R" }),
  entry({ name: 'beginner-dcal-1-7', step: 'dcal-1', alg: "R2 U R' S' U2 S R" }),
  entry({ name: 'beginner-dcal-1-8', step: 'dcal-1', alg: "R' U R' U2 R U R' U' R2" }),
  entry({ name: 'beginner-dcal-2-1', step: 'dcal-2', alg: "R D' R U R' D R'", sourceAlg: "(U2) R D' R U R' D R'", pre: 'U2' }),
  entry({ name: 'beginner-dcal-2-2', step: 'dcal-2', alg: "R' D' R U' R' D R", sourceAlg: "(U) R' D' R U' R' D R", pre: 'U' }),
  entry({ name: 'beginner-dcal-2-3', step: 'dcal-2', alg: "R D' R U' R' D R'", sourceAlg: "(U') R D' R U' R' D R'", pre: "U'" }),
  entry({ name: 'beginner-dcal-2-4', step: 'dcal-2', alg: "R U2 R U R' U R U2 R2" }),
  entry({ name: 'beginner-dcal-2-5', step: 'dcal-2', alg: "R U R' U' R U2 R' U' R U R'" }),
  entry({ name: 'beginner-cdrll-1-1', step: 'cdrll-1', alg: "R U R' U R U' R' U R U2 R'", sourceAlg: "(U) R U R' U R U' R' U R U2 R'", pre: 'U' }),
  entry({ name: 'beginner-cdrll-1-2', step: 'cdrll-1', alg: "R' U2 R2 U R2 U R2 U2 R'", sourceAlg: "(U') R' U2 R2 U R2 U R2 U2 R'", pre: "U'" }),
  entry({ name: 'beginner-cdrll-1-3', step: 'cdrll-1', alg: "R U R' U R U2 R'" }),
  entry({ name: 'beginner-cdrll-1-4', step: 'cdrll-1', alg: "R U2 R' U' R U' R'" }),
  entry({ name: 'beginner-cdrll-1-5', step: 'cdrll-1', alg: "R' U' D R' U' R U2 D' R", sourceAlg: "(U2) R' U' D R' U' R U2 D' R", pre: 'U2' }),
  entry({ name: 'beginner-cdrll-1-6', step: 'cdrll-1', alg: "R' U' R' D' R U R' D R2", sourceAlg: "(U2) R' U' R' D' R U R' D R2", pre: 'U2' }),
  entry({ name: 'beginner-cdrll-1-7', step: 'cdrll-1', alg: "R2 D' R U' R' D R U R", sourceAlg: "(U2) R2 D' R U' R' D R U R", pre: 'U2' }),
  entry({ name: 'beginner-cdrll-2-1', step: 'cdrll-2', alg: "R U R' F' R U R' U' R' F R2 U' R'" }),
  entry({ name: 'beginner-cdrll-2-2', step: 'cdrll-2', alg: "F R U' R' U' R U R' F' R U R' U' R' F R F'" }),
  entry({ name: 'beginner-d-edge-1', step: 'd-edge', alg: "S R2 S' R2", sourceAlg: "S R2' S' R2" }),
  entry({ name: 'beginner-epll-1', step: 'epll', alg: "M2 U M U2 M' U M2" }),
  entry({ name: 'beginner-epll-2', step: 'epll', alg: "M2 U' M U2 M' U' M2" }),
  entry({ name: 'beginner-epll-3', step: 'epll', alg: 'M2 U M2 U2 M2 U M2' }),
  entry({ name: 'beginner-epll-4', step: 'epll', alg: "M' U M2 U M2 U M' U2 M2" }),
]);

const ofSet = (set) => Object.freeze(MEHTA_ALGS.filter((row) => row.set === set));
export const MEHTA_EOLE = ofSet('eole');
export const MEHTA_6CO = ofSet('6co');
export const MEHTA_6CP = ofSet('6cp');
export const MEHTA_L5EP = ofSet('l5ep');

/** The beginner path's steps, in order: what each finishes is pinned by `mehta-algs.test.mjs`. */
export const MEHTA_BEGINNER_STEPS = Object.freeze(['eo', 'dcal-1', 'dcal-2', 'cdrll-1', 'cdrll-2', 'd-edge', 'epll']);
