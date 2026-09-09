// The shipped case tables are the proved ones, unedited.
//
// `lib/data/case-tables.js` is generated from `crates/optimal-solver/tables/*.json` — the
// artifacts the Rust searches produced, covered by the certificates beside them and re-checked
// against those certificates on every `cargo test` run. This file is the seam between the two: it
// re-runs the generator and diffs, so a hand-edit to the shipped module, a stale copy, or a
// regenerated table nobody carried across fails here rather than shipping a wrong algorithm.
//
// It also checks the properties the generator asserts, from outside the generator — every entry a
// face-turn maneuver of its stated length, every key unique, and the counts the tables claim.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { SOLVED, applyAlg } from '../lib/cube-pieces.js';
import { F2L_CASES, FULL_OLL, FULL_PLL } from '../lib/data/case-tables.js';
import { render } from '../regen-case-tables.mjs';

const SHIPPED = new URL('../lib/data/case-tables.js', import.meta.url);
const ARTIFACTS = new URL('../../../crates/optimal-solver/tables/', import.meta.url);

test('the shipped module is exactly what regenerating it produces', () => {
  // The whole point of the file. Cheap enough to run every time, which is what makes "generated,
  // never hand-edited" a property rather than a comment.
  assert.ok(existsSync(ARTIFACTS), 'crates/optimal-solver/tables/ is missing — it is committed');
  assert.equal(readFileSync(SHIPPED, 'utf8'), render(),
    'lib/data/case-tables.js has drifted from the proved tables — run `node regen-case-tables.mjs`');
});

// THE GUARD THAT MAKES THE TEST ABOVE MEAN ANYTHING.
//
// `render` is imported from the generator, and the generator used to write `case-tables.js` at
// module scope — so importing it REWROTE the file the diff was about to read. The drift test
// passed on a hand-edited module and left no trace: verified by corrupting an algorithm, running
// the suite, and finding the test green and the corruption gone.
//
// Checked from a separate process, because this one has already imported the module and an import
// happens once. The file's mtime is the observation: `writeFileSync` moves it even when the bytes
// are identical, so this fails the moment the side effect comes back.
test('importing the generator does not write the file the diff is about', () => {
  const generator = new URL('../regen-case-tables.mjs', import.meta.url).href;
  const before = statSync(SHIPPED).mtimeMs;
  const run = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(generator)});`],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.equal(
    statSync(SHIPPED).mtimeMs,
    before,
    'importing regen-case-tables.mjs wrote lib/data/case-tables.js — the drift test above cannot fail while that is true',
  );
});

test('--check reports the difference and writes nothing', () => {
  const generator = fileURLToPath(new URL('../regen-case-tables.mjs', import.meta.url));
  const before = statSync(SHIPPED).mtimeMs;
  const run = spawnSync(process.execPath, [generator, '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  // The content on stdout, as the usage line promises, and the verdict on stderr.
  assert.equal(run.stdout, readFileSync(SHIPPED, 'utf8'));
  assert.match(run.stderr, /is identical$/m);
  // The byte count is UTF-8 bytes, not UTF-16 code units — the header has non-ASCII in it.
  assert.match(run.stderr, new RegExp(`^${Buffer.byteLength(run.stdout, 'utf8')} bytes`, 'm'));
  assert.equal(statSync(SHIPPED).mtimeMs, before, '--check wrote the file');
});

test('the tables are the sizes the method claims, and every key is distinct', () => {
  // 57 OLL, 21 PLL, 41 F2L. These are the numbers the rungs' own blurbs promise a learner, and a
  // table quietly short of one is a case the tutor would meet and have no answer for.
  assert.equal(FULL_OLL.length, 57);
  assert.equal(FULL_PLL.length, 21);
  assert.equal(F2L_CASES.length, 41);
  const names = [...FULL_OLL, ...FULL_PLL, ...F2L_CASES].map((e) => e.name);
  assert.equal(new Set(names).size, names.length, 'two cases share a key');
  for (const name of names) assert.match(name, /^(?:oll|pll|f2l):[0-9a-f]+$/);
});

test('every algorithm is a face-turn maneuver and nothing but', () => {
  // The renderer and the move list speak face turns only — no wide moves, no slices, no rotations.
  // The Rust search is over exactly those 18, so this cannot fail today; it is here because the
  // day it can is the day someone widens that move set for a different reason and ships a step the
  // cube cannot animate.
  for (const entry of [...FULL_OLL, ...FULL_PLL, ...F2L_CASES]) {
    assert.match(entry.alg, /^[URFDLB][2']?(?: [URFDLB][2']?)*$/, `${entry.name}: "${entry.alg}"`);
    // And it is a real maneuver: applying it to a solved cube has to change something, or it is an
    // entry that would be preferred by every search and would achieve nothing.
    assert.notDeepEqual(applyAlg(SOLVED, entry.alg), SOLVED, `${entry.name} does nothing`);
  }
});

test('the length distributions are the proved ones', () => {
  // Pinned as RESULTS, not checked against a source: these are what the searches proved, and the
  // evidence they are minimal is the certificates and the brute-force refutation pass, not
  // agreement with a published table. The one external number this repository does have is PLL's
  // 11.642361 mean over all 288 permutations, which matches Cube Explorer — a different average
  // from the 11.4762 below, which is over the 21 cases.
  const histogram = (table) => table.reduce((h, e) => {
    const n = e.alg.split(' ').length;
    return { ...h, [n]: (h[n] ?? 0) + 1 };
  }, {});
  assert.deepEqual(histogram(FULL_OLL), { 6: 3, 7: 6, 8: 5, 9: 10, 10: 20, 11: 12, 12: 1 });
  assert.deepEqual(histogram(FULL_PLL), { 9: 5, 10: 3, 12: 5, 13: 6, 14: 2 });
  assert.deepEqual(histogram(F2L_CASES), { 3: 1, 4: 3, 6: 8, 7: 15, 8: 11, 9: 3 });
  // No eleven-move PLL case, and no five-move F2L one: real gaps in real distributions, and the
  // kind of detail a table transcribed by hand would smooth over.
  assert.equal(histogram(FULL_PLL)[11], undefined);
  assert.equal(histogram(F2L_CASES)[5], undefined);
});

test('the tables are frozen, so reading one cannot change a later solve', () => {
  // The defect this repository has already had once: an exported table handed out the objects the
  // solver reads, and `OLL_ALGS[0].alg = ''` changed every later solve in the process.
  for (const table of [FULL_OLL, FULL_PLL, F2L_CASES]) {
    assert.ok(Object.isFrozen(table));
    for (const entry of table) {
      assert.ok(Object.isFrozen(entry), `${entry.name} is a mutable record`);
      assert.throws(() => { entry.alg = 'R'; }, TypeError, `${entry.name} could be rewritten`);
    }
  }
});
