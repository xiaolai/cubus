// The per-algorithm ledger, held to the algorithms it describes — every computed column re-derived here by
// code that shares nothing with `lib/alg-library.js` or `lib/alg-effect.js`.
//
// dev-docs/algorithm-drill-v2-plan.md §2.1 and §8 (decision 4: every row, with clear explanations; the
// explanation is the gate). THE ORACLE IS CUBEJS: it reads slices, wide turns and whole-cube turns with code
// that did not come from this repository, and moves real centres. So the case picture, the effect, the
// regions kept, the order, the inverses and the mirrors are each played on cubejs and compared; the lengths
// are recounted by a token walk of this file's own; and the one sentence each row SAYS is read back and every
// claim in it checked against cubejs's stickers — and a sentence deliberately made wrong is shown to fail.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Cube from 'cubejs';

import {
  ALG_SETS, ALG_SOURCES, METHOD_SETS, PENDING_SOURCES, TRIGGERS, TRIGGER_SOURCES, algIds, algRow, loadEntries,
  mirrorAlg, rowsForMethod, setRows,
} from '../lib/alg-library.js';
import { CORNERS, EDGES } from '../lib/cube-pieces.js';
import { METHOD_FRAME } from '../lib/solving-hold.js';
import { CROSS_ALGS } from '../lib/methods/cross.js';
import { PAIRS_ALGS, PAIRS_EXTRAS } from '../lib/methods/pairs.js';
import { COURSE_ALGS, LAST_LAYER_EXTRAS, OLL_ALGS, PLL_ALGS } from '../lib/methods/last-layer.js';
import { HUMAN_ALGS, SOURCES as HUMAN_SOURCES } from '../lib/data/human-algs.js';
import { CMLL_ALGS, SOURCES as CMLL_SOURCES } from '../lib/data/cmll-algs.js';
import { F2L_CASES, FULL_OLL, FULL_PLL } from '../lib/data/case-tables.js';
import { buildLedger } from '../bench/alg-ledger.mjs';
import {
  ALG_LEDGER_COUNTS, ALG_LEDGER_GAPS, ALG_LEDGER_PENDING, ALG_LEDGER_ROWS,
} from './fixtures/alg-ledger.mjs';

const ROWS = ALG_LEDGER_ROWS;
const BY_ID = new Map(ROWS.map((r) => [r.id, r]));
const round = (v) => JSON.parse(JSON.stringify(v));

// ---- this file's own readings of an algorithm ---------------------------------------------------------------

const tokens = (alg) => alg.trim().split(/\s+/).filter(Boolean);

/** The kind of one token, by its letter alone — not `readToken`. */
const kindOf = (tok) => {
  const letter = tok.replace(/^\d/, '')[0];
  if (/[xyz]/.test(letter)) return 'rotation';
  if (/[MES]/.test(letter)) return 'slice';
  if (/[rludfb]/.test(letter) || tok.includes('w')) return 'wide';
  if (/[URFDLB]/.test(letter)) return 'face';
  throw new Error(`not a token: ${tok}`);
};
const half = (tok) => tok.includes('2');

/** The inverse, written here: reverse, and flip each quarter turn. cubejs reads no `2'`, so a half is `2`. */
const inverted = (alg) => tokens(alg).reverse().map((m) => (half(m) ? m.replace("2'", '2') : m.endsWith("'") ? m.slice(0, -1) : `${m}'`)).join(' ');
const forCubejs = (alg) => tokens(alg).map((m) => m.replace("2'", '2')).join(' ');

const played = (...algs) => {
  const c = new Cube();
  for (const a of algs) if (a.trim()) c.move(forCubejs(a));
  return c;
};

/** The pieces' cycles from cubejs's own cp/co/ep/eo, walked here. Positions are cubejs's slot names, which
 *  are `cube-pieces.js`'s by construction (the test asserts it). */
function cyclesFrom(perm, ori, names, mod) {
  const seen = new Set();
  const cycles = [];
  const inPlace = [];
  for (let s = 0; s < perm.length; s += 1) {
    if (seen.has(s)) continue;
    const slots = [];
    let at = s;
    while (!seen.has(at)) { seen.add(at); slots.push(at); at = perm.indexOf(at); }
    const turn = slots.reduce((n, x) => n + ori[x], 0) % mod;
    if (slots.length === 1) { if (turn) inPlace.push(names[s]); } else cycles.push({ positions: slots.map((x) => names[x]), turn });
  }
  return { cycles, inPlace };
}

