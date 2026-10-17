// The two exhaustive walks behind the pattern ledger, and what they measure as they go.
//
// Split out of `bench/pattern-ledger.mjs` (2026-10-17) so the walks can run in WORKER THREADS: a walk is
// independent below its first move, so each first move is a shard, and `walkAll` merges the shards in
// first-move order with the single walk's own rule — replace a candidate only with a STRICTLY shorter
// one. The first route found at the shortest length therefore wins exactly as it did in one thread, and
// the ledger does not change with the number of cores. Measured on the face walk to 7: 111 million
// maneuvers, 566 s of CPU in one thread.

import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

import { MOVE_NAMES, SOLVED, applyAlg, applyMove } from '../lib/cube-pieces.js';
import { faceTurnsOf } from '../lib/cube-moves.js';
import { readToken } from '../lib/cube-notation.js';
import { toFacelets } from '../lib/two-phase.js';
import { FACE_ORDER, ROTATIONS, canonicalLook, rotateFacelets, untwisted } from './cube-look.mjs';

/**
 * Only pictures fixed by at least this many of the 24 views are written down.
 *
 * Chosen from the depth-6 run rather than picked: order 2 alone produced 1,341 pictures, and a ledger
 * of 1,341 is a database, not a list a child chooses from. The distribution is steep — 1 at order 24,
 * 11 at 8, 102 at 4, 1,341 at 2 — so 4 is where the count stops being a catalogue. Everything found is
 * COUNTED at every order; the cut is about what is kept, and it is recorded beside the kept rows so
 * nobody mistakes the ledger for the census.
 */
export const STORE_MIN_ORDER = 4;

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
export const orderOf = (f) => { let n = 0; for (let r = 0; r < 24; r++) if (fixedBy(f, r)) n++; return n; };

