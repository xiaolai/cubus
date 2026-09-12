// The algorithm ledger. GENERATED — do not hand-edit.
//
//   regenerate: node apps/web/bench/algorithm-ledger.mjs --emit
//   re-verify:  node --test apps/web/test/algorithm-ledger.test.mjs
//
// What this repository holds, per set and per method, and what it does not. The sets themselves are
// NOT copied here — they live in lib/data/case-tables.js and lib/methods/, and copying them would
// make a second place for an algorithm to be wrong. This records the shape: sizes, lengths,
// provenance, which method needs which, and what is missing.
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
    "provenance": "rung 1 of the pairs stage: six triggers a pair is built out of, rather than 41 cases",
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
    "provenance": "the corner-orientation cases in FACE TURNS ONLY, because the renderer and the move list speak nothing else",
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
    "method": "The app's method",
    "ladder": true,
    "phases": [
      {
        "phase": "Cross",
        "rungs": [
          {
            "rung": 0,
            "label": "edge by edge",
            "held": [
              "cross-inserts"
            ]
          },
          {
            "rung": 1,
            "label": "planned whole",
            "intuitive": "an exact distance table is descended — no algorithm at all"
          }
        ]
      },
      {
        "phase": "Pairs",
        "rungs": [
          {
            "rung": 0,
            "label": "corner, then edge",
            "held": [
              "f1l-inserts",
              "middle-inserts"
            ]
          },
          {
            "rung": 1,
            "label": "trigger pairs",
            "held": [
              "f2l-triggers",
              "f1l-inserts",
              "middle-inserts"
            ]
          },
          {
            "rung": 2,
            "label": "the F2L cases",
            "held": [
              "f2l-full",
              "f1l-inserts",
              "middle-inserts"
            ]
          }
        ]
      },
      {
        "phase": "OLL",
        "rungs": [
          {
            "rung": 0,
            "label": "two-look",
            "held": [
              "eoll",
              "ocll"
            ]
          },
          {
            "rung": 1,
            "label": "full OLL",
            "held": [
              "oll-full"
            ]
          }
        ]
      },
      {
        "phase": "PLL",
        "rungs": [
          {
            "rung": 0,
            "label": "two-look",
            "held": [
              "cpll",
              "epll"
            ]
          },
          {
            "rung": 1,
            "label": "full PLL",
            "held": [
              "pll-full"
            ]
          }
        ]
      }
    ],
    "sets": [
      "cross-inserts",
      "f1l-inserts",
      "middle-inserts",
      "f2l-triggers",
      "f2l-full",
      "eoll",
      "ocll",
      "oll-full",
      "cpll",
      "epll",
      "pll-full"
    ],
    "held": 18,
    "heldMoves": 140,
    "heldTop": 124,
    "heldTopMoves": 1087,
    "missing": []
  },
  {
    "method": "CFOP",
    "ladder": false,
    "phases": [
      {
        "phase": "Cross",
        "intuitive": "planned, not memorised"
      },
      {
        "phase": "F2L",
        "held": "f2l-full"
      },
      {
        "phase": "OLL",
        "held": "oll-full"
      },
      {
        "phase": "PLL",
        "held": "pll-full"
      }
    ],
    "sets": [
      "f2l-full",
      "oll-full",
      "pll-full"
    ],
    "held": 119,
    "heldMoves": 1058,
    "heldTop": 119,
    "heldTopMoves": 1058,
    "missing": []
  },
  {
    "method": "Roux",
    "ladder": false,
    "phases": [
      {
        "phase": "First block",
        "intuitive": "block building"
      },
      {
        "phase": "Second block",
        "intuitive": "block building"
      },
      {
        "phase": "CMLL",
        "missing": "CMLL",
        "size": 42,
        "unmeasured": true
      },
      {
        "phase": "LSE",
        "missing": "LSE, largely intuitive with a handful of cases",
        "size": null,
        "unmeasured": true
      }
    ],
    "sets": [],
    "held": 0,
    "heldMoves": 0,
    "heldTop": 0,
    "heldTopMoves": 0,
    "missing": [
      "CMLL",
      "LSE, largely intuitive with a handful of cases"
    ]
  },
  {
    "method": "Petrus",
    "ladder": false,
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
    "heldTop": 10,
    "heldTopMoves": 100,
    "missing": []
  },
  {
    "method": "ZZ",
    "ladder": false,
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
    "heldTop": 10,
    "heldTopMoves": 100,
    "missing": []
  },
  {
    "method": "Corners first",
    "ladder": false,
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
    "heldTop": 0,
    "heldTopMoves": 0,
    "missing": [
      "a corner-only set",
      "an edge-only set"
    ]
  },
  {
    "method": "Mehta",
    "ladder": false,
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
    "heldTop": 0,
    "heldTopMoves": 0,
    "missing": [
      "EOLE",
      "6CO",
      "6CP",
      "L5EP"
    ]
  },
  {
    "method": "Thistlethwaite",
    "ladder": false,
    "phases": [
      {
        "phase": "G1 to G4",
        "intuitive": "NONE. A computer method searches each coset; there is nothing to memorise and nothing a human could"
      }
    ],
    "sets": [],
    "held": 0,
    "heldMoves": 0,
    "heldTop": 0,
    "heldTopMoves": 0,
    "missing": []
  },
  {
    "method": "The app's solver",
    "ladder": false,
    "phases": [
      {
        "phase": "Both phases",
        "intuitive": "NONE. `lib/two-phase.js` searches; its eleven tables are 9.82 MiB of pruning data, not algorithms"
      }
    ],
    "sets": [],
    "held": 0,
    "heldMoves": 0,
    "heldTop": 0,
    "heldTopMoves": 0,
    "missing": []
  }
]);
