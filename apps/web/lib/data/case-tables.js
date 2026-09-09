// GENERATED FILE — do not edit by hand.
//
//   node regen-case-tables.mjs
//
// The algorithms the one-look rungs are made of, copied from the proved tables in
// `crates/optimal-solver/tables/`. Those are the artifact: searched, certified, and re-checked
// against their certificates on every `cargo test` run. This file is a transport, and
// `case-tables.test.mjs` re-runs the generator and diffs it, so it cannot drift from them.
//
// **The names are IDENTIFIERS, not case names.** `oll:1a2b3c4d` is this repository's key for a
// case, derived from the position; it is not the number a learner would find on any other site,
// and inventing our own numbering would be worse than showing none. `method-lesson.js` carries
// them on the step and declines to print them, for exactly that reason.

/**
 * Full OLL: one algorithm per case, so the top face is one look rather than two.
 *
 * Proved minimal in half-turn metric by `crates/optimal-solver`, and certified — every length
 * carries the exhausted contour below it, over all 1,152 (alignment, goal) pairs. Mean 9.37,
 * longest 12.
 */
export const FULL_OLL = Object.freeze([
  Object.freeze({ name: 'oll:00000011', alg: "R F D2 L2 U2 B L2 D2 R" }),
  Object.freeze({ name: 'oll:00000101', alg: "R U R' U' L R' F R F' L'" }),
  Object.freeze({ name: 'oll:00001111', alg: "R B U B' R' B F2 D' L' D B' F2" }),
  Object.freeze({ name: 'oll:00120000', alg: "R B R' F R B' R' F'" }),
  Object.freeze({ name: 'oll:00120011', alg: "R' U' F U R U' R' F' R" }),
  Object.freeze({ name: 'oll:00120101', alg: "R U R' U' B' R' F R B F'" }),
  Object.freeze({ name: 'oll:00120110', alg: "R B' U' B2 U' B2 U2 B U' R'" }),
  Object.freeze({ name: 'oll:00121001', alg: "R U B' U' R' U R B R'" }),
  Object.freeze({ name: 'oll:00121010', alg: "R U R' U' R' F R F'" }),
  Object.freeze({ name: 'oll:00121100', alg: "R U B U' L B' R' B L' B'" }),
  Object.freeze({ name: 'oll:00121111', alg: "R U2 R' F' L' U B' U2 B L F" }),
  Object.freeze({ name: 'oll:00210000', alg: "R2 F2 R' B2 R F2 R' B2 R'" }),
  Object.freeze({ name: 'oll:00210011', alg: "R' U' F' U F R" }),
  Object.freeze({ name: 'oll:00210101', alg: "R U R B' R' B U' R'" }),
  Object.freeze({ name: 'oll:00210110', alg: "R U R' B F2 D' L' D B' F2" }),
  Object.freeze({ name: 'oll:00211001', alg: "R U B U' B' R'" }),
  Object.freeze({ name: 'oll:00211010', alg: "R B U B' U' R'" }),
  Object.freeze({ name: 'oll:00211100', alg: "R U B2 D B' U' B D' B2 R'" }),
  Object.freeze({ name: 'oll:00211111', alg: "R U2 R' F' L2 B L B' U2 L F" }),
  Object.freeze({ name: 'oll:01020000', alg: "R B L B' R' B L' B'" }),
  Object.freeze({ name: 'oll:01020011', alg: "R U2 R2 F R F' R U2 R'" }),
  Object.freeze({ name: 'oll:01020101', alg: "R' U L F U F' U' L' R" }),
  Object.freeze({ name: 'oll:01020110', alg: "R U2 R2 F2 L F L' F2 R F'" }),
  Object.freeze({ name: 'oll:01021001', alg: "R U R2 F' U' F U R2 U2 R'" }),
  Object.freeze({ name: 'oll:01021010', alg: "R U' L' B' U' B U L R'" }),
  Object.freeze({ name: 'oll:01021100', alg: "R B' R' B U B U' B'" }),
  Object.freeze({ name: 'oll:01021111', alg: "R U B L' U' B U L U' B2 R'" }),
  Object.freeze({ name: 'oll:01110000', alg: "R U2 R' U' R U' R'" }),
  Object.freeze({ name: 'oll:01110011', alg: "R B2 L' B' L B' R'" }),
  Object.freeze({ name: 'oll:01110101', alg: "R' U' F' U2 F U F' U' F R" }),
  Object.freeze({ name: 'oll:01110110', alg: "R' F' L F' L' F2 R" }),
  Object.freeze({ name: 'oll:01111001', alg: "R U2 R' U' F' L' B' U' B L F" }),
  Object.freeze({ name: 'oll:01111010', alg: "R B L R' U L' U' R B' R'" }),
  Object.freeze({ name: 'oll:01111100', alg: "R' U' R F R' F' U F R F'" }),
  Object.freeze({ name: 'oll:01111111', alg: "R B2 R2 U2 R B' R' U2 R2 B2 R'" }),
  Object.freeze({ name: 'oll:02220000', alg: "R U R' U R U2 R'" }),
  Object.freeze({ name: 'oll:02220011', alg: "R' F2 L F L' F R" }),
  Object.freeze({ name: 'oll:02220101', alg: "R B R' F' R U B' U' R' F" }),
  Object.freeze({ name: 'oll:02220110', alg: "R U2 F' L2 D' B' D L2 F U' R'" }),
  Object.freeze({ name: 'oll:02221001', alg: "R B L' B L B2 R'" }),
  Object.freeze({ name: 'oll:02221010', alg: "R U B U2 B' U R' F' U F" }),
  Object.freeze({ name: 'oll:02221100', alg: "R U R' B' R B U' B' R' B" }),
  Object.freeze({ name: 'oll:02221111', alg: "R B2 R2 U2 R B R' U2 R2 B2 R'" }),
  Object.freeze({ name: 'oll:11220000', alg: "R U2 R2 U' R2 U' R2 U2 R" }),
  Object.freeze({ name: 'oll:11220011', alg: "R B U B' U' B U B' U' R'" }),
  Object.freeze({ name: 'oll:11220101', alg: "R U B U' B' U B U' B' R'" }),
  Object.freeze({ name: 'oll:11220110', alg: "R' F' U' F U F' U' F U R" }),
  Object.freeze({ name: 'oll:11221001', alg: "R F' U2 F U2 F R2 F' R" }),
  Object.freeze({ name: 'oll:11221010', alg: "R U R' U R U' B U' B' R'" }),
  Object.freeze({ name: 'oll:11221100', alg: "R' F R2 F' U2 F' U2 F R'" }),
  Object.freeze({ name: 'oll:11221111', alg: "R U R' F' L' U' B L' B' L2 F" }),
  Object.freeze({ name: 'oll:12120000', alg: "R U R2 F2 D' L2 D' L2 D2 F2 R" }),
  Object.freeze({ name: 'oll:12120011', alg: "R' F R F' U2 R2 B' R' B R'" }),
  Object.freeze({ name: 'oll:12120101', alg: "R B L B' R2 B U L' U' B' R" }),
  Object.freeze({ name: 'oll:12120110', alg: "R B' R' B U2 R2 F R F' R" }),
  Object.freeze({ name: 'oll:12121010', alg: "R U2 R2 U' R U' R' U2 F R F'" }),
  Object.freeze({ name: 'oll:12121111', alg: "R U B' R B R2 U' R' F R F'" }),
]);

