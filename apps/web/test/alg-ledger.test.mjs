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
  mirrorAlg, observableOf, rowsForMethod, setRows,
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
  const inPlaceTurns = [];
  for (let s = 0; s < perm.length; s += 1) {
    if (seen.has(s)) continue;
    const slots = [];
    let at = s;
    while (!seen.has(at)) { seen.add(at); slots.push(at); at = perm.indexOf(at); }
    const turn = slots.reduce((n, x) => n + ori[x], 0) % mod;
    if (slots.length === 1) {
      if (turn) { inPlace.push(names[s]); inPlaceTurns.push({ position: names[s], turn }); }
    } else cycles.push({ positions: slots.map((x) => names[x]), turn });
  }
  return { cycles, inPlace, inPlaceTurns };
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
//
// The sentence is about the row's POINT, which its set's `goal` names (the library's data, read here as data);
// everything else it changes must be said as disturbed on the way. Every fact below is cubejs's, every list of
// pieces this file's own.

const WORD = Object.fromEntries(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'].map((w, i) => [w, i]));
const SIDE_LETTER = { top: 'U', bottom: 'D', front: 'F', back: 'B', right: 'R', left: 'L' };
/** "the bottom front-right corner" -> its letters, sorted. */
const positionOf = (words) => {
  const m = /^the (\w+)[ -](\w+)-(\w+) (corner|edge)$/.exec(words) ?? /^the (\w+)-(\w+) (edge)$/.exec(words);
  if (!m) throw new Error(`not a position: "${words}"`);
  return m.slice(1, -1).map((w) => SIDE_LETTER[w]).sort().join('');
};
const sortedLetters = (p) => [...p].sort().join('');
const splitList = (s) => s.split(/, | and /);
const isUp = (p) => p.includes('U');
const pieceKind = (p) => (p.length === 3 ? 'corner' : 'edge');

/** What each stage has built, written here: the cross, then its corners, then the middle edges. */
const BUILT = (() => {
  const cross = ['DF', 'DR', 'DB', 'DL'];
  const layer = [...cross, 'DFR', 'DLF', 'DBL', 'DRB'];
  return { cross, 'first-layer': layer, 'first-two-layers': [...layer, 'FR', 'FL', 'BL', 'BR'] };
})();
const KEEP_WORDS = {
  'keeps the other cross edges': 'cross',
  'keeps the rest of the first layer': 'first-layer',
  'keeps the rest of the first two layers': 'first-two-layers',
};
const SIX_EDGES = ['UF', 'UR', 'UB', 'UL', 'DF', 'DB'];
const COME_BACK = 'mixes the first two layers, which come back once the other top corners are turned up too';

/** Every position cubejs finds changed, sorted letters. */
const changedBy = (e) => [
  ...e.corners.cycles.flatMap((c) => c.positions), ...e.corners.inPlace,
  ...e.edges.cycles.flatMap((c) => c.positions), ...e.edges.inPlace,
].map(sortedLetters);

/** The case's top face from cubejs, white underneath: which top corners and edges do NOT show the top colour. */
function caseNotUp(alg) {
  const c = new Cube();
  c.move('x2');
  if (alg) c.move(inverted(alg));
  const s = c.asString();
  const at = { corner: { 0: 'BLU', 2: 'BRU', 6: 'FLU', 8: 'FRU' }, edge: { 1: 'BU', 3: 'LU', 5: 'RU', 7: 'FU' } };
  const out = {};
  for (const [kind, map] of Object.entries(at)) out[kind] = Object.entries(map).filter(([i]) => s[i] !== s[4]).map(([, p]) => p).sort();
  return out;
}

/** Where, in the case, the piece that belongs at `position` sits — read off cubejs's own permutation of the
 *  algorithm undone on a solved cube. */
function caseSlotOf(alg, position) {
  const j = played(inverted(alg)).toJSON();
  assert.deepEqual(j.center, [0, 1, 2, 3, 4, 5], 'the case is read with the centres home');
  const corner = position.length === 3;
  const names = corner ? CORNERS : EDGES;
  const home = names.findIndex((n) => sortedLetters(n) === sortedLetters(position));
  return names[(corner ? j.cp : j.ep).indexOf(home)];
}

/** Two top positions side by side (sharing a side face), or opposite — computed from their letters here. */
const adjacent = (a, b) => {
  const x = [...a].filter((c) => c !== 'U');
  const y = [...b].filter((c) => c !== 'U');
  if (x.length === 2) return x.some((c) => y.includes(c));
  return !['FB', 'BF', 'RL', 'LR'].includes(x[0] + y[0]);
};

function checkInsert(segs, goal, e) {
  const [point, keep, ...more] = segs;
  assert.ok(more.length <= 1, `"${more.join('; ')}": more clauses than an insert has`);
  const changed = changedBy(e);
  const built = BUILT[goal.region].map(sortedLetters);
  let said;
  let m;
  if ((m = /^Puts the (\w+)-(\w+) corner and edge into their slot$/.exec(point))) {
    const slot = [SIDE_LETTER[m[1]], SIDE_LETTER[m[2]]];
    said = [sortedLetters(['D', ...slot].join('')), sortedLetters(slot.join(''))];
  } else if ((m = /^Puts (.+) in place$/.exec(point))) {
    said = splitList(m[1]).map(positionOf);
  } else {
    assert.fail(`"${point}" is not how an insert says its point`);
  }
  assert.deepEqual(said.sort(), changed.filter((p) => built.includes(p)).sort(),
    'the pieces it says it puts in place are not the built pieces cubejs finds changed');
  // keeps: true of cubejs, and the region the stage has built — a smaller one would be true and say less
  const region = KEEP_WORDS[keep];
  assert.ok(region, `"${keep}" is not a kept region this test reads`);
  const rest = BUILT[region].map(sortedLetters).filter((p) => !said.includes(p));
  for (const p of rest) assert.ok(!changed.includes(p), `says it keeps the rest of ${region}, and cubejs finds ${p} changed`);
  assert.equal(region, goal.region, `says it keeps the rest of ${region}; its stage has built ${goal.region}`);
  // also moves: exactly what it changes outside what is built
  const outside = changed.filter((p) => !built.includes(p));
  const wantTop = outside.some(isUp);
  const wantBelow = outside.filter((p) => !isUp(p)).sort();
  let saidTop = false;
  const saidBelow = [];
  if (more.length) {
    const a = /^also moves (.+)$/.exec(more[0]);
    assert.ok(a, `"${more[0]}" is not an "also moves" clause`);
    for (const item of splitList(a[1])) {
      if (item === 'the top layer') { saidTop = true; continue; }
      const n = /^(\w+) (bottom corners|bottom edges|middle edges)$/.exec(item);
      if (n) {
        const of = wantBelow.filter((p) => ({
          'bottom corners': p.length === 3, 'bottom edges': p.length === 2 && p.includes('D'), 'middle edges': p.length === 2 && !p.includes('D'),
        })[n[2]]);
        assert.equal(WORD[n[1]], of.length, `"${item}": cubejs finds ${of.length}`);
        saidBelow.push(...of);
        continue;
      }
      saidBelow.push(positionOf(item));
    }
  }
  assert.equal(saidTop, wantTop, `the sentence and cubejs disagree on whether the top layer moves`);
  assert.deepEqual(saidBelow.sort(), wantBelow, 'the pieces it says it also moves are not the unbuilt ones cubejs finds changed');
}

const PLACE = /^(swaps two pairs of|swaps two) (side-by-side|diagonally opposite|opposite) top (corners|edges)$|^moves (three|all four) top (corners|edges) round$/;

function checkLastLayer(segs, set, row, e, kept) {
  const { goal } = set;
  const [pointRaw, keep, ...more] = segs;
  assert.ok(keep !== undefined, 'says nothing about what it keeps');
  assert.ok(more.length <= 1, `"${more.join('; ')}": more clauses than a last-layer sentence has`);
  const point = pointRaw.charAt(0).toLowerCase() + pointRaw.slice(1);
  const notUp = caseNotUp(row.alg);
  const cycles = { corner: e.corners.cycles, edge: e.edges.cycles };
  const topCycles = (kind) => cycles[kind].filter((c) => c.positions.some(isUp));
  const orients = goal.does === 'orient' || goal.does === 'solve';
  const places = goal.does === 'permute' || goal.does === 'solve';
  const covered = { corner: { turn: false, place: false }, edge: { turn: false, place: false } };

  // the point: which way its pieces face, then where they go
  const o = /^turns (.+) so the top colour faces up(?:, and (.+))?$/.exec(point);
  const placeText = o ? o[2] : point;
  if (o) {
    const said = { corner: [], edge: [] };
    for (const item of splitList(o[1])) {
      const n = /^(\w+) top (corner|edge)s?$/.exec(item);
      if (n) { said[n[2]].push(...Array(WORD[n[1]]).fill('?')); continue; }
      const p = positionOf(item);
      said[pieceKind(p)].push(p);
    }
    for (const kind of ['corner', 'edge']) {
      if (!said[kind].length) continue;
      assert.ok(orients && goal.kinds.includes(kind), `says which way the top ${kind}s face, which its goal is not about`);
      assert.equal(said[kind].length, notUp[kind].length, `says ${said[kind].length} top ${kind}s turn up; the case has ${notUp[kind].length} facing the wrong way`);
      for (const p of said[kind].filter((x) => x !== '?')) assert.ok(notUp[kind].includes(p), `names ${p}, which faces up in the case`);
      covered[kind].turn = true;
    }
  }
  if (placeText) {
    const byKind = { corner: [], edge: [] };
    for (const clause of splitList(placeText)) {
      const p = PLACE.exec(clause);
      assert.ok(p, `"${clause}" is not a clause this test can check`);
      byKind[(p[3] ?? p[5]).slice(0, -1)].push(p);
    }
    for (const kind of ['corner', 'edge']) {
      if (!byKind[kind].length) continue;
      assert.ok(places && goal.kinds.includes(kind), `says where the top ${kind}s go, which its goal is not about`);
      assert.equal(byKind[kind].length, 1, `two clauses about where the top ${kind}s go`);
      const [, swap, near, , round] = byKind[kind][0];
      const cs = cycles[kind];
      assert.ok(cs.every((c) => c.positions.every(isUp)), `cubejs moves a ${kind} outside the top layer`);
      const lens = cs.map((c) => c.positions.length).sort().join(',');
      if (round) {
        assert.equal(lens, round === 'three' ? '3' : '4', `"${byKind[kind][0][0]}": cubejs finds cycles ${lens}`);
      } else {
        assert.equal(lens, swap === 'swaps two' ? '2' : '2,2', `"${byKind[kind][0][0]}": cubejs finds cycles ${lens}`);
        assert.equal(near === 'side-by-side', adjacent(...cs[0].positions), `"${byKind[kind][0][0]}": cubejs finds ${cs[0].positions.join(' and ')}`);
      }
      covered[kind].place = true;
    }
  }

  // keeps
  const region = set.regions === 'blocks' ? 'both-blocks' : 'first-two-layers';
  if (keep === 'keeps the first two layers' || keep === 'keeps both blocks') {
    const r = keep === 'keeps both blocks' ? 'both-blocks' : 'first-two-layers';
    assert.ok(kept.has(r), `says it keeps ${r}, and cubejs finds it broken`);
    assert.equal(r, region, `names ${r}; its learners build ${region}`);
  } else if (keep === COME_BACK) {
    assert.ok(!kept.has('first-two-layers'), 'says it mixes the first two layers, and cubejs finds them kept');
    // The claim, played: three of it with only the top turned between, or it and its partner the other way.
    const others = ROWS.filter((r) => r.set === row.set && r.id !== row.id && !keptByCubejs(r.alg).has('first-two-layers'));
    assert.ok(others.length, 'no other row in the set turns a corner the other way');
    for (const u of ['U', 'U2', "U'"]) {
      assert.ok(keptByCubejs([row.alg, u, row.alg, u, row.alg].join(' ')).has('first-two-layers'), `three of it, ${u} between, do not bring the first two layers back`);
      assert.ok(others.some((b) => keptByCubejs([row.alg, u, b.alg].join(' ')).has('first-two-layers')), `no partner brings them back after ${u}`);
    }
  } else {
    assert.fail(`"${keep}" is not a keep clause this test reads`);
  }
  if (kept.has(region)) assert.notEqual(keep, COME_BACK);

  // also changes: whatever is changed and is not the point
  if (more.length) {
    const a = /^also changes (.+)$/.exec(more[0]);
    assert.ok(a, `"${more[0]}" is not an "also changes" clause`);
    for (const item of splitList(a[1])) {
      const kinds = { 'the top corners': ['corner'], 'the top edges': ['edge'], 'where the top corners sit': ['corner'], 'where the top edges sit': ['edge'], 'where the top pieces sit': ['corner', 'edge'] }[item];
      if (item === 'some of the six edges left for last') {
        assert.equal(set.regions, 'blocks', 'names the edges Roux leaves for last outside Roux');
        const edges = [...e.edges.cycles.flatMap((c) => c.positions), ...e.edges.inPlace];
        assert.ok(edges.length && edges.every((p) => SIX_EDGES.includes(p)), `cubejs changes edges ${edges.join(' ')}`);
        covered.edge = { turn: true, place: true };
        continue;
      }
      assert.ok(kinds, `"${item}" is not a part this test reads`);
      for (const kind of kinds) {
        if (item.startsWith('where')) {
          assert.ok(topCycles(kind).length, `"${item}": cubejs moves no top ${kind}`);
          assert.ok(!covered[kind].place, `"${item}" repeats what the point said`);
          covered[kind].place = true;
        } else {
          assert.ok(notUp[kind].length, `"${item}": every top ${kind} faces up in the case — say where they sit instead`);
          assert.ok(!goal.kinds.includes(kind), `"${item}": the top ${kind}s are this set's point`);
          covered[kind] = { turn: true, place: true };
        }
      }
    }
  }
  // Nothing on top is changed without being said, and the bottom changes only where a clause says so.
  for (const kind of ['corner', 'edge']) {
    if (notUp[kind].length) assert.ok(covered[kind].turn, `leaves out that top ${kind}s face the wrong way in the case`);
    if (topCycles(kind).length) assert.ok(covered[kind].place, `leaves out that top ${kind}s change places`);
  }
}

/**
 * Every claim in a row's sentence, checked against cubejs. Throws naming the first that is false, or the first
 * fact the sentence leaves out that it must say.
 */
function checkSays(row) {
  const set = ALG_SETS.find((s) => s.id === row.set);
  const says = row.says;
  assert.ok(says.endsWith('.'), 'a sentence ends with a full stop');
  const segments = says.slice(0, -1).split('; ');
  const e = cubejsEffect(row.alg);
  const HELD = 'ends with the cube held differently';
  const centresHome = e.centres.every((v, i) => v === i);
  assert.equal(segments.includes(HELD), !centresHome, 'the sentence and cubejs disagree on whether the hold changes');
  if (segments.includes(HELD)) assert.equal(segments.at(-1), HELD, 'the hold is said last');
  const segs = segments.filter((x) => x !== HELD);
  if (set.goal.does === 'insert') checkInsert(segs, set.goal, e);
  else checkLastLayer(segs, set, row, e, keptByCubejs(row.alg));
}

/**
 * A set's goal, true of every one of its rows by cubejs: what the case has wrong, where those pieces sit, what
 * is already done. Returns nothing; throws naming the row.
 */
function checkGoal(set, rows) {
  const g = set.goal;
  for (const row of rows) {
    const e = cubejsEffect(row.alg);
    const changed = changedBy(e);
    const kept = keptByCubejs(row.alg);
    const notUp = caseNotUp(row.alg);
    const at = `${set.id}/${row.id}`;
    if (g.does === 'insert') {
      const wrong = changed.filter((p) => BUILT[g.region].map(sortedLetters).includes(p));
      const corners = wrong.filter((p) => p.length === 3);
      const edges = wrong.filter((p) => p.length === 2);
      const sameSlot = (c, x) => sortedLetters(c.replace('D', '')) === x;
      if (g.pieces === 'edge') assert.ok(edges.length === 1 && !corners.length, `${at}: the case has ${wrong.join(' ')} wrong, not one edge`);
      if (g.pieces === 'corner') assert.ok(corners.length === 1 && !edges.length, `${at}: the case has ${wrong.join(' ')} wrong, not one corner`);
      if (g.pieces === 'pair') assert.ok(corners.length === 1 && edges.length === 1 && sameSlot(corners[0], edges[0]), `${at}: the case has ${wrong.join(' ')} wrong, not one slot's corner and edge`);
      if (g.pieces === 'slot') {
        assert.ok(wrong.length && corners.length <= 1 && edges.length <= 1, `${at}: the case has ${wrong.join(' ')} wrong`);
        if (corners.length && edges.length) assert.ok(sameSlot(corners[0], edges[0]), `${at}: ${wrong.join(' ')} are two slots' pieces`);
      }
      if (g.from === 'top') for (const p of wrong) assert.ok(isUp(caseSlotOf(row.alg, p)), `${at}: the piece for ${p} is not in the top layer in the case`);
      continue;
    }
    const region = set.regions === 'blocks' ? 'both-blocks' : 'first-two-layers';
    const twisting = g.keepsTopEdges && !kept.has(region);
    assert.ok(kept.has(region) || twisting, `${at}: breaks ${region}`);
    const topChanged = changed.filter(isUp);
    const of = (kind) => topChanged.filter((p) => pieceKind(p) === kind);
    if (g.does === 'orient') assert.ok(g.kinds.some((k) => notUp[k].length), `${at}: every ${g.kinds.join(' and ')} already faces up in the case`);
    if (g.does === 'permute') {
      assert.deepEqual([...notUp.corner, ...notUp.edge], [], `${at}: a permutation case with a top piece facing the wrong way`);
      assert.ok(g.kinds.some((k) => of(k).length), `${at}: moves no top ${g.kinds.join(' or ')}`);
    }
    if (g.does === 'solve') assert.ok(g.kinds.some((k) => of(k).length), `${at}: changes no top ${g.kinds.join(' or ')}`);
    if (g.after === 'edges-up') assert.deepEqual(notUp.edge, [], `${at}: the case's top cross is not made`);
    if (g.after === 'top-up') assert.deepEqual([...notUp.corner, ...notUp.edge], [], `${at}: the case's top face is not one colour`);
    if (g.after === 'corners-done') assert.deepEqual(of('corner'), [], `${at}: the case's top corners are not done`);
    if (g.keepsTopEdges) assert.deepEqual(of('edge'), [], `${at}: moves a top edge`);
  }
}

/**
 * The purpose's WORDS say what the goal says, and do not say what it does not. Written here, from the goal, so
 * a purpose edited out of step with its goal — or a goal changed under its words — fails.
 */
function checkPurposeWords(set) {
  const { purpose: p, goal: g } = set;
  const has = (re, why) => assert.match(p, re, `${set.id}: "${p}" ${why}`);
  const hasNot = (re, why) => assert.doesNotMatch(p, re, `${set.id}: "${p}" ${why}`);
  assert.match(p, /^[A-Z][^.]*\.$/, `${set.id}: a purpose is one sentence`);
  hasNot(/\b(OLL|PLL|CMLL|F2L|AUF|permut\w*|orient\w*)\b/i, 'uses a word a learner has not been taught');
  if (g.does === 'insert') {
    const region = { cross: /\bbottom cross\b/, 'first-layer': /\bfirst layer\b/ }[g.region]
      ?? (g.pieces === 'edge' ? /\bmiddle layer\b/ : /\bfirst two layers\b/);
    has(region, `does not name the ${g.region}`);
    if (g.pieces === 'edge') { has(/\bone edge\b/, 'does not say one edge'); hasNot(/corner/, 'names a corner the goal does not move'); }
    if (g.pieces === 'corner') { has(/\bone corner\b/, 'does not say one corner'); hasNot(/\bedge/, 'names an edge the goal does not place'); }
    if (g.pieces === 'pair' || g.pieces === 'slot') has(/\ba corner and its edge\b.*\bone slot\b/, 'does not say a corner and its edge into one slot');
    if (g.pieces === 'pair') has(/\btogether\b/, 'does not say the two go in together');
    if (g.from === 'top') has(/\bfrom the top layer\b/, 'does not say where the piece comes from');
    else hasNot(/\bfrom the top\b/, 'says the pieces come from the top, which the goal does not promise');
    hasNot(/faces up/, 'talks about which way the top faces');
    return;
  }
  hasNot(/\bfrom the top layer\b/, 'speaks of an insert');
  // What the set does, without the "Once …," that says what is already done before it starts.
  const does = p.replace(/^Once [^,]+, /, '');
  const doesHas = (re, why) => assert.match(does, re, `${set.id}: "${p}" ${why}`);
  const doesNot = (re, why) => assert.doesNotMatch(does, re, `${set.id}: "${p}" ${why}`);
  const kinds = g.kinds.join('+');
  if (kinds === 'corner+edge') doesHas(/\bevery top piece\b/, 'does not say every top piece');
  if (kinds === 'corner') { doesHas(/\bcorners\b/, 'does not name the corners'); if (!g.keepsTopEdges) doesNot(/\bedges?\b/, 'names edges its goal is not about'); }
  if (kinds === 'edge') { doesHas(/\bedges\b/, 'does not name the edges'); doesNot(/\bcorners?\b/, 'names corners its goal is not about'); }
  if (g.does === 'orient' || g.does === 'solve') has(/faces? up|which way they face|one colour/, 'does not say which way they face');
  if (g.does === 'orient') doesNot(/where (it|they) (belongs?|go)/, 'promises places an orientation goal does not give');
  if (g.does === 'permute' || g.does === 'solve') doesHas(/where (it|they) (belongs?|go)/, 'does not say where they go');
  if (g.does === 'permute') doesNot(/faces? up|which way|one colour/, 'promises turning a permutation goal does not do');
  if (g.after === 'edges-up') has(/\bcross on top is made\b/, 'does not say it starts once the cross on top is made');
  if (g.after === 'top-up') has(/\btop face is one colour\b/, 'does not say it starts once the top face is one colour');
  if (g.after === 'corners-done') has(/\bcorners are where they belong\b/, 'does not say it starts once the corners are done');
  if (!g.after) hasNot(/^Once\b/, 'says it waits for something its goal does not');
  if (g.keepsTopEdges) has(/\btop edges where they are\b/, 'does not say the top edges stay');
  if (set.regions === 'blocks') has(/\bblocks\b/, 'does not say it keeps the blocks');
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
    assert.deepEqual(reportsOf(row.observable), reportsByCubejs(row.alg), `${row.id}: the faces a smart cube reports`);
  }
});