/** A face's 3x3 as a mask of cells matching its centre, canonical over the face's four rotations. */
const ROT9 = [6, 3, 0, 7, 4, 1, 8, 5, 2];
export function figures(f) {
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
export const draw = (mask) => [0, 1, 2].map((r) => [0, 1, 2].map((c) => ((mask >> (r * 3 + c)) & 1 ? '#' : '.')).join('')).join('/');

/** How many faces show a single colour. RECORDED, never used to exclude — see below. */
export function blankFaces(f) {
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

/**
 * Is no piece turned against the others? `untwisted` in `bench/cube-look.mjs` is the measure, and its
 * comment is the decision (owner's call, 2026-09-12; widened 2026-10-17 so that a shell turned as one
 * piece against its centres — Six Spots — is not read as twisted).
 *
 * THE CUT IS ON ROUTES, NOT ON PICTURES, and that is the whole subtlety. The first version of this cut
 * assumed "twisted" was a property of the PICTURE, so it asserted that every maneuver reaching one
 * canonical look agrees about it — and the assertion fired immediately: `U R2 F2 L2 R2 F2 L2` leaves
 * every piece straight and `U2 R2 D2 U2 R2 D2 F` does not, yet the two reach the same look.
 *
 * The reason is that `canonicalLook` rotates the cube AND RENAMES THE COLOURS, which is the right
 * notion for "is this the same design" and the wrong one for "is a piece twisted": renaming is not
 * something a cube does. Measured, because it was worth knowing rather than assuming: of 720
 * picture-and-view pairs, 192 read differently about orientation depending on the view.
 *
 * So a look is kept when SOME maneuver within the radius reaches it untwisted, and the row stores the
 * shortest such maneuver. `moves` is therefore the proved minimum among untwisted routes, which can be
 * longer than the proved minimum overall; the report prints how often and by how much.
 */
export const oriented = untwisted;

/** How many of the 54 stickers read differently from a solved cube. */
export function stickersWrong(f) {
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

// ---- the named ones, for provenance and as exceptions --------------------------------------------
//
// Famous patterns, as a book prints them. Two jobs. PROVENANCE: a picture the walks find keeps the
// book's name. EXCEPTIONS (owner's call, 2026-10-17): a famous picture is in the ledger even when the
// walks cannot keep it — further than either radius, or fixed by fewer than four views — PROVIDED no
// piece is twisted. The radius and the order cut exist to keep a SEARCH's output a catalogue rather
// than a database; a hand-named list of fourteen does not threaten that, so they do not apply to it.
// The twist cut is about what a child sees, so it does.
//
// SIX SPOTS was "Centres" here until 2026-10-17. The name is sourced, not chosen: the `rubik` LaTeX
// package's pattern list (Nickalls and Syropoulos, CTAN) names exactly this sequence "sixspot", and the
// Rubik's fandom wiki lists "Six spots" with the slice route `E M E' M'`.
export const BOOK = [
  ['The Checkerboard', 'U2 D2 F2 B2 L2 R2'],
  ['Plus/Minus', 'U2 R2 L2 U2 R2 L2'],
  ['Lines', 'R2 U2 R2 U2 R2 U2 L2 D2 L2 D2 L2 D2 L2 R2'],
  ['Cube in a Cube', "F L F U' R U F2 L2 U' L' B D' B' L2 U"],
  ['Side Lines', "R D R F R' F' B D R' U' B' U D2"],
  ['Cube in a Cube in a Cube', "U' L' U' F' R2 B' R F U B2 U B' L U' F U R F'"],
  ['Superflip', "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2"],
  ['Chessboard in a Cube', "B D F' B' D L2 U L U' B D' R B R D' R L' F U2 D"],
  ['Six Spots', "U D' R L' F B' U D'"],
  ['Opposite Corners', 'R L U2 F2 D2 F2 R L F2 D2 B2 D2'],
  ['Vertical Stripes', "F U F R L2 B D' R D2 L D' B R2 L F U F"],
  ['Shifted Blocks', "L2 B2 D' B2 D L2 U R2 D R2 B U R' F2 R U' B' U'"],
  ['Hello!', 'U2 R2 F2 U2 D2 F2 L2 U2'],
  ['40 (4T)', "F2 D2 F' L2 D2 U2 R2 B' U2 F2"],
];
/** Every view of every book picture -> its canonical look, so a walk can recognise one at ANY order
 *  with a single lookup on the facelets it already has. */
const NAMED_VIEWS = new Map();
for (const [, alg] of BOOK) {
  const f = toFacelets(applyAlg(SOLVED, alg));
  const look = canonicalLook(f);
  for (let r = 0; r < ROTATIONS.length; r++) NAMED_VIEWS.set(rotateFacelets(f, r), look);
}

/**
 * Where one walk keeps what it finds: canonical look -> { best, clean }.
 *
 * TWO candidates per picture, because the twist cut is a cut on routes. `best` is the shortest maneuver
 * of any kind and exists only so the report can price the cut; `clean` is the shortest one that leaves
 * no piece twisted, and it is what the ledger stores. `route` is the maneuver as the walk spelled it —
 * face letters, and in the slice walk the cube's own M, E and S — and `state` is the cube it reaches.
 *
 * The measurements are built only when a candidate is actually being replaced. Building them eagerly is
 * correct and wasteful: most maneuvers at or above the order cut reach a picture already seen at the
 * same depth or shallower, and `figures` is ~200 operations.
 */
function recorder() {
  const found = new Map();
  const census = new Map();   // symmetry order -> maneuvers seen (not deduplicated by look)
  let visited = 0;
  function see(state, f, path) {
    visited++;
    // Cheap gate first: a picture fixed by NO rotation but the identity is not a pattern, and the test
    // above costs a few character comparisons for almost every state it rejects.
    let order = 1;
    for (let r = 1; r < 24; r++) if (fixedBy(f, r)) { order++; }
    if (order < 2) return;
    census.set(order, (census.get(order) ?? 0) + 1);
    let look;
    if (order >= STORE_MIN_ORDER) look = canonicalLook(f);
    else if (NAMED_VIEWS.has(f)) look = NAMED_VIEWS.get(f);
    else return;
    const prior = found.get(look);
    const ori = oriented(state);
    const measure = () => ({ order, depth: path.length, route: [...path], state, figures: figures(f),
      wrong: stickersWrong(f), blank: blankFaces(f) });
    if (!prior) {
      const entry = measure();
      found.set(look, { best: entry, clean: ori ? entry : null });
    } else {
      if (path.length < prior.best.depth) prior.best = measure();
      if (ori && (!prior.clean || path.length < prior.clean.depth)) prior.clean = measure();
    }
  }
  return { found, census, see, visited: () => visited };
}

// ---- the moves ------------------------------------------------------------------------------------
//
// The FACE walk turns the 18 faces; the SLICE walk turns those and the 9 middle layers, each one move.
// Spelled in the CUBE'S OWN letters (the identity frame): a slice moves the centres, so after one the
// child's "U" is a different face of the cube, and the walk would otherwise have to carry a hold. It
// does not need to — every held move is some identity move and back — so it walks identity moves and
// leaves the spelling a child reads to `heldRoute` in the ledger. Relative to the centres a slice IS its
// two outer faces turned the other way (`faceTurnsOf`: M is R L'), which is what the piece model applies.
//
// PRUNING, each rule a shorter route that reaches the same cube:
//   - never the same face twice running, and two turns on one axis in one order only (by letter);
//   - in the slice walk, two moves on one axis never include a slice: any run of turns on one axis
//     comes to some R^i L^j relative to the centres, which is one face turn, one slice, or two face
//     turns — and never the two face turns a slice already is (R L' is M, one move shorter).
// The last rule is the SLICE metric's alone: in face turns `R L'` is two moves and nothing is shorter.

const FACE_AXIS = { U: 'y', D: 'y', R: 'x', L: 'x', F: 'z', B: 'z' };
const FACE_MOVES = MOVE_NAMES.map((name) => ({ token: name, axis: FACE_AXIS[name[0]], slice: false, turns: [name] }));
const SLICE_MOVES = ['M', "M'", 'M2', 'E', "E'", 'E2', 'S', "S'", 'S2'].map((token) => {
  const { move } = readToken(token);
  return { token, axis: move.axis, slice: true, turns: faceTurnsOf(move).turns.map((t) => t.name) };
});
const SLICE_PAIRS = new Set(SLICE_MOVES.map((m) => [...m.turns].sort().join(' ')));
const MOVES = { face: FACE_MOVES, slice: [...FACE_MOVES, ...SLICE_MOVES] };

/**
 * One shard of a walk: the solved cube alone (`first` -1), or every maneuver of up to `depth` moves that
 * begins with move `first`. Returns what its recorder found, in a form a worker can post.
 */
function walkShard(kind, depth, first) {
  const moves = MOVES[kind];
  const rec = recorder();
  const path = [];
  const go = (state, left, last) => {
    rec.see(state, toFacelets(state), path);
    if (left === 0) return;
    for (const m of moves) {
      if (last && m.axis === last.axis) {
        if (m.slice || last.slice) continue;
        if (m.token[0] <= last.token[0]) continue;
        if (kind === 'slice' && SLICE_PAIRS.has([last.token, m.token].sort().join(' '))) continue;
      }
      let next = state;
      for (const t of m.turns) next = applyMove(next, t);
      path.push(m.token);
      go(next, left - 1, m);
      path.pop();
    }
  };
  if (first === -1) rec.see(SOLVED, toFacelets(SOLVED), path);
  else if (depth > 0) {
    const m = moves[first];
    let state = SOLVED;
    for (const t of m.turns) state = applyMove(state, t);
    path.push(m.token);
    go(state, depth - 1, m);
  }
  return { found: [...rec.found], census: [...rec.census], visited: rec.visited() };
}

/** Run one shard in a worker thread. */
function inWorker(kind, depth, first) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { patternWalk: { kind, depth, first } } });
    let answered = false;
    worker.once('message', (result) => { answered = true; resolve(result); });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (!answered) reject(new Error(`pattern walk shard ${kind}/${first} exited ${code} without an answer`));
    });
  });
}

