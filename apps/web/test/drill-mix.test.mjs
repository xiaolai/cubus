// Mixed practice (`lib/drill/mix.js`) — dev-docs/algorithm-drill-v2-plan.md §5, work item WI-13.
//
// The order is checked against the weakness the RECORD computes (`statsOf`), step by step; and the checks are
// run against mutants of the module, each of which must fail one — so a comparator that sorts the wrong way,
// or forgets a step, is found here.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { compareWeakness, mixOrder } from '../lib/drill/mix.js';
import { statsOf } from '../lib/drill/record.js';
import { TIME_REFUSAL } from '../lib/drill/timing.js';

let at = 0;
const rep = ({ clean = true, lostTurn = false, ms = 1000, turns = 6, htm = 7 } = {}) => Object.freeze({
  at: (at += 1), clean, lostTurn, ms, refused: ms === null ? TIME_REFUSAL.NO_CUBE_CLOCK : null,
  turns: ms !== null && clean ? turns : null, pauses: 0, htm,
});
const times = (n, o) => Array.from({ length: n }, () => rep(o));

/** A record in which every step of the definition decides one pair. */
const RECORD = new Map([
  // error rate 0.5
  ['err-high', [rep(), rep({ clean: false })]],
  // error rate 0.25, streak 3
  ['err-low-streak-3', [rep({ clean: false }), ...times(3)]],
  // error rate 0.25, streak 0 — 1 error of 4, the newest
  ['err-low-streak-0', [...times(3), rep({ clean: false })]],
  // no errors, streak 4, pace 1000/6 vs 600/6
  ['slow', times(4, { ms: 1000 })],
  ['fast', times(4, { ms: 600 })],
  // judged but never timed: no pace
  ['untimed', times(4, { ms: null })],
  // only lost turns: nothing judged
  ['lost-only', [rep({ clean: false, lostTurn: true, ms: null })]],
]);
const IDS = ['fast', 'slow', 'untimed', 'err-low-streak-3', 'never', 'err-high', 'lost-only', 'err-low-streak-0'];

const checkWeakestFirst = (mix) => {
  const order = mix(IDS, RECORD, { seed: 7 });
  // unknowns (never practised, only lost turns) first in a seed's order, then by error rate, streak, pace.
  assert.deepEqual(new Set(order.slice(0, 2)), new Set(['never', 'lost-only']));
  assert.deepEqual(order.slice(2), ['err-high', 'err-low-streak-0', 'err-low-streak-3', 'untimed', 'slow', 'fast']);
  const last = mix(IDS, RECORD, { seed: 7, unknownFirst: false });
  assert.deepEqual(last.slice(0, 6), ['err-high', 'err-low-streak-0', 'err-low-streak-3', 'slow', 'fast', 'untimed']);
  assert.deepEqual(new Set(last.slice(6)), new Set(['never', 'lost-only']));
};

test('weakest first, by exactly the record\'s figures: unknown, error rate, streak, pace', () => {
  checkWeakestFirst(mixOrder);
  // The figures the order stands on are the record's own.
  const s = (id) => statsOf(RECORD.get(id) ?? []);
  assert.equal(s('err-high').errorRate, 0.5);
  assert.equal(s('err-low-streak-3').errorRate, s('err-low-streak-0').errorRate);
  assert.deepEqual([s('err-low-streak-3').streak, s('err-low-streak-0').streak], [3, 0]);
  assert.ok(s('slow').pace > s('fast').pace);
  assert.equal(s('untimed').pace, null);
  assert.equal(s('lost-only').judged, 0);
  assert.ok(compareWeakness(s('err-high'), s('fast')) < 0);
  assert.equal(compareWeakness(s('fast'), s('fast')), 0);
});

test('the order is deterministic per seed, and the seed only orders ties', () => {
  const tied = Array.from({ length: 12 }, (_, i) => `t-${i}`); // none practised: all tie
  const a = mixOrder(tied, new Map(), { seed: 1, rounds: 3 });
  assert.deepEqual(mixOrder(tied, new Map(), { seed: 1, rounds: 3 }), a, 'one seed gave two orders');
  const orders = new Set([1, 2, 3, 4, 5].map((seed) => mixOrder(tied, new Map(), { seed }).join()));
  assert.ok(orders.size > 1, 'the seed changes nothing about a tie');
  for (const seed of [1, 2, 3, 99, 0xffffffff]) {
    const order = mixOrder(IDS, RECORD, { seed });
    assert.deepEqual(order.slice(2), ['err-high', 'err-low-streak-0', 'err-low-streak-3', 'untimed', 'slow', 'fast'],
      `seed ${seed} moved an algorithm the record ranks`);
  }
});

