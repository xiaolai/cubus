// What a cube looks like at the end of each phase of each solving method.
//
//   node bench/solver-phases.mjs
//
// A solving phase is a PATTERN — a set pattern, in the sense dev-docs/solve-to-state-plan.md is built
// around. It pins some stickers and leaves the rest free, which is exactly why "take me back to this
// phase" is cheap from anywhere.
//
// WHAT A PICTURE SAYS, and the first version of this file could not say enough. It knew only
// "settled" and "free", and that is too coarse for half the methods people actually use. ZZ's first
// phase orients every edge and settles almost no sticker; Kociemba's first phase — the app's OWN
// solver's first phase — orients every corner, which settles no sticker either while forbidding most
// colours from most places. Drawn as free, both look like nothing is happening, and that is a lie
// about a phase whose whole content is a constraint.
//
// So a sticker now carries the SET of colours it can show. One colour is settled. Two or three is a
// real constraint worth drawing. Four or more is free in any sense a child would notice.
//
// AND THE SETS ARE MEASURED, NOT DERIVED. Members of each phase are generated and the colours seen at
// each sticker collected. Two independent generators exist and where both apply they must agree:
//
//   * by PIECES — place the pinned pieces, shuffle the rest, repair the cube's three laws. Works for
//     any phase described as "these pieces are home, these are oriented".
//   * by GENERATORS — random products of a subgroup's own moves. Works for the coset phases of
//     Thistlethwaite and Kociemba, where it is correct by construction rather than by argument.
//
// The agreement between them is the check that makes the pictures trustworthy, and it is what caught
// nothing so far only because it has been run on every phase that admits both.

import { MOVE_NAMES, SOLVED, applyAlg, applyMove } from '../lib/cube-pieces.js';
import { toFacelets } from '../lib/two-phase.js';
import { FACE_ORDER, verify } from './cube-look.mjs';
import { lcg } from '../test/fixtures/seeded-scrambles.mjs';

verify();

// ---- slots, derived from the facelet layout -----------------------------------------------------

const PLACE = {
  U: (r, c) => [c - 1, 1, r - 1], R: (r, c) => [1, 1 - r, 1 - c], F: (r, c) => [c - 1, 1 - r, 1],
  D: (r, c) => [c - 1, -1, 1 - r], L: (r, c) => [-1, 1 - r, c - 1], B: (r, c) => [1 - c, 1 - r, -1],
};
const byPlace = new Map();
for (let f = 0; f < 6; f++) {
  const face = FACE_ORDER[f];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const key = PLACE[face](r, c).join(',');
    if (!byPlace.has(key)) byPlace.set(key, []);
    byPlace.get(key).push({ index: f * 9 + r * 3 + c, face });
  }
}

const EDGE_NAMES = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];
const CORNER_NAMES = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
const sameLetters = (a, b) => [...a].sort().join('') === [...b].sort().join('');

/** slot name -> the facelet indices of its stickers, and which face each is on. */
export const SLOT = {};
for (const stickers of byPlace.values()) {
  if (stickers.length === 1) continue;
  const letters = stickers.map((s) => s.face).join('');
  const names = stickers.length === 2 ? EDGE_NAMES : CORNER_NAMES;
  const name = names.find((n) => sameLetters(n, letters));
  if (!name) throw new Error(`no slot named for the stickers on ${letters}`);
  SLOT[name] = stickers;
}
if (Object.keys(SLOT).length !== 20) throw new Error(`${Object.keys(SLOT).length} slots, expected 20`);

const EDGE_INDEX = Object.fromEntries(EDGE_NAMES.map((n, i) => [n, i]));
const CORNER_INDEX = Object.fromEntries(CORNER_NAMES.map((n, i) => [n, i]));

// ---- piece groups -------------------------------------------------------------------------------

