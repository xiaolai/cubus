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

test('no shipped method uses the planned cross, so nothing warms its table (ADR 0011)', () => {
  // The warm-up was gated on `settings.rungs.cross >= 1`, which no method in the registry reaches: Beginner
  // is rung 0 everywhere. A warm-up nobody can trigger is code that only looks like it does something, so
  // it is gone; a future method that plans its cross whole warms the table from its own entry.
  assert.doesNotMatch(code, /warmCrossTable|crossTableWarmed/, 'the cross table is still warmed');
  assert.doesNotMatch(code, /settings\.rungs\?\.cross/, 'the solver service still reads the cross rung');
});
