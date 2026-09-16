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
import {
  BROWSER_PLAYER_KINDS, MODEL_RUNNERS, OPEN_ITEMS, PLAYER_RUNNERS, assertCovered, scriptFor, strictKit, underGapRules,
} from './tutorial-runner.mjs';

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
    ...Object.values(TARGET_IDS), ...SOURCES.flatMap((s) => [...s.uses, ...s.wants, ...(s.ready ?? [])]),
  ].flat();
  assert.deepEqual(unmapped(named, CAPABILITIES), [], 'a row names a capability the table does not define');
  for (const [id, c] of Object.entries(CAPABILITIES)) {
    assert.ok(['works', 'partial', 'gap'].includes(c.status), `${id}: status "${c.status}"`);
    if (c.status !== 'works') assert.match(c.item ?? '', /^[0-6]\.[1-6]$/, `${id} is ${c.status} with no plan item`);
    else assert.equal(c.item, undefined, `${id} works and still names a plan item`);
  }
  for (const s of SOURCES) {
    const works = s.wants.filter((w) => CAPABILITIES[w].status === 'works');
    assert.deepEqual(works, [], `${s.stage} (${s.where}) wants what already works — move it to \`ready\`: ${works.join(', ')}`);
    // And the other way: a capability a stage is said to be ready to adopt has to be one the surface has.
    const notYet = (s.ready ?? []).filter((w) => CAPABILITIES[w].status !== 'works');
    assert.deepEqual(notYet, [], `${s.stage} (${s.where}) is marked ready for what does not work yet: ${notYet.join(', ')}`);
  }
});

// Plan item 3.1's acceptance: the format is not a format until the tutorials that exist can be written
// in it. Every scenario that names a cube and something happening to it is converted — the ones written
// in the cube's own frame relabelled into the child's — and read back by the format's own checker.
test('every scenario is expressible as a script', () => {
  const expressed = [];
  for (const sc of SCENARIOS) {
    const doc = scriptFor(sc, kit);
    if (doc === null) {
      assert.equal(sc.kind, 'covered', `${sc.id}: nothing to express, and it is not a scenario pinned elsewhere`);
      continue;
    }
    assert.equal(kit.checkScript(doc), doc, `${sc.id}: its script is refused`);
    expressed.push(sc.id);
  }
  assert.ok(expressed.length >= SCENARIOS.length - 4, `only ${expressed.length} of ${SCENARIOS.length} scenarios are expressible`);
  // And the conversion is real: a scenario written in the cube's own frame comes out in the child's.
  const tumbled = SCENARIOS.find((s) => s.kind === 'identity' && s.orientation === 'D B');
  const script = scriptFor(tumbled, kit);
  assert.notEqual(script.steps.find((x) => x.move).move, tumbled.alg,
    'a tumbled scenario was copied rather than relabelled — its letters mean different faces to the child');
  assert.equal(kit.run(kit.parse(script.steps.find((x) => x.move).move), tumbled.orientation.split(' '), kit.SOLVED).drawn.join(' '),
    tumbled.alg, 'the relabelled moves do not draw the scenario they came from');
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

test('every player scenario has exactly one home: node runs it, or the browser suite does', () => {
  const kinds = new Set(SCENARIOS.filter((s) => s.half === 'player' && s.kind !== 'covered').map((s) => s.kind));
  for (const kind of kinds) {
    const homes = [Object.hasOwn(PLAYER_RUNNERS, kind), BROWSER_PLAYER_KINDS.includes(kind)].filter(Boolean).length;
    assert.equal(homes, 1, `player kind "${kind}" is run by ${homes} suites`);
  }
  for (const kind of BROWSER_PLAYER_KINDS) assert.ok(kinds.has(kind), `the browser claims "${kind}", which no scenario is`);
});

for (const sc of SCENARIOS.filter((s) => s.half === 'player' && s.kind !== 'covered' && !BROWSER_PLAYER_KINDS.includes(s.kind))) {
  const open = OPEN_ITEMS.includes(sc.closedBy);
  test(`${sc.id} (${sc.source})`, async (t) => {
    await underGapRules(t, sc, open, () => {
      const runner = PLAYER_RUNNERS[sc.kind];
      if (!runner) throw new Error(`no runner for "${sc.kind}" yet — it arrives with plan item ${sc.closedBy}`);
      return runner(sc, strictKit(kit));
    });
  });
}