const CROSS = ['DR', 'DF', 'DL', 'DB'];
const D_CORNERS = ['DFR', 'DLF', 'DBL', 'DRB'];
const MIDDLE = ['FR', 'FL', 'BL', 'BR'];          // the E slice
const U_EDGES = ['UR', 'UF', 'UL', 'UB'];
const U_CORNERS = ['URF', 'UFL', 'ULB', 'UBR'];
const F2L = [...CROSS, ...D_CORNERS, ...MIDDLE];
const ROUX_FB = ['DL', 'FL', 'BL', 'DLF', 'DBL'];
const ROUX_SB = ['DR', 'FR', 'BR', 'DFR', 'DRB'];
// Petrus builds outward from one corner: a 2x2x2 then a 2x2x3.
const PETRUS_222 = ['DLF', 'DL', 'DF', 'FL'];
const PETRUS_223 = [...PETRUS_222, 'DBL', 'DB', 'BL'];
// ZZ's EOLine: every edge oriented, plus the two edges of the D layer's front-back line.
const ZZ_LINE = ['DF', 'DB'];
/**
 * Mehta's first block is NOT Roux's, and reusing Roux's was wrong.
 *
 * Mehta solves a 1x2x3 lying FLAT in the D layer — the D centre, the DF, DL and DB edges, and the DLF
 * and DBL corners — where Roux's stands UP on the left face with DL, FL and BL. Two of Roux's edges
 * are E-slice edges, so reusing it made the belt phase pin five edges where Mehta's pins seven, and
 * the blurb "five edges left" was then wrong about a phase that was itself wrong. Found by audit and
 * confirmed against Mehta's own documentation.
 */
const MEHTA_FB = ['DF', 'DL', 'DB', 'DLF', 'DBL'];
const MEHTA_BELT = [...MEHTA_FB, ...MIDDLE];

/**
 * THE DAISY, and the assumption it breaks.
 *
 * Every other phase in this file is a RELAXATION of a solved cube: it asks for less, so a solved cube
 * satisfies it and every settled sticker shows the colour a solved cube shows there. The daisy is not.
 * It is four bottom-colour edges arranged round the TOP centre — the commonest way a child is taught
 * to start, and a state a solved cube does not satisfy. Its settled stickers deliberately disagree
 * with a solved cube, which is why `relaxationOfSolved` exists and why the test asserts the flag
 * rather than trusting it.
 *
 * Which flip puts a bottom edge's bottom-colour sticker upward is MEASURED below rather than derived,
 * because the orientation convention in cube-pieces.js is against the F/B axis and reasoning about it
 * by hand is exactly the sort of thing this session has got wrong twice.
 */
const DAISY_FLIP = (() => {
  const solvedFacelets = toFacelets(SOLVED);
  const table = {};
  for (const slot of U_EDGES) {
    for (const cubie of CROSS) {
      let found = null;
      for (const flip of [0, 1]) {
        const ep = [...SOLVED.ep], eo = [...SOLVED.eo];
        // Put `cubie` in `slot` and whatever was in `slot` into the cubie's home, so ep stays a
        // permutation; only the sticker under test is being read.
        const si = EDGE_INDEX[slot], ci = EDGE_INDEX[cubie];
        ep[si] = ci; ep[ci] = EDGE_INDEX[slot]; eo[si] = flip;
        const f = toFacelets({ cp: [...SOLVED.cp], co: [...SOLVED.co], ep, eo });
        const upSticker = SLOT[slot].find((st) => st.face === 'U');
        if (f[upSticker.index] === 'D') found = flip;
      }
      if (found === null) throw new Error(`no flip puts ${cubie}'s bottom sticker up in ${slot}`);
      table[`${slot}/${cubie}`] = found;
    }
  }
  return table;
})();

// ---- the phases ---------------------------------------------------------------------------------
//
// `solved` pins a piece and its turn. `placed` pins the piece and leaves the turn free. `orientEdges`
// and `orientCorners` orient everything without placing anything. `slice` confines the E-slice cubies
// to E-slice slots. `generators` is the alternative description, as a subgroup.

