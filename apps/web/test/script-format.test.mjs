// What a SCRIPT is, and what it refuses — plan item 3.1 of dev-docs/tutorial-capability-plan.md.
//
// The refusals are the point. A script crosses a project boundary (cubus-im authors them, the app
// plays them), and every check here exists because the alternative is a lesson that plays wrongly in
// front of a child with nothing saying so: a picture turned as if it were a cube, a question nobody
// implements asked halfway through, a cue field that was ignored because it was misspelt.
import assert from 'node:assert/strict';
import test from 'node:test';

import { STEP_CUES, STEP_KINDS, checkEpisode, checkLesson, checkScript } from '../lib/lesson-format.js';
import { QUESTIONS, ask, readAsk } from '../lib/script-questions.js';
import { SOLVED, applyAlg } from '../lib/cube-pieces.js';
import { targetPicture } from '../lib/stage-picture.js';

const SOLVED_FACELETS = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const script = (steps, rest = {}) => ({ schema: 2, steps, ...rest });
/** The message a refusal gives, or null when it was accepted. */
const refusal = (doc, read = checkScript) => { try { read(doc); return null; } catch (e) { return e.message; } };

test('a schema says which runtime a document is for, and an unknown one is refused', () => {
  // Today's episodes have no `schema` and are read exactly as they were.
  const episode = { cues: [{ say: 'hello', start: 0, end: 1 }] };
  assert.equal(checkLesson(episode), episode);
  // A script says so.
  const s = script([{ move: 'R' }]);
  assert.equal(checkLesson(s), s);
  // And anything else is refused rather than guessed at — accepted silently before this item.
  assert.match(refusal({ ...episode, schema: 'nonsense' }, checkLesson), /schema "nonsense" is not one this runtime knows/);
  assert.match(refusal({ ...episode, schema: 3 }, checkLesson), /schema 3 is not one this runtime knows/);
  // Even held directly, the episode reader refuses a document that says it is something else.
  assert.match(refusal({ ...episode, schema: 2 }, checkEpisode), /carries `schema` 2 — read it with checkLesson/);
});

test('a step says exactly one thing about the cube, and unknown fields are refused by name', () => {
  // A step that only narrates is ordinary — most of a lesson is — and one that says nothing is a typo.
  assert.equal(refusal(script([{ say: 'nothing happens yet' }])), null);
  assert.match(refusal(script([{}])), /step 0: says nothing — one of move, setup, cube, paint, hold, round, or a cue/);
  assert.match(refusal(script([{ move: 'R', paint: `${'U'.repeat(54)}` }])), /step 0: says move and paint/);
  assert.match(refusal(script([{ move: 'R' }, { move: 'U', hilight: 'slot:UR' }])), /step 1: unknown field "hilight"/);
  assert.match(refusal(script([{ move: 'R' }], { tempo: 2 })), /script: unknown field "tempo"/);
  assert.match(refusal(script([{ move: 'R' }], { start: { facelets: SOLVED_FACELETS, hold: 'U U' } })),
    /"U U" is not a hold/);
  // Every kind and every cue the format names is actually accepted, so the lists are not decoration.
  assert.equal(STEP_KINDS.length, 6);
  assert.ok(STEP_CUES.includes('ask'));
});

test('a move is the child\'s letters, and a setup states a cube rather than a hold', () => {
  assert.equal(checkScript(script([{ move: "y R U R' M2 Rw'" }])).steps.length, 1);
  assert.match(refusal(script([{ move: 'Q' }])), /step 0: `move` "Q" is not a move/);
  assert.match(refusal(script([{ move: '3Rw' }])), /step 0: `move` /);
  // A setup states the PIECES and says nothing about how the cube is held: the frame its rotations net
  // is discarded, as `<cubus-cube>`'s `scramble` already discards one (ADR 0004 decision 8). Rotations
  // are therefore allowed in it — an insert is written the way it is taught, and the owner's own
  // scenario opens on `y F' U' F U R U R' U' y'`.
  assert.equal(refusal(script([{ setup: "y F' U' F U R U R' U' y'" }])), null);
  assert.equal(checkScript(script([{ setup: "R U R'" }])).steps.length, 1);
  assert.match(refusal(script([{ setup: 'R Q' }])), /`setup` "Q" is not a move/);
  assert.match(refusal(script([{ cube: 'UUU' }])), /`cube` must be 54 of URFDLB/);
  assert.match(refusal(script([{ cube: SOLVED_FACELETS.replace('U', '?') }])), /a picture with unknowns is a `paint` step/);
});

test('a picture segment refuses a move, and a step that states a whole cube ends it', () => {
  const picture = targetPicture('cross');
  assert.ok(picture.includes('?'), 'precondition: a stage target leaves stickers unclaimed');
  assert.match(refusal(script([{ paint: picture }, { move: 'R' }])),
    /step 1: a move inside a picture segment/);
  // Two steps later is still inside it.
  assert.match(refusal(script([{ paint: picture }, { say: 'look' }, { hold: 'D F' }, { move: 'R' }])),
    /step 3: a move inside a picture segment/);
  // A `setup` or a `cube` states a complete cube, and the segment is over.
  assert.equal(refusal(script([{ paint: picture }, { setup: "R U R'" }, { move: 'R' }])), null);
  assert.equal(refusal(script([{ paint: picture }, { cube: SOLVED_FACELETS }, { move: 'R' }])), null);
});

