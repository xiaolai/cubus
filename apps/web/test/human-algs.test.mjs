// The human-speed table: every row is the algorithm its source published, answers the case it claims,
// and the 119 rows answer the 119 proved cases once each.
//
// THE ORACLE IS CUBEJS, which reads slices, wide turns and whole-cube turns with code that shares nothing
// with `lib/cube-notation.js` or `lib/cube-moves.js`. A row is sourced from somebody else's sheet, so the
// claim "this solves case X" is checked against an implementation that did not come from this repository
// either — and then the app's own interpreter is held to cubejs on every row, because the solver runs these
// algorithms through it on a child's cube.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Cube from 'cubejs';

import { F2L_CASES, FULL_OLL, FULL_PLL } from '../lib/data/case-tables.js';
import { HUMAN_ALGS, HUMAN_F2L, HUMAN_OLL, HUMAN_PLL, SOURCES } from '../lib/data/human-algs.js';
import { SOLVED, invert, toFacelets } from '../lib/cube-pieces.js';
import { run } from '../lib/cube-moves.js';

const PROVED = { f2l: F2L_CASES, oll: FULL_OLL, pll: FULL_PLL };
const setOf = (row) => row.name.split('-')[0];
const AUF = ['', 'U', 'U2', "U'"];

/** cubejs's facelets, URFDLB, nine each. */
const faces = (cube) => {
  const s = cube.asString();
  return Object.fromEntries('URFDLB'.split('').map((f, i) => [f, s.slice(i * 9, i * 9 + 9)]));
};
const uniform = (face, letter) => [...face].every((c) => c === letter);
/** The bottom two rows of a side face are its own colour. */
const lowerTwo = (face, letter) => [...face.slice(3)].every((c) => c === letter);
const firstTwoLayers = (f) => uniform(f.D, 'D') && ['R', 'F', 'L', 'B'].every((x) => lowerTwo(f[x], x));

/** What each set's algorithm must leave, read off cubejs's stickers. */
const GOAL = {
  f2l: (c) => firstTwoLayers(faces(c)),
  oll: (c) => firstTwoLayers(faces(c)) && uniform(faces(c).U, 'U'),
  pll: (c) => AUF.some((a) => { const d = c.clone(); if (a) d.move(a); return d.isSolved(); }),
};

/** Does `alg`, after a turn of the top, take the proved case `entry` to its set's goal? */
function answers(set, entry, alg) {
  return AUF.some((pre) => {
    const c = new Cube();
    c.move(invert(entry.alg));
    if (pre) c.move(pre);
    c.move(alg);
    return GOAL[set](c);
  });
}

