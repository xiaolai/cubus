// The corners-first table: every row is the sequence Jelinek published (with its changes accounted for), it
// does what its caption says, and the sequences of each step finish that step from EVERY position it can meet
// — proved by search over the pieces the step reads, never by trying a few scrambles.
//
// THE ORACLE IS CUBEJS, which turns faces, slices and the whole cube with code that shares nothing with
// `lib/cube-notation.js`; every sequence is read from it once as a map of the 54 stickers, and the searches
// run on those maps. The app's own interpreter is then held to cubejs on every row.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Cube from 'cubejs';

import { CF_ALGS, CF_STEPS, SOURCES, cfStep } from '../lib/data/corners-first-algs.js';
import { CORNER_FACELETS, EDGE_FACELETS, CENTERS } from '../lib/cube-layout.js';
import { CORNERS, EDGES, SOLVED, invert, toFacelets } from '../lib/cube-pieces.js';
import { run } from '../lib/cube-moves.js';

const SOLVED_FACELETS = new Cube().asString();
/** Where each sticker goes under `alg`: `to[from] = where`. Read off cubejs, and checked against it. */
function stickerMap(alg) {
  const c = new Cube();
  if (alg.trim()) c.move(alg);
  const to = new Array(54);
  for (let i = 0; i < 8; i++) for (let k = 0; k < 3; k++) to[CORNER_FACELETS[c.cp[i]][k]] = CORNER_FACELETS[i][(k + c.co[i]) % 3];
  for (let i = 0; i < 12; i++) for (let k = 0; k < 2; k++) to[EDGE_FACELETS[c.ep[i]][k]] = EDGE_FACELETS[i][(k + c.eo[i]) % 2];
  for (let i = 0; i < 6; i++) to[CENTERS[c.center[i]]] = CENTERS[i];
  const drawn = new Array(54);
  for (let i = 0; i < 54; i++) drawn[to[i]] = SOLVED_FACELETS[i];
  assert.equal(drawn.join(''), c.asString(), `the sticker map of "${alg}" disagrees with cubejs`);
  return to;
}
const MAPS = new Map();
const mapOf = (alg) => { if (!MAPS.has(alg)) MAPS.set(alg, stickerMap(alg)); return MAPS.get(alg); };
/** Conjugate: turn by `outer`, do `inner`, turn back — the inner sequence done from another angle. */
const from = (outer, inner) => (outer ? `${outer} ${inner} ${invert(outer)}` : inner);
const turns = (face) => ['', face, `${face}2`, `${face}'`];

const C = (n) => CORNERS.indexOf(n);
const E = (n) => EDGES.indexOf(n);
const fixes = (to, stickers) => stickers.every((i) => to[i] === i);
const cornerStickers = (pieces) => pieces.flatMap((p) => CORNER_FACELETS[p]);
const edgeStickers = (pieces) => pieces.flatMap((p) => EDGE_FACELETS[p]);
const ALL_CORNERS = cornerStickers(CORNERS.map((_, i) => i));
// The edge steps hold white on the left: white edges (ledges) on L, yellow (redges) on R, the rest in M.
const LEDGES = ['UL', 'FL', 'BL', 'DL'].map(E);
const REDGES = ['UR', 'FR', 'BR', 'DR'].map(E);
const MIDGES = ['UF', 'DF', 'DB', 'UB'].map(E);

// A piece's PLACE is slot * n + twist (n = 3 for a corner, 2 for an edge): where its first sticker sits.
const TYPES = {
  corner: { faces: CORNER_FACELETS, n: 3 },
  edge: { faces: EDGE_FACELETS, n: 2 },
};
function placeMap(type, to) {
  const { faces, n } = TYPES[type];
  const out = [];
  for (let s = 0; s < faces.length; s++) for (let t = 0; t < n; t++) {
    const dst = to[faces[s][t]];
    const s2 = faces.findIndex((f) => f.includes(dst));
    out[s * n + t] = s2 * n + faces[s2].indexOf(dst);
  }
  return out;
}
/**
 * How many applications each place of `piece` is from home, using only applications that keep `kept` (a list
 * of sticker indices) where they are. Infinity where home cannot be reached. Because every application keeps
 * `kept`, the other pieces do not matter: this is the whole truth about placing this piece next.
 */
