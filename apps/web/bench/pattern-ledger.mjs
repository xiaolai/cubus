// The pattern ledger: every interesting picture within reach, found by search and written down.
//
//   node bench/pattern-ledger.mjs [depth]           report
//   node bench/pattern-ledger.mjs [depth] --emit    rewrite test/fixtures/pattern-ledger.mjs
//
// The game is "from any state, solve to a pattern", so the app needs a LIST of patterns, and a list
// copied from a book is a list of whatever was famous. This searches instead.
//
// WHAT MAKES A PICTURE INTERESTING, and it is not a matter of taste. A pattern is pretty when it looks
// the same from more than one angle: that is what a checkerboard, a set of dots and a cube-in-a-cube
// all have in common, and it is exactly **symmetry order** — how many of the 24 whole-cube rotations
// leave the picture unchanged. A solved cube is 24. An accidental scramble is almost always 1. So the
// criterion is order >= 2, the measure is the order itself, and `bench/cube-look.mjs` establishes the
// geometry it rests on, checking its 24 rotations against the solver's own model on all 18 moves.
//
// Two kinds go in the ledger and they are not interchangeable:
//
//   STATE patterns are one cube each, up to rotation. Reaching one from a scramble costs a full solve,
//   because you have to get every piece right. They need no new machinery — `A⁻¹B` and the existing
//   pool — and they are found by the exhaustive walk below.
//
//   SET patterns leave pieces free, so they are millions of cubes and reaching one is cheap from
//   anywhere. They cannot be found by walking, because they are defined by what they DON'T say; they
//   are enumerated by hand below, with their cost measured rather than assumed. For a game played from
//   a scrambled cube these are the valuable ones.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOVE_NAMES, SOLVED, applyMove, applyAlg } from '../lib/cube-pieces.js';
import { toFacelets } from '../lib/two-phase.js';
import { FACE_ORDER, ROTATIONS, canonicalDesign, canonicalLook, verify } from './cube-look.mjs';

const DEPTH = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 6);
const EMIT = process.argv.includes('--emit');
const AXIS = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };

/**
 * Only pictures fixed by at least this many of the 24 views are written down.
 *
 * Chosen from the depth-6 run rather than picked: order 2 alone produced 1,341 pictures, and a ledger
 * of 1,341 is a database, not a list a child chooses from. The distribution is steep — 1 at order 24,
 * 11 at 8, 102 at 4, 1,341 at 2 — so 4 is where the count stops being a catalogue. Everything found is
 * COUNTED at every order; the cut is about what is kept, and it is recorded beside the kept rows so
 * nobody mistakes the ledger for the census.
 */
const STORE_MIN_ORDER = 4;

verify();

// `from[j]` is where sticker j's content comes from, so a symmetry test can exit on the first
// mismatch instead of building a whole 54-character string. At 8.3 million states that is the
// difference between seconds and a quarter of an hour.
const FROM = ROTATIONS.map(({ to }) => {
  const from = new Array(54);
  for (let i = 0; i < 54; i++) from[to[i]] = i;
  return from;
});

/** Is this picture unchanged by rotation `r`? Early-exits on the first disagreeing sticker. */
function fixedBy(f, r) {
  const { colour } = ROTATIONS[r];
  const from = FROM[r];
  for (let j = 0; j < 54; j++) if (f[j] !== colour[f[from[j]]]) return false;
  return true;
}
const orderOf = (f) => { let n = 0; for (let r = 0; r < 24; r++) if (fixedBy(f, r)) n++; return n; };

/** A face's 3x3 as a mask of cells matching its centre, canonical over the face's four rotations. */
const ROT9 = [6, 3, 0, 7, 4, 1, 8, 5, 2];
function figures(f) {
  const out = new Array(6);
  for (let k = 0; k < 6; k++) {
    const base = k * 9;
    const centre = f[base + 4];
    let mask = 0;
    for (let i = 0; i < 9; i++) if (f[base + i] === centre) mask |= 1 << i;
    let best = mask, cur = mask;
    for (let q = 0; q < 3; q++) {
      let next = 0;
      for (let i = 0; i < 9; i++) if (cur & (1 << ROT9[i])) next |= 1 << i;
      cur = next;
      if (cur < best) best = cur;
    }
    out[k] = best;
  }
  return out;
}
const draw = (mask) => [0, 1, 2].map((r) => [0, 1, 2].map((c) => ((mask >> (r * 3 + c)) & 1 ? '#' : '.')).join('')).join('/');
const SOLID = 0b111111111;