function cubejsEffect(alg) {
  const j = played(alg).toJSON();
  return { centres: j.center, corners: cyclesFrom(j.cp, j.co, CORNERS, 3), edges: cyclesFrom(j.ep, j.eo, EDGES, 2) };
}

// Facelet indices, URFDLB, each face 3×3 read as seen from outside (Kociemba's layout, which cubejs uses).
const F = (face, r, c) => 'URFDLB'.indexOf(face) * 9 + r * 3 + c;
const sticker = (s, face, r, c) => s[F(face, r, c)];
const holds = (s, cells) => cells.every(([face, r, c]) => sticker(s, face, r, c) === face);
const SIDES = ['R', 'F', 'L', 'B'];
const cells = {
  cross: [['D', 0, 1], ['D', 1, 0], ['D', 1, 2], ['D', 2, 1], ...SIDES.map((x) => [x, 2, 1])],
  'first-layer': [...[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => ['D', r, c])), ...SIDES.flatMap((x) => [0, 1, 2].map((c) => [x, 2, c]))],
  'first-two-layers': [...[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => ['D', r, c])), ...SIDES.flatMap((x) => [1, 2].flatMap((r) => [0, 1, 2].map((c) => [x, r, c])))],
  // The left block: L's lower two rows, D's left column, F's lower-left and B's lower-right (B is seen from
  // behind, so its right column is the L side).
  'first-block': [...[1, 2].flatMap((r) => [0, 1, 2].map((c) => ['L', r, c])), ['D', 0, 0], ['D', 1, 0], ['D', 2, 0], ['F', 1, 0], ['F', 2, 0], ['B', 1, 2], ['B', 2, 2]],
};
cells['both-blocks'] = [...cells['first-block'], ...[1, 2].flatMap((r) => [0, 1, 2].map((c) => ['R', r, c])), ['D', 0, 2], ['D', 1, 2], ['D', 2, 2], ['F', 1, 2], ['F', 2, 2], ['B', 1, 0], ['B', 2, 0]];

/** The regions cubejs's stickers say a solved cube keeps under `alg`, by this file's own cell lists. */
const keptByCubejs = (alg) => {
  const s = played(alg).asString();
  return new Set(Object.keys(cells).filter((r) => holds(s, cells[r])));
};

/** 3D centre of each facelet ×2, from the layout above: +x right, +y up, +z front. */
const POS = (() => {
  const at = {
    U: (r, c) => [2 * (c - 1), 3, 2 * (r - 1)],
    R: (r, c) => [3, 2 * (1 - r), 2 * (1 - c)],
    F: (r, c) => [2 * (c - 1), 2 * (1 - r), 3],
    D: (r, c) => [2 * (c - 1), -3, 2 * (1 - r)],
    L: (r, c) => [-3, 2 * (1 - r), 2 * (c - 1)],
    B: (r, c) => [2 * (1 - c), 2 * (1 - r), -3],
  };
  return [...'URFDLB'].flatMap((f) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => at[f](r, c))));
})();
const key = (p) => p.join(',');
const INDEX_AT = new Map(POS.map((p, i) => [key(p), i]));
/** A picture reflected left to right: each sticker to the place its mirror image occupies, R and L colours
 *  traded, because the reflected cube's right face carries what was its left. */
function reflect(s) {
  const out = new Array(54);
  POS.forEach(([x, y, z], i) => { out[INDEX_AT.get(key([-x, y, z]))] = ({ R: 'L', L: 'R' })[s[i]] ?? s[i]; });
  return out.join('');
}

// ---- reading a sentence back ---------------------------------------------------------------------------------

