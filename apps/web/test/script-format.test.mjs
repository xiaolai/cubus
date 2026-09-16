// What a SCRIPT is, and what it refuses — plan item 3.1 of dev-docs/tutorial-capability-plan.md.
//
// The refusals are the point. A script crosses a project boundary (cubus-im authors them, the app
// plays them), and every check here exists because the alternative is a lesson that plays wrongly in
// front of a child with nothing saying so: a picture turned as if it were a cube, a question nobody
// implements asked halfway through, a cue field that was ignored because it was misspelt.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHECKED_CUE_FIELDS, CHECKED_EPISODE_FIELDS, EPISODE_CUE_FIELDS,
  STEP_CUES, STEP_KINDS, checkEpisode, checkLesson, checkScript,
} from '../lib/lesson-format.js';
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
  assert.match(refusal(script([{ cube: 'UUU' }])), /`cube` expected 54 facelets of URFDLB/);
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
  // A REVEAL INHERITS THE PICTURE SEGMENT IT SITS IN. Its steps were checked from a clean slate, so this
  // passed validation and then threw where a child would have met it — the one failure a checker exists
  // to move earlier in time.
  assert.match(
    refusal(script([{ paint: 'U'.repeat(54) }, { round: { ask: 'pieceIn:UR', choose: 2, reveal: [{ move: 'R' }] } }])),
    /step 1: round: reveal step 0: a move inside a picture segment/,
  );
  // And it is the segment's state that is inherited, not a flag that sticks: a reveal that cuts to a cube
  // of its own may turn it.
  assert.equal(
    refusal(script([{ paint: 'U'.repeat(54) },
      { round: { ask: 'pieceIn:UR', choose: 2, reveal: [{ cube: SOLVED_FACELETS }, { move: 'R' }] } }])),
    null,
  );
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
  assert.equal(refusal(script([{ move: 'R', arrow: 'next', labels: 'position' }])), null);
  // `face` was a value and is not one any more (2026-09-16): a letter that moved with the cube.
  assert.match(refusal(script([{ move: 'R', labels: 'face' }])), /`labels` is none or position/);
  assert.match(refusal(script([{ move: 'R', arrow: 'R U' }])), /`arrow` is one move or "next"/);
  assert.match(refusal(script([{ move: 'R', arrow: 'Q' }])), /`arrow` "Q" is not a move/);
  assert.match(refusal(script([{ move: 'R', labels: 'all' }])), /`labels` is none or position/);
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

// Found by a Codex audit, 2026-09-16. Two shapes of the same mistake: a field checked by what it would
// LOOK like rather than what it is, and a cube checked by its alphabet rather than by being a cube.
test('a field written as something other than text, and a string that is not a cube, are refused here', () => {
  // `String(['UUU…'])` is a perfectly good facelet string. The step kept the array, and the reader a
  // layer down threw about a slot, by which point nothing knew which step it came from.
  assert.match(refusal(script([{ cube: [SOLVED_FACELETS] }])), /must be written as text, not a list/);
  assert.match(refusal(script([{ paint: [SOLVED_FACELETS] }])), /`paint` must be 54/);
  assert.match(refusal(script([{ move: ['R'] }])), /`move` must be a string/);
  assert.match(refusal(script([{ hold: ['U F'] }])), /must be written as text/);
  assert.match(refusal(script([{ say: 'x', hl: ['edges'] }])), /`hl` must be a string/);
  assert.match(refusal(script([{ say: 'x', arrow: ['R'] }])), /must be written as text/);
  assert.match(refusal(script([{ say: 'x', trail: ['piece:UF'] }])), /must be written as text/);
  // And a cube is a cube: 54 letters of the alphabet is not enough, and this passed before. The centres
  // are read first, because they are the frame the rest is stated in.
  assert.match(refusal(script([{ cube: 'U'.repeat(54) }])), /centres read UUUUUU/);
  assert.match(refusal(script([], { start: { facelets: 'U'.repeat(54) } })), /`facelets`/);
  // Centres right, and a corner whose stickers spell no piece: two of one colour on one cubie.
  const twoOfOne = `L${SOLVED_FACELETS.slice(1)}`;
  assert.match(refusal(script([{ cube: twoOfOne }])), /do not spell a piece/);
  const swapped = [...SOLVED_FACELETS];
  [swapped[13], swapped[22]] = [swapped[22], swapped[13]];
  assert.match(refusal(script([{ cube: swapped.join('') }])), /centres read UFRDLB/);
  // The ordinary ones still pass.
  assert.equal(refusal(script([{ cube: SOLVED_FACELETS }])), null);
  assert.equal(refusal(script([{ paint: `${'U'.repeat(53)}?` }])), null);
});