const PHASES = [
  // ---- the app's own ladder, which is the beginner's method -----------------------------------
  { method: "The app's method", id: 'cross', name: 'Cross',
    blurb: 'four edges round one centre', solved: [...CROSS] },
  { method: "The app's method", id: 'first-layer', name: 'First layer',
    blurb: 'the cross plus the four corners beside it', solved: [...CROSS, ...D_CORNERS] },
  { method: "The app's method", id: 'two-layers', name: 'Two bottom layers',
    blurb: 'everything but the top', solved: [...F2L] },
  { method: "The app's method", id: 'top-cross', name: 'Top cross',
    blurb: 'the top edges face the right way, but may sit anywhere',
    solved: [...F2L], orientEdges: U_EDGES },
  { method: "The app's method", id: 'top-face', name: 'Top face',
    blurb: 'the whole top face is one colour; the sides are not sorted yet',
    solved: [...F2L], orientEdges: U_EDGES, orientCorners: U_CORNERS },
  { method: "The app's method", id: 'top-corners', name: 'Top corners placed',
    blurb: 'the top face still one colour, and now each corner beside the right two sides',
    solved: [...F2L, ...U_CORNERS], orientEdges: U_EDGES },
  { method: "The app's method", id: 'lbl-solved', name: 'Top edges placed',
    blurb: 'finished', solved: [...EDGE_NAMES, ...CORNER_NAMES] },

  // ---- the beginner variant that permutes the top corners BEFORE orienting them -----------------
  // The owner's stage 5. A real order taught in many books, and not the one the app teaches, which is
  // why the plan has a decision about it.
  { method: 'Beginner, corners placed first', id: 'corners-home', name: 'Top corners home',
    blurb: 'each top corner in its own place but free to be twisted — the owner\'s stage 5',
    solved: [...F2L], orientEdges: U_EDGES, placed: U_CORNERS },
  { method: 'Beginner, corners placed first', id: 'cpf-solved', name: 'Corners turned and edges placed',
    blurb: 'finished', solved: [...EDGE_NAMES, ...CORNER_NAMES] },

  // ---- the daisy, which most children are taught before the cross ------------------------------
  { method: 'Beginner, the daisy first', id: 'daisy', name: 'The daisy',
    blurb: 'the four bottom-colour edges gathered round the top centre, ready to be dropped straight down into the cross. The one phase here that a solved cube does NOT satisfy',
    relaxationOfSolved: false, daisy: true },
  { method: 'Beginner, the daisy first', id: 'daisy-cross', name: 'Cross',
    blurb: 'each petal dropped a half turn to the bottom', solved: [...CROSS] },
  { method: 'Beginner, the daisy first', id: 'daisy-solved', name: 'Solved', blurb: 'finished',
    solved: [...EDGE_NAMES, ...CORNER_NAMES] },

  // ---- CFOP, which is the same ladder with the last layer taken in two big steps ---------------
  { method: 'CFOP', id: 'cfop-cross', name: 'Cross', blurb: 'the same start as every layer method',
    solved: [...CROSS] },
  { method: 'CFOP', id: 'cfop-f2l', name: 'F2L',
    blurb: 'corner and edge inserted together, four pairs, no algorithms to memorise',
    solved: [...F2L] },
  { method: 'CFOP', id: 'cfop-oll', name: 'OLL',
    blurb: 'the top face in one colour, in one algorithm out of 57',
    solved: [...F2L], orientEdges: U_EDGES, orientCorners: U_CORNERS },
  { method: 'CFOP', id: 'cfop-pll', name: 'PLL', blurb: 'the last layer sorted, one algorithm out of 21',
    solved: [...EDGE_NAMES, ...CORNER_NAMES] },

  // ---- Roux, whose blocks are the reason its first phase fits in a lookup table ----------------
  { method: 'Roux', id: 'roux-fb', name: 'First block',
    blurb: 'a 1x2x3 block on the left, five pieces', solved: [...ROUX_FB] },
  { method: 'Roux', id: 'roux-f2b', name: 'Both blocks',
    blurb: 'the second 1x2x3 on the right; the M slice and the top are still free',
    solved: [...ROUX_FB, ...ROUX_SB] },
  { method: 'Roux', id: 'roux-cmll', name: 'CMLL',
    blurb: 'both blocks and all four top corners, leaving six edges',
    solved: [...ROUX_FB, ...ROUX_SB, ...U_CORNERS] },
  { method: 'Roux', id: 'roux-lse', name: 'LSE', blurb: 'the last six edges, and finished',
    solved: [...EDGE_NAMES, ...CORNER_NAMES] },

  // ---- Petrus, which grows one block outward ---------------------------------------------------
  { method: 'Petrus', id: 'petrus-222', name: '2x2x2 block',
    blurb: 'one corner and its three edges: the smallest thing worth calling a start',
    solved: [...PETRUS_222] },
  { method: 'Petrus', id: 'petrus-223', name: '2x2x3 block',
    blurb: 'the block extended along one edge of the cube', solved: [...PETRUS_223] },
  { method: 'Petrus', id: 'petrus-eo', name: 'Edges oriented',
    blurb: 'every remaining edge turned the right way — a phase that settles almost no sticker',
    solved: [...PETRUS_223], orientEdges: 'all' },
  { method: 'Petrus', id: 'petrus-f2l', name: 'Two layers',
    blurb: 'the block grown to two full layers, with every edge still oriented',
    solved: [...F2L], orientEdges: 'all' },
  { method: 'Petrus', id: 'petrus-ll', name: 'Last layer', blurb: 'finished',
    solved: [...EDGE_NAMES, ...CORNER_NAMES] },

  // ---- ZZ, whose first phase is famously invisible ----------------------------------------------
  { method: 'ZZ', id: 'zz-eoline', name: 'EOLine',
    blurb: 'every edge oriented and two placed — almost nothing to see, which is why it is hard to learn',
    solved: [...ZZ_LINE], orientEdges: 'all' },
  { method: 'ZZ', id: 'zz-f2l', name: 'EO F2L',
    blurb: 'two layers built with no F or B turns at all, because the edges are already oriented',
    solved: [...F2L], orientEdges: 'all' },
  { method: 'ZZ', id: 'zz-ll', name: 'Last layer', blurb: 'finished', solved: [...EDGE_NAMES, ...CORNER_NAMES] },

  // ---- corners first, the oldest speed method --------------------------------------------------
  { method: 'Corners first', id: 'cf-corners', name: 'All eight corners',
    blurb: 'an X on every face; every edge still free. This is the cheapest target measured anywhere here',
    solved: [...CORNER_NAMES] },
  { method: 'Corners first', id: 'cf-edges', name: 'Edges', blurb: 'finished',
    solved: [...EDGE_NAMES, ...CORNER_NAMES] },

  // ---- Mehta, the newest of these, whose belt is a shape none of the others make ----------------
  { method: 'Mehta', id: 'mehta-fb', name: 'First block',
    blurb: 'a 1x2x3 lying flat in the bottom layer — not the upright block Roux starts with, though both are 1x2x3',
    solved: [...MEHTA_FB] },
  { method: 'Mehta', id: 'mehta-eole', name: 'Belt, and every edge oriented',
    blurb: 'the whole middle layer solved as a band round the cube, with every remaining edge turned the right way. No other method here makes this shape',
    solved: [...MEHTA_BELT], orientEdges: 'all' },
  { method: 'Mehta', id: 'mehta-6co', name: 'Corners oriented',
    blurb: 'the six remaining corners turned the right way, still in the wrong places',
    solved: [...MEHTA_BELT], orientEdges: 'all', orientCorners: 'all' },
  { method: 'Mehta', id: 'mehta-6cp', name: 'Corners placed',
    blurb: 'every corner home; five edges left',
    solved: [...MEHTA_BELT, ...CORNER_NAMES], orientEdges: 'all' },
  { method: 'Mehta', id: 'mehta-l5ep', name: 'Last five edges', blurb: 'finished',
    solved: [...EDGE_NAMES, ...CORNER_NAMES] },

  // ---- the computer methods, including the app's own --------------------------------------------
  { method: 'Thistlethwaite', id: 'g1', name: 'G1 — front and back need only half turns from here',
    blurb: 'Every edge is turned the right way. There is nothing to see but the centres, and that IS the point: the gain is invisible, and it is that the front and back faces will never need a quarter turn again.',
    orientEdges: 'all', generators: ['U', 'D', 'R', 'L', 'F2', 'B2'] },
  { method: 'Thistlethwaite', id: 'g2', name: 'G2 — left and right too',
    blurb: 'The top and bottom faces are now white and yellow only, and the four middle-layer edges are back in the middle layer. From here the left and right faces only ever get half turns. This is the same set of cubes the app\'s own solver reaches at the end of its first phase.',
    orientEdges: 'all', orientCorners: 'all', slice: true,
    generators: ['U', 'D', 'R2', 'L2', 'F2', 'B2'] },
  { method: 'Thistlethwaite', id: 'g3', name: 'G3 — every face, half turns only',
    blurb: 'Every face is two-tone — its own colour and the opposite one — because a half turn can never move a sticker off its axis. Measured: every piece is turned the right way, and each can now reach only four of the places it could before. Half turns alone will finish it.',
    generators: ['U2', 'D2', 'R2', 'L2', 'F2', 'B2'] },
  { method: 'Thistlethwaite', id: 'g4', name: 'G4 — solved', blurb: 'finished',
    solved: [...EDGE_NAMES, ...CORNER_NAMES] },

  { method: "The app's solver", id: 'kociemba-g1', name: 'Phase 1 — the same place, in one step',
    blurb: 'The same place Thistlethwaite reaches after two stages, in one. The top and bottom faces are white and yellow only, and the middle-layer edges are home in the middle layer. This is what apps/web/lib/two-phase.js searches for first: 2,217,093,120 cosets, which is its three coordinate counts multiplied.',
    orientEdges: 'all', orientCorners: 'all', slice: true,
    generators: ['U', 'D', 'R2', 'L2', 'F2', 'B2'] },
  { method: "The app's solver", id: 'kociemba-g2', name: 'Phase 2 — solved',
    blurb: 'Finished. The second phase never needs a quarter turn of R, L, F or B again, which is what the first phase bought.',
    solved: [...EDGE_NAMES, ...CORNER_NAMES] },
];

