// The pattern ledger: every interesting picture within reach, found by search and written down.
//
//   node bench/pattern-ledger.mjs [depth] [sliceDepth]           report
//   node bench/pattern-ledger.mjs [depth] [sliceDepth] --emit    rewrite test/fixtures/pattern-ledger.mjs
//
// TWO WALKS, TWO METRICS (2026-10-17). `depth` bounds the FACE walk, where a move is one of the 18
// face turns — the half-turn metric every solver in this app speaks. `sliceDepth` bounds the SLICE
// walk, where a middle-layer turn (M, E, S) is one move too, because it is one movement of a hand:
// Six Spots is `M E M' E'`, four moves, and eight face turns. A picture that slices make short and
// face turns do not was invisible to the face walk alone.
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
import { SOLVED, applyAlg } from '../lib/cube-pieces.js';
import { applyIdentity, heldMove, run, tokenOf } from '../lib/cube-moves.js';
import { readToken } from '../lib/cube-notation.js';
import { toFacelets } from '../lib/two-phase.js';
import { canonicalDesign, canonicalLook, verify } from './cube-look.mjs';
import { BOOK, STORE_MIN_ORDER, blankFaces, draw, figures, orderOf, oriented, stickersWrong, walkAll } from './pattern-walk.mjs';

const DEPTHS = process.argv.filter((a) => /^\d+$/.test(a)).map(Number);
const DEPTH = DEPTHS[0] ?? 6;
const SLICE_DEPTH = DEPTHS[1] ?? 5;
const EMIT = process.argv.includes('--emit');

verify();

// ---- the two walks, in worker threads (bench/pattern-walk.mjs) -------------------------------------

const face = await walkAll('face', DEPTH);
const found = face.found;
const census = face.census;
const visited = face.visited;
const walkMs = face.ms;
const sliced = await walkAll('slice', SLICE_DEPTH);
const sliceMs = sliced.ms;

/**
 * An identity-frame route as the child's moves, read in the hold each is made in, from white up and
 * green in front. The inverse of what `run` does, and checked against it: a route that does not replay
 * through `run` to the cube the walk reached is a generator bug, and it stops here rather than in a test.
 */
