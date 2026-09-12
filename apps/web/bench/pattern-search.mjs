// Finding patterns instead of copying them: an exhaustive search for pretty pictures.
//
//   node bench/pattern-search.mjs [depth]        default depth 6
//
// A list of patterns from a book answers "which ones are famous". It does not answer "which ones
// exist", and that second question is decidable, because pretty pictures are SHORT and short is a
// small number of cubes. Every canonical maneuver of length <= 6 is about 8.2 million sequences,
// which is minutes for a laptop and an exhaustive answer for that radius.
//
// TWO CRITERIA, and the first one's failure is the more interesting result.
//
//   A. **No face shows more than two colours.** The obvious formalisation of "orderly", and it turns
//      out to be almost a group-theoretic property rather than an aesthetic one. In the half-turn
//      group <U2, D2, R2, L2, F2, B2> every facelet stays on its own axis, so every face shows its own
//      colour and the opposite one and nothing else — two colours, always, for all 663,552 elements.
//      So criterion A mostly enumerates the square group, which is why it returns thousands of hits
//      and why almost none of them is a pattern anybody would name. Reported as a count, not a list.
//
//   B. **Every face shows the SAME figure.** This is what makes the famous ones famous. Take each
//      face's 3x3 and mark which cells match its centre; canonicalise that mask over the four
//      rotations of the face; and require all six faces to agree. A checkerboard, a plus, an X, a pair
//      of bars — each is one mask repeated six times. This is sharp, it is about the picture rather
//      than the group, and the list it returns is short enough to look at.
//
// THE VALIDATION IS BUILT IN: chapter 28's Checkerboard, Plus/Minus and Lines are each proved to be
// 6 moves by bench/cube-patterns.mjs, so a search of radius 6 or more that misses any of them is
// broken, and says so with a non-zero exit.

import { MOVE_NAMES, SOLVED, applyMove } from '../lib/cube-pieces.js';
import { toFacelets } from '../lib/two-phase.js';

const DEPTH = Number(process.argv[2] ?? 6);
const AXIS = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };

/** A face's nine cells, rotated a quarter turn clockwise. Indices, not colours. */
const ROT = [6, 3, 0, 7, 4, 1, 8, 5, 2];

/**
 * The picture on each face, as a 9-bit mask of "this cell matches the centre", canonicalised over the
 * face's four rotations so that the same figure in four orientations is one figure.
 */
function faceFigures(facelets) {
  const figures = new Array(6);
  const colours = new Array(6);
  for (let f = 0; f < 6; f++) {
    const cells = facelets.slice(f * 9, f * 9 + 9);
    const centre = cells[4];
    let mask = 0;
    for (let i = 0; i < 9; i++) if (cells[i] === centre) mask |= 1 << i;
    // Canonical over the four rotations: the smallest of the four masks.
    let best = mask, cur = mask;
    for (let r = 0; r < 3; r++) {
      let next = 0;
      for (let i = 0; i < 9; i++) if (cur & (1 << ROT[i])) next |= 1 << i;
      cur = next;
      if (cur < best) best = cur;
    }
    figures[f] = best;
    let n = 0, m = 0;
    for (let i = 0; i < 9; i++) m |= 1 << 'URFDLB'.indexOf(cells[i]);
    for (let k = m; k; k >>= 1) n += k & 1;
    colours[f] = n;
  }
  return { figures, colours };
}

/** The mask as three lines, so a figure can be read rather than decoded. */
const draw = (mask) => [0, 1, 2].map((r) => [0, 1, 2].map((c) => ((mask >> (r * 3 + c)) & 1 ? '#' : '.')).join('')).join('/');

const SOLID = 0b111111111;

const uniform = new Map();     // figure mask -> { depth, alg, facelets }
const bySignature = new Map(); // the six figures, sorted -> the shortest maneuver reaching that LOOK
let twoColour = 0;
let visited = 0;
const seenTwoColour = new Set();

/** A picture's LOOK: the six faces' canonical figures, sorted, so orientation does not matter. */
const signature = (figures) => [...figures].sort((a, b) => a - b).join(',');

