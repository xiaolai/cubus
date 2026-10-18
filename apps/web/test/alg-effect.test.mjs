// What an algorithm does, computed — held to cubejs on every algorithm the app holds.
//
// THE ORACLE IS CUBEJS, which plays slices, wide turns and whole-cube turns with code that shares nothing
// with `lib/cube-notation.js`, `lib/cube-moves.js` or `lib/cube-pieces.js`, and which moves REAL centres.
// So every claim `lib/alg-effect.js` makes is checked against cubejs's STICKERS: which slots changed, where
// each piece went, which way a corner turned in place, how many repetitions bring the 54 stickers back, and
// which regions still show their home colours. The only thing shared is the facelet LAYOUT
// (`lib/cube-layout.js`), which says which sticker belongs to which slot and is pinned to cubejs by
// `two-phase.test.mjs`.
//
// A cube whose slices or rotations did not cancel has its centres somewhere else in cubejs. The app keeps
// pieces relative to the centres, so the picture compared is cubejs's cube turned in the hands until its
// centres are home (`fixtures/cubejs-picture.mjs`) — except for the `centres` region and the order, which
// are claims about the hold and are read off the UNTURNED cube.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Cube from 'cubejs';

import { REGIONS, effectOf, keepsOf, orderOf } from '../lib/alg-effect.js';
import { CENTERS, CORNER_FACELETS, EDGE_FACELETS } from '../lib/cube-layout.js';
import { ORIENTATIONS } from '../lib/cube-orientation.js';
import { CORNERS, EDGES } from '../lib/cube-pieces.js';
import { CMLL_ALGS } from '../lib/data/cmll-algs.js';
import { CF_ALGS } from '../lib/data/corners-first-algs.js';
import { MEHTA_ALGS, MEHTA_BEGINNER } from '../lib/data/mehta-algs.js';
import { HUMAN_ALGS } from '../lib/data/human-algs.js';
import { CROSS_ALGS } from '../lib/methods/cross.js';
import { COURSE_ALGS, OLL_ALGS, PLL_ALGS } from '../lib/methods/last-layer.js';
import { PAIRS_ALGS } from '../lib/methods/pairs.js';
import { METHOD_FRAME, SCAN_HOLD } from '../lib/solving-hold.js';
import { cubejsPicture } from './fixtures/cubejs-picture.mjs';

const SOLVED_STRING = new Cube().asString();

/** Every algorithm the app holds, by pool. Each pool is asserted non-empty: a sweep that silently read an
 *  empty list would pass having checked nothing. */
const POOLS = Object.freeze({ HUMAN_ALGS, CMLL_ALGS, OLL_ALGS, PLL_ALGS, COURSE_ALGS, PAIRS_ALGS, CROSS_ALGS, MEHTA_ALGS, MEHTA_BEGINNER, CF_ALGS });
const EVERY = Object.entries(POOLS).flatMap(([pool, rows]) => rows.filter((r) => r.alg).map((r) => ({ pool, name: r.name, alg: r.alg })));

/** cubejs's spelling of an alg: it reads `r` but not `Rw`/`2Rw`, and not `R2'`. Applied only to algorithms
 *  this file writes; every pool row above is handed to cubejs exactly as it is stored. */