// ---- generating members --------------------------------------------------------------------------

const rnd = lcg(0x5747);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const parity = (p) => { let s = 0; for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) s++; return s % 2; };

const asList = (v, all) => (v === 'all' ? all : (v ?? []));

/**
 * A random member built from the PIECES: pinned pieces placed, the rest shuffled, the cube's three
 * laws repaired. Returns null when the constraints leave no room to repair them.
 */
function memberByPieces(phase) {
  const pinnedE = new Set(asList(phase.solved, []).filter((s) => s.length === 2));
  const pinnedC = new Set(asList(phase.solved, []).filter((s) => s.length === 3));
  const placedC = new Set(phase.placed ?? []);
  const orientE = new Set(asList(phase.orientEdges, EDGE_NAMES));
  const orientC = new Set(asList(phase.orientCorners, CORNER_NAMES));

  const ep = new Array(12).fill(-1), eo = new Array(12).fill(0);
  const cp = new Array(8).fill(-1), co = new Array(8).fill(0);
  for (const s of pinnedE) ep[EDGE_INDEX[s]] = EDGE_INDEX[s];
  for (const s of pinnedC) cp[CORNER_INDEX[s]] = CORNER_INDEX[s];
  for (const s of placedC) { cp[CORNER_INDEX[s]] = CORNER_INDEX[s]; co[CORNER_INDEX[s]] = Math.floor(rnd() * 3); }

  const freeE = [...ep.keys()].filter((i) => ep[i] < 0);
  const freeC = [...cp.keys()].filter((i) => cp[i] < 0);
  // The E-slice cubies stay in E-slice slots when the phase says so.
  if (phase.slice) {
    const sliceSlots = MIDDLE.map((n) => EDGE_INDEX[n]).filter((i) => freeE.includes(i));
    const slicePieces = shuffle(MIDDLE.map((n) => EDGE_INDEX[n]).filter((i) => freeE.includes(i)));
    if (sliceSlots.length !== slicePieces.length) return null;
    sliceSlots.forEach((slot, k) => { ep[slot] = slicePieces[k]; });
    const rest = freeE.filter((i) => !sliceSlots.includes(i));
    const restPieces = shuffle(rest.slice());
    rest.forEach((slot, k) => { ep[slot] = restPieces[k]; });
  } else {
    const pieces = shuffle(freeE.slice());
    freeE.forEach((slot, k) => { ep[slot] = pieces[k]; });
  }
  const cPieces = shuffle(freeC.slice());
  freeC.forEach((slot, k) => { cp[slot] = cPieces[k]; });

  // Orientations: forced to zero where the phase orients, random elsewhere, then repaired.
  const flippable = [...ep.keys()].filter((i) => ep[i] >= 0 && !pinnedE.has(EDGE_NAMES[ep[i]]) && !orientE.has(EDGE_NAMES[ep[i]]));
  for (const i of flippable) eo[i] = rnd() < 0.5 ? 1 : 0;
  if (eo.reduce((a, b) => a + b, 0) % 2 === 1) {
    if (!flippable.length) return null;
    eo[flippable[0]] ^= 1;
  }
  const twistable = [...cp.keys()].filter((i) => cp[i] >= 0 && !pinnedC.has(CORNER_NAMES[cp[i]])
    && !orientC.has(CORNER_NAMES[cp[i]]) && !placedC.has(CORNER_NAMES[cp[i]]));
  for (const i of twistable) co[i] = Math.floor(rnd() * 3);
  const twistTotal = co.reduce((a, b) => a + b, 0) % 3;
  if (twistTotal !== 0) {
    const fixable = twistable.length ? twistable : [...placedC].map((n) => CORNER_INDEX[n]);
    if (!fixable.length) return null;
    co[fixable[0]] = (co[fixable[0]] + (3 - twistTotal)) % 3;
  }
  if (parity(ep) !== parity(cp)) {
    const swapE = freeE.filter((i) => !phase.slice || !MIDDLE.map((n) => EDGE_INDEX[n]).includes(i));
    if (swapE.length >= 2) { const [a, b] = swapE; [ep[a], ep[b]] = [ep[b], ep[a]]; [eo[a], eo[b]] = [eo[b], eo[a]]; }
    else if (freeC.length >= 2) { const [a, b] = freeC; [cp[a], cp[b]] = [cp[b], cp[a]]; [co[a], co[b]] = [co[b], co[a]]; }
    else return null;
  }
  return { cp, co, ep, eo };
}