const path = [];
function walk(state, depth, lastFace, lastAxis) {
  visited++;
  const facelets = toFacelets(state);
  const { figures, colours } = faceFigures(facelets);

  if (Math.max(...colours) <= 2 && !seenTwoColour.has(facelets)) seenTwoColour.add(facelets);

  // Every LOOK, with the shortest route to it. This is the set/state distinction made concrete: the
  // book prints one STATE per picture, and a picture is a set of states.
  // The SHORTEST, not the first. A depth-first walk reaches deep before it reaches wide, so keeping
  // the first hit made a reported minimum GROW with the search depth — `##./##./...` moved from three
  // moves to four when the radius went from 3 to 5. Found by audit.
  const sig = signature(figures);
  const priorSig = bySignature.get(sig);
  if (!priorSig || path.length < priorSig.depth) bySignature.set(sig, { depth: path.length, alg: path.join(' ') });

  // Criterion B: every face the same figure, and not the solved figure.
  const fig = figures[0];
  if (fig !== SOLID && figures.every((f) => f === fig)) {
    const prior = uniform.get(fig);
    if (!prior || path.length < prior.depth) uniform.set(fig, { depth: path.length, alg: path.join(' '), facelets });
  }

  if (depth === 0) return;
  for (let m = 0; m < MOVE_NAMES.length; m++) {
    const f = MOVE_NAMES[m][0];
    if (f === lastFace) continue;
    if (AXIS[f] === lastAxis && f < lastFace) continue;
    path.push(MOVE_NAMES[m]);
    walk(applyMove(state, MOVE_NAMES[m]), depth - 1, f, AXIS[f]);
    path.pop();
  }
}

const t0 = Date.now();
walk(SOLVED, DEPTH, '', -1);
const ms = Date.now() - t0;
twoColour = seenTwoColour.size;

const pad = (s, n) => String(s).padEnd(n);

console.log(`=== exhaustive pattern search to ${DEPTH} moves ====================================`);
console.log(`${visited.toLocaleString()} canonical maneuvers walked in ${(ms / 1000).toFixed(1)} s\n`);

console.log('CRITERION A — no face shows more than two colours');
console.log(`  ${twoColour.toLocaleString()} distinct pictures. Almost all of them are elements of the`);
console.log('  half-turn group <U2 D2 R2 L2 F2 B2>, which has 663,552 elements and in which every face');
console.log('  shows its own colour and the opposite one BY CONSTRUCTION, because a half turn keeps every');
console.log('  facelet on its own axis. So this criterion is a group rather than a taste, and that is why');
console.log('  it returns thousands and names none of them.\n');

console.log('CRITERION B — every face shows the same figure, canonical over the face\'s four rotations');
console.log(`  ${uniform.size} distinct figures, shortest first. "#" marks a cell matching its centre.\n`);
console.log(`  ${pad('figure', 14)} ${pad('moves', 6)} shortest maneuver found`);
for (const [fig, v] of [...uniform.entries()].sort((a, b) => a[1].depth - b[1].depth || a[0] - b[0])) {
  console.log(`  ${pad(draw(fig), 14)} ${pad(v.depth, 6)} ${v.alg}`);
}

// ---- the look, versus the state: all fourteen of chapter 28 -------------------------------------
//
// This is the finding the whole exercise was for. A PATTERN is a picture; a picture is a SET of
// cubes; the book prints one member of the set. Where a shorter member exists, the printed algorithm
// is longer than the picture requires — not because it is wrong, but because it is aiming at a state
// when only the look is wanted.

const BOOK = [
  ['The Checkerboard', 'U2 D2 F2 B2 L2 R2'],
  ['Plus/Minus', 'U2 R2 L2 U2 R2 L2'],
  ['Lines', 'R2 U2 R2 U2 R2 U2 L2 D2 L2 D2 L2 D2 L2 R2'],
  ['Cube in a Cube', "F L F U' R U F2 L2 U' L' B D' B' L2 U"],
  ['Side Lines', "R D R F R' F' B D R' U' B' U D2"],
  ['Cube in a Cube in a Cube', "U' L' U' F' R2 B' R F U B2 U B' L U' F U R F'"],
  ['Superflip', "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2"],
  ['Chessboard in a Cube', "B D F' B' D L2 U L U' B D' R B R D' R L' F U2 D"],
  ['Centres', "U D' R L' F B' U D'"],
  ['Opposite Corners', 'R L U2 F2 D2 F2 R L F2 D2 B2 D2'],
  ['Vertical Stripes', "F U F R L2 B D' R D2 L D' B R2 L F U F"],
  ['Shifted Blocks', "L2 B2 D' B2 D L2 U R2 D R2 B U R' F2 R U' B' U'"],
  ['Hello!', 'U2 R2 F2 U2 D2 F2 L2 U2'],
  ['40 (4T)', "F2 D2 F' L2 D2 U2 R2 B' U2 F2"],
];

