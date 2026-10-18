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
    "id": "f2l-human",
    "name": "F2L, human-speed",
    "kind": "sourced",
    "provenance": "SpeedCubeDB's top-voted Front Right algorithm per case; what the pairs stage's top rung teaches since 2026-10-13",
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
    "provenance": "J Perm's first-listed algorithm per case; what full OLL teaches since 2026-10-13",
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
    "provenance": "J Perm's first-listed algorithm per case; what full PLL teaches since 2026-10-13",
    "verified": "same cubejs check, 21 to 21",
    "count": 21,
    "distinct": 21,
    "shortest": 9,
    "longest": 21,
    "mean": 13.95,
    "moves": 293
  },
  {
    "id": "mehta-eole",
    "name": "Mehta EOLE",
    "kind": "sourced",
    "provenance": "the Mehta-OS algorithm sheet, the first line of each cell that starts from the middle layer in place; not taught by any screen yet",
    "verified": "`mehta-algs.test.mjs`: every row draws a case of its step, and the 55 rows cover the 55 cases the pieces give, once each",
    "count": 55,
    "distinct": 55,
    "shortest": 3,
    "longest": 12,
    "mean": 6.95,
    "moves": 382
  },
  {
    "id": "mehta-6co",
    "name": "Mehta 6CO",
    "kind": "sourced",
    "provenance": "the Mehta-OS algorithm sheet; not taught by any screen yet",
    "verified": "same check, 71 rows to 71 cases",
    "count": 71,
    "distinct": 71,
    "shortest": 6,
    "longest": 12,
    "mean": 9.06,
    "moves": 643
  },
  {
    "id": "mehta-6cp",
    "name": "Mehta 6CP",
    "kind": "sourced",
    "provenance": "the Mehta-OS algorithm sheet; its 2-6 and 5-2 columns draw the same six cases with the bottom turned first",
    "verified": "same check, 47 rows to 41 cases, the six shared pairs pinned by name",
    "count": 47,
    "distinct": 47,
    "shortest": 3,
    "longest": 15,
    "mean": 10.38,
    "moves": 488
  },
  {
    "id": "mehta-l5ep",
    "name": "Mehta L5EP",
    "kind": "sourced",
    "provenance": "the Mehta-OS algorithm sheet: 16 cases, most drawn three ways (the bottom edge right, front or back)",
    "verified": "same check, 45 rows to 16 cases, every row of a case carrying its letter",
    "count": 45,
    "distinct": 45,
    "shortest": 5,
    "longest": 15,
    "mean": 11.16,
    "moves": 502
  },
  {
    "id": "mehta-beginner",
    "name": "Mehta, beginner path",
    "kind": "sourced",
    "provenance": "the Mehta-OS sheet's \"Beginner Mehta Algs\" page: EO, DCAL in two looks, CDRLL in two looks, the last bottom edge, EPLL",
    "verified": "`mehta-algs.test.mjs`: each step finishes every state it can meet, enumerated from the pieces",
    "count": 32,
    "distinct": 32,
    "shortest": 3,
    "longest": 17,
    "mean": 8.44,
    "moves": 270
  },
  {
    "id": "cf-corners",
    "name": "Corners first, the corners",
    "kind": "sourced",
    "provenance": "Josef Jelinek's beginner corners-first method: five bottom-corner sequences, one corner swap, one twist",
    "verified": "`corners-first-algs.test.mjs`: every white corner reaches home from every place without disturbing one placed; the top corners from every arrangement",
    "count": 7,
    "distinct": 7,
    "shortest": 3,
    "longest": 14,
    "mean": 5.29,
    "moves": 37
  },
  {
    "id": "cf-edges",
    "name": "Corners first, the edges",
    "kind": "sourced",
    "provenance": "Jelinek's beginner edges, the left and right layers turning freely; one sequence corrected, because the page's turns the top corners a half turn",
    "verified": "same test: every edge from every place, the middle slice from all 384 positions the cube's laws allow",
    "count": 17,
    "distinct": 17,
    "shortest": 4,
    "longest": 18,
    "mean": 6.47,
    "moves": 110
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
              "f2l-human",
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
              "oll-human"
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
              "pll-human"
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
      "f2l-human",
      "eoll",
      "ocll",
      "oll-human",
      "cpll",
      "epll",
      "pll-human"
    ],
    "held": 18,
    "heldMoves": 140,
    "heldTop": 121,
    "heldTopMoves": 1208,
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
        "held": "f2l-human"
      },
      {
        "phase": "OLL",
        "held": "oll-human"
      },
      {
        "phase": "PLL",
        "held": "pll-human"
      }
    ],
    "sets": [
      "f2l-human",
      "oll-human",
      "pll-human"
    ],
    "held": 119,
    "heldMoves": 1192,
    "heldTop": 119,
    "heldTopMoves": 1192,
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
        "held": "cf-corners"
      },
      {
        "phase": "Centres",
        "intuitive": "one turn of a middle slice"
      },
      {
        "phase": "Edges",
        "held": "cf-edges"
      }
    ],
    "sets": [
      "cf-corners",
      "cf-edges"
    ],
    "held": 24,
    "heldMoves": 147,
    "heldTop": 24,
    "heldTopMoves": 147,
    "missing": []
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
        "held": "mehta-eole",
        "note": "three of the four middle-layer edges by block building first"
      },
      {
        "phase": "6CO",
        "held": "mehta-6co"
      },
      {
        "phase": "6CP",
        "held": "mehta-6cp"
      },
      {
        "phase": "L5EP",
        "held": "mehta-l5ep"
      }
    ],
    "sets": [
      "mehta-eole",
      "mehta-6co",
      "mehta-6cp",
      "mehta-l5ep"
    ],
    "held": 218,
    "heldMoves": 2015,
    "heldTop": 218,
    "heldTopMoves": 2015,
    "missing": []
  },
  {
    "method": "Mehta, beginner path",
    "ladder": false,
    "phases": [
      {
        "phase": "First block",
        "intuitive": "block building"
      },
      {
        "phase": "Belt",
        "intuitive": "block building, all four middle-layer edges"
      },
      {
        "phase": "EO, DCAL, CDRLL, EPLL",
        "held": "mehta-beginner",
        "note": "its last steps meet the cases CFOP's two-look last layer does, with the Mehta-OS sheet's own algorithms"
      }
    ],
    "sets": [
      "mehta-beginner"
    ],
    "held": 32,
    "heldMoves": 270,
    "heldTop": 32,
    "heldTopMoves": 270,
    "missing": []
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
