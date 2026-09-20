// The published format, held to what the code actually does.
//
// `docs/course-format.md` is the half of ADR 0006 that makes a closed course a CHOICE rather than a
// lock: the player is open, so anyone may write a lesson for it. That promise is worth exactly as
// much as the document is accurate, and a specification nobody checks rots faster than code.
//
// Two things are pinned here:
//
//   1. **The round trip the spec tells authors to run.** `checkLesson` is necessary and NOT
//      sufficient — it accepts scripts the drivers then refuse — so the contract is
//      validate → build → drive. This is the nearest thing to a real outside author that can be
//      had without one: a document written against the spec alone, put through the three steps.
//   2. **The vocabularies the spec lists.** The field tables are not prose to be maintained by
//      hand; they are the module's own exported lists, and a field added or renamed in the code
//      fails here until the document says so.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { checkLesson, MIN_PER_MOVE, resolveSpanning, SPAN_LEAD, STEP_CUES, STEP_KINDS } from '../lib/cube-kit.js';
// Not through the kit: `EPISODE_CUE_FIELDS` and `ROUND_QUESTIONS` are the format module's own
// vocabularies and are not part of the promised public surface. ADR 0005 decision 4 makes every
// kit export a promise, so widening that surface for a test's convenience would be a commitment
// made for the wrong reason.
import { EPISODE_CUE_FIELDS, ROUND_QUESTIONS } from '../lib/lesson-format.js';
import { buildScript } from '../lib/script-view.js';
import { createClockDriver, timelineOf } from '../lib/script-drive.js';
import { buildSchedule } from '../lib/lesson-schedule.js';
import { answerAt } from '../lib/script-rounds.js';
import { courseAudioRef } from '../lib/course-source.js';
import { CORNERS, EDGES, SOLVED, applyAlg } from '../lib/cube-pieces.js';

/**
 * The format document — in `dev-docs/`, which is gitignored, because the format is not published
 * yet (owner's call, 2026-09-20).
 *
 * So this file SKIPS rather than passes when the document is absent, which is what a clone and CI
 * see. That is the rule `csp.test.mjs` and `stage.test.mjs` already follow for the maintainer's
 * files: a check that could not run is reported as unchecked, never counted green. When the format
 * is published this moves back to `docs/` and the skip disappears.
 */
const SPEC_PATH = new URL('../../../dev-docs/course-format.md', import.meta.url);
const SPEC = existsSync(SPEC_PATH) ? readFileSync(SPEC_PATH, 'utf8') : null;
const NO_SPEC = 'dev-docs/course-format.md is not in this checkout — the format is unpublished, so this is UNCHECKED here';

/** Is `name` written as a field in the spec — in a table cell or a code span? */
const names = (word) => new RegExp(`\`${word.replace(/[$.*+?^{}()|[\]\\]/g, '\\$&')}\``).test(SPEC);

test('the drift guard can tell a named field from an absent one', (t) => {
  if (!SPEC) return t.skip(NO_SPEC);
  // The guard's own acceptance. Every case below asks "is this field named in the spec?", and a
  // matcher that answered yes to everything would leave them all green while checking nothing.
  // Establishing the negative is the only thing that makes the positives mean anything.
  assert.equal(names('say'), true, 'precondition: a real field is found');
  assert.equal(names('definitelyNotAField'), false, 'the matcher says yes to a field that is absent');
  assert.equal(names('sa'), false, 'a prefix of a real field must not count as naming it');
});

test('the spec names every field an episode cue may carry', (t) => {
  if (!SPEC) return t.skip(NO_SPEC);
  const missing = EPISODE_CUE_FIELDS().filter((f) => !names(f));
  assert.deepEqual(missing, [], 'the published format omits fields the validator accepts');
});

test('the spec names every step kind and every step cue', (t) => {
  if (!SPEC) return t.skip(NO_SPEC);
  assert.deepEqual(STEP_KINDS.filter((k) => !names(k)), [], 'a step kind is missing from the spec');
  assert.deepEqual(STEP_CUES.filter((c) => !names(c)), [], 'a step cue is missing from the spec');
});

test('the spec names both round questions', (t) => {
  if (!SPEC) return t.skip(NO_SPEC);
  assert.deepEqual(ROUND_QUESTIONS.filter((q) => !SPEC.includes(q)), []);
});

test('the numbers in the spec are the numbers in the code', (t) => {
  if (!SPEC) return t.skip(NO_SPEC);
  // A specification that states a constant is a second place for it to be wrong. These two are
  // quoted because an author needs them to write timings at all.
  assert.ok(SPEC.includes(`${SPAN_LEAD.toFixed(2)} s`), `the lead is ${SPAN_LEAD}`);
  assert.ok(SPEC.includes(`${MIN_PER_MOVE.toFixed(2)} s`), `the floor is ${MIN_PER_MOVE}`);
});

