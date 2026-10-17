// Phase 8, the search half: is Roux fast enough to plan, on the slowest device the app supports?
//
//   node bench/roux-spike.mjs [n]          # n seeded scrambles, default 300
//
// dev-docs/solve-methods-plan.md §Phase 8: "express Roux's stages (first block, second block, CMLL, LSE)
// as engine stages and measure solve time on the slowest target device class … a method that takes ten
// seconds to plan is not offered." This answers it with numbers, beside CFOP (full) on the same cubes.
//
// THE FRAME IS THE BLOCKS'. Roux turns M, which moves centres, and this repository's piece model holds
// pieces relative to fixed centres, where M is not a face turn. cubejs keeps edge and corner POSITIONS
// physical and tracks centres separately, so its `M` permutes and flips the four slice edges and nothing
// else — exactly the frame Roux is built in, where a block is solved relative to its own L or R centre and
// the slice centres are not fixed until the last six edges. Every move's action is read off cubejs, so the
// tables below cannot disagree with the oracle about what a move does.
//
// Every route is REPLAYED in cubejs and checked against its stage's predicate before its length counts.

import Cube from '../vendor/cubejs.js';
import { HUMAN_OLL } from '../lib/data/human-algs.js';
import { AUF, fromRepertoire, repertoire } from '../lib/methods/engine.js';
import { solveByMethod } from '../lib/method-solver.js';
import { methodById } from '../lib/methods/registry.js';
import { methodOf } from '../lib/methods/method-of.js';
import { applyAlg, SOLVED } from '../lib/cube-pieces.js';
import { seededScrambles } from '../test/fixtures/seeded-scrambles.mjs';

const N = Number(process.argv[2] ?? 300);

/**
 * CPU milliseconds this process has used — the clock every figure here is read on. The machine this was
 * written on ran at load average 47–95 (a VM, a JVM, compilers, other sessions), and a wall clock there
 * measures the queue for a core, not the work. CPU time still feels contention (caches, clocks), which is
 * why every Roux figure is printed beside CFOP (full) measured in the same run on the same cubes.
 */
const cpuMs = () => { const { user, system } = process.cpuUsage(); return (user + system) / 1000; };
if (!Number.isInteger(N) || N < 1) throw new Error(`n must be a positive integer, not ${process.argv[2]}`);

// ---- every move's action, read off cubejs ------------------------------------------------------------

const FACE_MOVES = ['U', 'R', 'F', 'D', 'L', 'B'].flatMap((f) => [f, `${f}2`, `${f}'`]);
const SB_MOVES = ['R', 'R2', "R'", 'U', 'U2', "U'", 'M', 'M2', "M'"];
const LSE_MOVES = ['U', 'U2', "U'", 'M', 'M2', "M'"];

/** A move as cubejs applies it to a solved cube: where each position's piece came from, and its twist. */
function actionOf(name) {
  const c = new Cube();
  c.move(name);
  return { name, ep: [...c.ep], eo: [...c.eo], cp: [...c.cp], co: [...c.co], center: [...c.center] };
}
const ACTION = Object.fromEntries([...new Set([...FACE_MOVES, ...SB_MOVES])].map((m) => [m, actionOf(m)]));

/** Per move, a table from (position, orientation) of one tracked piece to where it goes. Base 24: an edge
 *  is pos*2+ori, a corner pos*3+ori. Kociemba multiplication: the piece at position p moves to the i with
 *  ep[i] === p, and gains that position's twist. */
function stepTables(moves) {
  const edge = moves.map((m) => {
    const a = ACTION[m];
    const t = new Uint8Array(24);
    for (let i = 0; i < 12; i++) for (let o = 0; o < 2; o++) t[a.ep[i] * 2 + o] = i * 2 + ((o + a.eo[i]) % 2);
    return t;
  });
  const corner = moves.map((m) => {
    const a = ACTION[m];
    const t = new Uint8Array(24);
    for (let i = 0; i < 8; i++) for (let o = 0; o < 3; o++) t[a.cp[i] * 3 + o] = i * 3 + ((o + a.co[i]) % 3);
    return t;
  });
  return { edge, corner };
}