/**
 * A random daisy: the four bottom edges scattered through the top slots, bottom colour upward, and
 * everything else free.
 */
function memberDaisy() {
  const ep = new Array(12).fill(-1), eo = new Array(12).fill(0);
  const cp = shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
  const co = new Array(8).fill(0);
  const petals = shuffle(CROSS.slice());
  U_EDGES.forEach((slot, k) => {
    const si = EDGE_INDEX[slot];
    ep[si] = EDGE_INDEX[petals[k]];
    eo[si] = DAISY_FLIP[`${slot}/${petals[k]}`];
  });
  const restSlots = [...ep.keys()].filter((i) => ep[i] < 0);
  const restPieces = shuffle([...ep.keys()].filter((i) => !U_EDGES.map((n) => EDGE_INDEX[n]).includes(i)
    ? !CROSS.map((n) => EDGE_INDEX[n]).includes(i) : false).concat([]));
  // The pieces still to place are everything except the four petals.
  const used = new Set(U_EDGES.map((n) => ep[EDGE_INDEX[n]]));
  const pool = shuffle([...Array(12).keys()].filter((i) => !used.has(i)));
  restSlots.forEach((slot, k) => { ep[slot] = pool[k]; eo[slot] = rnd() < 0.5 ? 1 : 0; });
  if (eo.reduce((a, b) => a + b, 0) % 2 === 1) eo[restSlots[0]] ^= 1;
  for (const i of [0, 1, 2, 3, 4, 5, 6, 7]) co[i] = Math.floor(rnd() * 3);
  const total = co.reduce((a, b) => a + b, 0) % 3;
  co[0] = (co[0] + (3 - total)) % 3;
  if (parity(ep) !== parity(cp)) { [cp[0], cp[1]] = [cp[1], cp[0]]; [co[0], co[1]] = [co[1], co[0]]; }
  return { cp, co, ep, eo };
}