test('the spec states that validation is necessary and not sufficient', (t) => {
  if (!SPEC) return t.skip(NO_SPEC);
  // The correction a refute pass forced into ADR 0006. If this sentence ever leaves the document,
  // the format is being published with a known rejection boundary undocumented.
  assert.match(SPEC, /necessary and not sufficient/i);
  // TWO pipelines, named separately. One combined line implied an episode is driven by
  // `createClockDriver`, which throws — the documented route did not run.
  assert.match(SPEC, /EPISODE\s+resolveSpanning\(cues\)\s*→\s*checkLesson\(doc\)\s*→\s*buildSchedule\(doc\)\s*→\s*createLessonPlayer/);
  assert.match(SPEC, /SCRIPT\s+checkLesson\(doc\)\s*→\s*buildScript\(doc\)\s*→\s*createClockDriver\(built\)/);
  // And the order that catches people: resolve before check, never after.
  assert.match(SPEC, /resolveSpanning` runs BEFORE validation/);
});

/**
 * The JSON examples the document actually publishes, in order.
 *
 * EXTRACTED, never re-typed. The previous version of these cases wrote its own episode and its own
 * script "from the document" — so the published episode example could send a schedule to the wrong
 * driver and the published drill could reveal a slot its piece does not live in, and both of these
 * cases stayed green. A documentation acceptance that does not run the documentation is not one.
 */
const EXAMPLES = SPEC ? [...SPEC.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1])) : [];

test('the document publishes the examples these cases run', (t) => {
  if (!SPEC) return t.skip(NO_SPEC);
  // If the document grows or loses an example, this file must be re-read rather than silently
  // checking fewer things.
  assert.equal(EXAMPLES.length, 2, 'the spec no longer publishes exactly one episode and one script');
  assert.ok(EXAMPLES[0].cues, 'the first example is the episode');
  assert.equal(EXAMPLES[1].schema, 2, 'the second example is the script');
});

test('THE PUBLISHED EPISODE runs the pipeline the document prescribes', (t) => {
  if (!SPEC) return t.skip(NO_SPEC);
  const raw = EXAMPLES[0];
  // resolveSpanning BEFORE checkLesson, exactly as the document now says.
  const episode = checkLesson({ ...raw, cues: resolveSpanning(raw.cues) });
  const schedule = buildSchedule(episode);
  assert.ok(schedule, 'the published episode does not schedule');
  // And the audio reference it publishes is one the app will actually accept.
  assert.ok(courseAudioRef(raw), `the published audio reference is refused: ${JSON.stringify(raw.audio)}`);
});

test('THE PUBLISHED SCRIPT runs the pipeline the document prescribes', (t) => {
  if (!SPEC) return t.skip(NO_SPEC);
  const built = buildScript(checkLesson(EXAMPLES[1]));
  assert.ok(timelineOf(built), 'the published script has no timeline');
  assert.ok(createClockDriver(built), 'the published script does not drive');
});

test("THE PUBLISHED DRILL's reveal points where its piece actually lives", (t) => {
  if (!SPEC) return t.skip(NO_SPEC);
  // The document's own claim, checked against the cube. The first draft asked about a slot whose
  // piece was already home and revealed a slot it does not live in — and validated.
  const script = EXAMPLES[1];
  const step = script.steps.find((x) => x.round);
  const slot = step.round.ask.replace('pieceIn:', '');
  const state = applyAlg(SOLVED, script.start.scramble);
  const edge = EDGES.indexOf(slot);
  const home = edge >= 0 ? EDGES[state.ep[edge]] : CORNERS[state.cp[CORNERS.indexOf(slot)]];

  assert.notEqual(home, slot, 'the published example asks about a piece that is already home');
  assert.deepEqual(step.round.reveal.map((r) => r.hl), [`slot:${home}`],
    'the published reveal points where the piece does not live');
  assert.equal(step.round.choose, slot.length);

  // And the engine agrees, reached the way a player reaches it.
  const built = buildScript(checkLesson(script));
  const at = built.positions.findIndex((pos) => built.script.steps[pos?.step]?.round);
  const { faces } = answerAt(built, at);
  assert.equal([...faces].sort().join(''), [...home].sort().join(''));
});

test('a script that validates but turns out of order is refused by the pipeline', (t) => {
  if (!SPEC) return t.skip(NO_SPEC);

  // THE CASE THE WHOLE DOCUMENT IS ABOUT. This script is accepted by the validator and built
  // without complaint; only driving it refuses. An author told "it validates, ship it" ships this.
  const outOfOrder = {
    schema: 2,
    steps: [
      { move: 'R U', at: 1, secs: 4 },
      { move: 'F', at: 2 },
    ],
  };
  const checked = checkLesson(outOfOrder);
  assert.ok(checked, 'precondition: the validator accepts it');
  const built = buildScript(checked);
  assert.ok(built, 'precondition: it builds');

  assert.throws(() => timelineOf(built), /before token/);
  assert.throws(() => createClockDriver(built), /a cube is turned in order/);
});

test('a round in the spec is a question the cube answers, not an answer written beside it', (t) => {
  if (!SPEC) return t.skip(NO_SPEC);
  // The spec's own claim, checked: `ask` is a question and there is no field to write the answer in.
  assert.match(SPEC, /computed from the cube/);
  const withAnswer = {
    schema: 2,
    start: { scramble: "R U R' U'" },
    steps: [{ round: { ask: 'pieceIn:BL', choose: 2, answer: ['U', 'L'] } }],
  };
  // An unknown field inside a round is refused rather than quietly ignored — which is what stops an
  // author from believing a written answer is what the drill marks against.
  assert.throws(() => checkLesson(withAnswer));
});

test('the spec is ready to publish, and says what it is not licensing', (t) => {
  if (!SPEC) return t.skip(NO_SPEC);
  // It is NOT published yet (owner's call, 2026-09-20) and lives in dev-docs/ meanwhile. This case
  // keeps it publishable: the day it moves to docs/ it must not send a reader to a file a clone has
  // not got, so it may not point into dev-docs/ even while it sits there.
  assert.ok(!SPEC.includes('dev-docs/'), 'the spec must not send a reader to a file a clone has not got');
  assert.match(SPEC, /MIT/);
  assert.match(SPEC, /not part of the app/i);
});