// ---- the exhaustive walk ------------------------------------------------------------------------

/** How many faces show a single colour. RECORDED, never used to exclude — see below. */
function blankFaces(f) {
  let n = 0;
  for (let k = 0; k < 6; k++) {
    const base = k * 9;
    const c = f[base];
    let plain = true;
    for (let i = 1; i < 9; i++) if (f[base + i] !== c) { plain = false; break; }
    if (plain) n++;
  }
  return n;
}

/** How many of the 54 stickers read differently from a solved cube. */
function stickersWrong(f) {
  let n = 0;
  for (let k = 0; k < 6; k++) {
    const face = FACE_ORDER[k];
    for (let i = 0; i < 9; i++) if (f[k * 9 + i] !== face) n++;
  }
  return n;
}

// A FILTER THAT WAS WRONG, AND WHY IT IS NOW A MEASUREMENT.
//
// The first version of this search required every face to show at least two colours, on the reasoning
// that a single `U` turn scores symmetry order 4 — a turned layer is invariant about its own axis —
// while leaving U and D blank, and is obviously not a pattern. The comment then claimed the rule
// "keeps every one of the book's fourteen". It does not, and that was asserted without checking:
// Plus/Minus and Lines each have TWO solid faces and are both perfectly good patterns. The rule threw
// away two of the fourteen it was supposed to preserve.
//
// Nor does the blank-face count separate the cases it was aimed at: `U` has two blank faces and so
// does Plus/Minus. What distinguishes them is how much of the cube has actually moved — `U` leaves 12
// stickers reading wrong, Plus/Minus 20, the Checkerboard 24 — so the honest thing is to RECORD that
// number and let a caller threshold on it, rather than to bake a guess into the search and lose rows
// to it silently.

const found = new Map();   // canonical look -> { order, depth, alg, figures }
let visited = 0;
const census = new Map();   // symmetry order -> maneuvers seen (not deduplicated by look)
const path = [];

function walk(state, left, lastFace, lastAxis) {
  visited++;
  const f = toFacelets(state);
  // Cheap gate first: a picture fixed by NO rotation but the identity is not a pattern, and the test
  // above costs a few character comparisons for almost every state it rejects.
  let order = 1;
  for (let r = 1; r < 24; r++) if (fixedBy(f, r)) { order++; }
  if (order >= 2) {
    census.set(order, (census.get(order) ?? 0) + 1);
    if (order >= STORE_MIN_ORDER) {
      const look = canonicalLook(f);
      const prior = found.get(look);
      if (!prior || path.length < prior.depth) {
        found.set(look, { order, depth: path.length, alg: path.join(' '), figures: figures(f),
          wrong: stickersWrong(f), blank: blankFaces(f) });
      }
    }
  }
  if (left === 0) return;
  for (let m = 0; m < MOVE_NAMES.length; m++) {
    const face = MOVE_NAMES[m][0];
    if (face === lastFace) continue;
    if (AXIS[face] === lastAxis && face < lastFace) continue;
    path.push(MOVE_NAMES[m]);
    walk(applyMove(state, MOVE_NAMES[m]), left - 1, face, AXIS[face]);
    path.pop();
  }
}

const t0 = Date.now();
walk(SOLVED, DEPTH, '', -1);
const walkMs = Date.now() - t0;

// The solved cube is in there at order 24 and depth 0. It is not a pattern; it is the thing patterns
// are measured from, and leaving it in would make the ledger's first row a lie about the game.
const SOLVED_LOOK = canonicalLook(toFacelets(SOLVED));
found.delete(SOLVED_LOOK);

