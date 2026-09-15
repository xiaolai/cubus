// The tutorial corpus, node half: every word a tutorial is written in today is mapped onto a
// capability, and (from plan item 0.2) every scenario runs against independent oracles.
//
// dev-docs/tutorial-capability-plan.md, Phase 0. A vocabulary is read from where it is DEFINED or
// EMITTED, never copied here: the method solver's step kinds and reason keys come from real solves
// over every rung combination, the stage targets from `TARGETS`, and the lesson course's cue verbs
// from its parser in the sibling checkout. A word with no row in the fixture fails the run, so a new
// cue, a new reason or a new target cannot enter a tutorial without the matrix saying what it needs.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import * as kit from '../lib/cube-kit.js';
import { SOLVED, applyAlg } from '../lib/cube-pieces.js';
import { WHY_KEYS as EMITTABLE_WHY_KEYS } from '../lib/method-lesson.js';
import { solveByMethod } from '../lib/method-solver.js';
import { allRungCombinations, methodFor } from '../lib/methods/index.js';
import { TARGETS } from '../lib/stage-targets.js';
import {
  CAPABILITIES, CUE_VERBS, SCENARIOS, SOURCES, STEP_KINDS, TARGET_IDS, WHY_KEYS,
} from './fixtures/tutorial-scenarios.mjs';
import { MODEL_RUNNERS, OPEN_ITEMS, assertCovered, strictKit, underGapRules } from './tutorial-runner.mjs';

/** The sibling lesson-course checkout, where its parser lives. Absent on a clone of this repo alone. */
const CUBUS_IM = process.env.CUBUS_IM_REPO
  ?? fileURLToPath(new URL('../../../../cubus-im/', import.meta.url));

/** Words in `vocabulary` that `table` has no row for. The whole of the coverage rule. */
export function unmapped(vocabulary, table) {
  return [...new Set(vocabulary)].filter((word) => !Object.hasOwn(table, word)).sort();
}

test('the check can fail: a word with no row is reported, and a mapped one is not', () => {
  assert.deepEqual(unmapped(['show', 'wave'], CUE_VERBS), ['wave']);
  assert.deepEqual(unmapped(['toString', 'constructor'], CUE_VERBS), ['constructor', 'toString'],
    'an inherited property name counted as a row');
  assert.deepEqual(unmapped(Object.keys(CUE_VERBS), CUE_VERBS), []);
});

test('every capability a row names exists, and every one not working says which plan item closes it', () => {
  const named = [
    ...Object.values(CUE_VERBS), ...Object.values(STEP_KINDS), ...Object.values(WHY_KEYS),
    ...Object.values(TARGET_IDS), ...SOURCES.flatMap((s) => [...s.uses, ...s.wants]),
  ].flat();
  assert.deepEqual(unmapped(named, CAPABILITIES), [], 'a row names a capability the table does not define');
  for (const [id, c] of Object.entries(CAPABILITIES)) {
    assert.ok(['works', 'partial', 'gap'].includes(c.status), `${id}: status "${c.status}"`);
    if (c.status !== 'works') assert.match(c.item ?? '', /^[0-6]\.[1-6]$/, `${id} is ${c.status} with no plan item`);
    else assert.equal(c.item, undefined, `${id} works and still names a plan item`);
  }
  for (const s of SOURCES) {
    const works = s.wants.filter((w) => CAPABILITIES[w].status === 'works');
    assert.deepEqual(works, [], `${s.stage} (${s.where}) wants what already works: ${works.join(', ')}`);
  }
});

test('every reason key the method solver can emit has a row, and no row is for a key it cannot', () => {
  assert.deepEqual(unmapped(EMITTABLE_WHY_KEYS, WHY_KEYS), []);
  assert.deepEqual(unmapped(Object.keys(WHY_KEYS), Object.fromEntries(EMITTABLE_WHY_KEYS.map((k) => [k, 1]))), []);
});

test('every step kind and reason key real solves emit, over every rung combination, has a row', () => {
  const kinds = [];
  const keys = [];
  // Three cubes that exercise every stage: a scramble, a cube with only the last layer left, and one
  // a few moves from solved.
  const cubes = [
    applyAlg(SOLVED, "R U R' U' F2 D L' B2 U R2 D' F L U2 B' R D2 L2 F' U'"),
    applyAlg(SOLVED, "R U R' U R U2 R' U2"),
    applyAlg(SOLVED, "F R U R' U' F'"),
  ];
  for (const rungs of allRungCombinations()) {
    for (const cube of cubes) {
      for (const step of solveByMethod(cube, methodFor(rungs)).steps) {
        kinds.push(step.kind);
        keys.push(step.why.key);
      }
    }
  }
  assert.ok(kinds.length > 0 && keys.length > 0, 'precondition: the solves emitted steps');
  assert.deepEqual(unmapped(kinds, STEP_KINDS), []);
  assert.deepEqual(unmapped(keys, WHY_KEYS), []);
});