/**
 * The whole distance function over a set of tracked pieces and moves — exact, because the projected space
 * fits (5,322,240 reachable of 24^5 codes for a block). Typed arrays and a level scan, no frontier arrays.
 */
function projection({ id, edges, corners, moves }) {
  const k = edges.length + corners.length;
  const SIZE = 24 ** k;
  const { edge, corner } = stepTables(moves);
  const digits = new Uint8Array(k);
  const step = (code, m) => {
    let r = code;
    for (let i = k - 1; i >= 0; i--) { digits[i] = r % 24; r = (r - digits[i]) / 24; }
    let c = 0;
    for (let i = 0; i < k; i++) c = c * 24 + (i < edges.length ? edge[m][digits[i]] : corner[m][digits[i]]);
    return c;
  };
  const codeOf = (cube) => {
    let c = 0;
    for (const e of edges) { const pos = cube.ep.indexOf(e); c = c * 24 + pos * 2 + cube.eo[pos]; }
    for (const q of corners) { const pos = cube.cp.indexOf(q); c = c * 24 + pos * 3 + cube.co[pos]; }
    return c;
  };
  const t0 = cpuMs();
  const dist = new Uint8Array(SIZE).fill(255);
  const goal = codeOf(new Cube());
  dist[goal] = 0;
  let reached = 1;
  for (let d = 0; ; d++) {
    let grew = 0;
    for (let code = 0; code < SIZE; code++) {
      if (dist[code] !== d) continue;
      for (let m = 0; m < moves.length; m++) {
        const n = step(code, m);
        if (dist[n] === 255) { dist[n] = d + 1; grew++; }
      }
    }
    if (grew === 0) break;
    reached += grew;
  }
  return { id, moves, dist, step, codeOf, goal, reached, buildMs: cpuMs() - t0 };
}

/**
 * The same distance function, built the way a shipped one would be: COORDINATES. The tracked edges are one
 * coordinate (base-24 digits, 24^e codes) and the tracked corners another (24^c), each with its own move
 * table built once, so a step is two lookups rather than an unpack and a repack per piece — the method
 * `methods/cross.js` already uses for the cross. One breadth-first pass over a typed-array queue.
 */
function coordProjection({ id, edges, corners, moves }) {
  const t0 = cpuMs();
  const { edge, corner } = stepTables(moves);
  const coordTable = (n, tables) => {
    const size = 24 ** n;
    const out = moves.map(() => new Int32Array(size));
    const d = new Uint8Array(n);
    for (let code = 0; code < size; code++) {
      let r = code;
      for (let i = n - 1; i >= 0; i--) { d[i] = r % 24; r = (r - d[i]) / 24; }
      for (let m = 0; m < moves.length; m++) {
        let c = 0;
        for (let i = 0; i < n; i++) c = c * 24 + tables[m][d[i]];
        out[m][code] = c;
      }
    }
    return { size, out };
  };
  const E = coordTable(edges.length, edge);
  const C = coordTable(corners.length, corner);
  const SIZE = E.size * C.size;
  const step = (code, m) => {
    const cc = code % C.size;
    return E.out[m][(code - cc) / C.size] * C.size + C.out[m][cc];
  };
  const codeOf = (cube) => {
    let e = 0;
    for (const x of edges) { const pos = cube.ep.indexOf(x); e = e * 24 + pos * 2 + cube.eo[pos]; }
    let c = 0;
    for (const q of corners) { const pos = cube.cp.indexOf(q); c = c * 24 + pos * 3 + cube.co[pos]; }
    return e * C.size + c;
  };
  const tablesMs = cpuMs() - t0;
  const dist = new Uint8Array(SIZE).fill(255);
  const goal = codeOf(new Cube());
  const queue = new Int32Array(SIZE);
  dist[goal] = 0;
  queue[0] = goal;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const code = queue[head++];
    const d = dist[code] + 1;
    const cc = code % C.size;
    const ec = (code - cc) / C.size;
    for (let m = 0; m < moves.length; m++) {
      const n = E.out[m][ec] * C.size + C.out[m][cc];
      if (dist[n] === 255) { dist[n] = d; queue[tail++] = n; }
    }
  }
  return { id, moves, dist, step, codeOf, goal, reached: tail, buildMs: cpuMs() - t0, tablesMs };
}

