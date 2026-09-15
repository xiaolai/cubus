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

import { SOLVED, applyAlg } from '../lib/cube-pieces.js';
import { WHY_KEYS as EMITTABLE_WHY_KEYS } from '../lib/method-lesson.js';
import { solveByMethod } from '../lib/method-solver.js';
import { allRungCombinations, methodFor } from '../lib/methods/index.js';
import { TARGETS } from '../lib/stage-targets.js';
import {
  CAPABILITIES, CUE_VERBS, SOURCES, STEP_KINDS, TARGET_IDS, WHY_KEYS,
} from './fixtures/tutorial-scenarios.mjs';

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