/** A random member built from the SUBGROUP: a long random product of its own generators. */
function memberByGenerators(phase, length = 60) {
  let s = SOLVED;
  for (let i = 0; i < length; i++) s = applyMove(s, phase.generators[Math.floor(rnd() * phase.generators.length)]);
  return s;
}

/** The colours each sticker can show across `samples` members, as a sorted string. */
function colourSets(make, samples) {
  const seen = Array.from({ length: 54 }, () => new Set());
  let built = 0;
  for (let i = 0; i < samples; i++) {
    const m = make();
    if (!m) continue;
    built++;
    const f = toFacelets(m);
    for (let j = 0; j < 54; j++) seen[j].add(f[j]);
  }
  return { sets: seen.map((s) => [...s].sort().join('')), built };
}

const SAMPLES = 4000;

/**
 * A phase's picture: per sticker, the colours it can show.
 *
 * Where both generators apply they must agree, which is the check that makes the sets trustworthy: one
 * shuffles pieces and repairs the cube's laws by hand, the other multiplies a subgroup's own moves and
 * is correct by construction. They share no reasoning.
 */
function buildPhase(phase) {
  const byPieces = phase.daisy ? colourSets(() => memberDaisy(), SAMPLES)
    : phase.solved || phase.orientEdges || phase.orientCorners || phase.placed
      ? colourSets(() => memberByPieces(phase), SAMPLES) : null;
  const byGens = phase.generators ? colourSets(() => memberByGenerators(phase), SAMPLES) : null;

  // A sampled colour set can only ever be too SMALL — a colour that exists but was not drawn looks
  // like a colour that cannot occur, which would draw a phase as more finished than it is. So the
  // sample must be shown to have converged: half as many members must already give the same answer.
  // Without this the generator-only phases, which have no second opinion, would rest on nothing.
  const half = phase.daisy ? colourSets(() => memberDaisy(), SAMPLES / 2)
    : byPieces ? colourSets(() => memberByPieces(phase), SAMPLES / 2)
      : colourSets(() => memberByGenerators(phase), SAMPLES / 2);
  const full = byPieces ?? byGens;
  for (let j = 0; j < 54; j++) {
    if (half.sets[j] !== full.sets[j]) {
      throw new Error(`${phase.id}: sticker ${j} is ${half.sets[j]} at ${SAMPLES / 2} members and`
        + ` ${full.sets[j]} at ${SAMPLES} — the sample has not converged`);
    }
  }

  if (byPieces && byPieces.built < SAMPLES / 2) throw new Error(`${phase.id}: only ${byPieces.built} members built`);
  if (byPieces && byGens) {
    for (let j = 0; j < 54; j++) {
      if (byPieces.sets[j] !== byGens.sets[j]) {
        throw new Error(`${phase.id}: sticker ${j} is ${byPieces.sets[j]} by pieces and ${byGens.sets[j]} by generators`);
      }
    }
  }
  const sets = (byPieces ?? byGens).sets;

  // A picture is the settled colour, or `?` for two or three candidates, or `-` for four and up.
  const solvedFacelets = toFacelets(SOLVED);
  const picture = sets.map((s) => (s.length === 1 ? s : s.length <= 3 ? '?' : '-')).join('');
  // Every phase that ASKS FOR LESS than a solved cube must settle on the colours a solved cube shows;
  // a phase that does not is not a relaxation of solved and has to say so. The daisy is the only one,
  // and the flag is checked in both directions so it cannot be set carelessly.
  const relax = phase.relaxationOfSolved !== false;
  const disagrees = [...picture].some((c, j) => c !== '-' && c !== '?' && c !== solvedFacelets[j]);
  if (relax && disagrees) {
    const j = [...picture].findIndex((c, k) => c !== '-' && c !== '?' && c !== solvedFacelets[k]);
    throw new Error(`${phase.id}: sticker ${j} settles as ${picture[j]}, not the solved cube's ${solvedFacelets[j]}`);
  }
  if (!relax && !disagrees) {
    throw new Error(`${phase.id} is marked as not a relaxation of solved, but agrees with a solved cube everywhere`);
  }
  return {
    ...phase, picture, sets,
    settled: sets.filter((s) => s.length === 1).length,
    narrowed: sets.filter((s) => s.length > 1 && s.length <= 3).length,
    free: sets.filter((s) => s.length > 3).length,
    checkedBothWays: Boolean(byPieces && byGens),
    relaxationOfSolved: relax,
    converged: true,
  };
}