/** The shortest route from `cube` to the projection's goal: a lookup and a descent. */
function descend(p, cube) {
  let code = p.codeOf(cube);
  const out = [];
  while (p.dist[code] !== 0) {
    const d = p.dist[code];
    if (d === 255) throw new Error(`${p.id}: unreachable from this cube`);
    let next = -1;
    for (let m = 0; m < p.moves.length && next < 0; m++) {
      const n = p.step(code, m);
      if (p.dist[n] === d - 1) { next = n; out.push(p.moves[m]); }
    }
    code = next;
  }
  return out.join(' ');
}

// cube-pieces' ordering, shared with cubejs: EDGES UR UF UL UB DR DF DL DB FR FL BL BR, CORNERS URF UFL ULB
// UBR DFR DLF DBL DRB.
const FIRST_BLOCK = { edges: [6, 9, 10], corners: [5, 6] }; // DL FL BL, DLF DBL
const SECOND_BLOCK = { edges: [4, 8, 11], corners: [4, 7] }; // DR FR BR, DFR DRB

const home = (cube, { edges, corners }) => edges.every((e) => cube.ep[e] === e && cube.eo[e] === 0)
  && corners.every((q) => cube.cp[q] === q && cube.co[q] === 0);

// ---- the last six edges, a small space of its own ------------------------------------------------------
//
// After CMLL the corners are solved up to a U turn, and the six edges UR UF UL UB DF DB, the slice
// centres and that U offset are all that is left. 720 permutations x 64 flips x 4 centre offsets x 4 U
// offsets = 737,280 codes, searched exhaustively with the <M, U> moves read off cubejs.

const LSE_POS = [0, 1, 2, 3, 5, 7];
function lseTable() {
  const t0 = cpuMs();
  const fact = [1, 1, 2, 6, 24, 120, 720];
  const rank = (perm) => {
    let r = 0;
    const used = new Array(6).fill(false);
    for (let i = 0; i < 6; i++) {
      let less = 0;
      for (let j = 0; j < perm[i]; j++) if (!used[j]) less++;
      r += less * fact[5 - i];
      used[perm[i]] = true;
    }
    return r;
  };
  const unrank = (r) => {
    const left = [0, 1, 2, 3, 4, 5];
    const perm = [];
    for (let i = 0; i < 6; i++) { const f = fact[5 - i]; const q = Math.floor(r / f); r %= f; perm.push(left.splice(q, 1)[0]); }
    return perm;
  };
  // A state: which LSE edge (0..5) sits at each LSE position, its flip, the slice centre offset, the U offset.
  const codeOf = (perm, flips, centre, uoff) => ((rank(perm) * 64 + flips) * 4 + centre) * 4 + uoff;
  const moveOn = LSE_MOVES.map((name) => {
    const a = actionOf(name);
    const src = LSE_POS.map((p) => LSE_POS.indexOf(a.ep[p]));
    const flip = LSE_POS.map((p) => a.eo[p]);
    const centreTurn = name[0] === 'M' ? { M: 1, M2: 2, "M'": 3 }[name] : 0;
    const uTurn = name[0] === 'U' ? { U: 1, U2: 2, "U'": 3 }[name] : 0;
    return { src, flip, centreTurn, uTurn };
  });
  const SIZE = 720 * 64 * 16;
  const dist = new Uint8Array(SIZE).fill(255);
  const decode = (code) => {
    const uoff = code % 4; code = (code - uoff) / 4;
    const centre = code % 4; code = (code - centre) / 4;
    const flips = code % 64;
    return { perm: unrank((code - flips) / 64), flips, centre, uoff };
  };
  const step = (code, m) => {
    const { perm, flips, centre, uoff } = decode(code);
    const mv = moveOn[m];
    const np = mv.src.map((s) => perm[s]);
    let nf = 0;
    for (let i = 0; i < 6; i++) nf |= ((((flips >> mv.src[i]) & 1) ^ mv.flip[i]) << i);
    return codeOf(np, nf, (centre + mv.centreTurn) % 4, (uoff + mv.uTurn) % 4);
  };
  const goal = codeOf([0, 1, 2, 3, 4, 5], 0, 0, 0);
  dist[goal] = 0;
  let reached = 1;
  let frontier = [goal];
  for (let d = 0; frontier.length; d++) {
    const next = [];
    for (const code of frontier) {
      for (let m = 0; m < LSE_MOVES.length; m++) {
        const n = step(code, m);
        if (dist[n] === 255) { dist[n] = d + 1; next.push(n); }
      }
    }
    reached += next.length;
    frontier = next;
  }
  // A cube's LSE code: positions of the six edges among the LSE slots, flips, the U centre's offset round
  // the slice, and how far the U corners are turned.
  const SLICE_CENTRES = [0, 2, 3, 5]; // U F D B in cubejs's centre order U R F D L B
  const lseCode = (cube) => {
    const perm = LSE_POS.map((p) => LSE_POS.indexOf(cube.ep[p]));
    if (perm.includes(-1)) return -1;
    let flips = 0;
    LSE_POS.forEach((p, i) => { flips |= cube.eo[p] << i; });
    const centre = [0, 1, 2, 3].find((k) => { const c = new Cube(); c.move(['', 'M', 'M2', "M'"][k]); return SLICE_CENTRES.every((i) => c.center[i] === cube.center[i]); });
    const uoff = [0, 1, 2, 3].find((k) => { const c = new Cube(); c.move(['', 'U', 'U2', "U'"][k]); return [0, 1, 2, 3].every((i) => c.cp[i] === cube.cp[i]); });
    if (centre === undefined || uoff === undefined) return -1;
    return codeOf(perm, flips, centre, uoff);
  };
  const solve = (cube) => {
    let code = lseCode(cube);
    if (code < 0) throw new Error('LSE: the cube is not in the last-six-edges space');
    const out = [];
    while (dist[code] !== 0) {
      const d = dist[code];
      let next = -1;
      for (let m = 0; m < LSE_MOVES.length && next < 0; m++) { const n = step(code, m); if (dist[n] === d - 1) { next = n; out.push(LSE_MOVES[m]); } }
      code = next;
    }
    return out.join(' ');
  };
  return { reached, solve, buildMs: cpuMs() - t0 };
}

