// Roux as targets, and the one place its shape beats CFOP's outright.
//
//   node bench/roux-targets.mjs
//
// Roux's stages are blocks rather than layers: a 1x2x3 on the left, a 1x2x3 on the right, the four
// top corners, then the last six edges. That changes the arithmetic of this repository's projection
// machinery, because the FIRST BLOCK is only five pieces.
//
//   | stage | pieces | projected states |
//   |---|---|---|
//   | first block  | 3 edges + 2 corners | 5,322,240 |
//   | second block | 3 edges + 2 corners | 5,322,240 |
//   | both blocks  | 6 edges + 4 corners | ~5.8 x 10^12 |
//
// Five million fits. So the first block does not need a heuristic, a ball or a search: the WHOLE
// distance function is storable, exactly as `methods/cross.js` stores the cross's 190,080. That
// matters because first-block planning is the part of Roux a learner cannot brute-force in their
// head, and an app that can say "your shortest first block is six moves, here it is" is teaching the
// one thing the method is hard for. dev-docs/pattern-databases-and-goal-balls.md §4's decision rule
// reaches that conclusion in one step: does the whole projected space fit in memory? It does.
//
// A GENERAL n-piece projection builder lives here, where the spike's is hard-wired to four. Phase C
// should ship ONE builder with the spike's four-piece version as a special case of it; two builders
// is the duplication `fixtures/seeded-scrambles.mjs` exists to warn about.

import { MOVES, MOVE_NAMES, SOLVED, applyAlg, applyMove } from '../lib/cube-pieces.js';
import { seededScrambles } from '../test/fixtures/seeded-scrambles.mjs';

const N = MOVE_NAMES.length;
const inv = (perm, n) => { const o = new Array(n); for (let i = 0; i < n; i++) o[perm[i]] = i; return o; };

const EDGE_STEP = MOVE_NAMES.map((m) => {
  const to = inv(MOVES[m].ep, 12);
  const t = new Uint8Array(24);
  for (let s = 0; s < 12; s++) for (let f = 0; f < 2; f++) t[s * 2 + f] = to[s] * 2 + ((f + MOVES[m].eo[to[s]]) % 2);
  return t;
});
const CORNER_STEP = MOVE_NAMES.map((m) => {
  const to = inv(MOVES[m].cp, 8);
  const t = new Uint8Array(24);
  for (let s = 0; s < 8; s++) for (let w = 0; w < 3; w++) t[s * 3 + w] = to[s] * 3 + ((w + MOVES[m].co[to[s]]) % 3);
  return t;
});

/**
 * A projection over any number of tracked edges and corners, with the whole distance function if it
 * fits. `codes` are base-24 per piece: edges first, then corners.
 */
function blockProjection({ id, edges, corners }) {
  const pieces = edges.length + corners.length;
  const SIZE = 24 ** pieces;
  if (SIZE > 2 ** 30) throw new Error(`${id}: ${SIZE} codes does not fit`);

  const codeOf = (s) => {
    let c = 0;
    for (const e of edges) { const slot = s.ep.indexOf(e); c = c * 24 + slot * 2 + s.eo[slot]; }
    for (const k of corners) { const slot = s.cp.indexOf(k); c = c * 24 + slot * 3 + s.co[slot]; }
    return c;
  };
  const cells = new Uint8Array(pieces);
  const unpack = (code) => { let r = code; for (let i = pieces - 1; i >= 0; i--) { cells[i] = r % 24; r = (r - cells[i]) / 24; } return cells; };
  const stepCode = (code, m) => {
    const a = unpack(code);
    let c = 0;
    for (let i = 0; i < edges.length; i++) c = c * 24 + EDGE_STEP[m][a[i]];
    for (let i = edges.length; i < pieces; i++) c = c * 24 + CORNER_STEP[m][a[i]];
    return c;
  };

  const goal = codeOf(SOLVED);
  const dist = new Uint8Array(SIZE).fill(255);
  dist[goal] = 0;
  let frontier = [goal], depth = 0, reachable = 1;
  const layers = [1];
  const t0 = Date.now();
  while (frontier.length) {
    const next = [];
    for (const code of frontier) {
      for (let m = 0; m < N; m++) {
        const nc = stepCode(code, m);
        if (dist[nc] === 255) { dist[nc] = depth + 1; next.push(nc); reachable++; }
      }
    }
    depth++;
    if (next.length) layers.push(next.length);
    frontier = next;
  }
  return { id, edges, corners, codeOf, stepCode, dist, goal,
    reachable, diameter: depth - 1, layers, bytes: SIZE, buildMs: Date.now() - t0 };
}

// Slot indices, from cube-pieces.js's own ordering.
// EDGES  = UR UF UL UB DR DF DL DB FR FL BL BR   ->  DR 4, DL 6, FR 8, FL 9, BL 10, BR 11
// CORNERS = URF UFL ULB UBR DFR DLF DBL DRB      ->  DFR 4, DLF 5, DBL 6, DRB 7
const FIRST_BLOCK = { edges: [6, 9, 10], corners: [5, 6] };   // left 1x2x3: DL FL BL, DLF DBL
const SECOND_BLOCK = { edges: [4, 8, 11], corners: [4, 7] };  // right 1x2x3: DR FR BR, DFR DRB

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log('=== Roux blocks as whole distance functions ==================================');
const FB = blockProjection({ id: 'first block (left 1x2x3)', ...FIRST_BLOCK });
const SB = blockProjection({ id: 'second block (right 1x2x3)', ...SECOND_BLOCK });
for (const p of [FB, SB]) {
  console.log(`${pad(p.id, 28)} reachable ${num(p.reachable, 9)} of ${num(p.bytes, 9)} codes  diameter ${p.diameter}  ${p.buildMs} ms  ${(p.bytes / 1024 / 1024).toFixed(1)} MiB`);
  console.log(`${pad('', 28)} layers ${p.layers.join(' ')}`);
}
console.log('\nThe reachable count is 12.11.10.2^3 x 8.7.3^2 = 10,560 x 504 = 5,322,240, so the table is');
console.log('exact everywhere and the first block needs no search at all — a lookup and a descent.');