test('every stage target has a row, and no row is for a target that does not exist', () => {
  const ids = TARGETS.map((t) => t.id);
  assert.deepEqual(unmapped(ids, TARGET_IDS), []);
  assert.deepEqual(unmapped(Object.keys(TARGET_IDS), Object.fromEntries(ids.map((id) => [id, 1]))), []);
});

test('every cue verb the lesson course parses has a row, and no row is for a verb it does not', (t) => {
  const parser = `${CUBUS_IM}pipeline/parse-lesson.py`;
  if (!existsSync(parser)) {
    t.skip(`the lesson course is not checked out beside this repo (${parser}); its cue verbs are UNCHECKED, not passed`);
    return;
  }
  const verbs = [...readFileSync(parser, 'utf8').matchAll(/verb == '([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(verbs.length >= 10, `precondition: the parser's verbs were read (${verbs.length})`);
  assert.deepEqual(unmapped(verbs, CUE_VERBS), []);
  assert.deepEqual(unmapped(Object.keys(CUE_VERBS), Object.fromEntries(verbs.map((v) => [v, 1]))), []);
});

// ---- the corpus (plan items 0.2 and 0.3) --------------------------------------------------------------

const HALVES = ['model', 'element', 'player'];

test('every scenario says which half runs it, and every gap names an open plan item or a covering test', () => {
  const ids = new Set();
  for (const sc of SCENARIOS) {
    assert.ok(!ids.has(sc.id), `two scenarios are called ${sc.id}`);
    ids.add(sc.id);
    assert.ok(HALVES.includes(sc.half), `${sc.id}: half "${sc.half}"`);
    assert.deepEqual(unmapped(sc.needs, CAPABILITIES), [], `${sc.id} needs a capability the table does not define`);
    if (sc.kind === 'covered') assert.equal(sc.closedBy, undefined, `${sc.id} is covered and still names a plan item`);
  }
  const used = new Set(SCENARIOS.map((s) => s.closedBy).filter(Boolean));
  assert.deepEqual(OPEN_ITEMS.filter((item) => !used.has(item)), [], 'an open item has no scenario waiting on it');
});

test('the gap rules can fail in each direction they exist to catch', async () => {
  const todos = [];
  const t = { todo: (why) => todos.push(why) };
  const sc = { id: 'probe', closedBy: '9.9' };
  await underGapRules(t, sc, true, () => { throw new Error('not built'); });
  assert.equal(todos.length, 1, 'an open gap that fails is a todo');
  await assert.rejects(underGapRules(t, sc, true, () => {}), /still in OPEN_ITEMS/, 'an open gap that passes is a stale registry');
  await assert.rejects(underGapRules(t, sc, false, () => { throw new Error('broken'); }), /broken/, 'a closed item that fails fails the run');
  await underGapRules(t, sc, false, () => {});
  assert.equal(todos.length, 1, 'a closed item that passes is not a todo');
});

test('a scenario sees cube-kit only as it is: a name it does not export throws, naming itself', () => {
  const k = strictKit(kit);
  assert.equal(typeof k.applyAlg, 'function');
  assert.throws(() => k.noSuchExport, /exports no "noSuchExport"/);
  assert.throws(() => k.constructor, /exports no "constructor"/);
});

for (const sc of SCENARIOS.filter((s) => s.kind === 'covered')) {
  test(`${sc.id}: pinned by the test it names`, () => assertCovered(sc));
}

for (const sc of SCENARIOS.filter((s) => s.half === 'model')) {
  const open = OPEN_ITEMS.includes(sc.closedBy);
  test(`${sc.id} (${sc.source})`, async (t) => {
    const runner = MODEL_RUNNERS[sc.kind];
    await underGapRules(t, sc, open, () => {
      if (!runner) throw new Error(`no runner for "${sc.kind}" yet — it arrives with plan item ${sc.closedBy}`);
      return runner(sc, strictKit(kit));
    });
  });
}

for (const sc of SCENARIOS.filter((s) => s.half === 'player')) {
  const open = OPEN_ITEMS.includes(sc.closedBy);
  if (sc.kind === 'covered') continue;
  test(`${sc.id} (${sc.source})`, async (t) => {
    await underGapRules(t, sc, open, () => {
      throw new Error(`no runner for "${sc.kind}" yet — it arrives with plan item ${sc.closedBy}`);
    });
  });
}
