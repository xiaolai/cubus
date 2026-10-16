// The beginner's lesson, byte for byte, against the record frozen before ADR 0011 moved the method into a
// registry (dev-docs/solve-methods-plan.md Phase 1). The registry is claimed to change nothing a learner
// sees; this is where that claim fails if it stops being true.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync } from 'node:fs';

import { baselineCubes, bootLesson, lessonRecord } from './fixtures/beginner-lesson.mjs';

const frozen = JSON.parse(readFileSync(new URL('./fixtures/beginner-lesson.json', import.meta.url), 'utf8'));
let booted;

before(async () => { booted = await bootLesson(); });
after(async () => { await booted?.win.happyDOM.abort(); });

test('the frozen record covers the cubes it claims to, and every stage of the course\'s route', () => {
  assert.deepEqual(frozen.cases.map((c) => c.facelets), baselineCubes(), 'the fixture is about other cubes');
  const stages = new Set(frozen.cases.flatMap((c) => c.lesson.steps.map((s) => s.stage)));
  for (const stage of ['cross', 'first-layer', 'middle-layer', 'top-cross', 'edges-home', 'top-corners', 'corners-turned']) {
    assert.ok(stages.has(stage), `no frozen lesson walks the "${stage}" stage — the baseline does not cover it`);
  }
  // NOT the app's route: its stages must never appear in the beginner's record.
  for (const stage of ['top-face', 'oll', 'pll']) assert.ok(!stages.has(stage), `the baseline walks "${stage}"`);
});

test('the beginner lesson is what it was before the registry, on every frozen cube', async () => {
  for (const [n, { facelets, lesson }] of frozen.cases.entries()) {
    const now = await booted.lessonFor({ facelets, lesson: null });
    assert.ok(now, `cube ${n} (${facelets}): no lesson`);
    assert.deepEqual(lessonRecord(now, booted.whyText), lesson, `cube ${n} (${facelets}): the beginner lesson changed`);
  }
});