// ---- what a smart cube reports, read off cubejs's centres ---------------------------------------------------

/** The outer faces a token turns relative to the centres, named by where they are in the CHILD's hold, by this
 *  file's own table: a slice turns the whole cube and its two outer faces back (M = R L' x'), a wide turn the
 *  whole cube and its far face back (r = L x), a rotation nothing. */
const WORLD_REPORTS = {
  M: ['R', "L'"], E: ['U', "D'"], S: ["F'", 'B'],
  r: ['L'], l: ['R'], u: ['D'], d: ['U'], f: ['B'], b: ['F'],
};
const withAmount = (turn, amount) => {
  if (amount.startsWith('2')) return `${turn[0]}2`;
  if (amount !== "'") return turn;
  return turn.endsWith("'") ? turn[0] : `${turn}'`;
};
/** Positions of the six centres in cubejs's facelet string, by the side of the CHILD's hold they are on. */
const CENTRE_AT = { U: 4, R: 13, F: 22, D: 31, L: 40, B: 49 };

/**
 * Every token that is not a face turn, with the faces a smart cube reports for it — named by the CUBE's own
 * faces, which are the letters' faces at the start. cubejs carries the centres round with every rotation,
 * slice and wide turn before the token, so the centre now on the child's right IS the cube face a right-side
 * turn reports.
 */