// ---- deduplication, corrected -------------------------------------------------------------------
//
// The walk deduplicates by the 24 whole-cube ROTATIONS, which merges "the same picture held
// differently" and nothing else. That is not enough, and the owner caught it: the first ledger
// reported 25 pictures at order 8 and 187 at order 4, and those were really 13 and 81. Two things
// were being counted twice.
//
//   MIRRORS. A reflection is not something you can do to a cube, but it is something you can do to a
//   picture, and two patterns that differ only by a mirror are one design to anybody looking at them.
//   Merging them takes 213 rows to 123.
//
//   INVERSES. A pattern's inverse is the cube that undoes it — the same design wound the other way.
//   Merging those too takes it to 95.
//
// The ledger keys on the coarsest of the three, and keeps every variant on the row rather than
// discarding it, so nothing found is lost and the count is honest. Grouping is exact rather than
// approximate because a mirror and an inverse both preserve symmetry order and move count, so every
// member of a family that exists within the radius was already found by the walk.

/** The cube that undoes this one. */
function inverseState(st) {
  const cp = new Array(8), co = new Array(8), ep = new Array(12), eo = new Array(12);
  for (let i = 0; i < 8; i++) { cp[st.cp[i]] = i; co[st.cp[i]] = (3 - st.co[i]) % 3; }
  for (let i = 0; i < 12; i++) { ep[st.ep[i]] = i; eo[st.ep[i]] = st.eo[i]; }
  return { cp, co, ep, eo };
}

const rotationClasses = [...found.entries()].map(([look, v]) => ({ look, ...v }));
const familyOf = new Map();
for (const r of rotationClasses) {
  const cube = applyAlg(SOLVED, r.alg);
  const f = toFacelets(cube);
  const design = canonicalDesign(f);
  const key = [design, canonicalDesign(toFacelets(inverseState(cube)))].sort()[0];
  r.design = design;
  if (!familyOf.has(key)) familyOf.set(key, []);
  familyOf.get(key).push(r);
}

const states = [...familyOf.entries()].map(([family, members]) => {
  members.sort((a, b) => a.depth - b.depth || (a.alg < b.alg ? -1 : 1));
  const head = members[0];
  // A name belongs to the FAMILY, not to whichever member happened to be shortest. All three named
  // six-move patterns survived the first family regeneration only because the named member was also
  // the shortest, which is luck and not a property.
  const named = members.find((m) => m.name);
  return {
    ...head,
    ...(named ? { name: named.name } : {}),
    family,
    designs: new Set(members.map((m) => m.design)).size,
    variants: members.slice(1).map((m) => m.alg),
  };
}).sort((a, b) => b.order - a.order || a.depth - b.depth || (a.look < b.look ? -1 : 1));

const rotationCount = rotationClasses.length;
const designCount = new Set(rotationClasses.map((r) => r.design)).size;

// ---- the named ones, for provenance -------------------------------------------------------------

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
const NAMED = new Map();
const bookRows = BOOK.map(([name, alg]) => {
  const state = applyAlg(SOLVED, alg);
  const f = toFacelets(state);
  const look = canonicalLook(f);
  const order = orderOf(f);
  const hit = found.get(look);
  if (hit) NAMED.set(look, name);
  return { name, bookMoves: alg.trim().split(/\s+/).length, order, look, inLedger: Boolean(hit), depth: hit?.depth ?? null };
});

// ---- the set patterns ---------------------------------------------------------------------------
//
// Defined by what they leave free, so they cannot be walked to. Each is a piece-class predicate, each
// is checked against the app's own model, and each has its reachable size derived rather than guessed.

