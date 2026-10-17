// The algorithm ledger. GENERATED — do not hand-edit.
//
//   regenerate: node apps/web/bench/algorithm-ledger.mjs --emit
//   re-verify:  node --test apps/web/test/algorithm-ledger.test.mjs
//
// What this repository holds, per set and per method, and what it does not. The sets themselves are
// NOT copied here — they live in lib/methods/ (the hand-written tables), lib/data/human-algs.js and
// lib/data/cmll-algs.js (the sourced ones) and lib/data/case-tables.js (the proved ones), and copying
// them would make a second place for an algorithm to be wrong. This records the shape: sizes,
// lengths, provenance, which method needs which, and what is missing. A method the solve tab offers
// carries its registry id (lib/methods/registry.js); one it does not carries `id: null`.
//
// `unmeasured: true` marks a size taken from the cubing community rather than measured here, the
// same way cubus-im-solving-methods.md marks the one CFOP figure nothing in either repo has measured.

export const ALGORITHM_SETS = Object.freeze([
  {
    "id": "cross-inserts",
    "name": "Cross inserts",
    "kind": "hand-written",
    "provenance": "written for teaching, not searched. Two ways to drop a cross edge in from the top.",
    "verified": "every entry must be reachable and used — `method-solver` refuses a step naming anything outside CASE_NAMES",
    "count": 2,
    "distinct": 2,
    "shortest": 1,
    "longest": 4,
    "mean": 2.5,
    "moves": 5
  },
  {
    "id": "f1l-inserts",
    "name": "First-layer corner inserts",
    "kind": "hand-written",
    "provenance": "the beginner trigger and its repeat, in the three orientations a corner can be in",
    "verified": "same as above",
    "count": 3,
    "distinct": 3,
    "shortest": 3,
    "longest": 7,
    "mean": 4.33,
    "moves": 13
  },
  {
    "id": "middle-inserts",
    "name": "Middle-layer edge inserts",
    "kind": "hand-written",
    "provenance": "one pair that both inserts a correct edge and ejects a wrong one, which is how it is taught",
    "verified": "same as above",
    "count": 2,
    "distinct": 2,
    "shortest": 8,
    "longest": 8,
    "mean": 8,
    "moves": 16
  },
  {
    "id": "f2l-triggers",
    "name": "F2L triggers",
    "kind": "hand-written",
    "provenance": "CFOP (easy)'s first two layers: six triggers a pair is built out of, rather than 41 cases",
    "verified": "same as above",
    "count": 6,
    "distinct": 6,
    "shortest": 3,
    "longest": 3,
    "mean": 3,
    "moves": 18
  },
  {
    "id": "eoll",
    "name": "Two-look OLL, first look",
    "kind": "hand-written",
    "provenance": "one algorithm, applied up to three times, to orient the last-layer edges",
    "verified": "same as above",
    "count": 1,
    "distinct": 1,
    "shortest": 6,
    "longest": 6,
    "mean": 6,
    "moves": 6
  },
  {
    "id": "ocll",
    "name": "Two-look OLL, second look",
    "kind": "hand-written",
    "provenance": "the corner-orientation cases in face turns only, by choice: the first algorithms a learner meets need no notation beyond the six faces. The renderer and the interpreter read wide turns and slices too; the sourced sets use them",
    "verified": "same as above",
    "count": 5,
    "distinct": 5,
    "shortest": 7,
    "longest": 11,
    "mean": 8.6,
    "moves": 43
  },
  {
    "id": "cpll",
    "name": "Two-look PLL, corners",
    "kind": "hand-written",
    "provenance": "adjacent swap both ways round, plus the diagonal",
    "verified": "same as above",
    "count": 3,
    "distinct": 3,
    "shortest": 9,
    "longest": 17,
    "mean": 11.67,
    "moves": 35
  },
  {
    "id": "epll",
    "name": "Two-look PLL, edges",
    "kind": "hand-written",
    "provenance": "two U-perms; Z and H fall out of applying two of them",
    "verified": "same as above",
    "count": 2,
    "distinct": 2,
    "shortest": 11,
    "longest": 11,
    "mean": 11,
    "moves": 22
  },
  {
    "id": "course-edges",
    "name": "The course's top edges",
    "kind": "hand-written",
    "provenance": "the beginner course's lessons 13 and 14 (cubus-courses): the cross on top, then a swap of two top edges",
    "verified": "same as above; and `bench/method-solver-profile.mjs exhaustive course course` walks all 62,208 last-layer states through the course's route (a nightly CI shard)",
    "count": 2,
    "distinct": 2,
    "shortest": 6,
    "longest": 8,
    "mean": 7,
    "moves": 14
  },
  {
    "id": "course-corners",
    "name": "The course's top corners",
    "kind": "hand-written",
    "provenance": "the beginner course's lessons 15 and 16: three corners moved round, then lesson 9's four moves done twice or four times to turn one corner up",
    "verified": "same as above",
    "count": 3,
    "distinct": 3,
    "shortest": 8,
    "longest": 16,
    "mean": 10.67,
    "moves": 32
  },
  {
    "id": "align",
    "name": "Alignment",
    "kind": "not an algorithm",
    "provenance": "an EMPTY body, so the AUF the repertoire already adds IS the alignment. Deliberately outside PLL_ALGS: \"turn the top until it matches\" is not something anyone memorises",
    "verified": "its absence once made a one-turn cube get a nineteen-move lesson (audit, 2026-09-09)",
    "count": 1,
    "distinct": 1,
    "shortest": 0,
    "longest": 0,
    "mean": 0,
    "moves": 0
  },
  {
    "id": "turn",
    "name": "Turning a slot to the front",
    "kind": "not an algorithm",
    "provenance": "an EMPTY body, named so a pairs step's parts add up to its algorithm: the turn of the whole cube that brings a slot to the front right. A regrip, not something anyone memorises",
    "verified": "a part a pairs step names, so it is in CASE_NAMES; held here so that every name a step can carry is filed somewhere",
    "count": 1,
    "distinct": 1,
    "shortest": 0,
    "longest": 0,
    "mean": 0,
    "moves": 0
  },
  {
    "id": "f2l-human",
    "name": "F2L, human-speed",
    "kind": "sourced",
    "provenance": "SpeedCubeDB's top-voted Front Right algorithm per case; what CFOP (full) teaches for its first two layers",
    "verified": "`human-algs.test.mjs`: cubejs finds each answers exactly its proved case, and the 41 cover the 41 once each",
    "count": 41,
    "distinct": 41,
    "shortest": 3,
    "longest": 12,
    "mean": 7.98,
    "moves": 327
  },
  {
    "id": "oll-human",
    "name": "Full OLL, human-speed",
    "kind": "sourced",
    "provenance": "J Perm's first-listed algorithm per case; what CFOP (full) teaches for the top face",
    "verified": "same cubejs check, 57 to 57",
    "count": 57,
    "distinct": 57,
    "shortest": 6,
    "longest": 15,
    "mean": 10.04,
    "moves": 572
  },
  {
    "id": "pll-human",
    "name": "Full PLL, human-speed",
    "kind": "sourced",
    "provenance": "J Perm's first-listed algorithm per case; what CFOP (full) teaches for the last layer",
    "verified": "same cubejs check, 21 to 21",
    "count": 21,
    "distinct": 21,
    "shortest": 9,
    "longest": 21,
    "mean": 13.95,
    "moves": 293
  },
  {
    "id": "cmll",
    "name": "CMLL",
    "kind": "sourced",
    "provenance": "SpeedCubeDB's top-voted algorithm per case, fetched 2026-10-17 from the page's markup and taught exactly as written; what Roux teaches for the top corners",
    "verified": "`cmll-algs.test.mjs`: cubejs finds every row keeps both blocks and the centres, the 42 rows answer the 42 cases once each, and no row solves the arrangement none is for",
    "count": 42,
    "distinct": 42,
    "shortest": 7,
    "longest": 17,
    "mean": 10.79,
    "moves": 453
  },
  {
    "id": "f2l-full",
    "name": "F2L, all cases",
    "kind": "proved",
    "provenance": "searched in `crates/optimal-solver`, proven minimal in the half-turn metric, certified",
    "verified": "`f2l-cross-check` refutes every case by brute force with no heuristic; `case-tables.test.mjs` re-runs the generator and diffs the shipped module",
    "count": 41,
    "distinct": 41,
    "shortest": 3,
    "longest": 9,
    "mean": 6.9,
    "moves": 283
  },
  {
    "id": "oll-full",
    "name": "Full OLL",
    "kind": "proved",
    "provenance": "same search; one algorithm per case so the top face is one look",
    "verified": "certified over all 1,152 (alignment, goal) pairs; same generator diff",
    "count": 57,
    "distinct": 57,
    "shortest": 6,
    "longest": 12,
    "mean": 9.37,
    "moves": 534
  },
  {
    "id": "pll-full",
    "name": "Full PLL",
    "kind": "proved",
    "provenance": "same search; the 288-state goal set checked against the published Cube Explorer distribution",
    "verified": "the distribution matched Cube Explorer entry for entry, mean 11.642361; same generator diff",
    "count": 21,
    "distinct": 21,
    "shortest": 9,
    "longest": 14,
    "mean": 11.48,
    "moves": 241
  }
]);