console.log('\n=== the MATCH-MASK versus the state, for all fourteen of chapter 28 ==========');
console.log('READ THE CAVEAT BELOW THE TABLE BEFORE QUOTING ANY NUMBER IN IT.');
console.log(`${pad('pattern', 26)} ${pad('book', 5)} ${pad('mask', 5)} ${pad('diff', 6)} shortest maneuver to the same mask`);
for (const [name, alg] of BOOK) {
  let s = SOLVED;
  const moves = alg.split(/\s+/);
  for (const m of moves) s = applyMove(s, m);
  const { figures } = faceFigures(toFacelets(s));
  const hit = bySignature.get(signature(figures));
  if (!hit) {
    console.log(`${pad(name, 26)} ${pad(moves.length, 5)} ${pad('>' + DEPTH, 5)} ${pad('-', 6)} no state with this look within ${DEPTH} moves`);
  } else {
    const saved = moves.length - hit.depth;
    console.log(`${pad(name, 26)} ${pad(moves.length, 5)} ${pad(hit.depth, 5)} ${pad(saved, 6)} ${hit.alg || '(solved)'}`);
  }
}
console.log('\nTHE CAVEAT, and it is why this column is called "mask" and not "look". The signature records');
console.log('which cells MATCH THEIR CENTRE and nothing about what the other cells show, so two cubes');
console.log('that no child would confuse can share it. The table names its own counterexample:');
console.log('superflip and the checkerboard both read #.#/.#./#.# on all six faces, because both have');
console.log('corners solved and all twelve edges wrong — but the checkerboard\'s edges show the OPPOSITE');
console.log('face\'s colour and superflip\'s show an ADJACENT one. The same mask, two different pictures.');
console.log('So superflip\'s "14 saved" is not a 6-move superflip; no such thing exists, and Reid proved');
console.log('in 1995 that it needs exactly 20.');
console.log('');
console.log('What the column IS good for: it is a real, large, partially-specified target of exactly the');
console.log('kind dev-docs/solve-to-state-plan.md is built around — "every face shows its corners and');
console.log('centre and nothing else" is a set, and reaching a set is cheap. What it is NOT is the same');
console.log('picture. A FULLY specified picture is a single cube up to the 24 whole-cube rotations, so');
console.log('there is no set to exploit and no saving to be had: the book\'s states are the pictures.');
console.log('The saving lives only where the description genuinely leaves pieces free, which is what');
console.log('bench/cube-patterns.mjs measures for the two duals — a plus on every face and an X on');
console.log('every face — at 8.5 and 10.5 moves saved from a full scramble.');

// ---- the search against chapter 28 --------------------------------------------------------------

const BOOK_SHORT = [
  ['The Checkerboard', 'U2 D2 F2 B2 L2 R2', 6],
  ['Plus/Minus', 'U2 R2 L2 U2 R2 L2', 6],
  ['Lines', 'R2 U2 R2 U2 R2 U2 L2 D2 L2 D2 L2 D2 L2 R2', 6],
];
console.log('\n=== the search against chapter 28 ===========================================');
let missing = 0;
for (const [name, alg, minimum] of BOOK_SHORT) {
  let s = SOLVED;
  for (const m of alg.split(/\s+/)) s = applyMove(s, m);
  const facelets = toFacelets(s);
  const { figures } = faceFigures(facelets);
  const fig = figures[0];
  const sameEverywhere = figures.every((f) => f === fig);
  if (DEPTH < minimum) {
    console.log(`${pad(name, 22)} skipped — it is ${minimum} moves and this run reached ${DEPTH}`);
    continue;
  }
  const got = uniform.get(fig);
  if (sameEverywhere && got && got.depth <= minimum) {
    console.log(`${pad(name, 22)} figure ${pad(draw(fig), 12)} found at ${got.depth} moves as ${got.alg}`);
  } else if (!sameEverywhere) {
    console.log(`${pad(name, 22)} is NOT uniform — its faces show ${new Set(figures).size} different figures, so`
      + ' criterion B is not the criterion it satisfies');
  } else {
    missing++;
    console.log(`${pad(name, 22)} NOT FOUND at ${minimum} moves — the search is broken`);
  }
}
if (missing) process.exitCode = 1;
console.log('\nA figure found at fewer moves than the book prints shares the book pattern\'s MASK, which is');
console.log('not the same as being the same picture — see the caveat above, where superflip and the');
console.log('checkerboard share one. bench/cube-patterns.mjs measures the states properly and proves');
console.log('a minimum at 10 moves or fewer.');