const EDGES_HOME = (s) => s.ep.every((v, i) => v === i) && s.eo.every((v) => v === 0);
const CORNERS_HOME = (s) => s.cp.every((v, i) => v === i) && s.co.every((v) => v === 0);
const SETS = [
  // Measured in bench/cube-patterns.mjs on ten 25-turn scrambles, against `refine` on the same cube.
  // `n` is how many of the ten the exact search ANSWERED, and it is recorded because the plus was
  // refused on four of them: a mean with no denominator hides its own refusals, and quoting 10.8 as
  // if it described ten cubes is the "never invent data" rule broken quietly.
  { id: 'plus-every-face', name: 'a plus on every face', free: 'all eight corners',
    size: (40320 / 2) * 2187, n: 6, of: 10, meanMoves: 10.8, meanSolve: 19.3,
    pred: EDGES_HOME, parts: ['crossEdges', 'midEdges', 'topEdges'] },
  { id: 'x-every-face', name: 'an X on every face', free: 'all twelve edges',
    size: (479001600 / 2) * 2048, n: 10, of: 10, meanMoves: 8.9, meanSolve: 19.4,
    pred: CORNERS_HOME, parts: ['dCorners', 'uCorners'] },
  // A THIRD SET WAS HERE AND WAS WRONG. "Every piece turned the right way" was declared with
  // `parts: ['flip']`, which constrains only the twelve edges: a legal cube with two twisted corners
  // satisfied it and the search returned a zero-move answer, while the recorded SIZE was computed for
  // the real condition including corner twists. Two different targets under one name. It is removed
  // rather than repaired because there is no corner-twist-only projection to repair it with, and it
  // was never recommended for the game — with the pieces permuted, a correctly turned piece still
  // shows the wrong colour, so there is nothing to see.
];

// ---- report -------------------------------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log(`=== exhaustive symmetry search to ${DEPTH} moves ===================================`);
console.log(`${visited.toLocaleString()} canonical maneuvers in ${(walkMs / 1000).toFixed(1)} s`);
console.log(`kept: fixed by at least ${STORE_MIN_ORDER} of the 24 views, then deduplicated properly`);
console.log(`  ${num(rotationCount, 5)} up to the 24 rotations   (a picture held differently)`);
console.log(`  ${num(designCount, 5)} up to the 48 symmetries   (mirrors merged)`);
console.log(`  ${num(states.length, 5)} up to symmetry and inverse — what the ledger stores\n`);

const byOrder = new Map();
for (const s of states) byOrder.set(s.order, (byOrder.get(s.order) ?? 0) + 1);
console.log('by symmetry order (how many of the 24 views leave the picture alone):');
for (const [order, n] of [...census.entries()].sort((a, b) => b[0] - a[0])) {
  const kept = byOrder.get(order);
  console.log(`  order ${num(order, 2)}  ${num(n, 9)} maneuvers  ${kept === undefined ? 'not kept (below the cut)' : `${num(kept, 5)} distinct pictures kept`}`);
}

console.log(`\nthe most symmetric, shortest first:\n`);
console.log(`  ${pad('order', 6)} ${pad('moves', 6)} ${pad('wrong', 6)} ${pad('blank', 6)} ${pad('faces', 14)} ${pad('name', 24)} maneuver`);
for (const s of states.filter((x) => x.order >= 8 || x.wrong >= 20).slice(0, 30)) {
  const uniform = new Set(s.figures).size === 1 ? draw(s.figures[0]) : `${new Set(s.figures).size} figures`;
  console.log(`  ${pad(s.order, 6)} ${pad(s.depth, 6)} ${pad(s.wrong, 6)} ${pad(s.blank, 6)} ${pad(uniform, 14)} ${pad(NAMED.get(s.look) ?? '', 24)} ${s.alg}`);
}

console.log('\n=== the book\'s fourteen, against the search =================================');
console.log(`  ${pad('pattern', 26)} ${pad('book', 5)} ${pad('order', 6)} ${pad('found', 6)} note`);
for (const r of bookRows) {
  const note = r.inLedger ? 'in the ledger'
    : r.order < STORE_MIN_ORDER ? `order ${r.order} is below the cut of ${STORE_MIN_ORDER}`
      : `order ${r.order}, but further than ${DEPTH} moves`;
  console.log(`  ${pad(r.name, 26)} ${pad(r.bookMoves, 5)} ${pad(r.order, 6)} ${pad(r.depth ?? '-', 6)} ${note}`);
}