export const METHOD_ALGORITHMS = Object.freeze([
  {
    "id": "quick",
    "method": "Quick",
    "phases": [
      {
        "phase": "Whole cube",
        "intuitive": "NONE. The two-phase search (`lib/two-phase.js`) answers; there is nothing to memorise"
      }
    ],
    "sets": [],
    "held": 0,
    "heldMoves": 0,
    "missing": []
  },
  {
    "id": "beginner",
    "method": "Beginner",
    "phases": [
      {
        "stage": "cross",
        "phase": "Cross",
        "held": [
          "cross-inserts"
        ]
      },
      {
        "stage": "pairs",
        "phase": "First two layers",
        "held": [
          "f1l-inserts",
          "middle-inserts"
        ]
      },
      {
        "stage": "oll",
        "phase": "Top face",
        "held": [
          "course-edges"
        ]
      },
      {
        "stage": "pll",
        "phase": "Last layer",
        "held": [
          "course-corners"
        ]
      }
    ],
    "sets": [
      "cross-inserts",
      "f1l-inserts",
      "middle-inserts",
      "course-edges",
      "course-corners"
    ],
    "held": 12,
    "heldMoves": 80,
    "missing": []
  },
  {
    "id": "cfop-4lll",
    "method": "CFOP (easy)",
    "phases": [
      {
        "stage": "cross",
        "phase": "Cross",
        "intuitive": "planned whole: an exact distance table is descended — no algorithm at all"
      },
      {
        "stage": "pairs",
        "phase": "First two layers",
        "held": [
          "f2l-triggers",
          "f1l-inserts",
          "middle-inserts"
        ]
      },
      {
        "stage": "oll",
        "phase": "Top face",
        "held": [
          "eoll",
          "ocll"
        ]
      },
      {
        "stage": "pll",
        "phase": "Last layer",
        "held": [
          "cpll",
          "epll"
        ]
      }
    ],
    "sets": [
      "f2l-triggers",
      "f1l-inserts",
      "middle-inserts",
      "eoll",
      "ocll",
      "cpll",
      "epll"
    ],
    "held": 20,
    "heldMoves": 147,
    "missing": []
  },
  {
    "id": "cfop",
    "method": "CFOP (full)",
    "phases": [
      {
        "stage": "cross",
        "phase": "Cross",
        "intuitive": "planned whole: an exact distance table is descended — no algorithm at all"
      },
      {
        "stage": "pairs",
        "phase": "First two layers",
        "held": [
          "f2l-human",
          "f1l-inserts",
          "middle-inserts"
        ]
      },
      {
        "stage": "oll",
        "phase": "Top face",
        "held": [
          "oll-human"
        ]
      },
      {
        "stage": "pll",
        "phase": "Last layer",
        "held": [
          "pll-human"
        ]
      }
    ],
    "sets": [
      "f2l-human",
      "f1l-inserts",
      "middle-inserts",
      "oll-human",
      "pll-human"
    ],
    "held": 121,
    "heldMoves": 1208,
    "missing": []
  },
  {
    "id": "roux",
    "method": "Roux",
    "phases": [
      {
        "stage": "first-block",
        "phase": "Left block",
        "intuitive": "block building, found by search: a shipped exact distance table is descended — no table of algorithms"
      },
      {
        "stage": "second-block",
        "phase": "Right block",
        "intuitive": "block building, found by search: a shipped exact distance table"
      },
      {
        "stage": "cmll",
        "phase": "Top corners",
        "held": [
          "cmll"
        ]
      },
      {
        "stage": "lse",
        "phase": "Last six edges",
        "intuitive": "found by search with the middle slice: exact distance tables, no table of algorithms"
      }
    ],
    "sets": [
      "cmll"
    ],
    "held": 42,
    "heldMoves": 453,
    "missing": []
  },
  {
    "id": null,
    "method": "Petrus",
    "phases": [
      {
        "phase": "2x2x2 and 2x2x3",
        "intuitive": "block building"
      },
      {
        "phase": "Edge orientation",
        "intuitive": "a recognition rule rather than a sequence"
      },
      {
        "phase": "Two layers",
        "intuitive": "block building"
      },
      {
        "phase": "Last layer",
        "held": "ocll",
        "also": [
          "cpll",
          "epll"
        ],
        "note": "Petrus finishes with the same last layer the app already teaches, so this one costs nothing new"
      }
    ],
    "sets": [
      "ocll",
      "cpll",
      "epll"
    ],
    "held": 10,
    "heldMoves": 100,
    "missing": []
  },
  {
    "id": null,
    "method": "ZZ",
    "phases": [
      {
        "phase": "EOLine",
        "intuitive": "planned, and the hardest part of the method to learn"
      },
      {
        "phase": "EO F2L",
        "intuitive": "block building with no F or B turns"
      },
      {
        "phase": "Last layer",
        "held": "ocll",
        "also": [
          "cpll",
          "epll"
        ],
        "note": "ZZ-a finishes with OCLL and PLL, which are held. ZZ-b with full ZBLL is 493 algorithms and is not"
      }
    ],
    "sets": [
      "ocll",
      "cpll",
      "epll"
    ],
    "held": 10,
    "heldMoves": 100,
    "missing": []
  },
  {
    "id": null,
    "method": "Corners first",
    "phases": [
      {
        "phase": "Corners",
        "missing": "a corner-only set",
        "size": null,
        "unmeasured": true
      },
      {
        "phase": "Edges",
        "missing": "an edge-only set",
        "size": null,
        "unmeasured": true
      }
    ],
    "sets": [],
    "held": 0,
    "heldMoves": 0,
    "missing": [
      "a corner-only set",
      "an edge-only set"
    ]
  },
  {
    "id": null,
    "method": "Mehta",
    "phases": [
      {
        "phase": "First block",
        "intuitive": "block building"
      },
      {
        "phase": "Belt and edge orientation",
        "missing": "EOLE",
        "size": null,
        "unmeasured": true
      },
      {
        "phase": "6CO",
        "missing": "6CO",
        "size": null,
        "unmeasured": true
      },
      {
        "phase": "6CP",
        "missing": "6CP",
        "size": null,
        "unmeasured": true
      },
      {
        "phase": "L5EP",
        "missing": "L5EP",
        "size": null,
        "unmeasured": true
      }
    ],
    "sets": [],
    "held": 0,
    "heldMoves": 0,
    "missing": [
      "EOLE",
      "6CO",
      "6CP",
      "L5EP"
    ]
  },
  {
    "id": null,
    "method": "Thistlethwaite",
    "phases": [
      {
        "phase": "G1 to G4",
        "intuitive": "NONE. A computer method searches each coset; there is nothing to memorise and nothing a human could"
      }
    ],
    "sets": [],
    "held": 0,
    "heldMoves": 0,
    "missing": []
  },
  {
    "id": null,
    "method": "The app's solver",
    "phases": [
      {
        "phase": "Both phases",
        "intuitive": "NONE. `lib/two-phase.js` searches; its eleven tables are 9.82 MiB of pruning data, not algorithms"
      }
    ],
    "sets": [],
    "held": 0,
    "heldMoves": 0,
    "missing": []
  }
]);
