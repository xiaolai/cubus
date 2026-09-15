// A script's cube at every position — plan item 3.2 of dev-docs/tutorial-capability-plan.md.
//
// THE PROPERTY THIS FILE EXISTS FOR, and it is the episode runtime's: the same position gives the same
// cube however it was reached. A driver decides WHICH position — from a time, from a cube a child
// turned, from an answer — and nothing about the picture may depend on that journey.
import assert from 'node:assert/strict';
import test from 'node:test';

import { SOLVED, applyAlg, toFacelets } from '../lib/cube-pieces.js';
import { askAt, buildScript, groupsOf, stateFrom, viewAtPosition } from '../lib/script-view.js';
import { parse } from '../lib/cube-notation.js';
import { targetPicture } from '../lib/stage-picture.js';

const SOLVED_FACELETS = toFacelets(SOLVED);
const script = (steps, start = {}) => ({ schema: 2, start, steps });
/** Every position's view, read in the order given — so the order can be varied. */
const views = (built, order) => order.map((k) => viewAtPosition(built, k));

test('a position is a stop: a regrip belongs to the turn it leads into', () => {
  assert.deepEqual(groupsOf(parse("x y R")).map((g) => g.length), [3]);
  assert.deepEqual(groupsOf(parse("R U R'")).map((g) => g.length), [1, 1, 1]);
  assert.deepEqual(groupsOf(parse('R x')).map((g) => g.length), [1, 1], 'a trailing regrip is the hold the step asked for');
  const built = buildScript(script([{ move: 'x y R' }, { move: "U R'" }]));
  // Position 0 is the script before anything; then one per stop.
  assert.deepEqual(built.positions.map((p) => p.kind), ['start', 'move', 'move', 'move']);
  assert.deepEqual(built.positions.map((p) => p.moves), [0, 3, 4, 5], 'the element seeks by TOKEN, and a stop names one');
});

test('the same position gives the same view, played, sought or stepped back', () => {
  const built = buildScript(script(
    [{ move: 'y R', focus: 'slot:UR' }, { move: "U R'" }, { hold: 'D B' }, { move: 'R' }],
    { scramble: "F R U'", hold: 'U F' },
  ));
  const order = built.positions.map((p) => p.index);
  const forwards = views(built, order);
  const backwards = views(built, [...order].reverse()).reverse();
  const jumped = views(built, [3, 0, 5, 1, 4, 2]);
  assert.deepEqual(backwards, forwards, 'stepping back gave a different cube');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((k) => jumped[[3, 0, 5, 1, 4, 2].indexOf(k)]), forwards,
    'jumping to a position gave a different cube from playing to it');
  // A rebuild is the same script read again: nothing is carried between reads.
  assert.deepEqual(views(buildScript(built.script), order), forwards);
});

test('a hold is a cut, and the element is told the cube it is holding', () => {
  const built = buildScript(script([{ move: "R U" }, { hold: 'D B' }, { move: 'R' }]));
  const cut = built.positions.find((p) => p.kind === 'hold');
  const view = viewAtPosition(built, cut.index);
  assert.equal(view.hold, 'D B');
  assert.equal(view.facelets, toFacelets(applyAlg(SOLVED, 'R U')), 'the cut loaded a cube that is not the one in front of the child');
  assert.equal(view.alg, 'R', 'the moves before the cut belong to the segment that ended');
  // The pieces did not move: a hold changes how it is held and nothing else.
  assert.deepEqual(viewAtPosition(built, cut.index).cube, viewAtPosition(built, cut.index - 1).cube);
});

test('a setup states pieces and discards the frame its rotations net', () => {
  const built = buildScript(script([{ setup: "y F' U' F U R U R' U' y'" }], { hold: 'D B' }));
  const view = viewAtPosition(built, 1);
  assert.equal(view.hold, 'D B', 'the setup changed how the cube is held');
  assert.equal(view.scramble.includes('y'), true, 'the tokens the element is given are the ones it discards the frame of');
  assert.deepEqual(view.cube, stateFrom(toFacelets(view.cube)), 'the setup left something that is not a cube');
});

