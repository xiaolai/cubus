// Rounds from cubus-im's two drills, frozen here so cubus can play them without the sibling checkout.
//
// THE FACTS ONLY. Every `say` here is a placeholder (`line 0`, `line 1`), the way
// `episode-structure.json` writes its narration, because the prompts, the verdicts and the reveal
// lines are the course's authored words and the course is not open (ADR 0006 decision 7). What is
// kept is what makes a round a round: the scramble, the slot, the piece, the turn, and the answer
// the round computes from the cube — facts about a cube, which are nobody's to own. Restoring a
// real sentence here fails `test/course-prose.test.mjs`, which is exactly what it is for.
//
// Plan item 3.4 of dev-docs/tutorial-capability-plan.md ports `tools/verify/verify-drill.mjs` and
// `tools/verify/verify-predict.mjs` to rounds on the script player's event driver. Their rounds come
// from generators in cubus-im (`tools/verify/drill-rounds.mjs` at seed 0x9e3779b9 and
// `tools/verify/predict-rounds.mjs` at seed 0x51ed270b); these are the first four of each, printed
// from `rounds(24)` on 2026-09-15, and `test/script-rounds.test.mjs` re-derives them from the generators
// whenever the sibling checkout is present — so a regenerated drill that no longer matches is caught.
// The answers (`home`, `dest`) are the generators' own and are NOT used as the answer rule: the round
// computes its answer from the cube, and the test holds the two equal.

/** The recognition drill: a scrambled cube, one slot lit, the piece in it not at home. */
export const RECOGNITION = Object.freeze([
  { alg: "B' U2 B2 L2 U2 R U R B' L' U2 D2 B2 F'", cam: [20, 225], slot: 'BL', piece: 'UL', home: ['U', 'L'], shows: ['L', 'U'] },
  { alg: "D R2 L U' F2 B2 R2 L' U F' B' U' R' L2 D2 L2 D2 F2 L'", cam: [35, 0], slot: 'UF', piece: 'FL', home: ['F', 'L'], shows: ['L', 'F'] },
  { alg: "F' L R' F2 D' L' D' R U2 L' U' F U2 F' R U' R2", cam: [-35, 135], slot: 'DRB', piece: 'ULB', home: ['U', 'L', 'B'], shows: ['B', 'U', 'L'] },
  { alg: "L F' B D2 B' R2 D R2 U2 L U R2 F D' L2 F'", cam: [-35, 270], slot: 'DL', piece: 'UB', home: ['U', 'B'], shows: ['U', 'B'] },
].map((r) => Object.freeze(r)));

/** The prediction drill: a turn is named — two of the first four do not touch the lit piece. */
export const PREDICTION = Object.freeze([
  { alg: "L' R' U2 L' D2 L2 B' L2 F2 D B F", cam: [35, 270], slot: 'UL', piece: 'DL', turn: 'B', dest: ['U', 'L'], moves: false },
  { alg: "D2 F L R U' L' R D' L' B' L2 F2 R F'", cam: [-35, 90], slot: 'DR', piece: 'UF', turn: "D'", dest: ['D', 'F'], moves: true },
  { alg: "R' D2 L U2 B U' R2 D2 L R' U2 D2 B2 R2 L D' R2", cam: [35, 135], slot: 'UBR', piece: 'URF', turn: 'R2', dest: ['D', 'F', 'R'], moves: true },
  { alg: "U2 B2 D2 B2 F' R F' B' D F2 B L R' F2", cam: [35, 90], slot: 'UR', piece: 'BR', turn: "B'", dest: ['U', 'R'], moves: false },
].map((r) => Object.freeze(r)));

/** A recognition round as a script: the slot lit by POSITION, and a reveal that lights the home slot. */
export const recognitionScript = (r) => ({
  schema: 2,
  start: { scramble: r.alg },
  steps: [
    { hl: `slot:${r.slot}`, cam: r.cam, say: 'line 0' },
    { round: { ask: `pieceIn:${r.slot}`, choose: r.slot.length, reveal: [{ hl: `slot:${r.piece}`, say: 'line 1' }] } },
  ],
});

/** A prediction round as a script: the piece lit by IDENTITY, so the glow travels with it through the turn. */
export const predictionScript = (r) => ({
  schema: 2,
  start: { scramble: r.alg },
  steps: [
    { hl: `piece:${r.piece}`, cam: r.cam, say: 'line 0' },
    { round: { turn: r.turn, ask: `whereIs:${r.piece}`, choose: r.piece.length, reveal: [{ move: r.turn }] } },
  ],
});