const WORD = Object.fromEntries(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'].map((w, i) => [w, i]));
const REGION_OF_WORDS = { 'the cross': 'cross', 'the first layer': 'first-layer', 'the first two layers': 'first-two-layers', 'the first block': 'first-block', 'both blocks': 'both-blocks' };
const SIDE_LETTER = { top: 'U', bottom: 'D', front: 'F', back: 'B', right: 'R', left: 'L' };
/** "the bottom front-right corner" -> the set of its letters. */
const positionOf = (words) => {
  const m = /^the (\w+)[ -](\w+)-(\w+) (corner|edge)$/.exec(words) ?? /^the (\w+)-(\w+) (edge)$/.exec(words);
  if (!m) throw new Error(`not a position: "${words}"`);
  return m.slice(1, -1).map((w) => SIDE_LETTER[w]).sort().join('');
};
const sortedLetters = (p) => [...p].sort().join('');
const splitList = (s) => s.split(/, | and /);

/** Which region the sentence must name, per family: the largest cubejs says is kept. */
const FAMILY = {
  layers: ['first-two-layers', 'first-layer', 'cross'],
  blocks: ['first-two-layers', 'both-blocks', 'first-block'],
};

/**
 * Every claim in a row's sentence, checked against cubejs. Throws naming the first that is false, or the first
 * fact the sentence leaves out that it must say. Exported to the deliberately-wrong case below by closure.
 */
function checkSays(row) {
  const set = ALG_SETS.find((s) => s.id === row.set);
  const says = row.says;
  assert.ok(says.endsWith('.'), 'a sentence ends with a full stop');
  const [body, ...tails] = says.slice(0, -1).split('; ');
  const e = cubejsEffect(row.alg);
  const kept = keptByCubejs(row.alg);

  // keeps — exactly the largest kept region of the set's family, or no clause when none is kept.
  const keepTail = tails.find((x) => x.startsWith('keeps '));
  const named = keepTail ? splitList(keepTail.slice('keeps '.length)).map((w) => REGION_OF_WORDS[w]) : [];
  assert.ok(named.every(Boolean), `"${keepTail}" names a region this test does not know`);
  for (const r of named) assert.ok(kept.has(r), `says it keeps ${r}, and cubejs finds it broken`);
  const largest = FAMILY[set.regions].find((r) => kept.has(r));
  if (largest) assert.ok(named.includes(largest), `keeps ${largest} by cubejs and does not say so`);
  else assert.deepEqual(named, [], 'names a region it keeps where cubejs finds none of its family kept');

  // the hold
  const centresHome = e.centres.every((v, i) => v === i);
  assert.equal(tails.includes('ends with the cube held differently'), !centresHome, 'the sentence and cubejs disagree on whether the hold changes');

  const corners = [...e.corners.cycles.flatMap((c) => c.positions), ...e.corners.inPlace];
  const edges = [...e.edges.cycles.flatMap((c) => c.positions), ...e.edges.inPlace];
  const moved = [...corners, ...edges];
  const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  const text = lower(body);

  let m;
  if ((m = /^turns the top colour up on (.+)$/.exec(text))) {
    const c = new Cube();
    c.move('x2');
    if (row.alg) c.move(inverted(row.alg));
    const s = c.asString();
    const down = (idx) => idx.filter((i) => s[i] !== s[4]).length;
    const want = { corner: down([0, 2, 6, 8]), edge: down([1, 3, 5, 7]) };
    const said = { corner: 0, edge: 0 };
    for (const part of splitList(m[1])) {
      const p = /^(\w+) (corner|edge)s?$/.exec(part);
      assert.ok(p, `"${part}" is not a count of corners or edges`);
      said[p[2]] = WORD[p[1]];
    }
    assert.deepEqual(said, want, 'the count of stickers turned up is not what the case shows');
    assert.ok(kept.has('first-two-layers'), 'an orientation sentence for an algorithm that breaks the first two layers');
  } else if ((m = /^puts (.+) in place(?: and moves (\w+) top pieces?)?$/.exec(text))) {
    const saidBelow = splitList(m[1]).map(positionOf).sort();
    const below = moved.filter((p) => !p.includes('U')).map(sortedLetters).sort();
    assert.deepEqual(saidBelow, below, 'the pieces it says it puts in place are not the ones cubejs finds moved below the top');
    assert.equal(m[2] ? WORD[m[2]] : 0, moved.filter((p) => p.includes('U')).length, 'the count of top pieces moved is wrong');
  } else {
    const clauses = splitList(text);
    const saw = { corners: { cycles: false, inPlace: false }, edges: { cycles: false, inPlace: false } };
    for (const clause of clauses) {
      const p = /^(swaps two pairs of|swaps two|cycles three|cycles four|moves (\w+)|twists (\w+)|flips (\w+)) (top )?(corners?|edges?)( in place)?$/.exec(clause);
      assert.ok(p, `"${clause}" is not a clause this test can check`);
      const noun = p[6].endsWith('s') ? p[6] : `${p[6]}s`;
      const fx = noun === 'corners' ? e.corners : e.edges;
      if (p[7]) {
        const n = WORD[p[3] ?? p[4]];
        assert.equal(n, fx.inPlace.length, `"${clause}": cubejs finds ${fx.inPlace.length} turned in place`);
        assert.equal(Boolean(p[5]), fx.inPlace.every((x) => x.includes('U')), `"${clause}": "top" is wrong`);
        saw[noun].inPlace = true;
        continue;
      }
      const lens = fx.cycles.map((c) => c.positions.length).sort((a, b) => a - b).join(',');
      const turned = fx.cycles.some((c) => c.turn);
      const verb = p[1];
      if (verb === 'swaps two') assert.ok(lens === '2' && !turned, `"${clause}": cubejs finds cycles ${lens}${turned ? ' with a turn' : ''}`);
      else if (verb === 'swaps two pairs of') assert.ok(lens === '2,2' && !turned, `"${clause}": cubejs finds cycles ${lens}`);
      else if (verb === 'cycles three') assert.ok(lens === '3' && !turned, `"${clause}": cubejs finds cycles ${lens}`);
      else if (verb === 'cycles four') assert.ok(lens === '4' && !turned, `"${clause}": cubejs finds cycles ${lens}`);
      else assert.equal(WORD[p[2]], fx.cycles.reduce((n, c) => n + c.positions.length, 0), `"${clause}": the count moved is wrong`);
      const positions = fx.cycles.flatMap((c) => c.positions);
      assert.equal(Boolean(p[5]), positions.every((x) => x.includes('U')), `"${clause}": "top" is wrong`);
      saw[noun].cycles = true;
    }
    for (const noun of ['corners', 'edges']) {
      const fx = noun === 'corners' ? e.corners : e.edges;
      assert.equal(saw[noun].cycles, fx.cycles.length > 0, `the sentence ${saw[noun].cycles ? 'claims' : 'leaves out'} moved ${noun}`);
      assert.equal(saw[noun].inPlace, fx.inPlace.length > 0, `the sentence ${saw[noun].inPlace ? 'claims' : 'leaves out'} ${noun} turned in place`);
    }
  }
}

// ---- the cases -------------------------------------------------------------------------------------------------

test('L1: every row of every source module has exactly one ledger row, and no ledger row lacks one', () => {
  // Enumerated from the modules THEMSELVES, not from the library's set definitions: a source row the sets
  // forget is exactly what this must catch. The named steps that are not algorithms are the only exclusions,
  // and they are the method modules' own lists of such steps.
  const source = [
    ...CROSS_ALGS, ...PAIRS_ALGS, ...OLL_ALGS, ...PLL_ALGS, ...COURSE_ALGS,
    ...HUMAN_ALGS, ...CMLL_ALGS, ...F2L_CASES, ...FULL_OLL, ...FULL_PLL,
  ];
  const ids = source.map((r) => r.name);
  assert.equal(new Set(ids).size, ids.length, 'two source rows share a name, so an id would name two algorithms');
  const ledger = ROWS.map((r) => r.id);
  assert.equal(new Set(ledger).size, ledger.length, 'a ledger row appears twice');
  assert.deepEqual([...ledger].sort(), [...ids].sort(), 'the ledger and the source modules disagree about which algorithms exist');
  for (const r of ROWS) assert.equal(r.alg, source.find((s) => s.name === r.id).alg, `${r.id}: the ledger's moves are not its source's`);
  // And the exclusions really are the empty named steps, held to the modules' lists rather than typed here.
  for (const extra of [...PAIRS_EXTRAS, ...LAST_LAYER_EXTRAS]) {
    assert.equal(extra.alg, '', `${extra.name} is filed as a non-algorithm and has moves`);
    assert.ok(!BY_ID.has(extra.name), `${extra.name} is not an algorithm and has a row`);
  }
  assert.equal(ROWS.length, 309);
});

test('relation: the fixture is what the library produces now', async () => {
  const ledger = await buildLedger();
  assert.deepEqual(ALG_LEDGER_ROWS, round(ledger.rows), 'the rows in the fixture are not what the library now computes — run bench/alg-ledger.mjs --emit');
  assert.deepEqual(ALG_LEDGER_COUNTS, round(ledger.counts));
  assert.deepEqual(ALG_LEDGER_PENDING, round(ledger.pending));
  assert.deepEqual(ALG_LEDGER_GAPS, round(ledger.gaps));
});

test('the counts are what the rows add up to, and there are no gaps', () => {
  assert.equal(ALG_LEDGER_COUNTS.rows, ROWS.length);
  assert.equal(Object.values(ALG_LEDGER_COUNTS.perSet).reduce((a, b) => a + b, 0), ROWS.length);
  for (const [id, n] of Object.entries(ALG_LEDGER_COUNTS.perSet)) assert.equal(n, ROWS.filter((r) => r.set === id).length, id);
  // Decision 4 makes the explanation the gate: a row that cannot be described is listed, and today none is.
  assert.deepEqual(ALG_LEDGER_GAPS, [], 'a row the generator could not describe — read the Gaps section of the page');
});

test('nothing in a row is undefined, and every null is a field the source does not give', () => {
  const walk = (v, path, out) => {
    if (v === undefined) out.push(`${path} is undefined`);
    else if (v === null) out.push(path);
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, out);
    return out;
  };
  for (const row of ROWS) {
    const set = ALG_SETS.find((s) => s.id === row.set);
    for (const path of walk(row, '', [])) {
      const field = path === 'solves.case' ? 'case' : path;
      const allowed = Object.hasOwn(set.notGiven, field)
        || (path === 'sourceAlg' && !HUMAN_ALGS.find((h) => h.name === row.id)?.sourceAlg)
        || (path === 'nicknameSource' && row.nickname === null);
      assert.ok(allowed, `${row.id}: ${path} is null and is neither a gap the page lists nor a field its source leaves out`);
    }
    // The columns the explanation rests on are never null.
    for (const k of ['says', 'source', 'alg', 'order']) assert.ok(row[k] !== null && row[k] !== undefined, `${row.id}: no ${k}`);
    assert.match(row.solves.facelets, /^[URFDLB]{54}$/, `${row.id}: no picture`);
  }
});