function heldRoute(tokens, state) {
  let now = { state: SOLVED, hold: ['U', 'F'] };
  const out = [];
  for (const token of tokens) {
    const { move } = readToken(token);
    // A half turn is the same move either way round; `M2'` is how the interpreter spells a negative one,
    // and a child reads `M2`.
    out.push(tokenOf(heldMove(move, now.hold)).replace(/2'$/, '2'));
    now = applyIdentity(move, now.hold, now.state);
  }
  const alg = out.join(' ');
  if (toFacelets(run(alg, ['U', 'F'], SOLVED).state) !== toFacelets(state)) {
    throw new Error(`heldRoute: "${alg}" does not replay to the cube the slice walk reached`);
  }
  return alg;
}

// The solved cube is in there at order 24 and depth 0. It is not a pattern; it is the thing patterns
// are measured from, and leaving it in would make the ledger's first row a lie about the game.
const SOLVED_LOOK = canonicalLook(toFacelets(SOLVED));
found.delete(SOLVED_LOOK);
sliced.found.delete(SOLVED_LOOK);

// THE TWIST CUT — see `oriented` above for what it is measured against and why. Counted by symmetry
// order before it is applied, so the ledger says what it threw away instead of merely being smaller
// than it was. A picture here can be perfectly symmetric and still show one corner sticker rotated out
// of an otherwise solid block, which is the thing being removed. Counted over the pictures at or above
// the order cut only: a book picture below it is in `found` so it can be NAMED, not as a find.
function cutTwisted(walked) {
  const twisted = new Set();
  const byOrder = new Map();
  /** Pictures whose shortest untwisted route is LONGER than their shortest route of any kind. */
  const price = [];
  let before = 0;
  const kept = new Map();
  for (const [look, v] of walked) {
    const counted = v.best.order >= STORE_MIN_ORDER;
    if (counted) before++;
    if (v.clean === null) {
      twisted.add(look);
      if (counted) byOrder.set(v.best.order, (byOrder.get(v.best.order) ?? 0) + 1);
      continue;
    }
    if (v.clean.depth > v.best.depth) price.push({ look, cost: v.clean.depth - v.best.depth });
    kept.set(look, v.clean);
  }
  return { kept, twisted, byOrder, before, price };
}
const faceCut = cutTwisted(found);
const sliceCut = cutTwisted(sliced.found);
const twistedLooks = faceCut.twisted;
const twistedByOrder = faceCut.byOrder;
const looksBeforeTwistCut = faceCut.before;
const twistPrice = faceCut.price;

// THE SLICE WALK MUST SEE EVERYTHING THE FACE WALK SEES within its radius, at no greater length: its
// moves include all eighteen face turns, and every route it prunes has a shorter one it keeps. A
// picture the face walk keeps at n <= SLICE_DEPTH that the slice walk lacks, or holds at more than n,
// is a pruning rule that threw away a cube — and every slice minimum would then be a lie.
for (const [look, v] of faceCut.kept) {
  if (v.depth > SLICE_DEPTH) continue;
  const s = sliceCut.kept.get(look);
  if (!s || s.depth > v.depth) {
    throw new Error(`the slice walk lost ${v.route.join(' ')} (${v.depth} face turns): its pruning is wrong`);
  }
}

// ---- the book, as names and as exceptions --------------------------------------------------------

const bookRows = BOOK.map(([name, alg]) => {
  const state = applyAlg(SOLVED, alg);
  const f = toFacelets(state);
  return { name, alg, state, look: canonicalLook(f), order: orderOf(f), clean: oriented(state),
    bookMoves: alg.trim().split(/\s+/).length };
});
const BOOK_BY_LOOK = new Map(bookRows.map((b) => [b.look, b]));

// Every picture either walk kept, and every book picture with no twisted piece — the exceptions.
// A book picture the walks found only twisted is admitted on its BOOK route when that route is clean,
// for the same reason the walks admit a picture on its cleanest route: the cut is on routes.
const admitted = new Set([...faceCut.kept.keys(), ...sliceCut.kept.keys()]);
for (const b of bookRows) if (b.clean) admitted.add(b.look);
admitted.delete(SOLVED_LOOK);

/** Order, figures, wrong and blank, measured on the cube a row's FIRST route reaches. */
function measured(state) {
  const f = toFacelets(state);
  return { order: orderOf(f), figures: figures(f), wrong: stickersWrong(f), blank: blankFaces(f) };
}

const rotationClasses = [...admitted].map((look) => {
  const byFace = faceCut.kept.get(look) ?? null;
  const bySlice = sliceCut.kept.get(look) ?? null;
  const book = BOOK_BY_LOOK.get(look) ?? null;
  // The FIRST route — face turns when there are any, then the slice walk's, then the book's — is the
  // one every measurement below and every reader downstream takes the picture from.
  const state = byFace?.state ?? bySlice?.state ?? book.state;
  return {
    look,
    ...measured(state),
    state,
    moves: byFace?.depth ?? null,
    alg: byFace ? byFace.route.join(' ') : null,
    sliceMoves: bySlice?.depth ?? null,
    sliceAlg: bySlice ? heldRoute(bySlice.route, bySlice.state) : null,
    ...(book ? { name: book.name, book: book.alg } : {}),
  };
});

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

const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
/**
 * Shortest first, and the ORDER OF TIES IS A DECISION. Face turns first; among equals a book picture,
 * whose name and route then head the row; then the face route's spelling, which is how the face walk
 * alone broke ties before 2026-10-17 — so no family that already had a head gets a different one, and
 * no offered picture turns into its mirror. Then slice moves, for families no face route reaches.
 */
const byLength = (a, b) => (a.moves ?? Infinity) - (b.moves ?? Infinity)
  || Number(Boolean(b.name)) - Number(Boolean(a.name))
  || (a.alg !== null && b.alg !== null ? cmp(a.alg, b.alg) : 0)
  || (a.sliceMoves ?? Infinity) - (b.sliceMoves ?? Infinity)
  || cmp(a.sliceAlg ?? a.look, b.sliceAlg ?? b.look);

const familyOf = new Map();
for (const r of rotationClasses) {
  const design = canonicalDesign(toFacelets(r.state));
  const key = [design, canonicalDesign(toFacelets(inverseState(r.state)))].sort()[0];
  r.design = design;
  if (!familyOf.has(key)) familyOf.set(key, []);
  familyOf.get(key).push(r);
}

const states = [...familyOf.entries()].map(([family, members]) => {
  members.sort(byLength);
  const head = members[0];
  // A name belongs to the FAMILY, not to whichever member happened to be shortest — but the book's
  // ROUTE belongs to one picture, and a row carries the head's picture. So a named member that is not
  // its family's head is refused here rather than written as a row whose name and route disagree.
  const named = members.find((m) => m.name);
  if (named && named !== head) {
    throw new Error(`${named.name} is not the shortest picture of its family (${head.alg ?? head.sliceAlg}) — decide which the row is`);
  }
  const { state, ...row } = head;
  return {
    ...row,
    family,
    designs: new Set(members.map((m) => m.design)).size,
    // Face-turn variants only: they are what the oracle can grade and what `applyAlg` can replay.
    variants: members.slice(1).filter((m) => m.alg !== null).map((m) => m.alg),
  };
}).sort((a, b) => b.order - a.order || byLength(a, b));

const rotationCount = rotationClasses.length;
const designCount = new Set(rotationClasses.map((r) => r.design)).size;
const NAMED = new Map(states.filter((s) => s.name).map((s) => [s.look, s.name]));

// ---- the set patterns ---------------------------------------------------------------------------
//
// Defined by what they leave free, so they cannot be walked to. Each is a piece-class predicate, each
// is checked against the app's own model, and each has its reachable size derived rather than guessed.

// THE TWIST CUT DOES NOT TOUCH THESE, and the reason is in the predicates rather than in a judgement.
// Each set requires the pieces it NAMES to be home AND turned the right way up — `eo` all zero for the
// plus, `co` all zero for the X — so the part of the picture a child is looking at cannot contain a
// twist. The pieces left free show assorted colours whatever they do, and a twisted free piece is
// indistinguishable from a permuted one there. So a set pattern is never a twisted pattern.
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

console.log(`=== exhaustive symmetry search to ${DEPTH} face turns ===================================`);
console.log(`${visited.toLocaleString()} canonical maneuvers in ${(walkMs / 1000).toFixed(1)} s`);
console.log(`and to ${SLICE_DEPTH} moves counting a middle-layer turn as one:`
  + ` ${sliced.visited.toLocaleString()} maneuvers in ${(sliceMs / 1000).toFixed(1)} s`);
console.log(`kept: fixed by at least ${STORE_MIN_ORDER} of the 24 views, untwisted, then deduplicated`);
console.log(`  ${num(looksBeforeTwistCut, 5)} pictures at or above the order cut`);
console.log(`  ${num(twistedLooks.size, 5)} reachable no other way than with a twisted corner or a flipped edge — CUT`
  + `   (by order: ${[...twistedByOrder.entries()].sort((a, b) => b[0] - a[0]).map(([o, n]) => `${o}:${n}`).join(' ')})`);
console.log(`  ${num(twistPrice.length, 5)} kept, but their shortest UNTWISTED route is longer`
  + `${twistPrice.length ? ` (by ${[...new Set(twistPrice.map((x) => x.cost))].sort((a, b) => a - b).join(' and ')} moves)` : ''}`);
const sliceOnly = [...sliceCut.kept.keys()].filter((look) => !faceCut.kept.has(look)).length;
const bookOnly = [...admitted].filter((look) => !faceCut.kept.has(look) && !sliceCut.kept.has(look)).length;
console.log(`  ${num(sliceOnly, 5)} more that only the slice walk reaches untwisted`
  + `   (its own twist cut: ${sliceCut.twisted.size} of ${sliceCut.before})`);
console.log(`  ${num(bookOnly, 5)} more from the book, beyond both walks and untwisted`);
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
console.log(`  ${pad('order', 6)} ${pad('moves', 6)} ${pad('slice', 6)} ${pad('wrong', 6)} ${pad('blank', 6)} ${pad('faces', 14)} ${pad('name', 24)} maneuver`);
for (const s of states.filter((x) => x.order >= 8 || x.wrong >= 20 || x.moves === null).slice(0, 40)) {
  const uniform = new Set(s.figures).size === 1 ? draw(s.figures[0]) : `${new Set(s.figures).size} figures`;
  console.log(`  ${pad(s.order, 6)} ${pad(s.moves ?? '-', 6)} ${pad(s.sliceMoves ?? '-', 6)} ${pad(s.wrong, 6)} ${pad(s.blank, 6)} ${pad(uniform, 14)} ${pad(NAMED.get(s.look) ?? '', 24)} ${s.alg ?? s.sliceAlg ?? s.book}`);
}

console.log('\n=== the book\'s fourteen, against the search =================================');
console.log(`  ${pad('pattern', 26)} ${pad('book', 5)} ${pad('order', 6)} ${pad('moves', 6)} ${pad('slice', 6)} note`);
for (const r of bookRows) {
  const row = states.find((s) => s.look === r.look);
  const note = row ? (row.moves !== null ? 'in the ledger, found by the face walk'
    : row.sliceMoves !== null ? 'in the ledger, found by the slice walk' : 'in the ledger, on the book\'s own route')
    : 'NOT in the ledger: no route to it leaves every piece untwisted';
  console.log(`  ${pad(r.name, 26)} ${pad(r.bookMoves, 5)} ${pad(r.order, 6)} ${pad(row?.moves ?? '-', 6)} ${pad(row?.sliceMoves ?? '-', 6)} ${note}`);
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
//   regenerate: node apps/web/bench/pattern-ledger.mjs ${DEPTH} ${SLICE_DEPTH} --emit
//   re-verify:  node --test apps/web/test/pattern-ledger.test.mjs
//
// Every picture fixed by at least ${STORE_MIN_ORDER} of the 24 whole-cube rotations, with no piece twisted,
// that is within ${DEPTH} FACE TURNS of solved or within ${SLICE_DEPTH} moves when a middle-layer turn (M, E, S)
// counts as one — which is what "pretty" means once it is made mechanical, and is the property a
// checkerboard, a ring of dots and a cube-in-a-cube all share. Both walks were exhaustive for their
// radius, so a row's \`moves\` and \`sliceMoves\` are proved minima and not best efforts.
//
// TWO METRICS, because a slice is one movement of a hand and two face turns to the pieces. \`moves\` and
// \`alg\` are in face turns — the half-turn metric every solver here speaks — and null when no
// untwisted face-turn route lies within ${DEPTH}. \`sliceMoves\` and \`sliceAlg\` count a slice as one, and
// \`sliceAlg\` is spelled as a child performs it, each letter read in the hold the moves before it left;
// null when no untwisted route lies within ${SLICE_DEPTH}. Six Spots is the reason: \`M E M' E'\`, four moves,
// and eight face turns, so the face walk alone never saw it.
//
// THREE CUTS, AND ALL ARE PART OF THE CLAIM.
//
// ORDER. Pictures fixed by fewer than ${STORE_MIN_ORDER} of the 24 are found and COUNTED and not kept — at depth
// ${DEPTH} there are over a hundred thousand such maneuvers at order 2 alone, and a ledger of them is a
// database rather than a list. So this file is complete for order ${STORE_MIN_ORDER} and above within both radii,
// and says nothing about lower orders except for the book's rows below.
//
// TWIST. ${twistedLooks.size} of the ${looksBeforeTwistCut} pictures the face walk finds above the order cut, and
// ${sliceCut.twisted.size} of the ${sliceCut.before} the slice walk finds, cannot be reached inside the radius
// without a piece twisted against the others, and are cut (owner's call, 2026-09-12). A permuted piece
// reads as design, because the whole piece moved; a twisted corner shows ONE sticker of the wrong colour
// inside an otherwise clean block, and a child cannot tell that from a misscramble. "Twisted" is
// \`untwisted\` in bench/cube-look.mjs: no turn of the whole SHELL leaves every piece oriented. It read
// "oriented against the centres" until 2026-10-17, which cut Six Spots — a solved shell turned against
// its centres — though nothing on it looks twisted.
//
// The cut is on ROUTES and not on pictures: \`canonicalLook\` renames colours as it rotates, so two
// maneuvers can reach one look and disagree about whether a piece is twisted, and a look is kept when
// SOME route to it is clean. \`moves\` is therefore the proved minimum among untwisted routes, which could
// in principle be longer than the proved minimum over all routes. ${twistPrice.length === 0 ? 'Measured: for every picture kept here it is\n// not — the shortest route to a picture that can be reached straight at all is already a straight one.' : `For ${twistPrice.length} of the pictures kept here it is longer.`}
//
// RADIUS. Within the two above. EXCEPT THE BOOK: a famous picture (\`name\`, with the route a book prints
// as \`book\`) is kept whatever its order and distance, provided its book route twists nothing — the radius
// and the order cut keep a SEARCH's output a catalogue, and a hand-named list of fourteen does not
// threaten that (owner's call, 2026-10-17). A row reached by neither walk has \`moves\` and \`sliceMoves\`
// null: its distance is not proved, and a book's route is not a minimum.
//
// \`look\` is the canonical facelet string: the smallest of the picture's 24 views, so two cubes that
// are the same picture held differently are one entry. \`order\` is how many views leave it unchanged.
// \`order\`, \`figures\`, \`wrong\` and \`blank\` are measured on the cube the row's FIRST route reaches —
// \`alg\` when there is one, then \`sliceAlg\`, then \`book\`. \`variants\` are the family's other face-turn
// routes.
//
// The solved cube is deliberately absent. It is order 24 at zero moves and it is what patterns are
// measured FROM, not one of them.
//
// SET patterns are not in here and cannot be: they are defined by what they leave free rather than by
// a cube, so no walk reaches them. They live in \`SET_PATTERNS\` below, with their sizes derived.
`;
  const stateRows = states.map((s) => `  { look: ${JSON.stringify(s.look)}, order: ${s.order},`
    + ` moves: ${s.moves}, alg: ${JSON.stringify(s.alg)},`
    + ` sliceMoves: ${s.sliceMoves}, sliceAlg: ${JSON.stringify(s.sliceAlg)},`
    + ` wrong: ${s.wrong}, blank: ${s.blank},`
    + ` designs: ${s.designs}, variants: ${JSON.stringify(s.variants)}, figures: [${s.figures.join(',')}]`
    + `${s.name ? `, name: ${JSON.stringify(s.name)}, book: ${JSON.stringify(s.book)}` : ''} },`).join('\n');
  const setRows = SETS.map((s) => `  { id: ${JSON.stringify(s.id)}, name: ${JSON.stringify(s.name)},`
    + ` free: ${JSON.stringify(s.free)}, size: ${s.size}, n: ${s.n}, of: ${s.of},`
    + ` meanMoves: ${s.meanMoves}, meanSolve: ${s.meanSolve}, parts: ${JSON.stringify(s.parts)} },`).join('\n');
  writeFileSync(FIXTURE,
    `${header}\nexport const LEDGER_DEPTH = ${DEPTH};\nexport const SLICE_DEPTH = ${SLICE_DEPTH};\n\n`
    + `export const STATE_PATTERNS = Object.freeze([\n${stateRows}\n].map(Object.freeze));\n\n`
    + `export const SET_PATTERNS = Object.freeze([\n${setRows}\n].map(Object.freeze));\n`);
  console.log(`\nwrote ${FIXTURE}: ${states.length} state patterns, ${SETS.length} set patterns`);
}