// Found by a Codex audit, 2026-09-16. An episode and a script grew the same camera, number, boolean,
// face-letter and orientation rules side by side, and the overlap check kept its own copy of the
// scheduler's default gap. Two spellings of one rule is validation and playback drifting apart, so the
// rules are one and the difference that is real — a script clears a cue with `null`, an episode has no
// such value — is what stays per format.
test('one rule, two formats: the shared value checks answer the same way on both sides', () => {
  const cue = (extra) => ({ cues: [{ say: 'x', start: 0, end: 1, ...extra }] });
  const both = (field, value) => [
    refusal(script([{ say: 'x', [field]: value }])),
    refusal(cue({ [field]: value }), checkEpisode),
  ];
  for (const [field, value, reason] of [
    ['cam', [1], /\[latitude, longitude\] or "tour"/],
    ['ghosts', 'false', /true or false — a string is always truthy/],
    ['counting', 'yes', /true or false — a string is always truthy/],
    ['camUp', 'X', /is not a face letter/],
    ['number', 'six', /must be digits, optionally grouped/],
  ]) {
    const [inScript, inEpisode] = both(field, value);
    assert.match(inScript, reason, `a script accepted ${field}: ${JSON.stringify(value)}`);
    assert.match(inEpisode, reason, `an episode accepted ${field}: ${JSON.stringify(value)}`);
  }
  // And the difference that is real: `null` clears a cue in a script and is not a value in an episode.
  assert.equal(refusal(script([{ say: 'x', cam: null, ghosts: null, camUp: null }])), null);
  assert.match(refusal(cue({ ghosts: null }), checkEpisode), /true or false/);
  // The orientation pair is one definition too, said with each format's own noun.
  assert.match(refusal(script([{ hold: 'U D' }])), /is not a hold — two perpendicular faces/);
  assert.match(refusal(cue({ orientation: 'U D' }), checkEpisode), /is not an orientation — two perpendicular faces/);
});

// A NAMED FIELD IS NOT A CHECKED FIELD — this file says so in a comment, about a defect it has already had,
// and until the validators became registries there was no way to hold it to that. Thirteen `if` blocks
// cannot be asked what they cover; a table can (audit, 2026-09-16).
//
// This is the assertion that makes the next unchecked field loud. Adding a name to `CUE_KEYS` or
// `STEP_CUES` without adding a rule is otherwise silent: the field passes the "is the key allowed" test and
// then fails somewhere the cue number is no longer available to blame, which is exactly how `setup:
// "banana"`, `number: "six"` and `ghosts: "false"` all got in.
test('every field a cue may carry is a field something checks', () => {
  // The fields that are deliberately NOT per-field rules, because they are about a cue's neighbours: you
  // cannot decide `start` alone, only `start` against the cue before it. Named, so the exemption is a
  // decision rather than an omission.
  const SEQUENCING = ['start', 'end', 'at'];

  const scriptRules = CHECKED_CUE_FIELDS();
  const missingFromScript = STEP_CUES.filter((k) => !scriptRules.includes(k) && !SEQUENCING.includes(k));
  assert.deepEqual(missingFromScript, [],
    `a script step may carry ${missingFromScript.join(', ')}, and nothing validates ${missingFromScript.length > 1 ? 'them' : 'it'}`);

  const episodeRules = CHECKED_EPISODE_FIELDS();
  const missingFromEpisode = EPISODE_CUE_FIELDS().filter((k) => !episodeRules.includes(k) && !SEQUENCING.includes(k));
  assert.deepEqual(missingFromEpisode, [],
    `an episode cue may carry ${missingFromEpisode.join(', ')}, and nothing validates ${missingFromEpisode.length > 1 ? 'them' : 'it'}`);

  // And the reverse: a rule for a field no format accepts is a rule that never runs, which reads as
  // coverage and is not.
  const named = new Set([...STEP_CUES, ...EPISODE_CUE_FIELDS()]);
  for (const rules of [scriptRules, episodeRules]) {
    const orphans = rules.filter((k) => !named.has(k));
    assert.deepEqual(orphans, [], `these rules validate fields nothing may carry: ${orphans.join(', ')}`);
  }
});
