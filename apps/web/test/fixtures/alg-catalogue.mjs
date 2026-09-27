// The catalogue's shape. GENERATED — do not hand-edit.
//
//   regenerate: node apps/web/bench/alg-catalogue.mjs --emit
//   re-verify:  node --test apps/web/test/alg-catalogue.test.mjs
//
// The entries themselves are NOT here: they live in lib/alg-catalogue.js, computed from the
// repertoires. This records how many there are, of what kind, with which effects — and a digest
// over every field of every entry, so a change the census cannot see still fails.

export const CATALOGUE_CENSUS = Object.freeze({
  "count": 137,
  "byDial": {
    "cross": 2,
    "oll": 60,
    "pairs": 49,
    "pll": 26
  },
  "byStage": {
    "cross": 2,
    "f2l": 44,
    "first-layer": 3,
    "middle-layer": 2,
    "top-corners": 24,
    "top-cross": 1,
    "top-edges": 2,
    "top-face": 59
  },
  "byHold": {
    "D B": 132,
    "U F": 5
  },
  "provenanceCounts": {
    "1": 131,
    "2": 6
  },
  "signatures": 62,
  "signatureCensus": {
    "c[2,2] e[2,2] t0 f0": 3,
    "c[2,2] e[2,2] t2 f2": 1,
    "c[2,2] e[2,2] t2 f4": 1,
    "c[2,2] e[2,2] t4 f0": 1,
    "c[2,2] e[2,2] t4 f2": 1,
    "c[2,2] e[3,3] t3 f4": 1,
    "c[2,2] e[3] t2 f2": 7,
    "c[2,2] e[3] t3 f0": 2,
    "c[2,2] e[3] t3 f2": 7,
    "c[2,2] e[3] t4 f0": 1,
    "c[2,2] e[3] t4 f2": 3,
    "c[2,2] e[3] t4 f4": 1,
    "c[2,2] e[] t0 f0": 1,
    "c[2,2] e[] t4 f2": 1,
    "c[2] e[2] t0 f0": 2,
    "c[2] e[2] t2 f2": 4,
    "c[2] e[2] t3 f2": 1,
    "c[2] e[4] t0 f0": 1,
    "c[2] e[4] t2 f2": 2,
    "c[3,2] e[3,2] t3 f2": 2,
    "c[3,2] e[4] t2 f2": 4,
    "c[3,2] e[4] t2 f4": 1,
    "c[3,2] e[4] t3 f2": 1,
    "c[3] e[2,2] t0 f0": 1,
    "c[3] e[2,2] t2 f4": 2,
    "c[3] e[2,2] t3 f2": 1,
    "c[3] e[2,2] t4 f4": 1,
    "c[3] e[3] t0 f0": 7,
    "c[3] e[3] t2 f2": 6,
    "c[3] e[3] t3 f2": 3,
    "c[3] e[3] t4 f2": 4,
    "c[3] e[3] t5 f2": 1,
    "c[3] e[5] t2 f2": 2,
    "c[3] e[5] t3 f2": 1,
    "c[3] e[5] t5 f2": 1,
    "c[3] e[] t0 f0": 4,
    "c[3] e[] t2 f0": 4,
    "c[4] e[2] t0 f0": 2,
    "c[4] e[2] t2 f4": 1,
    "c[4] e[2] t4 f0": 1,
    "c[4] e[3,2] t3 f0": 2,
    "c[4] e[3,2] t3 f2": 2,
    "c[4] e[3,2] t4 f0": 1,
    "c[4] e[3,2] t5 f2": 2,
    "c[4] e[4] t0 f0": 2,
    "c[4] e[4] t2 f2": 3,
    "c[4] e[4] t3 f0": 5,
    "c[4] e[4] t3 f2": 7,
    "c[4] e[4] t3 f4": 2,
    "c[4] e[4] t4 f0": 1,
    "c[4] e[4] t5 f4": 1,
    "c[5] e[3] t2 f2": 1,
    "c[5] e[3] t3 f2": 1,
    "c[5] e[3] t4 f2": 1,
    "c[5] e[5] t3 f0": 2,
    "c[5] e[5] t3 f4": 1,
    "c[] e[2,2] t0 f4": 1,
    "c[] e[3] t0 f0": 4,
    "c[] e[3] t0 f2": 2,
    "c[] e[3] t3 f0": 1,
    "c[] e[3] t4 f0": 1,
    "c[] e[3] t4 f2": 3
  },
  "orders": {
    "2": 11,
    "3": 34,
    "4": 21,
    "5": 3,
    "6": 26,
    "8": 1,
    "9": 5,
    "12": 15,
    "15": 3,
    "18": 4,
    "24": 5,
    "30": 2,
    "36": 1,
    "45": 2,
    "72": 4
  },
  "moveLengths": {
    "shortest": 1,
    "longest": 17
  },
  "sets": [
    "cross-inserts",
    "f1l-inserts",
    "middle-inserts",
    "f2l-triggers",
    "eoll",
    "ocll",
    "cpll",
    "epll",
    "f2l-full",
    "oll-full",
    "pll-full"
  ],
  "notAlgorithms": [
    "align",
    "turn"
  ],
  "digest": "dc1cf7216eb546010ae17a482cbaf9b93199cc0beb3872d64d9df7023b403a40"
});