function reportsByCubejs(alg) {
  const toks = tokens(alg);
  return toks.flatMap((tok, at) => {
    if (kindOf(tok) === 'face') return [];
    const read = /^([MESrludfbxyz])w?(2'|2|'|)$/.exec(tok.replace(/^([RLUDFB])w/, (_, f) => f.toLowerCase()));
    assert.ok(read, `the oracle cannot read "${tok}"`);
    const [, letter, amount] = read;
    const centres = played(toks.slice(0, at).join(' ')).asString();
    const cubeFace = (world) => centres[CENTRE_AT[world]];
    const reports = (WORLD_REPORTS[letter] ?? []).map((t) => withAmount(`${cubeFace(t[0])}${t.slice(1)}`, amount));
    return [`${at}:${reports.sort().join(' ')}`];
  });
}
const reportsOf = (observable) => observable.map((o) => `${o.at}:${[...o.reports].sort().join(' ')}`);

test('a smart cube\'s reports are named by the cube\'s own faces, after every turn of the hold before them', () => {
  // No ledger row puts a slice, wide turn or rotation after a hold change it has not undone, so the rows alone
  // would pass a reading that ignores the hold. These do: after `y` the child's M is a slice of the cube's
  // front and back.
  assert.deepEqual(observableOf("y M y'")[1].reports, ["F'", 'B']);
  for (const alg of ["y M y'", "x E x'", 'z S', "y2 M2 y2", 'r M', "u S'", "x' r'", "M' U M y E'", "z' u2 b"]) {
    assert.deepEqual(reportsOf(observableOf(alg)), reportsByCubejs(alg), alg);
  }
  // The oracle is not vacuous: in the starting hold it agrees with the token's own faces.
  assert.deepEqual(reportsByCubejs("M r' y"), ["0:L' R", "1:L'", '2:']);
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

/** A cycle list as comparable strings: each cycle as where every piece GOES (`UR>UB` — the piece at UR moves
 *  to UB), so a cycle read the other way round is a different cycle wherever it starts, and the EXACT net turn
 *  — a corner's twist is 0, 1 or 2 and an edge's flip 0 or 1, so a twist one way is never read as the other. */
const asSets = (cycles) => cycles.map((c) => {
  const n = c.positions.length;
  return `${c.positions.map((p, i) => `${p}>${c.positions[(i + 1) % n]}`).sort().join(' ')}/${c.turn}`;
}).sort();
const inPlaceOf = (list) => list.map((p) => `${p.position}/${p.turn}`).sort();

/** One row's effect against cubejs's: the cycles, the twists and flips in place (each with its amount), the
 *  hold it ends in, the regions kept and the order. Throws on the first disagreement. */
function checkEffect(row) {
  const e = cubejsEffect(row.alg);
  assert.deepEqual(asSets(row.effect.cornerCycles), asSets(e.corners.cycles), `${row.id}: corner cycles`);
  assert.deepEqual(asSets(row.effect.edgeCycles), asSets(e.edges.cycles), `${row.id}: edge cycles`);
  assert.deepEqual(inPlaceOf(row.effect.twistedInPlace), inPlaceOf(e.corners.inPlaceTurns), `${row.id}: twisted`);
  assert.deepEqual(inPlaceOf(row.effect.flippedInPlace), inPlaceOf(e.edges.inPlaceTurns), `${row.id}: flipped`);
  assert.equal(row.effect.keepsHold, e.centres.every((v, i) => v === i), `${row.id}: the hold`);
  // The hold it ends in, read from the hold it is declared in: cubejs tumbles a solved cube to the method frame
  // (`x2`, asserted in the case test) and plays the algorithm; the centres then on top and in front name the
  // end hold in the scan frame's letters. A row that keeps the hold ends exactly where it began.
  const after = played('x2', row.alg).asString();
  assert.deepEqual(row.effect.endHold, [after[4], after[22]], `${row.id}: the hold it ends in`);
  if (row.effect.keepsHold) assert.deepEqual(row.effect.endHold, row.hold, `${row.id}: keeps the hold, yet ends in another`);
  const kept = keptByCubejs(row.alg);
  for (const r of Object.keys(cells)) assert.equal(row.keeps.includes(r), kept.has(r), `${row.id}: keeps ${r}`);
  // The order: the fewest repeats cubejs needs to bring the cube back, counted here one at a time.
  const c = new Cube();
  let n = 0;
  do { c.move(forCubejs(row.alg)); n += 1; } while (!c.isSolved() && n <= row.order);
  assert.equal(n, row.order, `${row.id}: cubejs comes back after ${n} repeats, the row says ${row.order}`);
}

test('L2: the effect, the regions kept and the order — re-derived by cubejs', () => {
  assert.deepEqual(CORNERS, ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'], 'cubejs\'s corner order');
  assert.deepEqual(EDGES, ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'], 'cubejs\'s edge order');
  for (const row of ROWS) checkEffect(row);
  // Something to compare: a twist amount and a turned hold are both checked on data that has them.
  assert.ok(ROWS.some((r) => r.effect.cornerCycles.some((c) => c.turn === 1)) && ROWS.some((r) => r.effect.cornerCycles.some((c) => c.turn === 2)),
    'no row has a corner cycle twisted each way, so the amounts check nothing');
  assert.ok(ROWS.some((r) => r.effect.twistedInPlace.length), 'no row twists a corner in place');
});

test('a corner twist read the wrong way round, a cycle run backwards, or a hold the row does not end in, is caught', () => {
  const swap = (turn) => (turn === 0 ? 0 : 3 - turn);
  const withEffect = (row, effect) => ({ ...row, effect: { ...row.effect, ...effect } });
  // flip-in moves two pairs of corners, one pair gathering a twist each way: swapped, every position is right
  // and only the amounts are wrong.
  const flipIn = BY_ID.get('flip-in');
  assert.ok(new Set(flipIn.effect.cornerCycles.map((c) => c.turn)).size === 2, 'flip-in no longer twists its two cycles opposite ways');
  const swapped = withEffect(flipIn, { cornerCycles: flipIn.effect.cornerCycles.map((c) => ({ ...c, turn: swap(c.turn) })) });
  assert.throws(() => checkEffect(swapped), /flip-in: corner cycles/);
  // A corner twisted in place, its amount swapped.
  const twister = ROWS.find((r) => r.effect.twistedInPlace.length);
  const turnedBack = withEffect(twister, { twistedInPlace: twister.effect.twistedInPlace.map((p) => ({ ...p, turn: swap(p.turn) })) });
  assert.throws(() => checkEffect(turnedBack), new RegExp(`${twister.id}: twisted`));
  // A cycle read the other way round: every position right, every piece sent where it came from.
  const sune = BY_ID.get('sune');
  const backwards = withEffect(sune, { edgeCycles: sune.effect.edgeCycles.map((c) => ({ ...c, positions: [...c.positions].reverse() })) });
  assert.throws(() => checkEffect(backwards), /sune: edge cycles/);
  // The same cycle started elsewhere is the same cycle.
  const turnedRound = withEffect(sune, { edgeCycles: sune.effect.edgeCycles.map((c) => ({ ...c, positions: [...c.positions.slice(1), c.positions[0]] })) });
  checkEffect(turnedRound);
  // The hold: a row that keeps it must end in its declared hold, never the letters' own [U, F].
  assert.throws(() => checkEffect(withEffect(sune, { endHold: ['U', 'F'] })), /sune: the hold it ends in/);
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

test('every row carries its set\'s purpose, and every purpose is true of every row and says only what its goal says', () => {
  for (const set of ALG_SETS.filter((s) => s.kind !== 'not an algorithm')) {
    const rows = ROWS.filter((r) => r.set === set.id);
    assert.ok(rows.length, `${set.id} has no rows to hold its purpose to`);
    for (const r of rows) assert.equal(r.purpose, set.purpose, `${r.id}: its purpose is not its set's`);
    checkPurposeWords(set);
    checkGoal(set, rows);
  }
  // What must NOT be claimed, shown to be false on this data: some F2L case already has a piece in its slot,
  // which is why those purposes do not say "from the top layer"; and a course row that makes the top cross is
  // not the one that places its edges.
  const inSlot = ROWS.filter((r) => r.set === 'f2l-human').some((r) => changedBy(cubejsEffect(r.alg))
    .filter((p) => ['DFR', 'FR'].includes(p)).some((p) => !isUp(caseSlotOf(r.alg, p))));
  assert.ok(inSlot, 'every human F2L case starts from the top layer — the purpose could say so');
  const course = ROWS.filter((r) => r.set === 'course-edges').map((r) => caseNotUp(r.alg).edge.length > 0);
  assert.ok(course.includes(true) && course.includes(false), 'the course\'s edge rows no longer split into "make the cross" and "place the edges"');
  const corners = ROWS.filter((r) => r.set === 'course-corners').map((r) => keptByCubejs(r.alg).has('first-two-layers'));
  assert.ok(corners.includes(true) && corners.includes(false), 'the course\'s corner rows no longer split into "move" and "turn"');
});

test('a slot set\'s purpose promises only the cases its rows can solve: a piece in another slot is taken out first', () => {
  // cubejs: each row moves the top layer and one slot's corner and edge, and nothing else — no centre, no piece of
  // another slot. A piece that starts in another slot is where it was after the row, and after any turn of the top
  // before it, so no row of the set solves that case: the purpose may not say "wherever the pieces start".
  const sets = ALG_SETS.filter((s) => s.goal?.pieces === 'slot');
  assert.deepEqual(sets.map((s) => s.id).sort(), ['f2l-full', 'f2l-human'], 'the slot sets are not the two F2L sets');
  for (const set of sets) {
    const slots = new Set();
    for (const r of ROWS.filter((x) => x.set === set.id)) {
      const e = cubejsEffect(r.alg);
      assert.deepEqual(e.centres, [0, 1, 2, 3, 4, 5], `${r.id}: turns a centre`);
      const below = changedBy(e).filter((p) => !isUp(p));
      const edges = below.filter((p) => p.length === 2);
      const corners = below.filter((p) => p.length === 3);
      assert.ok(edges.length <= 1 && corners.length <= 1, `${r.id}: moves ${below.join(', ')} below the top layer`);
      const slot = edges[0] ?? corners[0].replace('D', '');
      if (corners.length) assert.equal(corners[0], sortedLetters(`D${slot}`), `${r.id}: moves a corner and an edge of two slots`);
      slots.add(slot);
    }
    assert.equal(slots.size, 1, `${set.id}: its rows fill ${[...slots].join(' and ')}`);
    assert.doesNotMatch(set.purpose, /\b(wherever|any)\b/, `${set.id}: "${set.purpose}" promises cases with a piece in another slot`);
    assert.match(set.purpose, /\btop layer\b.*\bthat slot\b/, `${set.id}: "${set.purpose}" does not say where the two pieces must start`);
    assert.match(set.purpose, /\banother slot\b.*\btaken out first\b/, `${set.id}: "${set.purpose}" does not say a piece in another slot is taken out first`);
  }
});

test('a purpose out of step with its goal is caught — the words and the rows both', () => {
  const set = (id) => ALG_SETS.find((s) => s.id === id);
  const reworded = (id, purpose) => ({ ...set(id), purpose });
  const regoaled = (id, goal) => ({ ...set(id), goal: { ...set(id).goal, ...goal } });
  assert.throws(() => checkPurposeWords(reworded('cross-inserts', 'Brings one corner of the bottom cross down from the top layer.')), /one edge/);
  assert.throws(() => checkPurposeWords(reworded('f2l-human', 'Brings a corner and its edge down from the top layer into one slot of the first two layers.')), /come from the top/);
  assert.throws(() => checkPurposeWords(reworded('eoll', 'Turns the top edges and corners so the top colour faces up.')), /corners its goal is not about/);
  assert.throws(() => checkPurposeWords(reworded('cpll', 'Once the top face is one colour, turns the top corners so they face up and where they belong.')), /promises turning/);
  assert.throws(() => checkPurposeWords(reworded('pll-human', 'Moves every top piece to where it belongs with one PLL.')), /not been taught|one colour/);
  // the goal held to the rows: a pair where the data has a single piece, a top-layer start the data refutes,
  // a precondition the cases do not meet
  const rows = (id) => ROWS.filter((r) => r.set === id);
  assert.throws(() => checkGoal(regoaled('middle-inserts', { pieces: 'pair' }), rows('middle-inserts')), /not one slot's corner and edge/);
  assert.throws(() => checkGoal(regoaled('f2l-human', { from: 'top' }), rows('f2l-human')), /not in the top layer in the case/);
  assert.throws(() => checkGoal(regoaled('eoll', { after: 'edges-up' }), rows('eoll')), /top cross is not made/);
  assert.throws(() => checkGoal(regoaled('epll', { kinds: ['corner'] }), rows('epll')), /moves no top corner/);
  assert.throws(() => checkGoal(regoaled('cpll', { after: 'corners-done' }), rows('cpll')), /top corners are not done/);
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
  // Each shape is in use, so the check above is not reading only one of them.
  for (const shape of [/^Puts .+ in place;/, /^Puts the \S+ corner and edge into their slot;/, /^Turns .+ so the top colour faces up;/,
    /^Turns .+ so the top colour faces up, and /, /^Swaps two side-by-side/, /diagonally opposite/, /swaps two pairs of/i, /round;/,
    /; also moves /, /; also changes /, /; keeps both blocks/, /which come back/]) {
    assert.ok(ROWS.some((r) => shape.test(r.says)), `no row's sentence has the shape ${shape}`);
  }
  // The bare count — "moves four corners" — that said nothing about where they go is gone.
  assert.ok(!ROWS.some((r) => /\bmoves (two|three|four|five|six|seven|eight) (top )?(corners|edges)\b(?! round)/.test(r.says)), 'a sentence fell back to a bare count');
});

test('a deliberately wrong sentence is caught — each kind of claim', () => {
  const wrong = (id, from, to) => {
    const row = BY_ID.get(id);
    assert.ok(row.says.includes(from), `${id} no longer says "${from}" — pick another example`);
    return { ...row, says: row.says.replace(from, to) };
  };
  for (const id of ['pll-T', 'sune', 'right-hand', 'right', 'edge-orient', 'course-corner-twist', 'cmll-h-columns', 'drop-in']) {
    assert.doesNotThrow(() => checkSays(BY_ID.get(id)), id);
  }
  // last layer: shape, side, a part left out, the keep, a count, a named piece, the incidental part
  assert.throws(() => checkSays(wrong('pll-T', 'Swaps two side-by-side top corners', 'Moves three top corners round')), /cubejs finds cycles/);
  assert.throws(() => checkSays(wrong('pll-T', 'side-by-side top corners', 'diagonally opposite top corners')), /cubejs finds/);
  assert.throws(() => checkSays(wrong('pll-T', ' and swaps two opposite top edges', '')), /leaves out that top edges change places/);
  assert.throws(() => checkSays(wrong('pll-T', '; keeps the first two layers', '')), /says nothing about what it keeps/);
  assert.throws(() => checkSays(wrong('sune', 'three top corners', 'two top corners')), /the case has 3/);
  assert.throws(() => checkSays(wrong('sune', '; also changes where the top pieces sit', '')), /leaves out/);
  assert.throws(() => checkSays(wrong('edge-orient', 'the top corners and ', '')), /leaves out that top corners face the wrong way/);
  assert.throws(() => checkSays(wrong('course-corner-twist', 'the top front-right corner', 'the top front-left corner')), /faces up in the case/);
  assert.throws(() => checkSays(wrong('cmll-h-columns', '; also changes some of the six edges left for last', '')), /leaves out/);
  assert.throws(() => checkSays(wrong('cmll-h-columns', 'keeps both blocks', 'keeps the first two layers')), /cubejs finds it broken|its learners build/);
  // the come-back claim, on moves for which it is false: R' D' R D once — three of it are not nothing
  const twist = BY_ID.get('course-corner-twist');
  assert.throws(() => checkSays({ ...twist, alg: "R' D' R D" }), /do not bring the first two layers back/);
  // inserts: the point, the slot, the keep, the incidental part
  assert.throws(() => checkSays(wrong('right-hand', 'the bottom front-right corner in place', 'the bottom front-left corner in place')), /built pieces cubejs finds changed/);
  assert.throws(() => checkSays(wrong('right-hand', 'keeps the rest of the first layer', 'keeps the rest of the first two layers')), /cubejs finds FR changed/);
  assert.throws(() => checkSays(wrong('right-hand', 'keeps the rest of the first layer', 'keeps the other cross edges')), /its stage has built first-layer/);
  assert.throws(() => checkSays(wrong('right-hand', '; also moves the top layer and the front-right edge', '')), /top layer moves/);
  assert.throws(() => checkSays(wrong('right-hand', 'and the front-right edge', 'and the front-left edge')), /unbuilt ones/);
  assert.throws(() => checkSays(wrong('right', 'the front-right corner and edge', 'the front-left corner and edge')), /built pieces cubejs finds changed/);
  assert.throws(() => checkSays(wrong('drop-in', 'two bottom corners', 'one bottom corners')), /cubejs finds 2/);
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

test('a source that failed to load is not remembered: the next ask loads it again and answers', () => {
  // A transient failure — one module fetch that did not arrive — must not poison the library for the life of
  // the thread that holds it: the promise of the entries, and of the index built on them, is dropped when it
  // rejects. Run in a child under a load hook that fails the FIRST load of one method module and counts every
  // attempt, so "the failure was replayed" and "it loaded again" are told apart by the count.
  const library = JSON.stringify(new URL('../lib/alg-library.js', import.meta.url).href);
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { registerHooks } from 'node:module';
    let loads = 0;
    registerHooks({ load(url, context, next) {
      if (url.endsWith('/lib/methods/cross.js')) {
        loads += 1;
        if (loads === 1) throw new Error('transient: cross.js could not be fetched');
      }
      return next(url, context);
    } });
    const lib = await import(${library});
    const said = [];
    for (const ask of [() => lib.algIds(), () => lib.algIds(), () => lib.loadEntries()]) {
      try { const v = await ask(); said.push({ ok: true, n: v.length ?? v.size, loads }); }
      catch (e) { said.push({ ok: false, message: e.message, loads }); }
    }
    process.stdout.write(JSON.stringify(said));
  `], { encoding: 'utf8' });
  const [first, second, third] = JSON.parse(out);
  assert.deepEqual(first, { ok: false, message: 'transient: cross.js could not be fetched', loads: 1 });
  assert.deepEqual(second, { ok: true, n: ROWS.length, loads: 2 }, 'the failure was replayed instead of loading again');
  assert.deepEqual(third, { ok: true, n: ALG_SETS.length, loads: 2 }, 'a load that worked was not kept');
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
