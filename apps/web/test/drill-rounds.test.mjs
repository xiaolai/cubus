// Generated drill rounds, and what the Drill screen is still not allowed to claim.
//
// Two halves. The generator has to produce rounds that are ALWAYS answerable and always about a
// piece that is not already home — a drill whose question is "where does this piece live" is a
// trick when the piece is already living there. And the screen has to keep saying what it does not
// know: the engine measures which FACES were picked, not a child executing an algorithm, so the
// queue and the averages stay dashes and the banner narrows rather than disappearing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CORNERS, EDGES, SOLVED, applyAlg } from '../lib/cube-pieces.js';
import { DRILL_TURNS, drillAlg, makeRound, recognitionScript, unsolvedSlot } from '../lib/drill-rounds.js';
import { CUBE_VIEW } from '../lib/cube-view.js';
import { checkLesson } from '../lib/lesson-format.js';
import { answerAt, createRound } from '../lib/script-rounds.js';
import { blockAt } from './app-source.mjs';
import { buildScript } from '../lib/script-view.js';
import { lcg } from './fixtures/seeded-scrambles.mjs';

/**
 * A deterministic source, so a generator test is a test and not a lottery.
 *
 * The repo's own seeded draw, ADAPTED rather than re-written: `lcg` yields a float in [0, 1) and
 * `randomBelow` wants what `cryptoUint32` gives it. A private copy of the same arithmetic is what
 * `seeded-scrambles.test.mjs` refuses, and it is right to — two fixtures describing different
 * cubes the day one is edited is a hard failure to see.
 */
const seeded = (seed = 1) => {
  const rnd = lcg(seed);
  return () => Math.floor(rnd() * 4294967296);
};

/** The position in a built script that actually asks something. */
const roundPosition = (built) => built.positions.findIndex((p) => built.script.steps[p?.step]?.round);