// The case plan item 3.1 names, and the reason a picture is not a state: a stage target says where the
// cross edges are and claims nothing about the rest, so inside the segment it opens every question is
// answered from IT — and the model it replaced, which knows perfectly well where DR went, is not asked.
test('a model, a picture and a model again: each position answers from what is in front of the child', () => {
  const built = buildScript(script([
    { move: 'R', say: 'one turn' },
    { paint: targetPicture('cross'), say: 'this is what we are aiming at' },
    { cube: SOLVED_FACELETS, say: 'and back to a real cube' },
    { move: 'R' },
  ]));
  const [start, afterR, painted, restored] = built.positions.map((p) => p.index);

  assert.equal(askAt(built, start, 'whereIs:DR').slot, 'DR');
  assert.equal(askAt(built, afterR, 'whereIs:DR').slot, 'FR', 'precondition: R takes the DR edge to FR');
  assert.equal(askAt(built, painted, 'whereIs:DR').slot, 'DR',
    'the picture was asked and the model answered — a target that says DR is home was overruled by the cube it replaced');
  assert.equal(viewAtPosition(built, painted).isPicture, true);
  assert.deepEqual([...askAt(built, painted, 'whereIs:UR').unknown], ['?'],
    'a picture that claims nothing about UR answered anyway');
  assert.equal(viewAtPosition(built, restored).isPicture, false);
  assert.equal(askAt(built, restored, 'whereIs:DR').slot, 'DR');

  // And every one of those answers is the same whichever way the position was reached.
  const order = built.positions.map((p) => p.index);
  const asked = (seq) => seq.map((k) => askAt(built, k, 'whereIs:DR').slot);
  assert.deepEqual(asked([...order].reverse()).reverse(), asked(order));
});

// R9 of dev-docs/adr/0004-orientation-notation-and-colour-are-three-things.md: a cue binds where it is
// written. The view carries both — what the cue says, and the position it took effect at — so a driver
// writes the piece the lesson meant rather than whatever is in that slot when the child scrubs past.
test('a cue in force says where it took effect, and a question in one is answered there', () => {
  const built = buildScript(script([
    { move: 'R', hl: 'ask:whereIs:DR' },
    { move: 'U' },
    { move: "R'" },
    { move: 'U', hl: 'slot:UR' },
  ]));
  const lit = [1, 2, 3].map((k) => viewAtPosition(built, k).cues.hl);
  assert.deepEqual(lit, ['piece:DR', 'piece:DR', 'piece:DR'],
    'an inherited cue was re-answered at every position — which is the bug R9 is about');
  assert.deepEqual([1, 2, 3].map((k) => viewAtPosition(built, k).bound.hl.at), [1, 1, 1], 'the binding moved');
  assert.equal(viewAtPosition(built, 4).cues.hl, 'slot:UR', 'a later cue did not replace the one before it');
  assert.equal(viewAtPosition(built, 0).cues.hl, undefined, 'a cue took effect before the step that gives it');
  // Clearing is a value of its own.
  const cleared = buildScript(script([{ move: 'R', focus: 'slot:UR' }, { move: 'U', focus: null }]));
  assert.equal(viewAtPosition(cleared, 1).cues.focus, 'slot:UR');
  assert.equal(viewAtPosition(cleared, 2).cues.focus, undefined);
});

test('a question with no answer lights nothing rather than leaving the last one glowing', () => {
  // On a solved cube every top edge carries the top colour, so the question has no answer at all.
  const built = buildScript(script([{ move: 'U', hl: 'ask:topEdgesWithoutTopColour' }]));
  assert.deepEqual([...askAt(built, 1, 'topEdgesWithoutTopColour').pieces], [], 'precondition: nothing to light');
  assert.equal(viewAtPosition(built, 1).cues.hl, 'none', 'an empty answer wrote an empty selector, which the element reads as "no change"');
  // And a question that does have one is lit as pieces, not as the slots they happen to be in.
  const lit = buildScript(script([{ move: 'R', hl: 'ask:topEdgesWithoutTopColour' }]));
  assert.equal(viewAtPosition(lit, 1).cues.hl, 'piece:FR');
});

test('a position outside the script is clamped rather than answered with nothing', () => {
  const built = buildScript(script([{ move: 'R' }]));
  assert.equal(viewAtPosition(built, -5).position, 0);
  assert.equal(viewAtPosition(built, 99).position, built.positions.length - 1);
  assert.equal(viewAtPosition(built, 'nonsense').position, 0);
});
