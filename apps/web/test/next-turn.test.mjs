// THE ONE NEXT TURN: that it is the walk's next move, that it stops, and that it refuses rather than
// inventing one.
//
// Two halves on purpose. The pure cases below use a lesson written by hand, because they are about
// what the function does with input nobody sane sends it — a missing walk, a fractional count, a
// token that is not a move. The last case drives a REAL lesson out of `lessonFor`, because the
// indexing claims (which hold a move is made in, which step it belongs to) are claims ABOUT THAT
// SHAPE, and a hand-made fixture would agree with whatever this file believed when it was written.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';

import { Window } from 'happy-dom';
import Cube from '../vendor/cubejs.js';

import { hasATurn, nextTurn } from '../lib/next-turn.js';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const move = (from, alg) => { const c = Cube.fromString(from); c.move(alg); return c.asString(); };

/** A walk of three moves, with the two tables the loop reads beside it. */
const LESSON = Object.freeze({
  moves: ['F2', "R'", 'y'],
  moveHolds: [['U', 'F'], ['U', 'F'], ['U', 'F']],
  moveStep: [0, 0, 1],
});

test('no walk, no turn — and the three reasons look alike on purpose', () => {
  // A solved cube, a cube the method cannot finish (`lessonFor` answers null for one), and a walk at
  // its end all mean NOTHING TO DO. The loop draws the same picture for all three; telling them apart
  // is the caller's business, not this function's.
  assert.equal(nextTurn(null), null);
  assert.equal(nextTurn(undefined), null);
  assert.equal(nextTurn({}), null, 'a lesson with no moves array is not a walk');
  assert.equal(nextTurn({ moves: [] }), null, 'an empty walk has no next turn');
  assert.equal(nextTurn(LESSON, 3), null, 'a walk at its end has no next turn');
  assert.equal(hasATurn(LESSON, 3), false);
  assert.equal(hasATurn(LESSON, 0), true);
});

test('a count that is not a whole number in range is refused, not indexed', () => {
  // THE ANSWER THAT MUST NOT BE RETURNED WRONGLY. `moves[1.5]` and `moves[-1]` are both `undefined`,
  // which would read as "nothing to do" — the same answer a solved cube gives. A child shown that is
  // told they are finished.
  for (const bad of [-1, 1.5, NaN, Infinity, '0', null, {}, []]) {
    assert.equal(nextTurn(LESSON, bad), null, `done=${JSON.stringify(bad)} was indexed rather than refused`);
  }
  // …and the honest zero still works, so the guard above is not simply refusing everything.
  assert.equal(nextTurn(LESSON, 0).token, 'F2');
  // ABSENT IS NOT WRONG, and the two must not be confused: `undefined` is how a caller says "from the
  // start", and a default parameter is the one value JavaScript treats as not-supplied. `null` is a
  // caller that computed a count and got nothing, which is refused above.
  assert.equal(nextTurn(LESSON).token, 'F2');
  assert.equal(nextTurn(LESSON, undefined).token, 'F2');
});

test('a move the notation cannot read is loud, never an arrow for a move that does not exist', () => {
  assert.throws(() => nextTurn({ moves: ['Q'] }, 0), /next-turn: move 0 of the walk is "Q"/);
  assert.throws(() => nextTurn({ moves: [null] }, 0), /next-turn/);
});

test('a half turn, a quarter turn and a regrip are told apart', () => {
  // A half turn has no wrong way round and a quarter turn does, which is the property the first
  // solving lesson is built on. And a ROTATION is not a turn of a face: an arrow drawn on one would
  // point at a layer nobody is being asked to move.
  assert.deepEqual({ ...nextTurn(LESSON, 0) }, { token: 'F2', face: 'F', kind: 'face', turns: 2, hold: ['U', 'F'], stepIndex: 0, remaining: 3 });
  assert.deepEqual({ ...nextTurn(LESSON, 1) }, { token: "R'", face: 'R', kind: 'face', turns: 1, hold: ['U', 'F'], stepIndex: 0, remaining: 2 });
  assert.equal(nextTurn(LESSON, 2).kind, 'rotation', 'a whole-cube turn was reported as a face turn');
  // A ROTATION NAMES NO FACE. `y` would otherwise answer "Y", which is not a face of anything, and a
  // caller drawing an arrow on it would point at a layer nobody is being asked to turn.
  assert.equal(nextTurn(LESSON, 2).face, null, 'a whole-cube turn was given a face to turn');
  // An outer block keeps its face, with the count off the front.
  assert.equal(nextTurn({ moves: ["2Rw'"] }, 0).face, 'R');
  assert.equal(nextTurn({ moves: ['M'] }, 0).face, null, 'a slice is not a face of the cube');
});

// --- against a real walk ---

let app = null;
before(async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const win = new Window({
    url: 'http://localhost/#/timer',
    settings: {
      disableJavaScriptFileLoading: true, disableCSSFileLoading: true,
      disableComputedStyleRendering: true, fetch: { disableSameOriginPolicy: true },
    },
  });
  win.document.write(html);
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'customElements',
    'HTMLElement', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  await import('../lib/app.js');
  const state = (await import('../lib/app.js')).state;
  const subject = await import('../lib/cube-subject.js');
  app = { state, subject };
}, { timeout: 120_000 });

test('driven one turn at a time, it reproduces the real walk exactly', () => {
  app.subject.setFacelets(move(SOLVED, "R U F2 L' D"));
  const lesson = app.subject.lessonFor(app.state.cube);
  assert.ok(lesson, 'the method solver found no walk for this cube, so this case checks nothing');
  assert.ok(lesson.moves.length > 10, `a walk of ${lesson.moves.length} moves is too short to be a real one`);

  // THE CLAIM: the loop shows the walk, in order, with nothing skipped and nothing repeated.
  const shown = [];
  for (let done = 0; ; done += 1) {
    const turn = nextTurn(lesson, done);
    if (turn === null) break;
    shown.push(turn.token);
    // And the two tables are read at the same index as the move, which is the part a hand-made
    // fixture could not check: `moveHolds[k]` is the hold once k moves are made, so the k-th move is
    // made in it, and a regrip renames the moves after it rather than its own.
    assert.deepEqual(turn.hold, lesson.moveHolds[done], `move ${done} was given the wrong hold`);
    assert.equal(turn.stepIndex, lesson.moveStep[done], `move ${done} was given the wrong step`);
    assert.equal(turn.remaining, lesson.moves.length - done);
    assert.ok(done <= lesson.moves.length, 'the walk did not end');
  }
  assert.deepEqual(shown, [...lesson.moves], 'the turns shown are not the walk');
  assert.equal(nextTurn(lesson, lesson.moves.length), null, 'the walk never said it was finished');
});

test('a solved cube has no next turn, which is the null beside the measurement above', () => {
  app.subject.setFacelets(SOLVED);
  const lesson = app.subject.lessonFor(app.state.cube);
  // Either there is no walk at all, or there is one with nothing in it; both are "nothing to do", and
  // neither may produce a turn.
  assert.equal(nextTurn(lesson, 0), null, 'a solved cube was given something to do');
  assert.equal(hasATurn(lesson, 0), false);
});
