// A corners-first method for beginners, as Josef Jelinek published it — sourced, never derived here.
//
// HAND-COPIED, AND SOURCED, like `human-algs.js`. Corners first is how Rubik first solved the cube (1974) and
// how Minh Thai won the first world championship (1982): every corner before any edge, then the edges and
// centres without disturbing a corner. Jelinek's beginner method publishes every step of that with 24
// sequences, and every step is small enough to check exhaustively, which `corners-first-algs.test.mjs` does.
//
// THE STEPS, in the order a solve meets them:
//   bottom-corners   the four white corners underneath, one at a time (white held DOWN)
//   top-corners-place  the four top corners to their places, ignoring their twist: the corner sequence swaps
//                    the two on the top right
//   top-corners-twist  then twisted: the twist sequence twists the two on the top left, opposite ways
//   centres          no sequence: turn the middle slices until the white centre is underneath again
//   ledges           three of the four white edges (the cube now held with white on the LEFT)
//   redges           all four yellow edges, on the right
//   last-ledge       the fourth white edge
//   midges-flip      the four edges of the middle slice turned the right way round
//   midges-place     and put in place
//
// THE HOLDS: the corner steps are written with white underneath; the edge steps with white on the left and
// yellow on the right, which is the same cube turned a quarter about the front-back axis. Through the edge
// steps the left and right layers turn freely — each carries its own four corners — and the corners are
// solved once both are turned back.
//
// WHAT EACH ROW IS:
//   name      this repository's id: `cf-<step>-<index>`
//   step      one of `CF_STEPS`
//   at, facing  where the piece the row is for sits, and which side its white (or, for a yellow edge, its
//             yellow) sticker faces — read off the cube, because the page's captions name a view of a picture
//             drawn from a turned angle ("bottom-front" is white-down for a first white edge and white-front for
//             the last one). The test holds every row to these.
//   case      Jelinek's caption for the row, verbatim
//   alg       what the app would teach
//   sourceAlg the moves as the page printed them, present only where `alg` differs
//
// THE CHANGES MADE TO A SEQUENCE, and the test admits these and nothing else:
//   1. A move printed twice in a row is written as the half turn it is: `U U` is `U2`, `Y Y` is `y2`
//      (the page prints the whole-cube turn in capitals).
//   2. A whole-cube turn the page leaves open is closed at the end: the twist sequence turns the cube `y2`
//      halfway through, and here it turns it back, so it ends held as it began.
//   3. ONE CORRECTION. "Ledge in top-left (flipped in its place)" is printed `U' M U U M M U`, whose turns of
//      the top add up to a half turn: it leaves the top corners a half turn from the bottom ones. Its mirror
//      on the yellow side, `U M U U M M U`, adds up to nothing, and so does `U' M U2 M2 U'`, which flips the
//      white edge in its place exactly as the caption says. The test holds both halves of that claim.
//
// Fetched 2026-10-16 from the Internet Archive's copy of 2020-11-12; the site itself no longer serves the page.

/** Where the rows came from. */
export const SOURCES = Object.freeze({
  'jelinek-beginner': Object.freeze({
    url: 'https://web.archive.org/web/20201112014226/http://rubikscube.info/beginner.php',
    what: "Josef Jelinek, Corners-First Solution Method for Rubik's Cube — for Beginners (rubikscube.info, 2000–2015)",
  }),
  'speedsolving-corners-first': Object.freeze({
    url: 'https://www.speedsolving.com/wiki/index.php/Corners_First',
    what: 'Speedsolving wiki, Corners First — the history, and the beginner outline the steps follow',
  }),
});

/** The steps, in order. `centres` has no sequence: it is a turn of the middle slices. */
export const CF_STEPS = Object.freeze([
  'bottom-corners', 'top-corners-place', 'top-corners-twist', 'centres',
  'ledges', 'redges', 'last-ledge', 'midges-flip', 'midges-place',
]);

const entry = (row) => Object.freeze(row);