const checkNoRepeats = (mix) => {
  for (let seed = 0; seed < 200; seed++) {
    for (const ids of [['a', 'b'], ['a', 'b', 'c'], IDS]) {
      // All tied, so every round is re-ordered by the seed, and a round may start where the last ended.
      const order = mix(ids, new Map(), { seed, rounds: 6 });
      assert.equal(order.length, ids.length * 6);
      order.forEach((id, i) => assert.notEqual(id, order[i - 1], `seed ${seed}: ${id} twice in a row at ${i}`));
      for (let r = 0; r < 6; r++) assert.deepEqual(new Set(order.slice(r * ids.length, (r + 1) * ids.length)), new Set(ids));
    }
  }
};

test('no algorithm twice in a row when there is more than one, over many rounds and seeds', () => {
  checkNoRepeats(mixOrder);
  // Ranked record, many rounds: still never a repeat, and every round still weakest first apart from the swap.
  const order = mixOrder(['fast', 'slow'], RECORD, { seed: 3, rounds: 4 });
  assert.deepEqual(order, ['slow', 'fast', 'slow', 'fast', 'slow', 'fast', 'slow', 'fast']);
  // One algorithm is blocked practice: it repeats by definition.
  assert.deepEqual(mixOrder(['solo'], RECORD, { seed: 1, rounds: 3 }), ['solo', 'solo', 'solo']);
});

test('bad input is refused loudly', () => {
  assert.throws(() => mixOrder(['a', 'a'], new Map(), { seed: 1 }), /twice/);
  assert.throws(() => mixOrder(['a'], {}, { seed: 1 }), /Map/);
  assert.throws(() => mixOrder(['a'], new Map(), {}), /seed/);
  assert.throws(() => mixOrder(['a'], new Map(), { seed: 1.5 }), /seed/);
  assert.throws(() => mixOrder(['a'], new Map(), { seed: 1, rounds: 0 }), /round/);
  assert.deepEqual(mixOrder([], new Map(), { seed: 1 }), []);
});

// ---- mutants: a broken comparator must fail these checks --------------------------------------------------

async function mutant(from, to) {
  const lib = new URL('../lib/', import.meta.url);
  const src = readFileSync(new URL('drill/mix.js', lib), 'utf8');
  assert.ok(src.includes(from), `the mutation target is gone from mix.js: ${from}`);
  const mutated = src.replaceAll(from, to).replaceAll("from './", `from '${new URL('drill/', lib).href}`);
  const dir = mkdtempSync(join(tmpdir(), 'drill-mix-mutant-'));
  const file = join(dir, 'mix.js');
  writeFileSync(file, mutated);
  return (await import(pathToFileURL(file).href)).mixOrder;
}

test('a broken comparator fails these checks: each mutant is caught', async () => {
  const cases = [
    ['error rate sorted the wrong way', 'return b.errorRate - a.errorRate;', 'return a.errorRate - b.errorRate;', checkWeakestFirst],
    ['streak sorted the wrong way', 'return a.streak - b.streak;', 'return b.streak - a.streak;', checkWeakestFirst],
    ['pace sorted the wrong way', 'return b.pace - a.pace;', 'return a.pace - b.pace;', checkWeakestFirst],
    ['the streak step forgotten', 'if (a.streak !== b.streak) return a.streak - b.streak;', '', checkWeakestFirst],
    ['unknowns not put first', 'if (a === null) return unknownFirst ? -1 : 1;', 'if (a === null) return 1;', checkWeakestFirst],
    ['no swap at a round boundary', '[ranked[0], ranked[1]] = [ranked[1], ranked[0]];', '', checkNoRepeats],
  ];
  for (const [what, from, to, check] of cases) {
    check(mixOrder); // the real module passes
    const broken = await mutant(from, to);
    assert.throws(() => check(broken), assert.AssertionError, `${what}: the mutant passed its check`);
  }
});
