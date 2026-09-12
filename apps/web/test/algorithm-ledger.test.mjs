// The algorithm ledger, held to the algorithms it describes.
//
// `test/fixtures/algorithm-ledger.mjs` records what this repository holds: how big each set is, how
// long its algorithms run, which method needs it, and what is missing. It deliberately does NOT copy
// the algorithms themselves — they live in `lib/data/case-tables.js` and `lib/methods/`, and a second
// copy would be a second place for one to be wrong. That makes drift the whole risk, so the ledger is
// regenerated here and diffed.
//
// What this does NOT re-check: that the proved tables are the proved tables. `case-tables.test.mjs`
// already re-runs their generator, diffs the shipped module, and pins the length distributions. Doing
// it twice would be two gates that fail together and tell you the same thing.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SOLVED, applyAlg, movesOf } from '../lib/cube-pieces.js';
import { ALGORITHM_SETS, METHOD_ALGORITHMS } from './fixtures/algorithm-ledger.mjs';
import { LEDGER, MEASURED_SETS } from '../bench/algorithm-ledger.mjs';
import { LADDER, STAGE_IDS } from '../lib/methods/index.js';

test('the frozen ledger is what regenerating it produces', () => {
  // Same shape as case-tables.test.mjs's first case, and for the same reason: a fixture that drifted
  // from its generator looks exactly like one that did not.
  // `LEDGER` is the one definition of the emitted shape, exported by the generator and used by its
  // own writer. Rebuilding it here instead was how this test reported "drift" when a field had merely
  // been added — two copies of a shape, which is exactly what the fixture exists to avoid.
  const round = (v) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(round(ALGORITHM_SETS), round(LEDGER.sets),
    'the sets in the fixture are not what the generator now produces');
  assert.deepEqual(round(METHOD_ALGORITHMS), round(LEDGER.methods),
    'the method mapping in the fixture is not what the generator now produces');
});