/**
 * The whole walk of `kind` ('face' or 'slice') to `depth`, sharded across worker threads, merged as one
 * thread would have found it: `{ found, census, visited, ms }`.
 */
export async function walkAll(kind, depth, { threads = availableParallelism() } = {}) {
  const t0 = Date.now();
  const shards = [-1, ...MOVES[kind].map((_, i) => i)];
  const results = new Array(shards.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(threads, shards.length)) }, async () => {
    while (next < shards.length) {
      const k = next++;
      results[k] = await inWorker(kind, depth, shards[k]);
    }
  }));
  return { ...mergeShards(results), ms: Date.now() - t0 };
}

/**
 * Shards merged IN SHARD ORDER, which is the order one thread would have walked them in, with the single
 * walk's own rule: a candidate is replaced only by a strictly shorter one, so the first route found at
 * the shortest length wins exactly as it did in one thread.
 */
function mergeShards(results) {
  const found = new Map();
  const census = new Map();
  let visited = 0;
  for (const r of results) {
    visited += r.visited;
    for (const [order, n] of r.census) census.set(order, (census.get(order) ?? 0) + n);
    for (const [look, v] of r.found) {
      const prior = found.get(look);
      if (!prior) { found.set(look, v); continue; }
      if (v.best.depth < prior.best.depth) prior.best = v.best;
      if (v.clean && (!prior.clean || v.clean.depth < prior.clean.depth)) prior.clean = v.clean;
    }
  }
  return { found, census, visited };
}

if (!isMainThread && workerData?.patternWalk) {
  const { kind, depth, first } = workerData.patternWalk;
  parentPort.postMessage(walkShard(kind, depth, first));
}