/**
 * Full PLL: one algorithm per case. Mean 11.4762 over the 21 cases, longest 14.
 *
 * Not to be confused with 11.642361, which is the mean over the 288 last-layer PERMUTATIONS and is
 * the number that matches Cube Explorer's published histogram bucket for bucket — the one place
 * this repository has an external figure to agree with. A case is an orbit of states under the two
 * alignments, so the two means are averages over different things and differ by 0.166.
 */
export const FULL_PLL = Object.freeze([
  Object.freeze({ name: 'pll:01230231', alg: "R2 U B' F R2 B F' U R2" }),
  Object.freeze({ name: 'pll:01230312', alg: "R2 U' B' F R2 B F' U' R2" }),
  Object.freeze({ name: 'pll:01231032', alg: "R B' R' B F R' B' F R' B R F2" }),
  Object.freeze({ name: 'pll:01232301', alg: "R2 B2 F2 L2 D R2 B2 F2 L2" }),
  Object.freeze({ name: 'pll:01320132', alg: "R2 U' R2 D R2 D' F2 U F2 R2" }),
  Object.freeze({ name: 'pll:01320213', alg: "R U2 R' U B L' B' R B L B' U R'" }),
  Object.freeze({ name: 'pll:01320321', alg: "R2 U R2 D' F2 L2 U' L2 D F2" }),
  Object.freeze({ name: 'pll:01321023', alg: "R U R' U2 L' B2 R' D' R' D R2 B2 L" }),
  Object.freeze({ name: 'pll:01321230', alg: "R B' R F2 R' B R F2 R2" }),
  Object.freeze({ name: 'pll:01321302', alg: "R U R' F2 D' L U' L' U L' D F2" }),
  Object.freeze({ name: 'pll:01322031', alg: "R2 D' F U' F U F' D R2 B U' B'" }),
  Object.freeze({ name: 'pll:01322103', alg: "R B' L U2 R' F L2 R' D2 L2 F' L' R" }),
  Object.freeze({ name: 'pll:01322310', alg: "R2 F2 U R2 D' R2 D B2 U' B2 F2 R2" }),
  Object.freeze({ name: 'pll:01323012', alg: "R2 F2 R' B' R F2 R' B R'" }),
  Object.freeze({ name: 'pll:01323120', alg: "R U' L U2 R' U R U2 L' R'" }),
  Object.freeze({ name: 'pll:01323201', alg: "R D L' D2 R D' L' F2 D' L2 D' R2" }),
  Object.freeze({ name: 'pll:03210132', alg: "R U R2 F R2 U' R' F2 L' U L F2 U2 F'" }),
  Object.freeze({ name: 'pll:03210213', alg: "R U R' F2 L D' L' U' L2 D L2 U F2" }),
  Object.freeze({ name: 'pll:03210321', alg: "R U' R2 F2 U' R F2 R' U F2 R2 U R'" }),
  Object.freeze({ name: 'pll:03211230', alg: "R U' L D2 L' U L R' U' R D2 R' U L'" }),
  Object.freeze({ name: 'pll:03212103', alg: "R U' R2 B2 D' L F2 L' D B2 R2 U R'" }),
]);