test('L2: every source citation is the data file\'s own, never retyped', () => {
  for (const row of ROWS) {
    const set = ALG_SETS.find((s) => s.id === row.set);
    if (set.kind === 'hand-written') { assert.equal(row.source, 'written for teaching'); continue; }
    if (set.kind === 'proved') { assert.equal(row.source, 'proved minimal by search'); continue; }
    const entry = set.from[0] === 'human-algs' ? HUMAN_ALGS.find((h) => h.name === row.id) : CMLL_ALGS.find((h) => h.name === row.id);
    const src = (set.from[0] === 'human-algs' ? HUMAN_SOURCES : CMLL_SOURCES)[entry.source];
    assert.deepEqual(row.source, { name: src.name ?? src.what, url: src.url, fetched: src.fetched }, row.id);
    assert.match(row.source.url, /^https:\/\//);
    assert.match(row.source.fetched, /^\d{4}-\d{2}-\d{2}$/, `${row.id}: no fetched date`);
  }
  for (const s of Object.values(TRIGGER_SOURCES)) {
    assert.match(s.url, /^https:\/\//);
    assert.match(s.fetched, /^\d{4}-\d{2}-\d{2}$/);
  }
  for (const tr of TRIGGERS) assert.ok(Object.hasOwn(TRIGGER_SOURCES, tr.source), `${tr.id} names no listed source`);
});

test('L2: the lengths and the kinds, recounted by a token walk of this file\'s own', () => {
  for (const row of ROWS) {
    const ks = tokens(row.alg).map(kindOf);
    const hs = tokens(row.alg).map(half);
    let htm = 0; let stm = 0; let qtm = 0;
    ks.forEach((k, i) => {
      if (k === 'rotation') return;
      const per = k === 'slice' ? 2 : 1;
      htm += per;
      stm += 1;
      qtm += per * (hs[i] ? 2 : 1);
    });
    assert.deepEqual([row.tokens, row.htm, row.stm, row.qtm], [ks.length, htm, stm, qtm], `${row.id} ("${row.alg}")`);
    assert.deepEqual(row.kinds, ['wide', 'slice', 'rotation'].filter((k) => ks.includes(k)), `${row.id}: kinds`);
    // what a smart cube cannot report: every token that is not a face turn, and what it reports instead
    assert.deepEqual(row.observable.map((o) => o.at), ks.flatMap((k, i) => (k === 'face' ? [] : [i])), `${row.id}: observable`);
    for (const o of row.observable) {
      assert.equal(o.reports.length, { rotation: 0, wide: 1, slice: 2 }[o.kind], `${row.id}: ${o.token} reports ${o.reports.join(' ')}`);
    }
  }
});

test('L2: the case is the state the algorithm solves — played by cubejs from a cube held white underneath', () => {
  // The hold every source declares is the method frame. cubejs's `x2` tumbles a solved cube to exactly that
  // hold — its top and front centres are the scan frame's D and B — which this asserts rather than assumes.
  const tumbled = played('x2').asString();
  assert.deepEqual([tumbled[4], tumbled[22]], [...METHOD_FRAME], 'x2 is not the method frame');
  for (const s of Object.values(ALG_SOURCES)) assert.deepEqual([...s.hold], [...METHOD_FRAME]);
  for (const row of ROWS) {
    const c = new Cube();
    c.move('x2');
    c.move(inverted(row.alg));
    assert.equal(row.solves.facelets, c.asString(), `${row.id}: the case picture is not cubejs's`);
    c.move(forCubejs(row.alg));
    assert.equal(c.asString(), tumbled, `${row.id}: the algorithm does not solve its own case`);
    assert.equal(row.solves.picture.startsWith('top'), keptByCubejs(row.alg).has('first-two-layers'),
      `${row.id}: a top-face picture is drawn exactly when the algorithm keeps the first two layers`);
    const human = HUMAN_ALGS.find((h) => h.name === row.id);
    if (human) assert.equal(row.solves.case, human.case);
  }
});

test('L2: the effect, the regions kept and the order — re-derived by cubejs', () => {
  assert.deepEqual(CORNERS, ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'], 'cubejs\'s corner order');
  assert.deepEqual(EDGES, ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'], 'cubejs\'s edge order');
  const asSets = (cycles) => cycles.map((c) => `${[...c.positions].sort().join(' ')}/${c.turn ? 1 : 0}`).sort();
  for (const row of ROWS) {
    const e = cubejsEffect(row.alg);
    assert.deepEqual(asSets(row.effect.cornerCycles), asSets(e.corners.cycles), `${row.id}: corner cycles`);
    assert.deepEqual(asSets(row.effect.edgeCycles), asSets(e.edges.cycles), `${row.id}: edge cycles`);
    assert.deepEqual(row.effect.twistedInPlace.map((p) => p.position).sort(), [...e.corners.inPlace].sort(), `${row.id}: twisted`);
    assert.deepEqual(row.effect.flippedInPlace.map((p) => p.position).sort(), [...e.edges.inPlace].sort(), `${row.id}: flipped`);
    assert.equal(row.effect.keepsHold, e.centres.every((v, i) => v === i), `${row.id}: the hold`);
    const kept = keptByCubejs(row.alg);
    for (const r of Object.keys(cells)) assert.equal(row.keeps.includes(r), kept.has(r), `${row.id}: keeps ${r}`);
    // The order: the fewest repeats cubejs needs to bring the cube back, counted here one at a time.
    const c = new Cube();
    let n = 0;
    do { c.move(forCubejs(row.alg)); n += 1; } while (!c.isSolved() && n <= row.order);
    assert.equal(n, row.order, `${row.id}: cubejs comes back after ${n} repeats, the row says ${row.order}`);
  }
});

test('L2: same moves, inverses and mirrors — strings for the first, cubejs states for the other two', () => {
  const norm = (alg) => tokens(alg).map((m) => m.replace("2'", '2')).join(' ');
  const solvedString = new Cube().asString();
  // The mirror is checked on every row, not only where a mirrored row exists: cubejs's picture of the mirrored
  // moves must be the reflection of the original's. This is what decides that M and x keep their direction.
  for (const row of ROWS) {
    assert.equal(played(mirrorAlg(row.alg)).asString(), reflect(played(row.alg).asString()), `${row.id}: mirrorAlg is not the mirror`);
  }
  const normed = new Map(ROWS.map((o) => [o.id, norm(o.alg)]));
  const holding = (moves, self) => ROWS.filter((o) => o.id !== self && normed.get(o.id) === moves).map((o) => o.id);
  for (const row of ROWS) {
    assert.deepEqual([...row.sameAs].sort(), holding(normed.get(row.id), row.id).sort(), `${row.id}: sameAs`);
    assert.deepEqual([...row.inverseOf].sort(), holding(norm(inverted(row.alg)), row.id).sort(), `${row.id}: inverseOf`);
    for (const id of row.inverseOf) assert.equal(played(row.alg, BY_ID.get(id).alg).asString(), solvedString, `${row.id} then ${id} is not the identity`);
    const mir = holding(norm(mirrorAlg(row.alg)), row.id);
    assert.deepEqual([...row.mirrorOf].sort(), mir.sort(), `${row.id}: mirrorOf`);
    for (const id of row.mirrorOf) {
      assert.equal(played(BY_ID.get(id).alg).asString(), reflect(played(row.alg).asString()), `${id} is not ${row.id}'s mirror`);
    }
  }
  // Something to compare: the relations are not vacuous on this data.
  assert.ok(ROWS.some((r) => r.sameAs.length) && ROWS.some((r) => r.inverseOf.length) && ROWS.some((r) => r.mirrorOf.length));
});

test('the mirror of a slice and of a turn about the left-right axis keeps its direction; every other flips', () => {
  assert.equal(mirrorAlg("R U R' U'"), "L' U' L U");
  assert.equal(mirrorAlg("M2 U M U2 M' U M2"), "M2 U' M U2 M' U' M2");
  assert.equal(mirrorAlg("x y' z r l' E S"), "x y z' l' r E' S'");
  for (const tok of ['R', 'L', 'U', 'D', 'F', 'B', 'M', 'E', 'S', 'r', 'l', 'u', 'd', 'f', 'b', 'x', 'y', 'z']) {
    for (const amount of ['', "'", '2']) {
      const alg = `${tok}${amount}`;
      assert.equal(played(mirrorAlg(alg)).asString(), reflect(played(alg).asString()), `mirror of ${alg}`);
    }
  }
});

test('chunks are the sourced triggers, found wherever they occur, and nothing else', () => {
  for (const row of ROWS) {
    const toks = tokens(row.alg);
    for (const ch of row.chunks) {
      const tr = TRIGGERS.find((x) => x.id === ch.trigger);
      assert.equal(toks.slice(ch.from, ch.to).join(' '), tr.alg, `${row.id}: chunk ${ch.trigger} is not its trigger`);
    }
    // Every occurrence a left-to-right reading finds is marked, scanned here without the library.
    let i = 0; const want = [];
    while (i < toks.length) {
      const hit = TRIGGERS.find((tr) => tokens(tr.alg).every((m, k) => toks[i + k] === m));
      if (hit) { want.push(`${hit.id}@${i}`); i += tokens(hit.alg).length; } else i += 1;
    }
    assert.deepEqual(row.chunks.map((c) => `${c.trigger}@${c.from}`), want, `${row.id}: chunks`);
  }
  assert.ok(ROWS.some((r) => r.chunks.length), 'no row has a trigger in it, so the chunk column checks nothing');
});

test('every row\'s sentence is true of what cubejs finds, and says everything it must', () => {
  for (const row of ROWS) {
    try {
      checkSays(row);
    } catch (err) {
      err.message = `${row.id} ("${row.alg}") says "${row.says}": ${err.message}`;
      throw err;
    }
  }
  // Each of the three shapes is in use, so the check above is not reading only one of them.
  assert.ok(ROWS.some((r) => r.says.startsWith('Turns the top colour up')));
  assert.ok(ROWS.some((r) => r.says.startsWith('Puts ')));
  assert.ok(ROWS.some((r) => /^(Swaps|Cycles)/.test(r.says)));
});

test('a deliberately wrong sentence is caught — each kind of claim', () => {
  const wrong = (id, from, to) => {
    const row = BY_ID.get(id);
    assert.ok(row.says.includes(from), `${id} no longer says "${from}" — pick another example`);
    return { ...row, says: row.says.replace(from, to) };
  };
  const tPerm = BY_ID.get('pll-T');
  assert.doesNotThrow(() => checkSays(tPerm));
  assert.throws(() => checkSays(wrong('pll-T', 'Swaps two top corners', 'Cycles three top corners')), /cubejs finds cycles/);
  assert.throws(() => checkSays(wrong('pll-T', 'Swaps two top corners and swaps two top edges', 'Swaps two top corners')), /leaves out moved edges/);
  assert.throws(() => checkSays(wrong('pll-T', '; keeps the first two layers', '')), /does not say so/);
  assert.throws(() => checkSays(wrong('sune', 'three corners', 'two corners')), /stickers turned up/);
  const insert = ROWS.find((r) => r.says.startsWith('Puts the bottom front-right corner and the front-right edge'));
  assert.throws(() => checkSays({ ...insert, says: insert.says.replace('the front-right edge', 'the front-left edge') }), /puts in place/);
  assert.throws(() => checkSays({ ...insert, says: insert.says.replace('keeps the cross', 'keeps the first two layers') }), /cubejs finds it broken/);
  assert.throws(() => checkSays({ ...insert, says: insert.says.replace(/ and moves \w+ top pieces/, '') }), /top pieces moved/);
});

test('rows for a set and for a method are the library\'s rows, and every method stage names its rows', async () => {
  const entries = await loadEntries();
  for (const set of ALG_SETS.filter((s) => s.kind !== 'not an algorithm')) {
    const rows = await setRows(set.id);
    assert.deepEqual(rows.map((r) => r.id), entries.get(set.id).map((e) => e.name), set.id);
    assert.ok(rows.every((r) => r.set === set.id));
  }
  await assert.rejects(setRows('align'), /not an algorithm set/);
  await assert.rejects(algRow('no-such-row'), /no algorithm/);
  for (const m of METHOD_SETS) {
    const rows = await rowsForMethod(m.id);
    const sets = new Set(m.phases.flatMap((p) => p.held ?? []));
    assert.deepEqual([...new Set(rows.map((r) => r.set))].sort(), [...sets].sort(), m.id);
    for (const r of rows) assert.ok(r.methods.some((x) => x.method === m.id), `${r.id} is in ${m.id}'s rows and does not name it`);
  }
  // A row's `methods` is exactly the stages whose sets hold it: the oracle is taught by none.
  for (const row of ROWS) {
    const want = METHOD_SETS.flatMap((m) => m.phases.filter((p) => (p.held ?? []).includes(row.set)).map((p) => ({ method: m.id, stage: p.stage })));
    assert.deepEqual(row.methods, want, row.id);
  }
  assert.ok(ROWS.filter((r) => ALG_SETS.find((s) => s.id === r.set).kind === 'proved').every((r) => r.methods.length === 0));
  assert.deepEqual(await algIds(), ROWS.map((r) => r.id));
});

test('importing the library builds no repertoire and reads no pending source; a row read later reads none either', () => {
  // ASKED OF NODE, never read off the source (AGENTS.md §5): a resolve hook prints every module the import
  // loads. The method modules build their repertoires as they load (last-layer.js took 150 ms, 2026-10-17),
  // which is what a UI-thread import must not pay; they load when a row is first asked for.
  const lib = new URL('../lib/', import.meta.url).href;
  const loadedBy = (body) => {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { registerHooks } from 'node:module';
      registerHooks({ resolve(specifier, context, next) { const r = next(specifier, context); process.stdout.write(r.url + '\\n'); return r; } });
      ${body}
    `], { encoding: 'utf8' });
    return new Set(out.split('\n').filter((u) => u.startsWith(lib)).map((u) => u.slice(lib.length)));
  };
  const library = JSON.stringify(new URL('../lib/alg-library.js', import.meta.url).href);
  const atImport = loadedBy(`await import(${library});`);
  for (const heavy of ['methods/cross.js', 'methods/pairs.js', 'methods/last-layer.js', 'methods/index.js']) {
    assert.ok(!atImport.has(heavy), `importing the library loaded ${heavy}`);
  }
  const afterRows = loadedBy(`const L = await import(${library}); for (const id of await L.algIds()) await L.algRow(id);`);
  assert.ok(afterRows.has('methods/last-layer.js'), 'reading every row never loaded the method modules, so the hook saw nothing');
  for (const p of PENDING_SOURCES) assert.ok(!afterRows.has(p.module.slice('lib/'.length)), `${p.module} is pending and was read`);
});

test('a pending source stays pending only while it is uncommitted', (t) => {
  // The day another session commits Mehta or corners-first, this fails: the ledger must then read it, and a
  // source left in PENDING_SOURCES after it is committed would be a table the ledger silently does not show.
  const repo = new URL('../../../', import.meta.url);
  const tracked = spawnSync('git', ['ls-files', '--', ...PENDING_SOURCES.map((p) => `apps/web/${p.module}`)], { cwd: repo, encoding: 'utf8' });
  if (tracked.status !== 0) { t.skip(`git is not available here (${tracked.error?.message ?? tracked.stderr}), so whether they are committed is unchecked`); return; }
  assert.equal(tracked.stdout.trim(), '', `committed, and still listed as pending: ${tracked.stdout.trim()}`);
  assert.deepEqual(PENDING_SOURCES.map((p) => p.id), ['mehta-algs', 'corners-first-algs']);
});

test('importing the generator prints nothing and writes nothing; run directly, it reports', () => {
  // The guard compares the RESOLVED path of argv[1], as bench/algorithm-ledger.mjs's does: an importer whose
  // name merely ends the same way must not print the report or arm --emit.
  const dir = mkdtempSync(join(tmpdir(), 'alg-ledger-import-'));
  try {
    const importer = join(dir, 'unrelated-alg-ledger.mjs');
    writeFileSync(importer, `import ${JSON.stringify(new URL('../bench/alg-ledger.mjs', import.meta.url).href)};\n`);
    const ran = spawnSync(process.execPath, [importer, '--emit'], { encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(ran.stdout, '', 'an import printed the report');
    const direct = spawnSync(process.execPath, [new URL('../bench/alg-ledger.mjs', import.meta.url).pathname], { encoding: 'utf8' });
    assert.equal(direct.status, 0, direct.stderr);
    assert.match(direct.stdout, /309 rows/);
    assert.doesNotMatch(direct.stdout, /wrote /, 'without --emit it wrote a file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
