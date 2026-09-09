// The Lessons screen is the ladder, and the cube screen makes the offer — §3 rules 2 and 3.
//
// `method-ladder.test.mjs` proves the RULES. This file proves they are attached to a screen, which
// is the half that fails silently: a ladder that draws the current rung only, an offer nobody can
// answer, a rung raised without an answer, a lesson kept from before the rung changed.
//
// Source-text assertions, like solve-tier-wiring.test.mjs, for the same reason: these are
// questions about wiring.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { LADDER, STAGE_IDS } from '../lib/method-solver.js';
import { FOLLOWS_TO_OFFER, RE_OFFER_GAP } from '../lib/method-ladder.js';

const app = readFileSync(new URL('../lib/app.js', import.meta.url), 'utf8');
const code = app
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/[^\n]*$/gm, '')
  .replace(/([^:'"`])\/\/[^\n]*/g, '$1');

/** The body of `SCREENS.lessons`, which is the whole of rule 2's surface. */
const lessons = code.match(/SCREENS\.lessons = \(\) => \{[\s\S]*?\n\};/)?.[0] ?? '';

test('the Lessons screen draws the ladder rather than a syllabus', () => {
  assert.ok(lessons, 'SCREENS.lessons is gone');
  assert.match(lessons, /ladderRows\(settings\.rungs, settings\.rungProgress\)/,
    'the ladder must be read from the learner\'s own rungs');
  // The placeholder it replaces. A chapter list is a plan; a ladder is a place you are standing.
  assert.doesNotMatch(lessons, /CHAPTER/, 'the placeholder syllabus is back');
  assert.doesNotMatch(lessons, /Keyhole F2L|Look-ahead drills/, 'and so are its invented lessons');
});

test('a rung not yet reached is described, not hidden', () => {
  // §3 rule 2, and the sentence the whole screen turns on: "a ladder you can see is a goal, a
  // dropdown is a chore." Drawing `row.rungs` and not a filtered subset is what makes that true.
  assert.match(lessons, /row\.rungs\.map/, 'the screen must draw every rung of a stage');
  assert.doesNotMatch(lessons, /rungs\.filter\(\(r\) => r\.reached\)/, 'a filtered ladder hides the goal');
  assert.match(lessons, /r\.blurb/, 'and each rung must say what it is FOR');
  // Every rung really does carry a description, so "described" is not an empty promise.
  for (const id of STAGE_IDS) {
    for (const stage of LADDER[id]) {
      assert.ok(stage.blurb.length > 20, `${id} rung ${stage.rung} has no description worth reading`);
    }
  }
});

test('the screen states measurements, never claims about a course nobody took', () => {
  // What the placeholder got right and must not be lost: no "Done", no "4/4", no progress claim
  // over a thing that has not happened. A count of solves actually followed is a measurement.
  assert.match(lessons, /followsUntilOffer/, 'the "not yet" line must be computed, not written');
  assert.doesNotMatch(lessons, /Done|COMPLETE|\d\/\d/, 'a progress claim is back on the screen');
});

test('raising a rung from the ladder is deliberate, and clears the lesson it invalidates', () => {
  const handler = lessons.match(/data-raise\]'\)\)[\s\S]*?\n {6}\}/)?.[0] ?? '';
  assert.ok(handler, 'the ladder must offer a way up');
  assert.match(handler, /acceptOffer\(settings\.rungs, settings\.rungProgress/);
  assert.match(handler, /state\.cube\.lesson = null/,
    'the cached lesson was worked out at the OLD rungs and must not be relabelled');
  assert.match(handler, /save\('cubusSettings', settings\)/, 'and the new rung must survive a reload');
});

test('the offer is on the cube screen, once per lesson, and answerable both ways', () => {
  // §3 rule 3. "Right there" is the cube screen — the moment the solve ends — not a notification
  // and not a settings row.
  assert.match(code, /id="rungOffer"/);
  assert.match(code, /id="rungYes"/);
  assert.match(code, /id="rungNot"/, 'an offer with no way to decline is an ask');
  const answer = code.match(/const answerOffer = \(yes\) => \{[\s\S]*?\n {6}\};/)?.[0] ?? '';
  assert.ok(answer, 'the offer must have a handler');
  assert.match(answer, /acceptOffer\(/);
  assert.match(answer, /declineOffer\(/);
  assert.match(answer, /state\.cube\.lesson = null/, 'accepting invalidates the lesson on screen');
  // Once per WALK: sync() fires on every step and every seek, and a learner scrubbing back and
  // forth must not be credited with a dozen solves.
  assert.match(code, /creditedWalk !== walkGen/);
  assert.match(code, /creditedWalk = walkGen/);
});

test('a follow is credited only for the stages the lesson actually contained', () => {
  // A cube whose cross was already solved taught nothing about the cross.
  assert.match(code, /recordCleanFollow\(\s*settings\.rungProgress,\s*lesson\.sections\.map/);
});

test('nothing is raised without an answer, and nothing is stored unrepaired', () => {
  // The whole of "never ask": the only writers of `settings.rungs` are the two answers.
  const writes = [...code.matchAll(/settings\.rungs = ([^;]+);/g)].map((m) => m[1].trim());
  assert.deepEqual(writes.sort(), ['next.rungs', 'next.rungs', 'repairRungs(settings.rungs)'].sort(),
    `settings.rungs is written from somewhere else: ${writes.join(' | ')}`);
  assert.match(code, /settings\.rungProgress = repairProgress\(settings\.rungProgress\)/,
    'localStorage is untrusted input');
});

test('the cross table is warmed for a learner who raised the rung LATER', () => {
  // The bug verification caught: `warmSolver` returns early once the two-phase worker is warm, and
  // the cross warm-up was called after that return. A learner on rung 0 at first warm who is later
  // offered rung 1 would therefore never warm the table, and their first lesson at the new rung
  // would pay the 804 ms the warm-up exists to move. The call has to come BEFORE the early return.
  const fn = code.match(/function warmSolver\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(fn, 'warmSolver is gone');
  const warm = fn.indexOf('warmCrossTable()');
  const bail = fn.indexOf('if (solverWarmed) return;');
  assert.ok(warm >= 0, 'warmSolver must warm the cross table');
  assert.ok(bail >= 0, 'warmSolver still has its early return');
  assert.ok(warm < bail,
    'warmCrossTable() is after the early return, so a rung raised later never warms the table');
  // And it only builds for a learner who is actually on that rung.
  const table = code.match(/function warmCrossTable\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(table, /settings\.rungs\?\.cross \?\? 0\) < 1/, 'rung 0 must not pay for rung 1');
  assert.match(table, /setTimeout\(/, 'the build must not run in the turn that triggered it');
  // And it is not ONE task once it starts. `warmCross` expands a bounded number of positions per
  // slice and yields between them; deferring a 114 ms block by one turn only moves which turn
  // freezes.
  assert.match(table, /warmCross\(\)\)?\s*\)?/, 'the build must go through warmCross');
  assert.match(table, /\.catch\(/, 'a sliced build is a promise, and its failure must be caught');
});

test('the numbers the screen leans on are the module\'s, not a copy', () => {
  // A screen that said "three more solves" while the rule used four would be a lie nobody could
  // see. Nothing in app.js may hard-code either number.
  assert.ok(FOLLOWS_TO_OFFER > 0 && RE_OFFER_GAP > 0);
  assert.doesNotMatch(lessons, /FOLLOWS_TO_OFFER|RE_OFFER_GAP|\b3 more\b/,
    'the screen must ask the module rather than repeat its constants');
});
