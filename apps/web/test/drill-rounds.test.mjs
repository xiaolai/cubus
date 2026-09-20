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

const SCREEN = readFileSync(new URL('../lib/screens/drill/round-play.js', import.meta.url), 'utf8');

test('the Drill screen says results are not saved, in its own words', () => {
  // Its OWN banner: changing the shared `PREVIEW_NOTE` would have re-described the Alg trainer,
  // which is still a design in full.
  assert.match(SCREEN, /Results are not saved/);
  const lessons = readFileSync(new URL('../lib/screens/lessons.js', import.meta.url), 'utf8');
  assert.match(lessons, /PREVIEW_NOTE/, 'the Trainer still needs the shared preview note');
});

test('the grades stay disabled and the figures stay dashes', () => {
  // The engine measures which faces were picked. It does not measure a child executing an
  // algorithm, so an "average execution" built from it would be a number about a different
  // activity — which is the thing this repository refuses to put on a screen.
  const grades = [...SCREEN.matchAll(/<button class="btn[^>]*>\$\{escHtml\(t\('(Again|Good|Easy)'\)\)\}/g)];
  assert.equal(grades.length, 3, 'the three grade buttons are still drawn');
  for (const m of grades) {
    assert.match(m[0], /disabled/, `the ${m[1]} grade is no longer disabled, but nothing records it`);
  }
  assert.match(SCREEN, /nothing is recorded, so there is nothing to average/);
});

test('the screen never writes a figure it did not compute', () => {
  // A number in this file would have to come from somewhere, and there is nowhere: no store, no
  // counter, no history. The two places a figure would go both hold an em dash.
  //
  // `style="…"` is stripped first: CSS is full of percentages (`width:100%`) and none of them is a
  // claim about a learner. Reading the raw source flagged the layout and would have forced the
  // stylesheet to be written around a test, which is a guard making the code worse.
  const text = SCREEN.replace(/style="[^"]*"/g, '');
  assert.ok(!/\b\d+\s*%/.test(text), 'a percentage appeared on a screen that measures nothing');
  assert.ok(!/\bao\d+\b/i.test(text), 'an average-of-N appeared on a screen that records nothing');
});
