// CMLL: the 42 algorithms Roux solvers learn for the top corners, one per case, copied from the sheet they
// learn from.
//
// SOURCED, the way `human-algs.js` is: nobody here derived these. CMLL solves the four top corners while
// keeping both blocks, and is free to move the six edges left — which is why it is not OLL's corners or
// any table this repository proves. `cmll-algs.test.mjs` re-derives each row with **cubejs**: every
// algorithm keeps both blocks and solves exactly one case, and the 42 rows cover the 42 cases once.
//
// WHAT EACH ROW IS:
//   name    this repository's id for the row — `cmll-sune-left-bar`
//   label   the name SpeedCubeDB gives the case — "Sune Left Bar"
//   set     the corner-orientation set it belongs to: O, H, Pi, U, T, Sune, Anti Sune or L
//   alg     what the app teaches, exactly as the source writes it — no row differs from its source
//   source  a key into `SOURCES`
//
// Fetched 2026-10-17 from the page's own markup, not retyped: each row is the first algorithm SpeedCubeDB
// lists for the case (its top-voted) under the case's own orientation. Several begin with a turn of the top;
// that turn is part of the source's algorithm, because the source draws each case from its own angle.

/** Where the rows came from. */
export const SOURCES = Object.freeze({
  speedcubedb: Object.freeze({ name: 'SpeedCubeDB', url: 'https://www.speedcubedb.com/a/3x3/CMLL', fetched: '2026-10-17' }),
});

const row = (name, label, set, alg) => Object.freeze({ name, label, set, alg, source: 'speedcubedb' });

/** The 42 CMLL rows, in the source's order. */
export const CMLL_ALGS = Object.freeze([
  row('cmll-o-adjacent', 'O Adjacent', 'O', "R U R' F' R U R' U' R' F R2 U' R'"),
  row('cmll-o-diagonal', 'O Diagonal', 'O', "F R U' R' U' R U R' F' R U R' U' R' F R F'"),
  row('cmll-h-columns', 'H Columns', 'H', "U R U R' U R U' R' U R U2 R'"),
  row('cmll-h-rows', 'H Rows', 'H', "F R U R' U' R U R' U' R U R' U' F'"),
  row('cmll-h-column', 'H Column', 'H', "R' F2 D R2 U R2 D' F2 R"),
  row('cmll-h-row', 'H Row', 'H', "U2 r U' r2 D' r U' r' D r2 U r'"),
  row('cmll-pi-right-bar', 'Pi Right Bar', 'Pi', "F R U R' U' R U R' U' F'"),
  row('cmll-pi-down-slash', 'Pi Down Slash', 'Pi', "U F R' F' R U2 R U' R' U R U2 R'"),
  row('cmll-pi-x', 'Pi X', 'Pi', "R' F2 D R2 U' R2 D' F2 R"),
  row('cmll-pi-up-slash', 'Pi Up Slash', 'Pi', "R U2 R' U' R U R' U2 R' F R F'"),
  row('cmll-pi-columns', 'Pi Columns', 'Pi', "U' r U' r2 D' r U r' D r2 U r'"),
  row('cmll-pi-left-bar', 'Pi Left Bar', 'Pi', "U' R' U' R' F R F' R U' R' U2 R"),
  row('cmll-u-up-slash', 'U Up Slash', 'U', "U2 R2 D R' U2 R D' R' U2 R'"),
  row('cmll-u-down-slash', 'U Down Slash', 'U', "R2 D' R U2 R' D R U2 R"),
  row('cmll-u-bottom-row', 'U Bottom Row', 'U', "R' U' R U' R' U2 R2 U R' U R U2 R'"),
  row('cmll-u-rows', 'U Rows', 'U', "U' F R2 D R' U R D' R2 U' F'"),
  row('cmll-u-x', 'U X', 'U', "U2 r U' r' U r' D' r U' r' D r"),
  row('cmll-u-upper-row', 'U Upper Row', 'U', "U' F R U R' U' F'"),
  row('cmll-t-left-bar', 'T Left Bar', 'T', "U' R U R' U' R' F R F'"),
  row('cmll-t-right-bar', 'T Right Bar', 'T', "U L' U' L U L F' L' F"),
  row('cmll-t-rows', 'T Rows', 'T', "R U2 R' U' R U' R2 U2 R U R' U R"),
  row('cmll-t-bottom-row', 'T Bottom Row', 'T', "r' U r U2 R2 F R F' R"),
  row('cmll-t-top-row', 'T Top Row', 'T', "r' D' r U r' D r U' r U r'"),
  row('cmll-t-columns', 'T Columns', 'T', "U2 r U' r2 D' r U2 r' D r2 U r'"),
  row('cmll-sune-left-bar', 'Sune Left Bar', 'Sune', "U R U R' U R U2 R'"),
  row('cmll-sune-x', 'Sune X', 'Sune', "U L' U2 L U2 r U' r' F"),
  row('cmll-sune-up-slash', 'Sune Up Slash', 'Sune', "U F R' F' R U2 R U2 R'"),
  row('cmll-sune-columns', 'Sune Columns', 'Sune', "U R U R' U' R' F R F' R U R' U R U2 R'"),
  row('cmll-sune-right-bar', 'Sune Right Bar', 'Sune', "U' R U R' U R' F R F' R U2 R'"),
  row('cmll-sune-down-slash', 'Sune Down Slash', 'Sune', "U r U' r' F R' F' R"),
  row('cmll-anti-sune-right-bar', 'Anti Sune Right Bar', 'Anti Sune', "U R' U' R U' R' U2 R"),
  row('cmll-anti-sune-columns', 'Anti Sune Columns', 'Anti Sune', "U2 R U R2 F' r F R U' r2 F r"),
  row('cmll-anti-sune-down-slash', 'Anti Sune Down Slash', 'Anti Sune', "U' F' L F L' U2 L' U2 L"),
  row('cmll-anti-sune-x', 'Anti Sune X', 'Anti Sune', "U' R U2 R' U2 R' F R F'"),
  row('cmll-anti-sune-up-slash', 'Anti Sune Up Slash', 'Anti Sune', "U' R' F R F' r U r'"),
  row('cmll-anti-sune-left-bar', 'Anti Sune Left Bar', 'Anti Sune', "U R U2 R' F R' F' R U' R U' R'"),
  row('cmll-l-best', 'L Best', 'L', "U' F' r U r' U' r' F r"),
  row('cmll-l-good', 'L Good', 'L', "U2 F R' F' R U R U' R'"),
  row('cmll-l-pure', 'L Pure', 'L', "R U R' U R U' R' U R U' R' U R U2 R'"),
  row('cmll-l-front-commutator', 'L Front Commutator', 'L', "U2 R U2 R D R' U2 R D' R2"),
  row('cmll-l-diagonal', 'L Diagonal', 'L', "U2 R U2 R2 F R F' R U2 R'"),
  row('cmll-l-back-commutator', 'L Back Commutator', 'L', "U R' U2 R' D' R U2 R' D R2"),
]);