test('every algorithm in every set is a real algorithm', () => {
  // The generator asserts this while measuring; this asserts it from outside the generator, which is
  // the distinction `case-tables.test.mjs` draws for the proved tables and the hand-written
  // repertoires never had.
  const FACE_TURN = /^[URFDLB][2']?$/;
  for (const set of MEASURED_SETS) {
    assert.ok(set.algs.length > 0, `${set.id} is empty`);
    const names = new Set();
    for (const { name, alg } of set.algs) {
      assert.ok(name && typeof name === 'string', `${set.id}: an entry has no name`);
      assert.ok(!names.has(name), `${set.id}: two entries are called ${name}`);
      names.add(name);
      for (const m of movesOf(alg)) {
        assert.match(m, FACE_TURN, `${set.id}/${name}: "${m}" is not a face turn the renderer can animate`);
      }
      if (set.kind === 'not an algorithm') continue;
      const after = applyAlg(SOLVED, alg);
      const unchanged = ['cp', 'co', 'ep', 'eo'].every((k) => after[k].every((v, i) => v === SOLVED[k][i]));
      assert.equal(unchanged, false, `${set.id}/${name} leaves a solved cube solved, so it does nothing`);
    }
  }
});

test('the alignment is the only empty entry, and it is not counted as an algorithm', () => {
  // It was once absent and a one-turn cube got a nineteen-move lesson. It is kept out of PLL_ALGS on
  // purpose — "turn the top until it matches" is not something anyone memorises — so the ledger must
  // not fold it into any method's cost.
  const empties = MEASURED_SETS.flatMap((s) => s.algs.filter((a) => movesOf(a.alg).length === 0)
    .map((a) => `${s.id}/${a.name}`));
  assert.deepEqual(empties, ['align/align'], 'the alignment must be the only empty entry');
  const align = ALGORITHM_SETS.find((s) => s.id === 'align');
  assert.equal(align.kind, 'not an algorithm');
  for (const m of METHOD_ALGORITHMS) {
    assert.ok(!m.sets.includes('align'), `${m.method} counts the alignment as an algorithm it teaches`);
  }
});

test('every method names sets that exist, and every set is named by some method', () => {
  const ids = new Set(ALGORITHM_SETS.map((s) => s.id));
  const used = new Set();
  for (const m of METHOD_ALGORITHMS) {
    for (const id of m.sets) {
      assert.ok(ids.has(id), `${m.method} needs a set "${id}" that the ledger does not have`);
      used.add(id);
    }
    // A phase is either a single description or a ladder of rungs, and every rung must say exactly
    // one thing about itself: it is held, it is intuitive, or it is missing. "None of the above" is
    // how a phase quietly stops being accounted for.
    for (const p of m.phases) {
      for (const r of p.rungs ?? [p]) {
        const where = p.rungs ? `${m.method}/${p.phase} rung ${r.rung}` : `${m.method}/${p.phase}`;
        const kinds = ['held', 'intuitive', 'missing'].filter((k) => r[k] !== undefined);
        assert.equal(kinds.length, 1,
          `${where} is ${kinds.length === 0 ? 'neither held, intuitive nor missing' : `both ${kinds.join(' and ')}`}`);
      }
      if (p.rungs) {
        const seen = p.rungs.map((r) => r.rung);
        assert.deepEqual(seen, [...seen].sort((a, b) => a - b),
          `${m.method}/${p.phase}: the rungs are out of order, so "bottom" and "top" mean nothing`);
      }
    }
  }
  // A set nothing needs is a set we would claim to teach and never show — the same rule
  // `CASE_NAMES` already enforces one level down. `align` is exempt: it is not taught.
  for (const id of ids) {
    if (id === 'align') continue;
    assert.ok(used.has(id), `no method needs "${id}" — it is held and never taught`);
  }
});

test("the ladder's ends are what the app actually needs at them", () => {
  const byName = Object.fromEntries(METHOD_ALGORITHMS.map((m) => [m.method, m]));
  const app = byName["The app's method"];
  assert.equal(app.ladder, true, "the app's method must be modelled as a ladder or the range is a lie");
  assert.equal(app.held, 18, 'the bottom rung is 2 + 3 + 2 + 1 + 5 + 3 + 2');
  // 124, not 119. An audit found the tidier version — "the top rung is exactly CFOP's set" — was
  // false: the top rung still needs the beginner inserts whenever a pair is BURIED, because
  // `pairsFrom` falls back to `placeSeparately`. Measured over 25 seeded scrambles at TOP_RUNG,
  // `solveByMethod` emits steps named facing-up, insert-left, insert-right, left-hand and right-hand.
  assert.equal(app.heldTop, 124, 'the top rung is 41 + 3 + 2 + 57 + 21');
  assert.notEqual(app.heldTop, byName.CFOP.held,
    'if these are equal again the fallback has gone, and the comment above needs rewriting');
  const cross = app.phases.find((p) => p.phase === 'Cross');
  assert.equal(cross.rungs.at(-1).held, undefined, "the cross's top rung must need no algorithms");
});

test("the ledger's ladder is the app's ladder, not a second copy of it", () => {
  // The audit's sharpest test finding: this suite compared the ledger with its own generator and
  // never with `methods/index.js`, so deleting a rung from the app left every assertion green.
  assert.equal(STAGE_IDS.length, 4, 'the app has four stages');
  const app = METHOD_ALGORITHMS.find((m) => m.method === "The app's method");
  const ledgerRungs = Object.fromEntries(app.phases.map((p) => [p.phase, p.rungs.length]));
  assert.deepEqual(ledgerRungs,
    { Cross: LADDER.cross.length, Pairs: LADDER.pairs.length, OLL: LADDER.oll.length, PLL: LADDER.pll.length },
    'the ledger and methods/index.js disagree about how many rungs each stage has');
  for (const [stage, key] of [['Cross', 'cross'], ['Pairs', 'pairs'], ['OLL', 'oll'], ['PLL', 'pll']]) {
    const labels = app.phases.find((p) => p.phase === stage).rungs.map((r) => r.label);
    assert.deepEqual(labels, LADDER[key].map((r) => r.label),
      `${stage}: the ledger's rung labels are not the app's`);
  }
});

test('the headline counts are what the sets add up to', () => {
  const total = ALGORITHM_SETS.reduce((a, s) => a + s.count, 0);
  const proved = ALGORITHM_SETS.filter((s) => s.kind === 'proved').reduce((a, s) => a + s.count, 0);
  const hand = ALGORITHM_SETS.filter((s) => s.kind === 'hand-written').reduce((a, s) => a + s.count, 0);
  assert.equal(proved + hand + 1, total, 'the kinds do not partition the ledger (the +1 is the alignment)');
  assert.equal(proved, 119, 'the proved tables are 41 + 57 + 21');
  assert.equal(hand, 24, 'the hand-written repertoires are 2 + 3 + 2 + 6 + 1 + 5 + 3 + 2');

  // The contrast the ledger exists to make: a beginner method costs a fraction of CFOP, and the two
  // computer methods cost nothing at all because they search instead of remembering.
  const byName = Object.fromEntries(METHOD_ALGORITHMS.map((m) => [m.method, m]));
  assert.equal(byName["The app's method"].held, 18);
  assert.equal(byName.CFOP.held, 119);
  assert.equal(byName.Thistlethwaite.held, 0, 'a search method memorises nothing');
  assert.equal(byName["The app's solver"].held, 0, 'a search method memorises nothing');
  assert.ok(byName.CFOP.held > byName["The app's method"].held * 6,
    'CFOP should cost many times what the beginner method does, or one of them has been mis-mapped');
});

test('a method with nothing held says what it is missing', () => {
  // The useful half of the ledger. "We do not teach Roux" is worth little; "Roux needs CMLL and we
  // have none of it" is a work item. A method with no sets and no missing entries would be a hole
  // pretending to be a method.
  for (const m of METHOD_ALGORITHMS) {
    if (m.held > 0) continue;
    const searchMethod = m.phases.some((p) => (p.intuitive ?? '').startsWith('NONE'));
    assert.ok(m.missing.length > 0 || searchMethod,
      `${m.method} holds nothing, is missing nothing and is not a search method — one of those is wrong`);
  }
});