// ---- what a learner would be told ---------------------------------------------------------------
//
// The distribution of the OPTIMAL first block over random scrambles is the number Roux learners argue
// about, and with the whole table it is a histogram rather than an estimate.

const SCRAMBLES = seededScrambles(2000, 0x5747, 25);
const states = SCRAMBLES.map((s) => applyAlg(SOLVED, s));

function histogram(proj) {
  const h = new Map();
  let total = 0;
  for (const s of states) {
    const d = proj.dist[proj.codeOf(s)];
    h.set(d, (h.get(d) ?? 0) + 1);
    total += d;
  }
  return { h: [...h.entries()].sort((a, b) => a[0] - b[0]), mean: total / states.length };
}

console.log('\n=== optimal first block from 2,000 random scrambles =========================');
for (const p of [FB, SB]) {
  const { h, mean } = histogram(p);
  console.log(`${pad(p.id, 28)} mean ${mean.toFixed(2)}   ${h.map(([d, n]) => `${d}:${n}`).join(' ')}`);
}
console.log('\nThat is the optimal block in ONE fixed position. A Roux solver picks the best of several,');
console.log('so the number a human plans against is lower again — which the same table answers by');
console.log('taking the minimum over the orientations, and is the next thing to measure.');

// ---- both blocks, which does not fit and needs the search ---------------------------------------

const AXIS = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
const FACE = MOVE_NAMES.map((m) => m[0]);
const F2B_PARTS = [FB, SB];
const f2bAt = (codes) => F2B_PARTS.every((p, i) => codes[i] === p.goal);
const f2bH = (codes) => { let m = 0; for (let i = 0; i < F2B_PARTS.length; i++) { const d = F2B_PARTS[i].dist[codes[i]]; if (d > m) m = d; } return m; };

function searchF2B(state, { maxDepth = 16, nodeBudget = 4_000_000 } = {}) {
  const start = F2B_PARTS.map((p) => p.codeOf(state));
  if (f2bAt(start)) return { alg: '', moves: 0, nodes: 0 };
  let nodes = 0;
  const path = [];
  const descend = (codes, g, bound, lastFace, lastAxis) => {
    if (g + f2bH(codes) > bound) return false;
    if (f2bAt(codes)) return true;
    if (nodes >= nodeBudget) return null;
    for (let m = 0; m < N; m++) {
      const f = FACE[m];
      if (f === lastFace) continue;
      if (AXIS[f] === lastAxis && f < lastFace) continue;
      nodes++;
      const next = F2B_PARTS.map((p, i) => p.stepCode(codes[i], m));
      path.push(MOVE_NAMES[m]);
      const got = descend(next, g + 1, bound, f, AXIS[f]);
      if (got === true) return true;
      if (got === null) return null;
      path.pop();
    }
    return false;
  };
  for (let bound = f2bH(start); bound <= maxDepth; bound++) {
    path.length = 0;
    const got = descend(start, 0, bound, '', -1);
    if (got === true) return { alg: path.join(' '), moves: path.length, nodes };
    if (got === null) return { alg: null, moves: null, nodes };
  }
  return { alg: null, moves: null, nodes };
}

const bothBlocks = (s) => [...FIRST_BLOCK.edges, ...SECOND_BLOCK.edges].every((e) => s.ep[e] === e && s.eo[e] === 0)
  && [...FIRST_BLOCK.corners, ...SECOND_BLOCK.corners].every((c) => s.cp[c] === c && s.co[c] === 0);

console.log('\n=== both blocks, from a cube a few turns out ================================');
console.log('The product space is about 5.8 x 10^12, so this one is a search with the two block tables');
console.log('as its heuristic — the same shape as the stage targets, with a ceiling of their diameters.\n');
console.log(`${pad('case', 18)} ${num('moves', 6)} ${num('nodes', 11)} ${num('ms', 7)}`);
let answered = 0;
for (const k of [1, 2, 3, 4, 5, 6, 8, 10]) {
  const scramble = seededScrambles(1, 0x5747 + k, k)[0];
  const state = applyAlg(SOLVED, scramble);
  const t = Date.now();
  const got = searchF2B(state);
  const ms = Date.now() - t;
  if (got.alg !== null) {
    if (!bothBlocks(applyAlg(state, got.alg))) throw new Error(`${k} turns: route does not build both blocks`);
    answered++;
  }
  console.log(`${pad(`${k} turns`, 18)} ${num(got.moves ?? '-', 6)} ${num(got.nodes, 11)} ${num(ms, 7)}`);
}
console.log(`\nanswered ${answered} of 8 within the budget. Every route that came back was replayed and`);
console.log('checked against the block predicate before its length was printed.');