test('a cue is checked where it is written, selectors and questions included', () => {
  assert.equal(refusal(script([{ move: 'R', hl: 'slot:UR', focus: 'layer:U,corners' }])), null);
  assert.match(refusal(script([{ move: 'R', hl: 'slop:UR' }])), /step 0: `hl`: "slop:UR" is not a selector/);
  assert.match(refusal(script([{ move: 'R', ghosts: 'true' }])), /`ghosts` must be true or false/);
  assert.match(refusal(script([{ move: 'R', cam: [1] }])), /`cam` must be \[latitude, longitude\] or "tour"/);
  assert.match(refusal(script([{ move: 'R', camUp: 'X' }])), /"X" is not a face letter/);
  assert.match(refusal(script([{ move: 'R', at: 3 }, { move: 'U', at: 1 }])), /step 1: is at 1, before the step before it at 3/);
  // A cue may light the ANSWER to a question, and a question nobody implements is refused here rather
  // than when a child reaches that line.
  assert.equal(refusal(script([{ move: 'R', hl: 'ask:topEdgesWithoutTopColour' }])), null);
  assert.equal(refusal(script([{ move: 'R', hl: 'ask:whereIs:UR' }])), null);
  assert.match(refusal(script([{ move: 'R', hl: 'ask:whatColourIsIt' }])), /no question is named "whatColourIsIt"/);
  assert.match(refusal(script([{ move: 'R', hl: 'ask:whereIs' }])), /"whereIs" needs a piece or a slot/);
  assert.match(refusal(script([{ ask: 'piecesAway:UR', move: 'R' }])), /takes no argument/);
});

test('a round says what it asks and how many answers it wants, and its reveal is a script segment', () => {
  const round = { say: 'Where will it go?', turn: "U R U' R'", ask: 'whereIs:UR', choose: 2, reveal: [{ move: "U R U' R'" }] };
  assert.equal(refusal(script([{ round }])), null);
  assert.match(refusal(script([{ round: { ...round, choose: 0 } }])), /`choose` is how many answers/);
  assert.match(refusal(script([{ round: { ...round, ask: undefined } }])), /`ask` names the question/);
  assert.match(refusal(script([{ round: { ...round, prompt: 'hi' } }])), /round: unknown field "prompt"/);
  assert.match(refusal(script([{ round: { ...round, reveal: [{ round }] } }])), /a round inside a reveal/);
  assert.match(refusal(script([{ round: { ...round, reveal: [{ move: 'Q' }] } }])), /reveal step 0: `move` /);
  // Answered by picking faces, so the question names one place, and `choose` is how many faces that is.
  assert.match(refusal(script([{ round: { ...round, ask: 'piecesAway' } }])), /"piecesAway" is not answered by picking faces/);
  assert.match(refusal(script([{ round: { ...round, ask: 'whereIs:URF', choose: 2 } }])), /`choose` is 2, and "URF" is answered by 3 faces/);
  assert.match(refusal(script([{ paint: 'U'.repeat(54) }, { round }])), /step 1: a round with a turn inside a picture segment/);
  assert.equal(refusal(script([{ paint: 'U'.repeat(54) }, { round: { ask: 'pieceIn:UR', choose: 2 } }])), null,
    'a recognition round on a picture turns nothing, and is ordinary');
});

// R9 of dev-docs/adr/0004-orientation-notation-and-colour-are-three-things.md. cubus-im's builder copies
// a persistent selector onto every cue it covers, so a player cannot tell "set here" from "still set"
// and re-binds an inherited focus at every line — which, since the element binds focus where it is
// written, lights a different piece each time. A script states a cue once.
test('a cue inherited across three steps is written once, at the step that gives it', () => {
  const s = checkScript(script([
    { move: 'R', focus: 'slot:UR' },
    { move: 'U' },
    { move: "R'" },
  ]));
  const given = s.steps.filter((step) => step.focus !== undefined);
  assert.equal(given.length, 1, 'a script that copies a cue forward cannot say where it took effect');
  assert.equal(s.steps.indexOf(given[0]), 0);
  // And clearing is a value, not an absence: an absent field means "unchanged".
  assert.equal(refusal(script([{ move: 'R', focus: 'slot:UR' }, { move: 'U', focus: null }])), null);
});

