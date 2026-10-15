// The cube screen makes the offer, and a rung goes up only by an answer to it — §3 rule 3.
//
// `method-ladder.test.mjs` proves the RULES. This file proves they are attached to the app, which
// is the half that fails silently: an offer nobody can answer, a rung raised without an answer, a
// lesson kept from before the rung changed. The Lessons screen that drew the whole ladder was
// removed (ADR 0010); Settings shows the rungs and can reset them.
//
// Source-text assertions, like solve-tier-wiring.test.mjs, for the same reason: these are
// questions about wiring.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LADDER, STAGE_IDS } from '../lib/method-solver.js';
import { blockAt, readAppSource } from './app-source.mjs';

const app = readAppSource();
const code = app
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/[^\n]*$/gm, '')
  .replace(/([^:'"`])\/\/[^\n]*/g, '$1');

test('the offer is on the cube screen, once per lesson, and answerable both ways', () => {
  // §3 rule 3. "Right there" is the cube screen — the moment the solve ends — not a notification
  // and not a settings row.
  assert.match(code, /id="rungOffer"/);
  assert.match(code, /id="rungYes"/);
  assert.match(code, /id="rungNot"/, 'an offer with no way to decline is an ask');
  const answer = blockAt(code, 'const answerOffer = (yes) =>');
  assert.ok(answer, 'the offer must have a handler');
  assert.match(answer, /raiseRung\(offer\)/, 'accepting must go through the shared operation');
  assert.match(answer, /declineOffer\(/);
  const raise = blockAt(code, 'function raiseRung(offer)');
  assert.match(raise, /state\.cube\.lesson = null/, 'accepting invalidates the lesson on screen');
  // Once per WALK: sync() fires on every step and every seek, and a learner scrubbing back and
  // forth must not be credited with a dozen solves.
  assert.match(code, /creditedWalk !== walkGen/);
  assert.match(code, /creditedWalk = walkGen/);
  // The offer says what the next rung is FOR, so every rung must carry a description worth reading.
  for (const id of STAGE_IDS) {
    for (const stage of LADDER[id]) {
      assert.ok(stage.blurb.length > 20, `${id} rung ${stage.rung} has no description worth reading`);
    }
  }
});

test('a follow is credited only for the stages the lesson actually contained', () => {
  // A cube whose cross was already solved taught nothing about the cross.
  assert.match(code, /recordCleanFollow\(\s*settings\.rungProgress,\s*lesson\.sections\.map/);
});

test('nothing is raised without an answer, and nothing is stored unrepaired', () => {
  // The whole of "never ask": `settings.rungs` is raised by ONE function, and written otherwise only by
  // the repair that reads it back off untrusted storage. It used to be raised from two places — the
  // cube screen's answered offer and the Lessons ladder each carried their own copy of "take the
  // offer, write both halves, throw the cached lesson away, persist", which is four steps in two
  // places and four chances to forget the third.
  //
  // A THIRD WRITER SINCE ADR 0010: Settings' reset, and it can only LOWER — every stage to its default
  // rung, never to one nobody accepted. It is held here by what it writes, not trusted by name.
  const writes = [...code.matchAll(/settings\.rungs = ([^;]+);/g)].map((m) => m[1].trim());
  assert.deepEqual(writes.sort(), ['next.rungs', 'repairRungs(settings.rungs)', '{ ...DEFAULT_RUNGS }'].sort(),
    `settings.rungs is written from somewhere else: ${writes.join(' | ')}`);
  const reset = blockAt(code, 'function resetRungs()');
  assert.match(reset, /settings\.rungs = \{ \.\.\.DEFAULT_RUNGS \};/, 'the reset writes something other than the first rungs');
  assert.match(reset, /state\.cube\.lesson = null/, 'a reset must throw away a lesson worked out at the old rungs');
  // And the offer reaches it rather than growing its own copy again.
  const raise = blockAt(code, 'function raiseRung(offer)');
  assert.ok(raise, 'the shared rung-raising operation is gone');
  assert.match(raise, /state\.cube\.lesson = null/,
    'raising a rung must throw away a lesson worked out at the old ones');
  assert.equal([...code.matchAll(/raiseRung\(/g)].length, 2,
    'raiseRung must be defined once and called from the offer alone');
  assert.match(code, /settings\.rungProgress = repairProgress\(settings\.rungProgress\)/,
    'localStorage is untrusted input');
});

test('the cross table is warmed for a learner who raised the rung LATER', () => {
  // The bug verification caught: `warmSolver` returns early once the two-phase worker is warm, and
  // the cross warm-up was called after that return. A learner on rung 0 at first warm who is later
  // offered rung 1 would therefore never warm the table, and their first lesson at the new rung
  // would pay the 804 ms the warm-up exists to move. The call has to come BEFORE the early return.
  const fn = blockAt(code, 'function warmSolver()');
  assert.ok(fn, 'warmSolver is gone');
  const warm = fn.indexOf('warmCrossTable()');
  const bail = fn.indexOf('if (solverWarmed) return;');
  assert.ok(warm >= 0, 'warmSolver must warm the cross table');
  assert.ok(bail >= 0, 'warmSolver still has its early return');
  assert.ok(warm < bail,
    'warmCrossTable() is after the early return, so a rung raised later never warms the table');
  // And it only builds for a learner who is actually on that rung.
  const table = blockAt(code, 'function warmCrossTable()');
  assert.match(table, /settings\.rungs\?\.cross \?\? 0\) < 1/, 'rung 0 must not pay for rung 1');
  assert.match(table, /setTimeout\(/, 'the build must not run in the turn that triggered it');
  // And it is not ONE task once it starts. `warmCross` expands a bounded number of positions per
  // slice and yields between them; deferring a 114 ms block by one turn only moves which turn
  // freezes.
  assert.match(table, /warmCross\(\)\)?\s*\)?/, 'the build must go through warmCross');
  assert.match(table, /\.catch\(/, 'a sliced build is a promise, and its failure must be caught');
  // And a build that failed is tried again, like the solver's own warm-up (found by audit,
  // 2026-09-13).
  assert.match(table, /crossTableWarmed = false;/, 'a cross warm-up that failed is never tried again');
});