// ---- CMLL, measured as the cost of the step it would be ------------------------------------------------
//
// No sourced CMLL table is in the repository yet (Phase 8's second half adds one, re-derived by cubejs), so
// its PLANNING cost is measured as what it will be: one ply of `fromRepertoire` over a one-look repertoire
// of the same size, with a U turn before and after, as a wide-turn table is played (it cannot be relabelled
// by rotation). The OLL table stands in — 57 rows, more than CMLL's 42 —
// and its goal is never met, so every candidate is played: an upper bound on the step, not a guess at it.

function cmllCostMs(states) {
  const candidates = repertoire(HUMAN_OLL, { rotations: [0], post: AUF });
  const t0 = cpuMs();
  for (const s of states) fromRepertoire(s, candidates, () => false, 1);
  return { perSolve: (cpuMs() - t0) / states.length, candidates: candidates.length };
}

// ---- run -------------------------------------------------------------------------------------------------

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { mean: s.reduce((a, b) => a + b, 0) / s.length, p50: at(0.5), p99: at(0.99), max: s[s.length - 1] };
};
const fmt = (x, d = 2) => x.toFixed(d).padStart(8);

console.log(`node ${process.version}, n = ${N}\n`);
// Both builders, so the coordinate one is checked against the plain one entry for entry before it is used.
const plainFB = projection({ id: 'first block (plain)', ...FIRST_BLOCK, moves: FACE_MOVES });
const FB = coordProjection({ id: 'first block', ...FIRST_BLOCK, moves: FACE_MOVES });
const SB = coordProjection({ id: 'second block', ...SECOND_BLOCK, moves: SB_MOVES });
if (FB.dist.length !== plainFB.dist.length || FB.dist.some((d, i) => d !== plainFB.dist[i])) {
  throw new Error('the coordinate builder disagrees with the plain one');
}
console.log(`  plain builder, first block: ${plainFB.buildMs.toFixed(0)} ms — the coordinate builder below agrees with it on every one of ${FB.dist.length} codes`);
const LSE = lseTable();
console.log('tables (built once per session)');
console.log(`  first block   ${String(FB.reached).padStart(9)} states  ${fmt(FB.buildMs, 0)} ms  ${(FB.dist.length / 2 ** 20).toFixed(1)} MiB  (move tables ${FB.tablesMs.toFixed(0)} ms of it)`);
console.log(`  second block  ${String(SB.reached).padStart(9)} states  ${fmt(SB.buildMs, 0)} ms  ${(SB.dist.length / 2 ** 20).toFixed(1)} MiB  (R, U, M only)`);
console.log(`  last six edges${String(LSE.reached).padStart(9)} states  ${fmt(LSE.buildMs, 0)} ms`);