const forCubejs = (alg) => alg.replace(/\b2?([URFDLB])w/g, (_, f) => f.toLowerCase()).replace(/2'/g, '2');

/** The slots' stickers, read off a facelet string. */
const cornerStickers = (s, slot) => CORNER_FACELETS[slot].map((i) => s[i]).join('');
const edgeStickers = (s, slot) => EDGE_FACELETS[slot].map((i) => s[i]).join('');
const sameSet = (a, b) => [...a].sort().join('') === [...b].sort().join('');

/** Region slots written out by NAME, here, rather than read from the module: what each region means is the
 *  claim under test. Named in the letters' frame, D the bottom. */
const REGION_SLOTS = Object.freeze({
  cross: { edges: ['DF', 'DR', 'DB', 'DL'], corners: [] },
  'first-layer': { edges: ['DF', 'DR', 'DB', 'DL'], corners: ['DFR', 'DLF', 'DBL', 'DRB'] },
  'first-two-layers': {
    edges: ['DF', 'DR', 'DB', 'DL', 'FR', 'FL', 'BL', 'BR'], corners: ['DFR', 'DLF', 'DBL', 'DRB'],
  },
  'first-block': { edges: ['DL', 'FL', 'BL'], corners: ['DLF', 'DBL'] },
  'both-blocks': { edges: ['DL', 'FL', 'BL', 'DR', 'FR', 'BR'], corners: ['DLF', 'DBL', 'DFR', 'DRB'] },
  'bottom-corners': { edges: [], corners: ['DFR', 'DLF', 'DBL', 'DRB'] },
});

/** How many repetitions bring cubejs's 54 stickers — centres included — back to solved. */
function cubejsOrder(alg) {
  const cube = new Cube();
  for (let n = 1; n <= 1260; n += 1) {
    cube.move(alg);
    if (cube.asString() === SOLVED_STRING) return n;
  }
  return Infinity;
}

/** Cycle lengths of a permutation array, longest first — written here a second time, deliberately, so the
 *  test does not import the function it is checking. */
const cycleLengths = (perm) => {
  const seen = new Array(perm.length).fill(false);
  const out = [];
  for (let i = 0; i < perm.length; i += 1) {
    if (seen[i] || perm[i] === i) continue;
    let j = i; let n = 0;
    while (!seen[j]) { seen[j] = true; n += 1; j = perm[j]; }
    out.push(n);
  }
  return out.sort((a, b) => b - a);
};

/**
 * Every way `effect` disagrees with cubejs about `alg`, as sentences — empty when it agrees. ONE comparator,
 * used both on the real effects and on a deliberately wrong one (the last case), so the case proving it can
 * fail exercises the same code that passes everything else.
 */
function disagreements(alg, effect) {
  const out = [];
  const pic = cubejsPicture(alg);
  const raw = (() => { const c = new Cube(); c.move(alg); return c.asString(); })();

  // (a) The slots whose stickers changed are exactly the slots the effect says it disturbs.
  const changedCorners = CORNERS.filter((n, i) => cornerStickers(pic, i) !== n);
  const changedEdges = EDGES.filter((n, i) => edgeStickers(pic, i) !== n);
  const claimedCorners = [...effect.cornerCycles.flatMap((c) => c.positions), ...effect.twistedInPlace.map((t) => t.position)];
  const claimedEdges = [...effect.edgeCycles.flatMap((c) => c.positions), ...effect.flippedInPlace.map((t) => t.position)];
  if (!sameSet(changedCorners.join(','), claimedCorners.join(',')) || changedCorners.length !== claimedCorners.length) {
    out.push(`corners changed ${changedCorners} but claimed ${claimedCorners}`);
  }
  if (!sameSet(changedEdges.join(','), claimedEdges.join(',')) || changedEdges.length !== claimedEdges.length) {
    out.push(`edges changed ${changedEdges} but claimed ${claimedEdges}`);
  }
  if (effect.movedCorners !== changedCorners.length) out.push(`movedCorners ${effect.movedCorners}, cubejs ${changedCorners.length}`);
  if (effect.movedEdges !== changedEdges.length) out.push(`movedEdges ${effect.movedEdges}, cubejs ${changedEdges.length}`);
  if (effect.pieces !== changedCorners.length + changedEdges.length) out.push(`pieces ${effect.pieces}`);

  // Each cycle's DIRECTION: the piece that started at positions[k] now shows its colours at positions[k+1].
  for (const [cycles, names, stickers] of [
    [effect.cornerCycles, CORNERS, cornerStickers], [effect.edgeCycles, EDGES, edgeStickers],
  ]) {
    for (const { positions } of cycles) {
      positions.forEach((from, k) => {
        const to = positions[(k + 1) % positions.length];
        if (!sameSet(stickers(pic, names.indexOf(to)), from)) out.push(`the piece from ${from} is not at ${to}`);
      });
    }
  }
  // A corner turned in place: its own colours, its U/D colour `turn` stickers round in the slot's order.
  for (const { position, turn } of effect.twistedInPlace) {
    const s = cornerStickers(pic, CORNERS.indexOf(position));
    if (!sameSet(s, position) || s.indexOf(position[0]) !== turn) out.push(`${position} is not twisted ${turn} in place (${s})`);
  }
  for (const { position } of effect.flippedInPlace) {
    const s = edgeStickers(pic, EDGES.indexOf(position));
    if (s !== [...position].reverse().join('')) out.push(`${position} is not flipped in place (${s})`);
  }

  // The first version's four counts, from cubejs's own arrays (the old test's oracle, ported).
  const c = Cube.fromString(pic);
  if (cycleLengths(c.cp).join() !== effect.corners.join()) out.push(`corner cycles ${effect.corners}, cubejs ${cycleLengths(c.cp)}`);
  if (cycleLengths(c.ep).join() !== effect.edges.join()) out.push(`edge cycles ${effect.edges}, cubejs ${cycleLengths(c.ep)}`);
  if (c.co.filter((v) => v !== 0).length !== effect.twisted) out.push(`twisted ${effect.twisted}`);
  if (c.eo.filter((v) => v !== 0).length !== effect.flipped) out.push(`flipped ${effect.flipped}`);
  const parity = (p) => (cycleLengths(p).reduce((n, l) => n + l - 1, 0) % 2 ? 'odd' : 'even');
  if (parity(c.cp) !== effect.parity || parity(c.ep) !== effect.parity) out.push(`parity ${effect.parity}`);

  // (b) The order: repetitions until every sticker, centres too, is back.
  const order = cubejsOrder(alg);
  if (effect.order !== order) out.push(`order ${effect.order}, cubejs ${order}`);

  // (c) Every region claimed really shows its home colours — and every region NOT claimed really does not.
  const oracleKeeps = new Set(Object.entries(REGION_SLOTS)
    .filter(([, { edges, corners }]) => edges.every((n) => edgeStickers(pic, EDGES.indexOf(n)) === n)
      && corners.every((n) => cornerStickers(pic, CORNERS.indexOf(n)) === n))
    .map(([id]) => id));
  if (CENTERS.every((i) => raw[i] === SOLVED_STRING[i])) oracleKeeps.add('centres');
  for (const id of REGIONS.map((r) => r.id)) {
    if (effect.keeps.includes(id) && !oracleKeeps.has(id)) out.push(`claims to keep ${id}, which cubejs shows disturbed`);
    if (!effect.keeps.includes(id) && oracleKeeps.has(id)) out.push(`does not claim ${id}, which cubejs shows intact`);
  }
  if (effect.keepsHold !== effect.keeps.includes('centres')) out.push('keepsHold and the centres region disagree');
  return out;
}

test('every pool is read, and none is empty', () => {
  for (const [pool, rows] of Object.entries(POOLS)) assert.ok(rows.filter((r) => r.alg).length > 0, `${pool} is empty`);
  assert.equal(EVERY.length, Object.values(POOLS).reduce((n, rows) => n + rows.filter((r) => r.alg).length, 0));
  // The sweep includes slices, wide turns and rotations, or it is the first version's test again.
  assert.ok(EVERY.some((e) => /\bM/.test(e.alg)), 'no slice in the sweep');
  assert.ok(EVERY.some((e) => /\br/.test(e.alg)), 'no wide turn in the sweep');
  assert.ok(EVERY.some((e) => /\b[xy]/.test(e.alg)), 'no rotation in the sweep');
});

test('every algorithm the app holds measures as cubejs plays it', () => {
  for (const { pool, name, alg } of EVERY) {
    assert.deepEqual(disagreements(alg, effectOf(alg)), [], `${pool} ${name}: ${alg}`);
  }
});

test('the regions are exactly the ones the oracle knows, so a new region cannot go unchecked', () => {
  assert.deepEqual(REGIONS.map((r) => r.id).sort(), ['centres', ...Object.keys(REGION_SLOTS)].sort());
});

test('named cases, checked by hand and then by cubejs', () => {
  // Sune on a SOLVED cube does not twist three corners in place: it swaps two pairs of top corners (each
  // pair turned as it goes) and cycles three top edges. Order 6, the number cubers quote for it.
  const sune = effectOf("R U R' U R U2 R'");
  assert.deepEqual(sune.corners, [2, 2]);
  assert.deepEqual(sune.edges, [3]);
  assert.deepEqual(sune.twistedInPlace, []);
  assert.equal(sune.order, 6);
  // T perm: two corners and two edges swapped, nothing turned — odd, and its own undo.
  const t = effectOf("R U R' U' R' F R2 U' R' U' R U R' F'");
  assert.deepEqual(t.cornerCycles.map((c) => [...c.positions]), [['URF', 'UBR']]);
  assert.deepEqual(t.edgeCycles.map((c) => [...c.positions]), [['UR', 'UL']]);
  assert.equal(t.parity, 'odd');
  assert.equal(t.order, 2);
  assert.deepEqual([...t.keeps], ['centres', 'cross', 'first-layer', 'first-two-layers', 'first-block', 'both-blocks', 'bottom-corners']);
  // Ua, slices: three top edges cycled, no corner touched, the centres back where they were.
  const ua = effectOf("M2 U M U2 M' U M2");
  assert.deepEqual(ua.cornerCycles, []);
  assert.deepEqual(ua.edgeCycles.map((c) => c.positions.length), [3]);
  assert.equal(ua.order, 3);
  assert.equal(ua.keepsHold, true);
  // H, slices: two pairs of opposite top edges swapped.
  const h = effectOf('M2 U M2 U2 M2 U M2');
  assert.deepEqual(h.edgeCycles.map((c) => [...c.positions]), [['UR', 'UL'], ['UF', 'UB']]);
  assert.equal(h.order, 2);
  // The sexy move: order 6, and it keeps the cross and the left block but not the first layer.
  const sexy = effectOf("R U R' U'");
  assert.equal(sexy.order, 6);
  assert.deepEqual([...sexy.keeps], ['centres', 'cross', 'first-block']);
  assert.ok(!sexy.keeps.includes('first-layer'), 'R U R\' U\' moves DFR, so it cannot keep the first layer');
  // A rotation in a closed algorithm (Aa opens and closes `x`) leaves the hold as it found it.
  const aa = effectOf("x L2 D2 L' U' L D2 L' U L' x'");
  assert.equal(aa.keepsHold, true);
  assert.deepEqual(aa.corners, [3]);
  assert.deepEqual(aa.edges, []);
  for (const alg of ["R U R' U R U2 R'", "R U R' U' R' F R2 U' R' U' R U R' F'", "M2 U M U2 M' U M2", 'M2 U M2 U2 M2 U M2', "R U R' U'", "x L2 D2 L' U' L D2 L' U L' x'"]) {
    assert.deepEqual(disagreements(alg, effectOf(alg)), [], alg);
  }
});

test('an algorithm that leaves the cube turned has an order, counted with the hold', () => {
  // The first version refused these ("x U", "y", "r U r' x", the open Aa). They are measured now: the
  // centres region is not kept, the hold is reported, and the order counts repetitions until the stickers
  // AND the centres are back — which is what cubejs counts.
  for (const alg of ['x U', 'y', "r U r' x", "x L2 D2 L' U' L D2 L' U L'", "r U R'", 'M', 'x', "z' U", 'Rw U R\'', "2Rw' F"]) {
    const e = effectOf(alg);
    assert.equal(e.keepsHold, false, `${alg} ends held as it began?`);
    assert.ok(!e.keeps.includes('centres'), `${alg} claims to keep the centres`);
    assert.deepEqual(disagreements(forCubejs(alg), e), [], alg);
    assert.equal(orderOf(alg), cubejsOrder(forCubejs(alg)), alg);
  }
  // A bare rotation moves no piece relative to the centres and keeps every piece region, carried round.
  const x = effectOf('x');
  assert.equal(x.pieces, 0);
  assert.equal(x.order, 4);
  assert.deepEqual([...x.keeps], ['cross', 'first-layer', 'first-two-layers', 'first-block', 'both-blocks', 'bottom-corners']);
});

test('the first version\'s two equalities still hold', () => {
  const pieces = ({ corners, edges, twisted, flipped, order }) => ({ corners, edges, twisted, flipped, order });
  assert.deepEqual(pieces(effectOf("x U x'")), pieces(effectOf('F')));
  assert.deepEqual(pieces(effectOf('M2 U M2 U2 M2 U M2')), pieces(effectOf('R2 L2 D R2 L2 U2 R2 L2 D R2 L2')));
});

/** A cubejs rotation sequence that turns a solved cube into the hold `[up, front]`. */
function cubejsHold([up, front]) {
  const seqs = [''];
  for (const a of ['', 'x', 'x2', "x'", 'z', "z'"]) for (const b of ['', 'y', 'y2', "y'"]) seqs.push(`${a} ${b}`.trim());
  for (const s of seqs) {
    const c = new Cube();
    if (s) c.move(s);
    const str = c.asString();
    if (str[CENTERS[0]] === up && str[CENTERS[2]] === front) return s;
  }
  throw new Error(`no cubejs rotation reaches ${up} ${front}`);
}

test('the end hold is the one cubejs ends in, from every one of the 24 holds, and the pieces are hold-free', () => {
  assert.equal(ORIENTATIONS.length, 24);
  for (const alg of ["R U R' U'", 'x', 'M', "r U R'", "z' U", 'y2', "x L2 D2 L' U' L D2 L' U L' x'", 'E S']) {
    const base = effectOf(alg);
    for (const hold of ORIENTATIONS) {
      const c = new Cube();
      const setup = cubejsHold(hold);
      if (setup) c.move(setup);
      c.move(alg);
      const s = c.asString();
      const e = effectOf(alg, { hold });
      assert.deepEqual([...e.endHold], [s[CENTERS[0]], s[CENTERS[2]]], `${alg} from ${hold}`);
      assert.deepEqual([...e.hold], [...hold]);
      // Everything but the holds is the same from every hold: it is named in the letters' own frame.
      const { hold: _h, endHold: _e, ...rest } = e;
      const { hold: _bh, endHold: _be, ...baseRest } = base;
      assert.deepEqual(rest, baseRest, `${alg} measures differently from ${hold}`);
    }
  }
  // The tables are written in the method frame, and a closed algorithm ends in it.
  assert.deepEqual([...effectOf("R U R' U'", { hold: METHOD_FRAME }).endHold], [...METHOD_FRAME]);
  assert.deepEqual([...effectOf('x', { hold: SCAN_HOLD }).endHold], ['F', 'D']);
});

test('every order in the sweep is a whole number within the cube group\'s 1260', () => {
  const orders = EVERY.map((e) => orderOf(e.alg));
  assert.ok(Math.max(...orders) <= 1260);
  assert.ok(orders.every((o) => Number.isInteger(o) && o >= 1));
  // The identity is no algorithm: nothing in any pool leaves a solved cube as it was.
  assert.ok(EVERY.every((e) => effectOf(e.alg).pieces > 0), 'an algorithm in a pool does nothing');
});

test('every pool algorithm ends held as it began', () => {
  // The data files close every rotation they open (human-algs.js, change 2), which `piecesOf` in the method
  // engine relies on. Measured here, not assumed, because an open one would change what `keeps` means.
  // The one exception is Jelinek's corners-first edge steps, which leave the middle slice loose by the method's
  // design: exactly these ten end with the centres turned, and the ledger finishes each with a turn of M.
  const open = EVERY.filter((e) => !effectOf(e.alg).keepsHold).map((e) => e.name);
  assert.deepEqual(open, [
    'cf-ledges-1', 'cf-ledges-2', 'cf-ledges-3', 'cf-ledges-5', 'cf-redges-1', 'cf-redges-2', 'cf-redges-3', 'cf-redges-5',
    'cf-last-ledge-1', 'cf-last-ledge-2',
  ]);
});

test('the result is frozen, and keepsOf answers what effectOf carries', () => {
  const e = effectOf("R U R' U'");
  assert.ok(Object.isFrozen(e) && Object.isFrozen(e.cornerCycles) && Object.isFrozen(e.cornerCycles[0].positions));
  assert.throws(() => { e.cornerCycles[0].positions[0] = 'DBL'; });
  assert.deepEqual(keepsOf("R U R' U'"), e.keeps);
  assert.throws(() => effectOf('R', { hold: ['U', 'D'] }), 'a hold that is not one is refused');
  assert.throws(() => effectOf('R Q'), 'an unreadable token is refused');
});

test('the comparator can fail: a wrong effect fed through it is caught on every claim it makes', () => {
  const alg = "R U R' U' R' F R2 U' R' U' R U R' F'";
  const right = effectOf(alg);
  const wrong = (patch) => disagreements(alg, { ...right, ...patch });
  assert.deepEqual(disagreements(alg, right), []);
  // Reversed cycle direction is invisible for a 2-cycle, so a 3-cycle is reversed instead.
  const ua = "M2 U M U2 M' U M2";
  const uaRight = effectOf(ua);
  const reversed = uaRight.edgeCycles.map((c) => ({ ...c, positions: [...c.positions].reverse() }));
  assert.notDeepEqual(disagreements(ua, { ...uaRight, edgeCycles: reversed }), []);
  assert.notDeepEqual(wrong({ order: 3 }), []);
  assert.notDeepEqual(wrong({ cornerCycles: [{ positions: ['URF', 'ULB'], turn: 0 }] }), []);
  assert.notDeepEqual(wrong({ edgeCycles: [] }), []);
  assert.notDeepEqual(wrong({ twistedInPlace: [{ position: 'DFR', turn: 1 }] }), []);
  assert.notDeepEqual(wrong({ parity: 'even' }), []);
  assert.notDeepEqual(wrong({ keeps: ['centres', 'cross'] }), [], 'an unclaimed region that is intact is caught');
  const sexy = "R U R' U'";
  assert.notDeepEqual(disagreements(sexy, { ...effectOf(sexy), keeps: [...effectOf(sexy).keeps, 'first-layer'] }), [],
    'a region claimed but disturbed is caught');
});