test('a question is asked and answered the way the child holds the cube', () => {
  // Held U F the two frames agree, so this is the case that says nothing about relabelling...
  const cube = applyAlg(SOLVED, "R U R'");
  assert.deepEqual([...ask('whereIs:UR', cube, ['U', 'F']).pieces], ['UR']);
  // ...and tumbled they do not: the child's "top" is the D face, so "the top edges with none of the
  // top colour" is a different set of four slots and the answer comes back in the child's letters.
  const held = ask('topEdgesWithoutTopColour', SOLVED, ['D', 'B']);
  assert.deepEqual([...held.unknown], []);
  assert.deepEqual([...held.pieces], [], 'on a solved cube every top edge carries the top colour');
  const scrambled = applyAlg(SOLVED, "F2 R2");
  const up = ask('topEdgesWithoutTopColour', scrambled, ['U', 'F']);
  const down = ask('topEdgesWithoutTopColour', scrambled, ['D', 'B']);
  assert.notDeepEqual([...up.pieces], [...down.pieces], 'the same cube, two holds, one answer — the hold is being ignored');
  // Every name in the registry answers, so the table cannot list a question that throws when asked.
  for (const name of Object.keys(QUESTIONS)) {
    const text = readAsk(name).why ? `${name}:UR` : name;
    const answer = ask(text.startsWith('pairOf') ? 'pairOf:URF' : text, cube, ['U', 'F']);
    assert.ok(Array.isArray(answer.pieces) && Array.isArray(answer.unknown), `${name} answered without pieces and unknown`);
  }
});

test('a painted picture answers what it shows, and says what it cannot', () => {
  const picture = targetPicture('cross');
  const answer = ask('whereIs:DR', picture, ['U', 'F']);
  assert.equal(answer.slot, 'DR', 'the cross target pins the DR edge home, so the picture can say where it is');
  const unknowable = ask('whereIs:UR', picture, ['U', 'F']);
  assert.equal(unknowable.slot, null, 'a target that claims nothing about the top edges answered anyway');
  assert.deepEqual([...unknowable.unknown], ['?']);
});

test('Phase 4\'s annotations are cues: an arrow is one move or next, and letters are a mode', () => {
  assert.equal(refusal(script([{ move: 'R', arrow: "U'", labels: 'position' }])), null);
  assert.equal(refusal(script([{ move: 'R', arrow: 'next', labels: 'face' }])), null);
  assert.match(refusal(script([{ move: 'R', arrow: 'R U' }])), /`arrow` is one move or "next"/);
  assert.match(refusal(script([{ move: 'R', arrow: 'Q' }])), /`arrow` "Q" is not a move/);
  assert.match(refusal(script([{ move: 'R', labels: 'all' }])), /`labels` is none, position or face/);
});

test('a trail cue names pieces, and nothing else', () => {
  assert.equal(refusal(script([{ move: "R U R'", trail: 'piece:UF,slot:URF' }])), null);
  assert.match(refusal(script([{ move: 'R', trail: 'layer:U' }])), /`trail` names pieces .* "layer:U" is not one/);
  assert.match(refusal(script([{ move: 'R', trail: 'piece:UD' }])), /"piece:UD" is not one/);
});

test("a question's argument names a piece the cube has, and a pair is a corner", () => {
  // Found by a Codex audit, 2026-09-16. `UU` and `UD` are two letters of URFDLB and neither is a piece:
  // both passed this check, `checkScript` accepted the lesson, and the throw arrived when a child reached
  // that line — the exact failure every refusal in this file exists to move forward to authoring time.
  assert.match(refusal(script([{ move: 'R', hl: 'ask:whereIs:UU' }])), /"UU" is not a piece of a cube/);
  assert.match(refusal(script([{ move: 'R', hl: 'ask:pieceIn:UD' }])), /"UD" is not a piece of a cube/);
  assert.match(refusal(script([{ move: 'R', hl: 'ask:isHome:UUR' }])), /"UUR" is not a piece of a cube/);
  // A pair is a corner and the edge beside it, so an edge cannot be asked for one.
  assert.match(refusal(script([{ move: 'R', hl: 'ask:pairOf:UR' }])), /"UR" is an edge/);
  assert.equal(refusal(script([{ move: 'R', hl: 'ask:pairOf:DFR' }])), null);
  assert.equal(refusal(script([{ move: 'R', hl: 'ask:isHome:URF' }])), null);
  // And what is accepted answers rather than throwing, which is what the refusals are protecting.
  for (const text of ['whereIs:UR', 'pieceIn:UF', 'isHome:URF', 'pairOf:DFR']) {
    assert.ok(ask(text, SOLVED, ['U', 'F']), text);
  }
});

test('a pair is read in the hold the script wrote it in', () => {
  // The middle layer is the one between the CHILD's top and bottom, so the pair of the corner they call
  // DFR is the edge they call FR, whichever way the cube is held. Reading the cube's own U and D instead
  // answered `FD` held `R F` — an edge of the layer the child is not looking at (Codex audit, 2026-09-16).
  assert.deepEqual([...ask('pairOf:DFR', SOLVED, ['R', 'F']).slots], ['DFR', 'FR']);
  assert.deepEqual([...ask('pairOf:DFR', SOLVED, ['U', 'F']).slots], ['DFR', 'FR']);
  assert.deepEqual([...ask('pairOf:DBL', SOLVED, ['D', 'B']).slots], ['DBL', 'BL']);
});