const scrambles = seededScrambles(N, 0x8008, 25);
const moves = { fb: [], sb: [], lse: [] };
const ms = { fb: [], sb: [], lse: [], cfop: [] };
const afterBlocks = [];
for (const scramble of scrambles) {
  const cube = new Cube();
  cube.move(scramble);
  let t = cpuMs();
  const fb = descend(FB, cube);
  ms.fb.push(cpuMs() - t);
  if (fb) cube.move(fb);
  if (!home(cube, FIRST_BLOCK)) throw new Error(`first block not built: ${scramble} / ${fb}`);
  t = cpuMs();
  const sb = descend(SB, cube);
  ms.sb.push(cpuMs() - t);
  if (sb) cube.move(sb);
  if (!home(cube, FIRST_BLOCK) || !home(cube, SECOND_BLOCK)) throw new Error(`second block not built, or the first broken: ${scramble}`);
  moves.fb.push(fb ? fb.split(' ').length : 0);
  moves.sb.push(sb ? sb.split(' ').length : 0);
  afterBlocks.push(cube);
}

// LSE needs the corners done; CMLL is not implemented here, so each cube's LSE is measured from a cube with
// both blocks and the corners solved and the six edges, the slice centres and the U offset as random as the
// <M, U> group makes them.
const lseStarts = seededScrambles(N, 0x15E, 30).map((s) => s.split(' ').map((m) => ({ U: 'U', D: 'M', R: 'U2', L: "M'", F: 'M2', B: "U'" })[m[0]]).join(' '));
for (const alg of lseStarts) {
  const cube = new Cube();
  cube.move(alg);
  const t = cpuMs();
  const route = LSE.solve(cube);
  ms.lse.push(cpuMs() - t);
  if (route) cube.move(route);
  if (cube.asString() !== new Cube().asString()) throw new Error(`LSE route does not solve: ${alg} / ${route}`);
  moves.lse.push(route ? route.split(' ').length : 0);
}

const cfop = methodOf(methodById('cfop'));
for (const scramble of scrambles) {
  const state = applyAlg(SOLVED, scramble);
  const t = cpuMs();
  solveByMethod(state, cfop);
  ms.cfop.push(cpuMs() - t);
}
const cmll = cmllCostMs(scrambles.slice(0, Math.min(N, 100)).map((s) => applyAlg(SOLVED, s)));

console.log('\nper solve, ms           mean      p50      p99      max     moves (mean / max)');
for (const [key, label] of [['fb', 'first block'], ['sb', 'second block'], ['lse', 'last six edges']]) {
  const t = stats(ms[key]);
  const mv = stats(moves[key]);
  console.log(`  ${label.padEnd(18)}${fmt(t.mean, 3)}${fmt(t.p50, 3)}${fmt(t.p99, 3)}${fmt(t.max, 3)}     ${mv.mean.toFixed(1)} / ${mv.max}`);
}
console.log(`  ${'CMLL (bound)'.padEnd(18)}${fmt(cmll.perSolve, 3)}   one ply over ${cmll.candidates} candidates`);
const c = stats(ms.cfop);
console.log(`  ${'CFOP (full), whole'.padEnd(18)}${fmt(c.mean, 3)}${fmt(c.p50, 3)}${fmt(c.p99, 3)}${fmt(c.max, 3)}     the app's own method solver, same cubes`);
const rouxWorst = stats(ms.fb).max + stats(ms.sb).max + cmll.perSolve + stats(ms.lse).max;
console.log(`\nRoux planning, worst stage of each summed: ${rouxWorst.toFixed(2)} ms per solve, after ${(FB.buildMs + SB.buildMs + LSE.buildMs).toFixed(0)} ms of tables.`);