export const CF_ALGS = Object.freeze([
  entry({ name: 'cf-bottom-corners-1', step: 'bottom-corners', at: 'URF', facing: 'F', case: 'cubie in the top layer, bottom sticker on the front side', alg: "F' U' F" }),
  entry({ name: 'cf-bottom-corners-2', step: 'bottom-corners', at: 'URF', facing: 'R', case: 'cubie in the top layer, bottom sticker on the right side', alg: "R U R'" }),
  entry({ name: 'cf-bottom-corners-3', step: 'bottom-corners', at: 'URF', facing: 'U', case: 'bottom sticker on the top side', alg: "R U' R' U2", sourceAlg: "R U' R' U U" }),
  entry({ name: 'cf-bottom-corners-4', step: 'bottom-corners', at: 'DFR', facing: 'F', case: 'cubie in the bottom layer, bottom sticker on the front side', alg: "R U' R'" }),
  entry({ name: 'cf-bottom-corners-5', step: 'bottom-corners', at: 'DFR', facing: 'R', case: 'cubie in the bottom layer, bottom sticker on the right side', alg: "F' U F" }),
  entry({ name: 'cf-top-corners-place-1', step: 'top-corners-place', case: 'remove corner, position the top layer, and restore corner', alg: "R U R' U' F' U' F" }),
  entry({ name: 'cf-top-corners-twist-1', step: 'top-corners-twist', case: 'apply normal corner sequence, turn cube, apply mirrored corner sequence', alg: "R U R' U' F' U' F y2 L' U' L U F U F' y2", sourceAlg: "R U R' U' F' U' F Y Y L' U' L U F U F'" }),
  entry({ name: 'cf-ledges-1', step: 'ledges', at: 'DF', facing: 'D', case: 'ledge in bottom-front', alg: "U' M' U" }),
  entry({ name: 'cf-ledges-2', step: 'ledges', at: 'DF', facing: 'F', case: 'ledge in front-bottom', alg: "U M2 U'", sourceAlg: "U M M U'" }),
  entry({ name: 'cf-ledges-3', step: 'ledges', at: 'UR', facing: 'U', case: 'ledge in top-right', alg: "U' M U" }),
  entry({ name: 'cf-ledges-4', step: 'ledges', at: 'UR', facing: 'R', case: 'ledge in right-top', alg: "U M U2 M' U", sourceAlg: "U M U U M' U" }),
  entry({ name: 'cf-ledges-5', step: 'ledges', at: 'UL', facing: 'U', case: 'ledge in top-left (flipped in its place)', alg: "U' M U2 M2 U'", sourceAlg: "U' M U U M M U" }),
  entry({ name: 'cf-redges-1', step: 'redges', at: 'DF', facing: 'D', case: 'redge in bottom-front', alg: "U M' U'" }),
  entry({ name: 'cf-redges-2', step: 'redges', at: 'DF', facing: 'F', case: 'redge in front-bottom', alg: "U' M2 U", sourceAlg: "U' M M U" }),
  entry({ name: 'cf-redges-3', step: 'redges', at: 'UL', facing: 'U', case: 'redge in top-left', alg: "U M U'" }),
  entry({ name: 'cf-redges-4', step: 'redges', at: 'UL', facing: 'L', case: 'redge in left-top', alg: "U' M U2 M' U'", sourceAlg: "U' M U U M' U'" }),
  entry({ name: 'cf-redges-5', step: 'redges', at: 'UR', facing: 'U', case: 'redge in top-right (flipped in its place)', alg: "U M U2 M2 U", sourceAlg: "U M U U M M U" }),
  entry({ name: 'cf-last-ledge-1', step: 'last-ledge', at: 'DF', facing: 'F', case: 'ledge in bottom-front', alg: "U' M U2 M U'", sourceAlg: "U' M U U M U'" }),
  entry({ name: 'cf-last-ledge-2', step: 'last-ledge', at: 'DB', facing: 'B', case: 'ledge in bottom-back', alg: "U M' U2 M' U", sourceAlg: "U M' U U M' U" }),
  entry({ name: 'cf-midges-flip-1', step: 'midges-flip', case: 'two top midges flipped', alg: "M' U M' U M' U2 M U M U M U2", sourceAlg: "M' U M' U M' U U M U M U M U U" }),
  entry({ name: 'cf-midges-place-1', step: 'midges-place', case: 'three midges in forward cycle', alg: "U2 M U2 M'", sourceAlg: "U U M U U M'" }),
  entry({ name: 'cf-midges-place-2', step: 'midges-place', case: 'three midges in backward cycle', alg: "U2 M' U2 M", sourceAlg: "U U M' U U M" }),
  entry({ name: 'cf-midges-place-3', step: 'midges-place', case: 'two top midges and two bottom midges swapped', alg: 'U2 M2 U2 M2', sourceAlg: 'U U M M U U M M' }),
  entry({ name: 'cf-midges-place-4', step: 'midges-place', case: 'two and two midges diagonally swapped', alg: 'E2 M E2 M', sourceAlg: 'E E M E E M' }),
]);

/** One step's rows, in the page's order. */
export const cfStep = (step) => CF_ALGS.filter((row) => row.step === step);