test('the table is the three standard sets, numbered as the sheets number them', () => {
  assert.equal(HUMAN_F2L.length, 41);
  assert.equal(HUMAN_OLL.length, 57);
  assert.equal(HUMAN_PLL.length, 21);
  assert.equal(HUMAN_ALGS.length, 119);
  assert.deepEqual(HUMAN_F2L.map((r) => r.label), Array.from({ length: 41 }, (_, i) => `F2L ${i + 1}`));
  assert.deepEqual(HUMAN_OLL.map((r) => r.label), Array.from({ length: 57 }, (_, i) => `OLL ${i + 1}`));
  assert.deepEqual(HUMAN_PLL.map((r) => r.label),
    ['Aa', 'Ab', 'E', 'F', 'Ga', 'Gb', 'Gc', 'Gd', 'H', 'Ja', 'Jb', 'Na', 'Nb', 'Ra', 'Rb', 'T', 'Ua', 'Ub', 'V', 'Y', 'Z']);
  assert.equal(new Set(HUMAN_ALGS.map((r) => r.name)).size, 119, 'two rows share an id');
  for (const row of HUMAN_ALGS) {
    assert.ok(Object.hasOwn(SOURCES, row.source), `${row.name} names a source that is not listed`);
    assert.ok(Object.isFrozen(row), `${row.name} can be edited in place`);
  }
  for (const [key, src] of Object.entries(SOURCES)) assert.match(src.url, /^https:\/\//, `${key} is not a URL`);
  // A nickname is OLL's only: PLL's letter IS its name, and F2L cases have none on the sheets.
  assert.ok(HUMAN_ALGS.filter((r) => r.nickname).every((r) => r.name.startsWith('oll-')));
});

test('every row answers the case it claims, and that case only — checked by cubejs', () => {
  let checked = 0;
  for (const row of HUMAN_ALGS) {
    const set = setOf(row);
    const hits = PROVED[set].filter((entry) => answers(set, entry, row.alg)).map((e) => e.name);
    assert.deepEqual(hits, [row.case], `${row.name} ("${row.alg}") answers ${hits.join(', ') || 'no case'}, not ${row.case}`);
    checked += 1;
  }
  assert.equal(checked, 119);
});

test('the 119 rows answer the 119 proved cases, once each', () => {
  for (const [set, table] of Object.entries(PROVED)) {
    const claimed = HUMAN_ALGS.filter((r) => setOf(r) === set).map((r) => r.case).sort();
    assert.deepEqual(claimed, table.map((e) => e.name).sort(), `the ${set} rows and the proved ${set} cases are not one-to-one`);
  }
});

test('the check can fail: an algorithm that keeps the first two layers but reaches no goal answers nothing', () => {
  // A goal every cube satisfied would make the case check above vacuous, so each set is handed an algorithm
  // that leaves its first two layers alone and CANNOT reach its goal — and must answer no case at all. Not
  // a scrambling sequence: those fail by breaking the layers, which tests the easy half. (The first null
  // tried was `(R U R' U')3`, which is not a null at all: it is F2L 32.)
  const sune = "R U R' U R U2 R'";
  const tPerm = HUMAN_PLL.find((r) => r.label === 'T').alg;
  // Sune keeps the layers below the top, so an unsolved F2L pair stays unsolved.
  assert.deepEqual(PROVED.f2l.filter((e) => answers('f2l', e, sune)), [], 'the F2L goal accepts a pair left unsolved');
  // A T perm only swaps pieces in the top layer, so it orients no case that was not already oriented.
  assert.deepEqual(PROVED.oll.filter((e) => answers('oll', e, tPerm)), [], 'the OLL goal accepts a top left unoriented');
  // And Sune twists three corners, so it leaves every permutation case with a twisted corner.
  assert.deepEqual(PROVED.pll.filter((e) => answers('pll', e, sune)), [], 'the PLL goal accepts an unsolved cube');
});

test('every row ends with the cube held the way it began', () => {
  // The solver hands the next stage the cube AS HELD (`method-solver.js`), so an algorithm that left it
  // on its side would hand the PLL stage a cube whose top is not the last layer. Checked by cubejs's
  // centres as well as by the interpreter's hold, because the two disagreeing would mean one of them
  // reads a rotation wrongly.
  for (const row of HUMAN_ALGS) {
    const c = new Cube();
    c.move(row.alg);
    const f = faces(c);
    for (const face of 'URFDLB') assert.equal(f[face][4], face, `${row.name} leaves the ${face} centre elsewhere`);
    assert.deepEqual([...run(row.alg, ['U', 'F'], SOLVED).hold], ['U', 'F'], `${row.name} leaves the cube turned`);
  }
});

test('the app\'s interpreter does to the pieces exactly what cubejs does, on every row', () => {
  // The solver applies these through `run`, the drill tracks them through it, and the renderer draws them
  // through the same arithmetic. One disagreement here is a child told a turn is wrong that is right.
  for (const row of HUMAN_ALGS) {
    const c = new Cube();
    c.move(row.alg);
    assert.equal(toFacelets(run(row.alg, ['U', 'F'], SOLVED).state), c.asString(), `${row.name} ("${row.alg}")`);
  }
});

test('a row differs from its source only by the two documented normalisations', () => {
  // 1. Two identical quarter turns side by side become the half turn they are.
  // 2. A whole-cube turn the source left open is closed at the end.
  // Re-derived from `sourceAlg`; a row with no `sourceAlg` must already be in normal form, so the test
  // also catches a source string pasted in un-normalised.
  const merge = (alg) => alg.split(' ').reduce((out, m) => {
    if (out.length && out[out.length - 1] === m && !m.includes('2')) out[out.length - 1] = `${m.replace("'", '')}2`;
    else out.push(m);
    return out;
  }, []).join(' ');
  const close = (alg) => {
    for (const r of ['', 'x', "x'", 'x2', 'y', "y'", 'y2', 'z', "z'", 'z2']) {
      const closed = r ? `${alg} ${r}` : alg;
      const [up, front] = run(closed, ['U', 'F'], SOLVED).hold;
      if (up === 'U' && front === 'F') return closed;
    }
    throw new Error(`no single rotation closes "${alg}"`);
  };
  let changed = 0;
  for (const row of HUMAN_ALGS) {
    const from = row.sourceAlg ?? row.alg;
    assert.equal(row.alg, close(merge(from)), `${row.name} is not its source, normalised`);
    if (row.sourceAlg !== undefined) {
      assert.notEqual(row.sourceAlg, row.alg, `${row.name} records a source string identical to its algorithm`);
      changed += 1;
    }
  }
  // Which rows changed is a fact about the sources; pinned so a re-fetch that moved it is noticed.
  assert.deepEqual(HUMAN_ALGS.filter((r) => r.sourceAlg).map((r) => r.name),
    ['f2l-13', 'f2l-18', 'f2l-20', 'oll-1', 'oll-18', 'oll-35', 'pll-Aa', 'pll-Ab', 'pll-E', 'pll-Ja', 'pll-V']);
  assert.equal(changed, 11);
});

test('an inverse is the inverse, for every row — the drill builds its case with it', () => {
  // `invert` rebuilt a primed token from its first character until 2026-10-13, which turned `Rw'` into
  // `R`. No row uses `Rw`, but every row's set-up is `invert(alg)`, so it is checked on the rows
  // themselves rather than only on a list of tokens.
  for (const row of HUMAN_ALGS) {
    const c = new Cube();
    c.move(row.alg);
    c.move(invert(row.alg));
    assert.ok(c.isSolved(), `${row.name}: the algorithm then its inverse is not the identity`);
  }
});