function distances(type, piece, applications, kept) {
  const usable = applications.filter((a) => fixes(mapOf(a), kept)).map((a) => placeMap(type, mapOf(a)));
  const size = TYPES[type].faces.length * TYPES[type].n;
  const dist = new Array(size).fill(Infinity);
  dist[piece * TYPES[type].n] = 0;
  for (let d = 1, grew = true; grew; d++) {
    grew = false;
    for (let p = 0; p < size; p++) {
      if (dist[p] !== Infinity) continue;
      if (usable.some((m) => dist[m[p]] === d - 1)) { dist[p] = d; grew = true; }
    }
  }
  return dist;
}
const subsets = (a) => a.reduce((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);
const algsOf = (step) => cfStep(step).map((r) => r.alg);

test('the table is Jelinek\'s steps in order, each row frozen, named once and sourced', () => {
  assert.deepEqual([...new Set(CF_ALGS.map((r) => r.step))], CF_STEPS.filter((s) => s !== 'centres'));
  assert.deepEqual(CF_STEPS.map((s) => cfStep(s).length), [5, 1, 1, 0, 5, 5, 2, 1, 4]);
  assert.equal(new Set(CF_ALGS.map((r) => r.name)).size, CF_ALGS.length, 'two rows share an id');
  for (const r of CF_ALGS) {
    assert.ok(Object.isFrozen(r), `${r.name} can be edited in place`);
    assert.match(r.name, new RegExp(`^cf-${r.step}-\\d+$`));
    assert.ok(r.case, `${r.name} has no caption`);
  }
  for (const [key, src] of Object.entries(SOURCES)) assert.match(src.url, /^https:\/\//, `${key} is not a URL`);
});

test('a row differs from the page only by the three documented changes', () => {
  const merge = (alg) => alg.split(' ').reduce((out, m) => {
    if (out.length && out[out.length - 1] === m && !m.includes('2')) out[out.length - 1] = `${m.replace("'", '')}2`;
    else out.push(m);
    return out;
  }, []).join(' ').replace(/\bY2\b/g, 'y2');
  const CORRECTED = { 'cf-ledges-5': "U' M U2 M2 U'" };
  for (const r of CF_ALGS) {
    if (r.sourceAlg === undefined) { assert.doesNotMatch(r.alg, /(\b\w'?) \1\b|Y/, `${r.name} looks un-normalised`); continue; }
    let expected = merge(r.sourceAlg);
    // Close an open whole-cube turn, as `human-algs.test.mjs` does. Only a turn of the WHOLE cube is closed: a
    // middle-slice sequence that leaves the slice's centres turned is the method working, not an open hold.
    const quarters = expected.split(' ').reduce((n, m) => n + ({ y: 1, y2: 2, "y'": 3 }[m] ?? 0), 0) % 4;
    if (quarters) expected = `${expected} ${['', "y'", 'y2', 'y'][quarters]}`;
    if (CORRECTED[r.name]) {
      assert.notEqual(expected, r.alg);
      assert.equal(r.alg, CORRECTED[r.name]);
      continue;
    }
    assert.equal(r.alg, expected, `${r.name}: "${r.sourceAlg}" normalises to "${expected}"`);
  }
});

// ---------- every row is in reduced form ----------
// The source-fidelity check reads a row only when it carries a `sourceAlg`, so an undocumented cancelling pair
// appended to a row ("R U' R' U U'") would pass every other test. No two adjacent turns may share a layer —
// the same face, the same slice, the same wide turn or the same whole-cube axis — because they would merge
// into one turn or cancel to none; and the turn count must equal the count after that merge.
const layerOf = (m) => m.replace(/['2]/g, '');
const mergedCount = (alg) => alg.split(' ').reduce((out, m) => {
  if (out.length && layerOf(out[out.length - 1]) === layerOf(m)) out[out.length - 1] = m; else out.push(m);
  return out;
}, []).length;
function assertReduced(r) {
  const ms = r.alg.trim().split(/\s+/);
  for (let i = 1; i < ms.length; i++) {
    assert.notEqual(layerOf(ms[i]), layerOf(ms[i - 1]), `${r.name} ("${r.alg}"): "${ms[i - 1]} ${ms[i]}" turns one layer twice in a row`);
  }
  assert.equal(ms.length, mergedCount(r.alg), `${r.name} ("${r.alg}") is not reduced`);
}

test('every row is in reduced form: no two adjacent turns of one layer', () => {
  for (const r of CF_ALGS) assertReduced(r);
});

test('the one correction: the page\'s flip of a white edge breaks the corners, and the row\'s does not', () => {
  const printed = cfStep('ledges').find((r) => r.name === 'cf-ledges-5').sourceAlg.replace('U U', 'U2').replace('M M', 'M2');
  assert.equal(fixes(mapOf(printed), ALL_CORNERS), false, 'the printed sequence keeps the corners after all');
  // It leaves the top corners exactly a half turn of the top from home.
  assert.ok(fixes(mapOf(`${printed} U2`), ALL_CORNERS));
  assert.ok(fixes(mapOf("U' M U2 M2 U'"), ALL_CORNERS));
  // And the yellow-side twin the page prints, which the correction mirrors, keeps them as printed.
  assert.ok(fixes(mapOf(cfStep('redges').find((r) => r.name === 'cf-redges-5').alg), ALL_CORNERS));
});

// ---------- what each sequence does, against its caption ----------
// The corner steps hold white DOWN (D); the edge steps hold white on the LEFT (L), yellow on the right (R).
const placeOf = (type, slot, firstStickerAt) => slot * TYPES[type].n + TYPES[type].faces[slot].indexOf(firstStickerAt);
/** The place of a piece in `slot` whose sticker of colour `face` (the piece's first sticker) is on `side`. */
const sideIndex = { U: [0, 9], R: [9, 18], F: [18, 27], D: [27, 36], L: [36, 45], B: [45, 54] };
const at = (type, slot, side) => {
  const st = TYPES[type].faces[slot].find((i) => i >= sideIndex[side][0] && i < sideIndex[side][1]);
  return placeOf(type, slot, st);
};
const homeOf = (type, piece) => piece * TYPES[type].n;
const moves = (type, alg, place) => placeMap(type, mapOf(alg))[place];

test('every sequence does what its caption says', () => {
  // A white corner's first sticker is its white one (cubejs names D corners D-first: DFR, DLF, DBL, DRB), so
  // `at` places the corner by where its white sticker faces. Each row's `at` and `facing` say where the piece is.
  const DFR = C('DFR');
  const corner = (r) => moves('corner', r.alg, at('corner', C(r.at), r.facing));
  const [toFront, toRight, whiteUp, liftFront, liftRight] = cfStep('bottom-corners');
  assert.equal(corner(toFront), homeOf('corner', DFR), 'top layer, white on the front: placed');
  assert.equal(corner(toRight), homeOf('corner', DFR), 'top layer, white on the right: placed');
  // White on top: one sequence turns it into one of the two above, at the same corner of the top.
  assert.ok([at('corner', C('URF'), 'F'), at('corner', C('URF'), 'R')].includes(corner(whiteUp)), 'white on top becomes white at the side');
  // In the bottom layer the wrong way round: lifted to the top layer with white at the side.
  for (const r of [liftFront, liftRight]) {
    const out = corner(r);
    assert.ok(Math.floor(out / 3) < 4 && out % 3 !== 0, `${r.name} does not lift a white corner to the top with white at the side`);
  }
  // The corner sequence swaps the two top-right corners and keeps the bottom; the twist sequence twists the
  // two top-left corners, opposite ways, and moves no corner at all.
  // Each row is looked up by its fixed name and THAT row's sequence is run, so two rows swapped under unchanged
  // names fail here; the expected effect stays written in the test, independent of the table.
  const row = (name) => { const r = CF_ALGS.find((x) => x.name === name); assert.ok(r, `no row ${name}`); return r.alg; };
  const swap = mapOf(row('cf-top-corners-place-1'));
  assert.ok(fixes(swap, cornerStickers(['DFR', 'DLF', 'DBL', 'DRB'].map(C))));
  assert.equal(Math.floor(placeMap('corner', swap)[homeOf('corner', C('URF'))] / 3), C('UBR'));
  assert.equal(Math.floor(placeMap('corner', swap)[homeOf('corner', C('UBR'))] / 3), C('URF'));
  const twist = placeMap('corner', mapOf(cfStep('top-corners-twist')[0].alg));
  for (const [p, t] of [['UFL', 1], ['ULB', 2], ['URF', 0], ['UBR', 0], ['DFR', 0], ['DLF', 0], ['DBL', 0], ['DRB', 0]]) {
    assert.equal(twist[homeOf('corner', C(p))], homeOf('corner', C(p)) + t, `the twist sequence turns ${p} by ${t}`);
  }
  // The twist sequence is the corner sequence, the cube turned, and the mirror of the corner sequence.
  assert.ok(row('cf-top-corners-twist-1').startsWith(`${row('cf-top-corners-place-1')} y2 L' U' L U F U F'`));

  // Edges, white on the left: a white edge (ledge) belongs on the L face, a yellow one (redge) on R. Put the
  // piece at the row's `at` with its own-face sticker (white or yellow) facing the row's `facing`, and follow it.
  const lands = (r, piece) => {
    const own = LEDGES.includes(piece) ? 'L' : 'R';
    const k = EDGE_FACELETS[piece].findIndex((i) => i >= sideIndex[own][0] && i < sideIndex[own][1]);
    const slot = E(r.at);
    const j = EDGE_FACELETS[slot].findIndex((i) => i >= sideIndex[r.facing][0] && i < sideIndex[r.facing][1]);
    return moves('edge', r.alg, slot * 2 + ((j - k + 2) % 2)) === homeOf('edge', piece);
  };
  for (const r of [...cfStep('ledges'), ...cfStep('last-ledge')]) assert.ok(lands(r, E('UL')), `${r.name} does not put a white edge at ${r.at} (white facing ${r.facing}) home at the top left`);
  for (const r of cfStep('redges')) assert.ok(lands(r, E('UR')), `${r.name} does not put a yellow edge at ${r.at} (yellow facing ${r.facing}) home at the top right`);
  // Only the rows a piece is placed by carry `at`: the others act on the whole top or the whole slice.
  assert.deepEqual(CF_ALGS.filter((r) => r.at).map((r) => r.step), [...Array(5).fill('bottom-corners'), ...Array(5).fill('ledges'), ...Array(5).fill('redges'), 'last-ledge', 'last-ledge']);
  // The middle slice: the flip turns over exactly the two top midges; the four placements are what they say.
  const flip = placeMap('edge', mapOf(row('cf-midges-flip-1')));
  for (let s = 0; s < 12; s++) assert.equal(flip[s * 2], s * 2 + (['UF', 'UB'].includes(EDGES[s]) ? 1 : 0), `the flip moves ${EDGES[s]}`);
  const cycle = (alg) => ['UF', 'UB', 'DF', 'DB'].map((n) => EDGES[Math.floor(placeMap('edge', mapOf(alg))[E(n) * 2] / 2)]).join(' ');
  assert.equal(cycle(row('cf-midges-place-1')), 'DB UF DF UB', 'forward cycle: UF to DB, UB to UF, DB to UB');
  // Not the forward cycle's inverse: the mirror, cycling the top two with the bottom FRONT edge instead.
  assert.equal(cycle(row('cf-midges-place-2')), 'UB DF UF DB', 'backward cycle: UF to UB, UB to DF, DF to UF');
  assert.equal(cycle(row('cf-midges-place-3')), 'UB UF DB DF', 'the top two swapped, and the bottom two');
  assert.equal(cycle(row('cf-midges-place-4')), 'DB DF UB UF', 'swapped two and two across the diagonals');
});

// ---------- each step finishes everything it can meet ----------
// The corner steps hold white down: the four white corners are the D corners.
const WHITE = ['DFR', 'DLF', 'DBL', 'DRB'].map(C);
const TOP = ['URF', 'UFL', 'ULB', 'UBR'].map(C);
// A white corner is placed through any turn of the top first, from any side of the cube: from y^k, U^a.
const cornerApps = (algs) => turns('y').flatMap((y) => turns('U').flatMap((u) => algs.map((a) => from(y, `${u} ${a}`.trim()))));

test('bottom corners: with any white corners already down, every other one can be brought down, keeping them', () => {
  // The first is free: turn the whole cube until a white corner is underneath, white facing down — so, by
  // symmetry, DLF is home. Then for every set of others already placed, every remaining white corner, in
  // every place it can be, has a route home through the step's sequences that never disturbs one placed.
  const apps = cornerApps(algsOf('bottom-corners'));
  let worst = 0;
  for (const rest of subsets(WHITE.filter((p) => p !== C('DLF')))) {
    const placed = [C('DLF'), ...rest];
    for (const piece of WHITE.filter((p) => !placed.includes(p))) {
      const dist = distances('corner', piece, apps, cornerStickers(placed));
      for (let slot = 0; slot < 8; slot++) for (let t = 0; t < 3; t++) {
        if (placed.includes(slot)) continue;
        assert.notEqual(dist[slot * 3 + t], Infinity, `${CORNERS[piece]} at ${CORNERS[slot]} (twist ${t}) cannot be brought down`);
        worst = Math.max(worst, dist[slot * 3 + t]);
      }
    }
  }
  // Jelinek's two-stage promise: at most one sequence to turn a corner into a case you know, one to place it.
  assert.equal(worst, 2);
});

/** Breadth-first over whole states (arrays of places), to a goal, through applications. */
function bfs(starts, applications, type, goal, key = (s) => s.join(',')) {
  const maps = applications.map((a) => placeMap(type, mapOf(a)));
  let worst = 0;
  for (const s0 of starts) {
    let frontier = [s0]; const seen = new Set([key(s0)]); let d = 0;
    while (!frontier.some(goal)) {
      d += 1;
      const next = [];
      for (const s of frontier) for (const m of maps) { const t = s.map((p) => m[p]); const k = key(t); if (!seen.has(k)) { seen.add(k); next.push(t); } }
      assert.ok(next.length, `no route to the goal from ${s0.join(',')}`);
      frontier = next;
    }
    worst = Math.max(worst, d);
  }
  return worst;
}
const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));

test('top corners: the corner sequence places them in at most two goes, then the twist sequence turns them', () => {
  const place = cornerApps(algsOf('top-corners-place'));
  for (const a of place) assert.ok(fixes(mapOf(a), cornerStickers(WHITE)), `${a} disturbs the bottom corners`);
  // Positions only, up to a turn of the top: "all corners are in their positions (although probably twisted)".
  const slotOf = (p) => Math.floor(p / 3);
  const aligned = (s) => turns('U').some((u) => { const m = placeMap('corner', mapOf(u)); return s.every((p, i) => slotOf(m[p]) === TOP[i]); });
  const starts = perms(TOP).map((slots) => slots.map((s) => s * 3));
  assert.equal(bfs(starts, place, 'corner', aligned, (s) => s.map(slotOf).join(',')), 2);
  // Twists: every twisting of the four top corners, positions home, sum a whole turn.
  const twist = turns('y').map((y) => from(y, algsOf('top-corners-twist')[0]));
  for (const a of twist) {
    assert.ok(fixes(mapOf(a), cornerStickers(WHITE)), `${a} disturbs the bottom corners`);
    assert.ok(placeMap('corner', mapOf(a)).every((p, i) => slotOf(p) === slotOf(i)), `${a} moves a corner`);
  }
  const twists = [];
  for (let m = 0; m < 81; m++) { const t = [0, 1, 2, 3].map((i) => Math.floor(m / 3 ** i) % 3); if (t.reduce((x, y) => x + y) % 3 === 0) twists.push(TOP.map((s, i) => s * 3 + t[i])); }
  assert.equal(twists.length, 27);
  const worst = bfs(twists, twist, 'corner', (s) => s.every((p) => p % 3 === 0));
  assert.ok(worst <= 3, `a twisting needs ${worst} goes`);
});

test('centres: one turn of a middle slice puts white underneath, from any of the 24 ways they can sit', () => {
  // The corners fix the frame; the centres turn only as a whole, through the slices, which keep every corner.
  const slices = ['M', "M'", 'M2', 'E', "E'", 'E2', 'S', "S'", 'S2'];
  for (const s of slices) assert.ok(fixes(mapOf(s), ALL_CORNERS));
  const frames = new Set();
  let frontier = [CENTERS.map((c) => c)];
  frames.add(frontier[0].join());
  while (frontier.length) {
    const next = [];
    for (const f of frontier) for (const s of slices) { const g = f.map((i) => mapOf(s)[i]); if (!frames.has(g.join())) { frames.add(g.join()); next.push(g); } }
    frontier = next;
  }
  assert.equal(frames.size, 24);
  // `f[k]` is where the centre that belongs at CENTERS[k] now sits. White is the D centre (index 3).
  for (const key of frames) {
    const f = key.split(',').map(Number);
    const ok = (g) => g[3] === CENTERS[3] && g[0] === CENTERS[0];
    if (ok(f)) continue;
    assert.ok(slices.some((s) => ok(f.map((i) => mapOf(s)[i]))), `centres ${key}: no single slice turn puts white underneath`);
  }
});

// The edge steps: white on the left. The left and right layers turn freely — each carries its four corners,
// and they are turned back at the end — so an application is a turn of each, then of the middle, then a
// sequence, all undone but the sequence.
const edgeApps = (algs) => turns('L').flatMap((l) => turns('R').flatMap((r) => turns('M').flatMap((m) => algs.map((a) => from(`${l} ${r}`.trim(), `${m} ${a}`.trim())))));

test('every edge-step sequence keeps every corner and the left and right centres', () => {
  for (const step of ['ledges', 'redges', 'last-ledge', 'midges-flip', 'midges-place']) {
    for (const r of cfStep(step)) {
      assert.ok(fixes(mapOf(r.alg), ALL_CORNERS), `${r.name} moves a corner`);
      assert.ok(fixes(mapOf(r.alg), [CENTERS[1], CENTERS[4]]), `${r.name} moves the left or right centre`);
    }
  }
});

function everyPieceReachesHome(placedSets, pool, apps, label) {
  let worst = 0;
  for (const placed of placedSets) {
    for (const piece of pool.filter((p) => !placed.includes(p))) {
      const dist = distances('edge', piece, apps, edgeStickers(placed));
      for (let slot = 0; slot < 12; slot++) for (let f = 0; f < 2; f++) {
        if (placed.includes(slot)) continue;
        assert.notEqual(dist[slot * 2 + f], Infinity, `${label}: ${EDGES[piece]} at ${EDGES[slot]}${f ? ' flipped' : ''} cannot be placed with ${placed.map((p) => EDGES[p]).join(' ') || 'nothing'} kept`);
        worst = Math.max(worst, dist[slot * 2 + f]);
      }
    }
  }
  return worst;
}

test('ledges, redges, the last ledge: every edge, from every place, goes home without disturbing one placed', () => {
  const ledges = everyPieceReachesHome(subsets(LEDGES).filter((s) => s.length < 3), LEDGES, edgeApps(algsOf('ledges')), 'ledges');
  // Three white edges first; the fourth slot stays empty so the yellow edges have a way in.
  const redgeSets = LEDGES.flatMap((empty) => subsets(REDGES).filter((s) => s.length < 4).map((s) => [...LEDGES.filter((e) => e !== empty), ...s]));
  const redges = everyPieceReachesHome(redgeSets, REDGES, edgeApps(algsOf('redges')), 'redges');
  const last = everyPieceReachesHome(LEDGES.map((l) => [...REDGES, ...LEDGES.filter((e) => e !== l)]), LEDGES, edgeApps(algsOf('last-ledge')), 'last ledge');
  assert.deepEqual({ ledges, redges, last }, { ledges: 2, redges: 2, last: 2 });
});

test('the middle slice: every position of its four edges and centres is flipped, then placed', () => {
  // What can arise, from the cube's laws alone: the four edges in any order with an even number turned over,
  // and the four centres a turn of the slice off, the turn's parity the order's (a quarter turn of a slice is a
  // four-cycle of both). 24 * 8 * 4 / 2 = 384.
  const SLICE_CENTRES = [0, 2, 3, 5].map((k) => CENTERS[k]);
  const states = [];
  const parity = (p) => { let n = 0; for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) n++; return n % 2; };
  for (const order of perms([0, 1, 2, 3])) for (let flips = 0; flips < 16; flips++) for (let turn = 0; turn < 4; turn++) {
    const f = [0, 1, 2, 3].map((i) => (flips >> i) & 1);
    if (f.reduce((x, y) => x + y) % 2 || parity(order) !== turn % 2) continue;
    // Build the facelets: midge i sits in slot MIDGES[order[i]], flipped by f[i]; the centres turned by M^turn.
    const s = [...SOLVED_FACELETS];
    for (let i = 0; i < 4; i++) {
      const piece = MIDGES[i]; const slot = MIDGES[order[i]];
      for (let k = 0; k < 2; k++) s[EDGE_FACELETS[slot][(k + f[i]) % 2]] = SOLVED_FACELETS[EDGE_FACELETS[piece][k]];
    }
    const m = mapOf(turns('M')[turn]);
    for (const c of SLICE_CENTRES) s[m[c]] = SOLVED_FACELETS[c];
    states.push(s.join(''));
  }
  assert.equal(states.length, 384);
  const apply = (s, alg) => { const to = mapOf(alg); const o = new Array(54); for (let i = 0; i < 54; i++) o[to[i]] = s[i]; return o.join(''); };
  // Jelinek's rule for a midge the right way round: either sticker's colour is its neighbouring centre's, or
  // that colour's opposite.
  const OPP = { U: 'D', D: 'U', F: 'B', B: 'F', L: 'R', R: 'L' };
  const centreBeside = (i) => CENTERS[Math.floor(i / 9)];
  const good = (s) => MIDGES.every((slot) => { const i = EDGE_FACELETS[slot][0]; const c = s[centreBeside(i)]; return s[i] === c || s[i] === OPP[c]; });
  const flipApps = turns('M').flatMap((m) => algsOf('midges-flip').map((a) => `${m} ${a}`.trim()));
  const placeApps = [...turns('M').filter(Boolean), ...turns('M').flatMap((m) => algsOf('midges-place').map((a) => `${m} ${a}`.trim()))];
  const search = (s0, apps, goal) => {
    let frontier = [s0]; const seen = new Set(frontier); let d = 0;
    while (!frontier.some(goal)) { d += 1; frontier = frontier.flatMap((s) => apps.map((a) => apply(s, a))).filter((t) => !seen.has(t) && seen.add(t)); assert.ok(frontier.length, 'stuck'); }
    return { d, at: frontier.find(goal) };
  };
  let flipWorst = 0; let placeWorst = 0;
  for (const s of states) {
    const flipped = search(s, flipApps, good);
    flipWorst = Math.max(flipWorst, flipped.d);
    placeWorst = Math.max(placeWorst, search(flipped.at, placeApps, (t) => t === SOLVED_FACELETS).d);
  }
  assert.ok(good(SOLVED_FACELETS) && states.filter((s) => !good(s)).length > 0, 'the rule calls everything good, or nothing');
  assert.deepEqual({ flipWorst, placeWorst }, { flipWorst: 2, placeWorst: 2 });
});

test('the app\'s interpreter agrees with cubejs on every row, middle-slice centres included', () => {
  // A middle-slice sequence may leave that slice's centres turned — corners first carries the slice loose until
  // the end — and the interpreter says so through its HOLD: which centre is now on top and in front. So the
  // check is that the hold names cubejs's centres, and that the pieces match once the cube is turned to put
  // them home. Rows with no net slice turn must leave the hold alone.
  const ROTATIONS = ['', 'x', 'x2', "x'", 'y', 'y2', "y'", 'z', 'z2', "z'"];
  for (const r of CF_ALGS) {
    const c = new Cube();
    c.move(r.alg);
    const f = c.asString();
    const app = run(r.alg, ['U', 'F'], SOLVED);
    assert.deepEqual([...app.hold], [f[CENTERS[0]], f[CENTERS[2]]], `${r.name}: the hold is not where cubejs puts the centres`);
    const home = ROTATIONS.map((rot) => { const d = Cube.fromString(f); if (rot) d.move(rot); return d.asString(); }).find((g) => g[CENTERS[0]] === 'U' && g[CENTERS[2]] === 'F');
    assert.equal(toFacelets(app.state), home, `${r.name} ("${r.alg}")`);
    if (!/M/.test(r.alg)) assert.deepEqual([...app.hold], ['U', 'F'], `${r.name} turns the cube`);
  }
});

test('the step checks can fail: sequences that only shuffle the middle slice place no white edge', () => {
  // Without this, a search that reached everything for some other reason would pass the tests above vacuously.
  // (No single published sequence is NECESSARY — each step has routes through the others; the page offers them
  // so a learner can place a piece in one go. So the null is a set that cannot work at all.)
  assert.throws(() => everyPieceReachesHome([[]], LEDGES, edgeApps(algsOf('midges-place')), 'null'), /cannot be placed/);
  assert.throws(() => everyPieceReachesHome([[]], LEDGES, edgeApps(algsOf('midges-flip')), 'null'), /cannot be placed/);
});
