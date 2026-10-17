// The sourced CMLL table (lib/data/cmll-algs.js), re-derived with CUBEJS — an implementation that shares no
// code with the piece model, the interpreter or the method engine.
//
// What a CMLL row must be, each asserted: it keeps both blocks; it ends with the centres where they began; it
// solves the top corners of exactly one case, with a turn of the top before and after; and the 42 rows cover
// the 42 cases, once each. Plus the null beside the measurement: the one arrangement no row is for — the top
// corners already solved — is the one no row solves.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CMLL_ALGS, SOURCES } from '../lib/data/cmll-algs.js';
import { FIRST_BLOCK, SECOND_BLOCK } from '../lib/methods/roux-blocks.js';

const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url))).default;

const AUF = ['', 'U', 'U2', "U'"];
const TOP = [0, 1, 2, 3];
const after = (alg) => { const c = new Cube(); if (alg.trim()) c.move(alg.trim()); return c; };
const blocksKept = (c) => [...FIRST_BLOCK.edges, ...SECOND_BLOCK.edges].every((e) => c.ep[e] === e && c.eo[e] === 0)
  && [...FIRST_BLOCK.corners, ...SECOND_BLOCK.corners].every((q) => c.cp[q] === q && c.co[q] === 0);
const cornersSolved = (c) => c.cp.every((v, i) => v === i) && c.co.every((v) => v === 0);
/** The top corners of a cube, as a key: where each is and how it is twisted. */
const cornersKey = (c) => TOP.map((i) => `${c.cp[i]}${c.co[i]}`).join('');

/** Every arrangement of the four top corners with everything else solved: 24 places x 27 twists = 648. */
function topCornerStates() {
  const out = [];
  const perms = [];
  const permute = (left, acc) => { if (!left.length) perms.push(acc); left.forEach((x, i) => permute([...left.slice(0, i), ...left.slice(i + 1)], [...acc, x])); };
  permute(TOP, []);
  for (const cp of perms) {
    for (let t = 0; t < 27; t++) {
      const co = [t % 3, Math.floor(t / 3) % 3, Math.floor(t / 9) % 3];
      co.push((6 - co[0] - co[1] - co[2]) % 3);
      const c = new Cube();
      c.cp = [...cp, 4, 5, 6, 7];
      c.co = [...co, 0, 0, 0, 0];
      out.push(c);
    }
  }
  return out;
}

/**
 * A case is an arrangement up to a turn of the top on EITHER side of it — U^a · s · U^b — because a solver
 * may turn the top before the algorithm and after it: if `s · pre · alg · post` is solved, then so is
 * `U^a s U^b` by `U^-b pre`, the same algorithm, and `post U^-a`. Its key is the least of the sixteen.
 */
function caseOf(cube) {
  let least = null;
  for (const a of AUF) {
    for (const b of AUF) {
      const c = new Cube();
      if (a) c.move(a);
      c.multiply(cube);
      if (b) c.move(b);
      const k = cornersKey(c);
      if (least === null || k < least) least = k;
    }
  }
  return least;
}

test('every row keeps both blocks, and ends with the centres where they began', () => {
  for (const row of CMLL_ALGS) {
    const c = after(row.alg);
    assert.ok(blocksKept(c), `${row.name}: cubejs says "${row.alg}" breaks a block`);
    assert.deepEqual([...c.center], [0, 1, 2, 3, 4, 5], `${row.name}: "${row.alg}" leaves the centres turned`);
  }
});

test('the 42 rows are the 42 cases, once each, and every top-corner arrangement is one of them or none', () => {
  const states = topCornerStates();
  assert.equal(states.length, 648);
  // The case each row is FOR: the arrangement its inverse makes from solved.
  const rowCase = new Map();
  for (const row of CMLL_ALGS) {
    const inverse = row.alg.trim().split(/\s+/).reverse().map((m) => (m.endsWith("'") ? m.slice(0, -1) : m.endsWith('2') ? m : `${m}'`)).join(' ');
    const k = caseOf(after(inverse));
    assert.ok(!cornersSolved(after(inverse)) || caseOf(new Cube()) !== k, `${row.name}: its case is the solved one`);
    rowCase.set(row.name, k);
  }
  const cases = new Set(rowCase.values());
  assert.equal(cases.size, 42, `two rows answer the same case: ${[...rowCase].filter(([, k], i, all) => all.findIndex(([, j]) => j === k) !== i).map(([n]) => n).join(', ')}`);
  // Every arrangement: solved by a turn of the top alone, or by exactly the row its case names — and by no
  // other row, so no case has two answers.
  const solvedCase = caseOf(new Cube());
  let byRow = 0;
  for (const s of states) {
    const k = caseOf(s);
    if (k === solvedCase) {
      assert.ok(AUF.some((u) => { const c = new Cube(s); if (u) c.move(u); return cornersSolved(c); }),
        'an arrangement in the solved case that no turn of the top solves');
      continue;
    }
    const solving = CMLL_ALGS.filter((row) => AUF.some((pre) => AUF.some((post) => {
      const c = new Cube(s);
      c.move([pre, row.alg, post].filter(Boolean).join(' '));
      return cornersSolved(c) && blocksKept(c);
    })));
    assert.deepEqual(solving.map((r) => r.name), [...rowCase].filter(([, j]) => j === k).map(([n]) => n),
      `the arrangement ${cornersKey(s)} is solved by ${solving.map((r) => r.name).join(', ') || 'no row'}`);
    byRow++;
  }
  assert.ok(byRow >= 640, `only ${byRow} arrangements needed a row`);
});

test('every row names its source, a set the source uses, and a label the source gives', () => {
  const SETS = ['O', 'H', 'Pi', 'U', 'T', 'Sune', 'Anti Sune', 'L'];
  assert.equal(CMLL_ALGS.length, 42);
  assert.equal(new Set(CMLL_ALGS.map((r) => r.name)).size, 42, 'two rows share an id');
  for (const row of CMLL_ALGS) {
    assert.ok(Object.hasOwn(SOURCES, row.source), `${row.name}: no source "${row.source}"`);
    assert.ok(SETS.includes(row.set), `${row.name}: set "${row.set}"`);
    assert.ok(row.label.startsWith(row.set), `${row.name}: "${row.label}" is not in its set's name`);
    assert.match(row.name, /^cmll-[a-z0-9-]+$/);
  }
  // Every set the sheet has, with the sheet's own counts.
  const count = Object.fromEntries(SETS.map((s) => [s, CMLL_ALGS.filter((r) => r.set === s).length]));
  assert.deepEqual(count, { O: 2, H: 4, Pi: 6, U: 6, T: 6, Sune: 6, 'Anti Sune': 6, L: 6 });
});
