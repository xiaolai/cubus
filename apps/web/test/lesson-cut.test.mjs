// The cut of a beginner lesson at a Restore chip (ADR 0011, plan Phase 4): ONE function that truncates
// every parallel record of the walk at one position, and that position is the first stage end where the
// chip's own predicate holds. Checked on real lessons from the booted app, against the chip's
// independent predicate and against the full lesson the cut was taken from.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { cutLesson } from '../lib/lesson-cut.js';
import { fromCube, moveCount } from '../lib/cube-pieces.js';
import { lessonSections } from '../lib/method-lesson.js';
import { BEGINNER_ENTRY } from '../lib/methods/registry.js';
import { toMethodFrame } from '../lib/solving-hold.js';
import { TARGET_BY_ID } from '../lib/stage-targets.js';
import Cube from '../vendor/cubejs.js';
import { baselineCubes, bootLesson } from './fixtures/beginner-lesson.mjs';

let booted;
before(async () => { booted = await bootLesson(); });
after(async () => { await booted?.win.happyDOM.abort(); });

const CHIPS = BEGINNER_ENTRY.stops.filter((id) => id !== 'solved');
/** The chip's independent predicate on a walk state as a lesson stores it: scan-frame facelets. */
const holdsFor = (id) => (facelets) => TARGET_BY_ID[id].verify(fromCube(Cube.fromString(toMethodFrame(facelets))));

/** Every stage end of a lesson, as [step index, position]. */
function stageEnds(lesson) {
  const ends = [];
  let at = 0;
  for (const [i, step] of lesson.steps.entries()) {
    at += moveCount(step.alg);
    if (lesson.steps[i + 1]?.stage !== step.stage) ends.push([i, at]);
  }
  return ends;
}

test('every record of the walk agrees at the cut, and each is the full lesson\'s own prefix', () => {
  let cuts = 0;
  for (const facelets of baselineCubes()) {
    const full = booted.lessonFor({ facelets, lesson: null });
    for (const chip of CHIPS) {
      const cut = cutLesson(full, holdsFor(chip));
      if (!cut) continue;
      cuts += 1;
      const n = cut.moves.length;
      const where = `${chip} on ${facelets}`;
      assert.ok(n > 0, `${where}: an empty cut was returned rather than null`);
      // The lengths, all at the one position.
      assert.equal(cut.alg.split(' ').length, n, `${where}: alg`);
      assert.equal(cut.moveStep.length, n, `${where}: moveStep`);
      assert.equal(cut.moveHolds.length, n + 1, `${where}: moveHolds`);
      assert.equal(cut.stepFacelets.length, n + 1, `${where}: stepFacelets`);
      assert.equal(cut.steps.length, cut.cutAt + 1, `${where}: steps`);
      assert.equal(cut.steps.reduce((k, s) => k + moveCount(s.alg), 0), n, `${where}: the steps\' moves are not the cut\'s moves`);
      assert.equal(Math.max(...cut.moveStep), cut.steps.length - 1, `${where}: a move belongs to a step that was cut away`);
      assert.equal(cut.sections.at(-1).to, n, `${where}: the last section does not end at the cut`);
      assert.equal(cut.sections.reduce((k, s) => k + s.steps, 0), cut.steps.length, `${where}: sections`);
      // Each a PREFIX of the full lesson: the cut drops, it never rewrites. Cues ride on the steps.
      assert.deepEqual(cut.steps, full.steps.slice(0, cut.steps.length), `${where}: steps, cues included`);
      assert.deepEqual(cut.moves, full.moves.slice(0, n), `${where}: moves`);
      assert.deepEqual(cut.moveHolds, full.moveHolds.slice(0, n + 1), `${where}: holds`);
      assert.deepEqual(cut.stepFacelets, full.stepFacelets.slice(0, n + 1), `${where}: replay states`);
      assert.deepEqual(cut.moveStep, full.moveStep.slice(0, n), `${where}: move indices`);
      assert.deepEqual(cut.sections, lessonSections(cut.steps), `${where}: sections are not the cut steps\' own`);
      // WHERE it cut: at a stage end, where the chip first holds — and at no earlier stage end.
      const ends = stageEnds(full);
      const at = ends.findIndex(([i]) => i === cut.cutAt);
      assert.ok(at >= 0, `${where}: the cut is not at a stage end`);
      assert.ok(holdsFor(chip)(cut.stepFacelets[n]), `${where}: the chip does not hold where the walk stops`);
      for (const [, position] of ends.slice(0, at)) {
        assert.ok(!holdsFor(chip)(full.stepFacelets[position]), `${where}: the chip held at an earlier stage end`);
      }
    }
  }
  assert.ok(cuts >= baselineCubes().length * 5, `only ${cuts} cuts were checked — the sample is not cutting`);
});

test('a chip that already holds, or a lesson whose records disagree, is refused — never a walk of nothing', () => {
  const facelets = baselineCubes()[0];
  const full = booted.lessonFor({ facelets, lesson: null });
  assert.equal(cutLesson(full, () => true), null, 'a chip already held produced a cut');
  assert.equal(cutLesson(full, () => false), null, 'a chip no stage end reaches produced a cut');
  assert.throws(() => cutLesson({ ...full, moveHolds: full.moveHolds.slice(1) }, () => false), /disagree/);
});

test('the app cuts the chosen method\'s lesson through the chip\'s own predicate, and only at a chip it stops at', async () => {
  const { stageLessonFor } = await import('../lib/cube-subject.js');
  const facelets = baselineCubes()[1];
  for (const chip of CHIPS) {
    const want = cutLesson(booted.lessonFor({ facelets, lesson: null }), holdsFor(chip));
    const got = stageLessonFor({ facelets, lesson: null }, BEGINNER_ENTRY, TARGET_BY_ID[chip]);
    assert.deepEqual(got, want, `${chip}: the app's cut is not the cut of its own lesson at the chip's predicate`);
  }
  // Not a stop of the method (a set pattern), and the whole cube: no cut, the caller's other routes.
  assert.equal(stageLessonFor({ facelets, lesson: null }, BEGINNER_ENTRY, TARGET_BY_ID['six-cross']), null);
  assert.equal(stageLessonFor({ facelets, lesson: null }, BEGINNER_ENTRY, TARGET_BY_ID.solved), null);
});