console.log('\n=== set patterns: defined by what they leave free ===========================');
for (const s of SETS) {
  console.log(`  ${pad(s.name, 34)} free: ${pad(s.free, 22)} ${pad(s.size.toLocaleString(), 20)} cubes`
    + `   ${s.meanMoves} moves vs ${s.meanSolve} to solve, over ${s.n} of ${s.of} scrambles`);
}
console.log('\n  These cannot be walked to, because they are defined by what they do not say. Their cost');
console.log('  from a scrambled cube is measured in bench/cube-patterns.mjs: a plus at 10.8 moves and an');
console.log('  X at 8.9, against about 19 to solve.');

// ---- emit ---------------------------------------------------------------------------------------

if (EMIT) {
  const FIXTURE = fileURLToPath(new URL('../test/fixtures/pattern-ledger.mjs', import.meta.url));
  const header = `// The pattern ledger. GENERATED — do not hand-edit.
//
//   regenerate: node apps/web/bench/pattern-ledger.mjs ${DEPTH} --emit
//   re-verify:  node --test apps/web/test/pattern-ledger.test.mjs
//
// Every picture within ${DEPTH} moves of solved that is fixed by at least ${STORE_MIN_ORDER} of the 24
// whole-cube rotations — which is what "pretty" means once it is made mechanical, and is the property
// a checkerboard, a ring of dots and a cube-in-a-cube all share. The search was exhaustive for that
// radius, so an entry's \`moves\` is a proved minimum over the whole radius and not a best effort.
//
// THE CUT IS PART OF THE CLAIM. Pictures fixed by exactly two of the 24 are found and COUNTED and not
// kept — at depth ${DEPTH} there are over a hundred thousand such maneuvers, and a ledger of them is a
// database rather than a list. So this file is complete for order ${STORE_MIN_ORDER} and above, and
// says nothing about order 2. The first version of this header said "more than one", which claimed a
// completeness it does not have.
//
// \`look\` is the canonical facelet string: the smallest of the picture's 24 views, so two cubes that
// are the same picture held differently are one entry. \`order\` is how many views leave it unchanged.
// \`alg\` is one shortest maneuver to it, and there are usually others.
//
// The solved cube is deliberately absent. It is order 24 at zero moves and it is what patterns are
// measured FROM, not one of them.
//
// SET patterns are not in here and cannot be: they are defined by what they leave free rather than by
// a cube, so no walk reaches them. They live in \`SET_PATTERNS\` below, with their sizes derived.
`;
  const stateRows = states.map((s) => `  { look: ${JSON.stringify(s.look)}, order: ${s.order}, moves: ${s.depth},`
    + ` alg: ${JSON.stringify(s.alg)}, wrong: ${s.wrong}, blank: ${s.blank},`
    + ` designs: ${s.designs}, variants: ${JSON.stringify(s.variants)}, figures: [${s.figures.join(',')}]`
    + `${NAMED.has(s.look) ? `, name: ${JSON.stringify(NAMED.get(s.look))}` : ''} },`).join('\n');
  const setRows = SETS.map((s) => `  { id: ${JSON.stringify(s.id)}, name: ${JSON.stringify(s.name)},`
    + ` free: ${JSON.stringify(s.free)}, size: ${s.size}, n: ${s.n}, of: ${s.of},`
    + ` meanMoves: ${s.meanMoves}, meanSolve: ${s.meanSolve}, parts: ${JSON.stringify(s.parts)} },`).join('\n');
  writeFileSync(FIXTURE,
    `${header}\nexport const LEDGER_DEPTH = ${DEPTH};\n\n`
    + `export const STATE_PATTERNS = Object.freeze([\n${stateRows}\n].map(Object.freeze));\n\n`
    + `export const SET_PATTERNS = Object.freeze([\n${setRows}\n].map(Object.freeze));\n`);
  console.log(`\nwrote ${FIXTURE}: ${states.length} state patterns, ${SETS.length} set patterns`);
}