test('a drill position is stirred, and never turns the same face twice running', () => {
  const rng = seeded(7);
  for (let i = 0; i < 40; i += 1) {
    const moves = drillAlg(rng).split(' ');
    assert.equal(moves.length, DRILL_TURNS);
    for (let k = 1; k < moves.length; k += 1) {
      assert.notEqual(moves[k][0], moves[k - 1][0], `${moves[k - 1]} ${moves[k]} turns one face twice`);
    }
    assert.ok(moves.every((m) => /^[URFDLB](['2])?$/.test(m)), `not a face turn: ${moves.join(' ')}`);
  }
});

test('the slot asked about always holds a piece that is not at home', () => {
  const rng = seeded(11);
  for (let i = 0; i < 60; i += 1) {
    const state = applyAlg(SOLVED, drillAlg(rng));
    const chosen = unsolvedSlot(state, rng);
    assert.ok(chosen, 'a stirred cube offered nothing to ask about');
    // The whole point: a slot whose own piece is sitting in it has a trivial answer.
    const home = chosen.kind === 'edge' ? state.ep[chosen.slot] : state.cp[chosen.slot];
    assert.notEqual(home, chosen.slot);
  }
});

test('a solved cube has nothing to ask about, and says so rather than inventing one', () => {
  assert.equal(unsolvedSlot(SOLVED, seeded(3)), null);
});

test('every generated round validates, builds, and is answerable from the cube', () => {
  // INDEPENDENTLY DERIVED. This used to take `answerAt`'s answer and feed it back into a grader
  // that computes the same answer the same way, which is a tautology: an audit made every reveal
  // highlight `UF` and all eleven cases passed, because nothing here looked at the reveal and the
  // answer was only ever compared with itself. The occupant and its home are worked out here from
  // the piece state, and the round's own parts are checked against THAT.
  const rng = seeded(23);
  for (let i = 0; i < 25; i += 1) {
    const round = makeRound(rng);
    const built = buildScript(checkLesson(round.script));
    const at = roundPosition(built);
    assert.ok(at >= 0, 'the generated script has no round in it');

    // Where the piece in the asked slot actually lives, from the state the alg produces.
    const state = applyAlg(SOLVED, round.alg);
    const edge = EDGES.indexOf(round.slot);
    const home = edge >= 0 ? EDGES[state.ep[edge]] : CORNERS[state.cp[CORNERS.indexOf(round.slot)]];
    assert.equal(round.home, home, 'the round names the wrong home for the piece in its slot');

    // The QUESTION names the asked slot, and the REVEAL lights the home the cube says it has.
    const ask = built.script.steps[built.positions[at].step].round;
    assert.equal(ask.ask, `pieceIn:${round.slot}`);
    assert.deepEqual(ask.reveal, [{ hl: `slot:${home}` }], 'the reveal points somewhere the piece does not live');

    const { faces, choose } = answerAt(built, at);
    assert.equal(choose, round.slot.length, 'an edge asks for two faces and a corner for three');
    // The engine's answer is the set of faces the HOME slot touches — checked against the home
    // derived above, not against the engine's own output.
    assert.equal([...faces].sort().join(''), [...home].sort().join(''),
      'the computed answer is not the faces the piece belongs on');

    const live = createRound(built, at);
    for (const f of faces) live.select(f);
    assert.equal(live.state.verdict, 'right');
  }
});

test('a round shows the piece it asks about', () => {
  // The defect this pins: a script that names neither ghosts nor a camera gets the driver's bare
  // defaults — `ghosts="none"` — so a slot at the BACK of the cube was lit and the child was then
  // graded right or wrong on stickers they had never been shown. `CUBE_VIEW` is the app's tuned
  // look, ghosts included, and asserting against it rather than against literals means the drill
  // cannot drift away from how the rest of the app draws a cube.
  const first = recognitionScript({ alg: "R U R'", slot: 'DB', home: 'UF' }).steps[0];
  assert.equal(first.ghosts, true, 'a hidden sticker would be unreachable without ghosts');
  assert.deepEqual(first.cam, [CUBE_VIEW.camLat, CUBE_VIEW.camLon]);
  // And every generated round, not only a hand-made one.
  const rng = seeded(5);
  for (let i = 0; i < 10; i += 1) {
    const step = makeRound(rng).script.steps[0];
    assert.equal(step.ghosts, true);
    assert.deepEqual(step.cam, [CUBE_VIEW.camLat, CUBE_VIEW.camLon]);
  }
});

test('a generated round carries no words at all', () => {
  // ADR 0006 decision 7, at the cheapest place to hold it: the QUESTION is the screen's, in the
  // app's own copy, so the script the drill generates has nothing authored in it to leak.
  const script = recognitionScript({ alg: "R U R'", slot: 'UF' });
  const says = JSON.stringify(script).match(/"say"/g) ?? [];
  assert.deepEqual(says, [], 'a generated round grew a sentence');
  assert.ok(checkLesson(script), 'and it is still a valid script');
});

test('makeRound gives up loudly rather than looping for ever', () => {
  assert.throws(() => makeRound(seeded(1), 0), /nothing to ask about/);
});

test('a degenerate source produces a bad alg, never a hang', () => {
  // This case exists because the first version DID hang: `while (face === last) redraw` never
  // terminates against a source that keeps answering the same number, and a test's fake is exactly
  // such a source. A wrong answer is a bug; a spin is a frozen app, and the second is worse.
  const moves = drillAlg(() => 0).split(' ');
  assert.equal(moves.length, DRILL_TURNS);
  for (let k = 1; k < moves.length; k += 1) {
    assert.notEqual(moves[k][0], moves[k - 1][0], 'the no-repeat rule must hold even here');
  }
});

// ---- what the screen may not claim ------------------------------------------------------------

const SCREEN = readFileSync(new URL('../lib/screens/pieces/round-play.js', import.meta.url), 'utf8');
/**
 * The screen's CODE, with its prose removed — what every "this must not reach a screen" sweep reads.
 *
 * A scan of raw source cannot tell a comment from markup, and the comments here name the very things
 * they explain having removed: the first version of the deletion check below failed on its own note
 * saying "HOW WELL DID THAT GO row ... THIS DRILL card ... QUEUE card". Same mechanism
 * `solve-tier-wiring.test.mjs` strips comments for, and it is what lets the history of a removal stay
 * written down beside it. HTML comments too, because this file's markup is a template literal and its
 * notes live inside it.
 */
const CODE = SCREEN
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/[^\n]*$/gm, '')
  .replace(/([^:'"`])\/\/[^\n]*/g, '$1');

test('the Drill screen says results are not saved, in its own words', () => {
  // Its OWN banner: changing the shared `PREVIEW_NOTE` would have re-described the Alg trainer,
  // which is still a design in full.
  assert.match(SCREEN, /Results are not saved/);
  const lessons = readFileSync(new URL('../lib/screens/lessons.js', import.meta.url), 'utf8');
  assert.match(lessons, /PREVIEW_NOTE/, 'the Trainer still needs the shared preview note');
});

test('nothing that records nothing is offered at all — not even greyed out', () => {
  // The engine measures which faces were picked. It does not measure a child executing an algorithm,
  // so an "average execution" built from it would be a number about a different activity — which is
  // the thing this repository refuses to put on a screen.
  //
  // THIS USED TO ASSERT THE OPPOSITE: that Again / Good / Easy were drawn AND disabled. They had no
  // id, no handler and `disabled` in the markup, so they could not be pressed in any state, ever, and
  // a first-time reader had three dead controls, an em dash and a card explaining there was no queue —
  // three of the four cards in that aside, all about absence (naive-user read, 2026-09-28).
  // "Never invent data" is honoured by NOT DRAWING the widget: a dead grading row teaches a learner
  // the app is broken, while removing it says nothing false. The banner still narrows honestly, which
  // is the one sentence that was doing any work.
  for (const word of ['Again', 'Good', 'Easy']) {
    assert.ok(!new RegExp(`escHtml\\(t\\('${word}'\\)\\)`).test(CODE),
      `a ${word} grade is drawn again, and nothing records it`);
  }
  assert.ok(!/HOW WELL DID THAT GO/.test(CODE), 'the grading card is back');
  assert.ok(!/THIS DRILL/.test(CODE), 'the average card is back, and there is still nothing to average');
  assert.ok(!/QUEUE/.test(CODE), 'the queue card is back, and there is still no queue');
  assert.ok(!/nothing is recorded, so there is nothing to average/.test(CODE),
    'a card exists only to say it is empty');
  // What DOES remain is the honest narrowing, and it is the whole of what this screen disclaims — and
  // it no longer points at furniture that is gone: the sentence used to end "the queue and averages
  // are still a preview" while naming a QUEUE card and an average card this change deleted.
  assert.match(CODE, /Practice works\. Results are not saved\./);
  assert.ok(!/queue and averages/.test(CODE), 'the banner names cards that are no longer on screen');
});

test('the reveal can be played again, and the button says so only when there is one', () => {
  // The only control this drill was genuinely missing. The reveal plays stop by stop with a beat and
  // Next deals a NEW round, so a child who looked away during the one they got wrong had lost it.
  assert.match(CODE, /id="drillAgain"/, 'there is no way to see the reveal a second time');
  const btn = /<button[^>]*id="drillAgain"[^>]*>/.exec(CODE);
  assert.ok(btn, 'the replay button is not a button');
  assert.match(btn[0], /disabled/, 'the replay is offered before there is anything to replay');
  // Enabled when the answer lands, disabled again when a fresh round is loaded.
  assert.match(CODE, /if \(again\) again\.disabled = false;/, 'answering does not offer the replay');
  assert.match(CODE, /if \(again\) again\.disabled = true;/, 'a new round still offers a replay of the old one');
  // GUARDED ON `locked`, not on `revealing`: `revealing` stays true from the answer until the next
  // load, so guarding on it would refuse every press — an enabled button that does nothing, which is
  // the very thing the deletion above removes.
  //
  // READ FROM THE REPLAY HANDLER'S OWN BLOCK, brace-matched. Scanned over the whole file this check
  // matched `pick`'s guard, which is guarded on `revealing` correctly and must stay that way — the
  // assertion was failing on the one use of the flag that is right.
  const replay = blockAt(CODE, "again?.addEventListener('click', () => {");
  assert.ok(replay, 'the replay handler is not where this test can find it');
  assert.ok(!/revealing/.test(replay), 'the replay is guarded on a flag that is always set once answered');
  assert.match(replay, /if \(!driver\?\.round\?\.locked\) return;/, 'the replay does not check there is an answer');
  assert.match(replay, /driver\.replay\(\)/, 'the replay does not reset the reveal, so it would play nothing');
  // ONE reveal loop, so the replay cannot drift from the first playing.
  assert.equal((CODE.match(/driver\.reveal\(\) > 0/g) ?? []).length, 1, 'the reveal loop is written twice');
});

test('this drill has no move transport, and that is the design', () => {
  // A ◁ ↺ ▷ ▶ transport steps through a SEQUENCE. This drill asks a question about one lit piece and
  // is answered by picking faces; there is no sequence, so a transport would drive nothing. Written
  // down because the Algorithms tab beside it has one, and an absence that looks like an oversight
  // gets "fixed" by somebody eventually.
  assert.ok(!/id="drillPlay"|id="drillBack"|id="drillNextTurn"/.test(CODE), 'a move transport appeared');
  // The REASON is prose, so it is looked for in the source and not in the comment-stripped code.
  assert.match(SCREEN, /no sequence to step through/, 'the reason the transport is absent is not written down');
});

test('the screen never writes a figure it did not compute', () => {
  // A number in this file would have to come from somewhere, and there is nowhere: no store, no
  // counter, no history. The two places a figure would have gone are gone with the cards that held
  // them — an em dash under an eyebrow is still a card about absence.
  //
  // `style="…"` is stripped first: CSS is full of percentages (`width:100%`) and none of them is a
  // claim about a learner. Reading the raw source flagged the layout and would have forced the
  // stylesheet to be written around a test, which is a guard making the code worse.
  const text = SCREEN.replace(/style="[^"]*"/g, '');
  assert.ok(!/\b\d+\s*%/.test(text), 'a percentage appeared on a screen that measures nothing');
  assert.ok(!/\bao\d+\b/i.test(text), 'an average-of-N appeared on a screen that records nothing');
});

/**
 * The draws that make `drillAlg` return a sequence which cancels to a SOLVED cube.
 *
 * Derived from the generator's own arithmetic rather than hunted for with a seed: the first turn
 * picks from six faces, every later one picks from the five that are not the last face and bumps the
 * index past it, and each turn then draws a suffix. Alternating U and D — which commute, being
 * opposite faces — with a half turn of each at the end gives eight quarter turns of U and eight of
 * D: `U D U D U D U D U D U D U2 D2`, which is the identity and has no face repeated in a row.
 *
 * A seeded stream cannot be used for this. A solved 14-turn stir is vanishingly rare, which is
 * precisely why the retry path had no coverage.
 */
const SOLVED_DRAWS = Object.freeze([
  0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 2, 2, 2,
]);

/** A source that hands back `values` in order, then falls through to a seeded stream. */
const thenSeeded = (values, seed) => {
  const rest = seeded(seed);
  let i = 0;
  return () => (i < values.length ? values[i++] : rest());
};

test('the draws used below really do produce a solved cube — the premise, checked', () => {
  // Without this the two tests under it could be passing for the wrong reason: a draw list that
  // stopped cancelling would leave them exercising the ordinary path while still going green.
  const alg = drillAlg(thenSeeded(SOLVED_DRAWS, 1));
  assert.equal(alg, "U D U D U D U D U D U D U2 D2", 'the derived draws no longer produce the cancelling sequence');
  assert.deepEqual(applyAlg(SOLVED, alg), SOLVED, 'the sequence does not cancel');
  assert.equal(unsolvedSlot(applyAlg(SOLVED, alg), seeded(1)), null, 'a solved cube must offer nothing to ask about');
});

test('a position with nothing to ask about is drawn again, and the next one is used', () => {
  // THE RETRY IS THE BEHAVIOUR, and nothing exercised it: every seeded stir has something to ask
  // about, so the loop ran exactly once in every test there was (Codex audit, 2026-10-04). Here the
  // first draw is spent on a solved cube and the round must come from the second.
  const round = makeRound(thenSeeded(SOLVED_DRAWS, 29));
  assert.ok(round.slot, 'the retry produced no round');
  assert.notDeepEqual(applyAlg(SOLVED, round.alg), SOLVED, 'the round was built on the solved position');
  assert.notEqual(round.alg, 'U D U D U D U D U D U D U2 D2', 'the rejected position was used anyway');
});

test('a budget spent entirely on unusable positions is reported, never looped on', () => {
  // The exact budget, not "eventually": `tries` draws are made and the (tries + 1)th is never
  // attempted. Asserted by counting the draws, because a retry loop that quietly ran once more
  // would still throw and still look right.
  let draws = 0;
  const stuck = () => { draws += 1; return SOLVED_DRAWS[(draws - 1) % SOLVED_DRAWS.length]; };
  assert.throws(() => makeRound(stuck, 3), /3 positions in a row/, 'exhaustion must be named, not retried for ever');
  assert.equal(draws, 3 * SOLVED_DRAWS.length, `the budget of 3 cost ${draws} draws, not ${3 * SOLVED_DRAWS.length}`);
});
