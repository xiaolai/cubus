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
  assert.equal(viewAtPosition(cleared, 1).cues.focus, 'piece:FR');
  assert.equal(viewAtPosition(cleared, 2).cues.focus, undefined);
});

// ADR 0004 decision 10 and R10: focus LATCHES onto the pieces it named. A driver seeks and lands cold,
// so the binding is done from the script — the element is handed pieces, and where the cube is when
// they arrive cannot change which.
test('a focus is handed to the element as the pieces it named where it took effect', () => {
  const built = buildScript(script([
    { move: 'R', focus: 'slot:UR' },       // after R, the FR edge sits in UR
    { move: 'U' },
    { move: "U' R'" },
  ]));
  const focus = built.positions.map((p) => viewAtPosition(built, p.index).cues.focus ?? null);
  assert.deepEqual(focus, [null, 'piece:FR', 'piece:FR', 'piece:FR', 'piece:FR'],
    'the focus followed the slot instead of staying on the piece it named');
  // A layer names every piece in it, and centres are pieces too.
  const layer = buildScript(script([{ move: 'R', focus: 'layer:U' }]));
  const pieces = viewAtPosition(layer, 1).cues.focus.split(',');
  assert.equal(pieces.length, 9, 'a layer is nine cubies');
  assert.ok(pieces.includes('piece:U'), 'the centre of the layer was left out');
  // Highlight stays positional: it names a place, and the element re-reads it after every turn.
  const hl = buildScript(script([{ move: 'R', hl: 'slot:UR' }, { move: 'U' }]));
  assert.equal(viewAtPosition(hl, 2).cues.hl, 'slot:UR');
});

// Decision 6: letters name positions in the hold in force WHEN THE CUE IS GIVEN. Tumbled — an x2 from the
// reference, which leaves R where it was — the child's "upper right" is the cube's D and R faces.
test('a cue\'s letters are read in the hold where it was written, and handed to the element in the cube\'s own', () => {
  const built = buildScript(script([{ move: 'R', hl: 'slot:UR' }, { move: 'y' }], { hold: 'D B' }));
  assert.equal(viewAtPosition(built, 1).cues.hl, 'slot:DR', 'held D B, the child\'s UR is the cube\'s DR');
  assert.equal(viewAtPosition(built, 2).cues.hl, 'slot:DR', 'a regrip after the cue moved the slot it names');
  const asked = buildScript(script([{ move: 'U', hl: 'ask:whereIs:UR' }], { hold: 'D B' }));
  assert.equal(viewAtPosition(asked, 1).cues.hl, 'piece:DR', 'a question answered in the child\'s letters was handed over untranslated');
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

// Plan item 4.1: a focus on ONE sticker is bound to that sticker, by its colour — so the lesson that says
// "watch the sticker on top" keeps watching it after a turn puts it on the side.
test('a sticker focus is bound to that sticker by colour, and a set to what is left of it', () => {
  const built = buildScript(script([{ move: 'R', focus: 'slot:UR/U' }, { move: 'U' }]));
  // After R, the UR slot holds the FR edge, and the sticker facing up is its F one.
  assert.equal(viewAtPosition(built, 1).cues.focus, 'piece:FR/F');
  assert.equal(viewAtPosition(built, 2).cues.focus, 'piece:FR/F', 'the sticker binding moved with the slot');
  const set = buildScript(script([{ move: 'U', focus: 'layer:U - corners - slot:UF/U' }]));
  const tokens = viewAtPosition(set, 1).cues.focus.split(',');
  assert.equal(tokens.length, 5, `four edges and the centre: ${tokens.join(' ')}`);
  assert.equal(tokens.filter((t) => t.includes('/')).length, 1, 'the edge with one sticker taken away is bound sticker by sticker');
  // Held tumbled, the sticker's face letter is read in the hold too.
  const held = buildScript(script([{ move: 'U', hl: 'slot:UF/U' }], { hold: 'D B' }));
  assert.equal(viewAtPosition(held, 1).cues.hl, 'slot:DB/D');
});

test('an arrow cue is handed over as the cube\'s own token, read in the hold where it was written', () => {
  // Held D B — an x2 from the reference, which leaves R where it was — the child's R is the cube's R, turning
  // R's way: a rotation is not a reflection.
  const built = buildScript(script([{ move: 'U', arrow: 'R' }], { hold: 'D B' }));
  assert.equal(viewAtPosition(built, 1).cues.arrow, 'R');
  // Written after a `y`, the child's right face is the cube's B. The cue is read where it is written, which is
  // the step that makes the `y`, so it is the hold that step leaves.
  const turned = buildScript(script([{ move: 'y' }, { move: 'U', arrow: 'R' }]));
  assert.equal(viewAtPosition(turned, 2).cues.arrow, 'B', 'after y the child\'s right face is the cube\'s B');
  assert.equal(viewAtPosition(buildScript(script([{ move: 'R', arrow: 'next' }])), 1).cues.arrow, 'next');
});