/**
 * The 41 F2L cases, read in the frame where the working slot is at the front right.
 *
 * Mean 6.90, longest 9. Not every position a solve meets is one of these: a piece buried in
 * ANOTHER pair's slot cannot be reached by a maneuver that leaves that slot alone, so those fall
 * back to the rung below. That is structural, not a gap in the table —
 * `f2l-configurations.test.mjs` enumerates the whole space and splits it 150 to 234.
 */
export const F2L_CASES = Object.freeze([
  Object.freeze({ name: 'f2l:0c11', alg: "R U' R U2 F R2 F' U2 R2" }),
  Object.freeze({ name: 'f2l:0c06', alg: "R U2 B U B' U2 R'" }),
  Object.freeze({ name: 'f2l:0c07', alg: "F U2 L F2 L' U2 F'" }),
  Object.freeze({ name: 'f2l:0d10', alg: "R U2 R U2 F R F' U2 R2" }),
  Object.freeze({ name: 'f2l:0d11', alg: "R U2 B U B2 R B R2" }),
  Object.freeze({ name: 'f2l:0d06', alg: "R B U2 B' U R'" }),
  Object.freeze({ name: 'f2l:0d07', alg: "R U' R' F' U' F" }),
  Object.freeze({ name: 'f2l:0e10', alg: "R U2 R U R' U R U2 R2" }),
  Object.freeze({ name: 'f2l:0e11', alg: "R U' R' F' L' U2 L F" }),
  Object.freeze({ name: 'f2l:0e06', alg: "R U' B U2 B' R'" }),
  Object.freeze({ name: 'f2l:0e07', alg: "U2 R U2 R' F' U2 F" }),
  Object.freeze({ name: 'f2l:0910', alg: "F' U L' U2 L U' F" }),
  Object.freeze({ name: 'f2l:0911', alg: "F' U2 F R U R'" }),
  Object.freeze({ name: 'f2l:0906', alg: "U R U2 R' U' R U R'" }),
  Object.freeze({ name: 'f2l:0907', alg: "U' R B U B2 R B R2" }),
  Object.freeze({ name: 'f2l:0902', alg: "U R B U2 B' R'" }),
  Object.freeze({ name: 'f2l:0903', alg: "F' U2 F2 R' F' R" }),
  Object.freeze({ name: 'f2l:0904', alg: "U2 R U B' R B R2" }),
  Object.freeze({ name: 'f2l:0905', alg: "U F' L' U2 L F" }),
  Object.freeze({ name: 'f2l:0900', alg: "U' R2 U2 R' U' R U' R2" }),
  Object.freeze({ name: 'f2l:0901', alg: "U F' U2 F U F' U' F" }),
  Object.freeze({ name: 'f2l:0a10', alg: "U2 R U2 B U2 B' R'" }),
  Object.freeze({ name: 'f2l:0a11', alg: "U2 F' U' F U' R U R'" }),
  Object.freeze({ name: 'f2l:0a06', alg: "R U' R' U R U R'" }),
  Object.freeze({ name: 'f2l:0a07', alg: "U R U' R' U2 F' U' F" }),
  Object.freeze({ name: 'f2l:0a02', alg: "U F2 U' L' U L F2" }),
  Object.freeze({ name: 'f2l:0a03', alg: "U R2 B U B' U' R2" }),
  Object.freeze({ name: 'f2l:0a04', alg: "U R U R'" }),
  Object.freeze({ name: 'f2l:0a05', alg: "F' U' L' U2 L U2 F" }),
  Object.freeze({ name: 'f2l:0a00', alg: "U R U' B U2 B' U2 R'" }),
  Object.freeze({ name: 'f2l:0a01', alg: "F' U F" }),
  Object.freeze({ name: 'f2l:0b10', alg: "F' U2 L' U2 L F" }),
  Object.freeze({ name: 'f2l:0b11', alg: "R U R' U F' U' F" }),
  Object.freeze({ name: 'f2l:0b06', alg: "U2 R U' R'" }),
  Object.freeze({ name: 'f2l:0b07', alg: "R U2 R' U F' U' F" }),
  Object.freeze({ name: 'f2l:0b02', alg: "R U2 R' U2 R U' R'" }),
  Object.freeze({ name: 'f2l:0b03', alg: "U F' U' F" }),
  Object.freeze({ name: 'f2l:0b04', alg: "U F2 L' U' L U F2" }),
  Object.freeze({ name: 'f2l:0b05', alg: "U R2 U B U' B' R2" }),
  Object.freeze({ name: 'f2l:0b00', alg: "U R U2 B U B' U R'" }),
  Object.freeze({ name: 'f2l:0b01', alg: "U2 F2 D' F U' F' D F2" }),
]);