export const SOLVER_PHASES = PHASES.map(buildPhase);

if (process.argv[1]?.endsWith('solver-phases.mjs')) {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);
  console.log('=== what each phase of each method actually guarantees =======================');
  console.log('A sticker is SETTLED when every cube at that phase shows the same colour there, NARROWED');
  console.log('when it can show two or three, and FREE at four or more.\n');
  console.log(`${pad('method', 20)} ${pad('phase', 30)} ${num('settled', 8)} ${num('narrowed', 9)} ${num('free', 5)}  checked`);
  let both = 0;
  for (const p of SOLVER_PHASES) {
    if (p.checkedBothWays) both++;
    console.log(`${pad(p.method, 20)} ${pad(p.name, 30)} ${num(p.settled, 8)} ${num(p.narrowed, 9)} ${num(p.free, 5)}  ${p.checkedBothWays ? 'two generators agree' : 'one generator'}`);
  }
  console.log(`\n${SOLVER_PHASES.length} phases across ${new Set(SOLVER_PHASES.map((p) => p.method)).size} methods;`
    + ` ${both} were built two independent ways and agreed on all 54 stickers.`);
  console.log(`Each set was measured over ${SAMPLES.toLocaleString()} members, and every one was required to`);
  console.log(`give the same answer at ${(SAMPLES / 2).toLocaleString()} — a sampled colour set can only err by being`);
  console.log('too small, which would draw a phase as more finished than it is.');
}
