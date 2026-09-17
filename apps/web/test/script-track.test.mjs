// Following a cube along a walk by its arrangement — plan item 3.3 of dev-docs/tutorial-capability-plan.md.
//
// Every case drives the matcher with ARRANGEMENTS a real cube would report after each quarter turn, and
// asserts both where it lands and that it never calls a legal path "off plan". The arrangements are
// computed by cubejs, which shares no code with the piece model the track is built from.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { locate, trackFor, trackOf } from '../lib/script-track.js';
import { buildScript } from '../lib/script-view.js';
import { parse } from '../lib/cube-notation.js';

const require = createRequire(import.meta.url);
const Cube = require('cubejs');

const script = (steps, start = {}) => buildScript({ schema: 2, start, steps });
/** Follow `reports` (quarter turns, in the cube's own frame) from position 0, recording each reading. */
function follow(track, reports) {
  const cube = new Cube();
  let at = 0;
  return reports.split(' ').map((turn) => {
    cube.move(turn);
    const loc = locate(track, cube.asString(), at);
    if (loc.kind === 'step') at = loc.idx;
    return { turn, ...loc, at };
  });
}

// R5 of dev-docs/adr/0004-orientation-notation-and-colour-are-three-things.md. A planned `M` is reported
// by a smart cube as `R` and `L'`, in either order, and both arrangements between are part of the plan.
test('a slice reported as two face turns, in either order, is followed with nothing off plan', () => {
  const track = trackFor(script([{ move: "M M'" }]));
  for (const reports of ["R L' L R'", "L' R R' L"]) {
    const read = follow(track, reports);
    assert.deepEqual(read.filter((r) => r.kind === 'off'), [], `"${reports}" was called off plan at ${read.find((r) => r.kind === 'off')?.turn}`);
    assert.deepEqual(read.map((r) => r.kind), ['mid', 'step', 'mid', 'step'], `"${reports}" read as ${read.map((r) => r.kind).join(' ')}`);
    assert.equal(read.at(-1).at, 2, `"${reports}" did not finish the walk`);
  }
});

// Plan item 3.6 — THE HARDWARE'S ANSWER, not a model of it. A GAN16 ui (`GAN16ui_C8D3`), held white up and
// green in front, turned `M M' Rw Rw'` as real slice and wide turns through `gan-driver`'s monitor on
// 2026-09-17, starting from the arrangement `U` leaves. Every line below is what the cube printed: its move
// serial, the move in its own letters, its own millisecond clock, and the STATE it sent after that move
// (null where it sent none before the next move arrived). All seven states replay from solved in cubejs.
//
// What the session bought, and what this case therefore pins:
//   - a slice is TWO reports, and the cube put the L-face half FIRST both times — the order the synthetic
//     case above calls unknown, seen once in each direction;
//   - the two halves of one slice land 39 ms and 8 ms apart (an attempt the same day made with separate
//     R and L' turns put them 1.3 s apart, which is how a slice and two face turns are told apart);
//   - the cube BROADCAST the half-finished slice as a snapshot (serial 23), so a midpoint is not only a
//     moment inside the move stream but an arrangement a live snapshot can land on;
//   - a wide move is ONE report, `L` for `Rw`, and it moves no centre as far as the cube can tell.
const GAN16_2026_09_17 = Object.freeze({
  start: 'UUUUUUUUUBBBRRRRRRRRRFFFFFFDDDDDDDDDFFFLLLLLLLLLBBBBBB',
  reports: [
    { serial: 23, move: "L'", t: 233133, state: 'RUUFUUFUUBBBRRRRRRDRRDFFDFFBDDBDDLDDFLLFLLFLLLLUBBUBBU' },
    { serial: 24, move: 'R', t: 233172, state: 'RURFUFFUFRRBRRBRRBDRDDFDDFDBDBBDBLDLFLLFLLFLLULUUBUUBU' },
    { serial: 25, move: 'L', t: 236059, state: null },
    { serial: 26, move: "R'", t: 236067, state: 'UUUUUUUUUBBBRRRRRRRRRFFFFFFDDDDDDDDDFFFLLLLLLLLLBBBBBB' },
    { serial: 27, move: 'L', t: 239685, state: 'BUUBUULUUBBBRRRRRRURRUFFUFFRDDFDDFDDLLFLLFLLFLLDBBDBBD' },
    { serial: 28, move: "L'", t: 243548, state: 'UUUUUUUUUBBBRRRRRRRRRFFFFFFDDDDDDDDDFFFLLLLLLLLLBBBBBB' },
  ],
});

test('what a real GAN16 reported for M M\' Rw Rw\' is followed with nothing off plan', () => {
  const { start, reports } = GAN16_2026_09_17;
  const track = trackFor(script([{ move: "M M' Rw Rw'" }], { facelets: start }));
  const cube = Cube.fromString(start);
  let at = 0;
  const read = reports.map(({ move, state }) => {
    cube.move(move);
    // The cube's own snapshot, where it sent one, is the arrangement its moves replay to — so what is
    // matched below is what the hardware said, not a reconstruction of it.
    if (state !== null) assert.equal(cube.asString(), state, `the cube's state after ${move} is not its moves replayed`);
    const loc = locate(track, cube.asString(), at);
    if (loc.kind === 'step') at = loc.idx;
    return loc.kind;
  });
  assert.deepEqual(read, ['mid', 'step', 'mid', 'step', 'step', 'step']);
  assert.equal(at, track.states.length - 1, 'the walk did not finish');

  // A slice is two reports close together, and a wide move is one.
  const gap = (a, b) => reports[b].t - reports[a].t;
  assert.ok(gap(0, 1) < 100 && gap(2, 3) < 100, 'the two halves of a slice were not one motion');
  // The snapshot the cube sent BETWEEN the two halves of `M` is the walk's midpoint, and is silent.
  assert.deepEqual(locate(track, reports[0].state, 0), { kind: 'mid', idx: 0 });
});

test('a half turn is two quarter turns either way round, and its midpoint counts only beside it', () => {
  const track = trackFor(script([{ move: 'R2 U' }]));
  assert.deepEqual(follow(track, 'R R U').map((r) => r.kind), ['mid', 'step', 'step']);
  assert.deepEqual(follow(track, "R' R' U").map((r) => r.kind), ['mid', 'step', 'step']);
  // The same arrangement far from its own half turn is a wrong move, not quiet progress.
  const far = trackFor(script([{ move: "U F D B R2" }]));
  assert.equal(follow(far, 'R')[0].kind, 'off', 'a midpoint four positions away was accepted as progress');
});

// R6: a walk that passes through one arrangement twice. The turn that reached it is progress.
test('a turn that returns to an arrangement the walk passes through twice is progress, not an undo', () => {
  const track = trackFor(script([{ move: "R R' U" }]));
  const read = follow(track, "R R'");
  assert.deepEqual(read.map((r) => r.at), [1, 2], 'checking behind first drew an undo nobody made');
});

// ADR 0004 decision 9 and R7: a regrip changes no arrangement, so nothing will ever report it.
test('a regrip is passed through when the turn before it lands, and never on its own', () => {
  const track = trackFor(script([{ move: 'R x2' }]));
  assert.deepEqual(track.observable, [true, true, false]);
  assert.deepEqual(follow(track, 'R').map((r) => r.at), [2], 'the walk waited at a trailing regrip for a report that never comes');
  // Standing on a position does not skip ahead: a snapshot of the start is still the start.
  assert.deepEqual(locate(track, new Cube().asString(), 0), { kind: 'step', idx: 0 });
  // And a regrip leading into a turn is the same group as that turn, so there is no position to pass.
  const leading = trackFor(script([{ move: 'y R' }]));
  assert.equal(leading.states.length, 2);
  const cube = new Cube(); cube.move('B');
  assert.deepEqual(locate(leading, cube.asString(), 0), { kind: 'step', idx: 1 }, '`y R` is `B` to the cube');
});

test('a painted picture is on the track and cannot be matched', () => {
  const track = trackFor(script([{ move: 'R' }, { paint: 'U'.repeat(9) + '?'.repeat(45) }, { cube: new Cube().asString() }]));
  assert.equal(track.states[2], null);
  assert.equal(locate(track, new Cube().asString(), 1).kind, 'step', 'the cube after the picture is still a position');
});

test('the track refuses a shape that cannot be a walk', () => {
  assert.throws(() => trackOf(['x', 'y'], []), /2 positions need 1 transitions, not 0/);
  assert.equal(trackOf([new Cube().asString()], []).states.length, 1);
  // A walk that does not exist yet — one being searched for — is followed by nothing, without throwing.
  assert.deepEqual(locate(trackOf([], []), new Cube().asString(), 0), { kind: 'off' });
  assert.equal(parse('R').length, 1);
});

// Found by a Codex audit, 2026-09-16. Arriving at a position carries the cube through the regrips that
// follow it, so a cube standing at the end of that run may be mid-way through the turn that led INTO the
// position the pass started from. The midpoint window was the two transitions nearest `from`, which after
// a passed regrip does not reach that one: undoing a quarter of `R2` was reported as off the walk.
test('an undo reads as a half-made turn even when the walk had passed a regrip', () => {
  const built = script([{ move: 'R2' }, { move: 'x2' }]);
  const track = trackFor(built);
  assert.deepEqual(track.states[1], track.states[2], 'the regrip moved the pieces');
  const cube = new Cube();
  cube.move('R R');
  const at = locate(track, cube.asString(), 0);
  assert.deepEqual(at, { kind: 'step', idx: 2 }, 'completing R2 did not carry the cube through the regrip');
  cube.move("R'");
  assert.deepEqual(locate(track, cube.asString(), at.idx), { kind: 'mid', idx: 2 },
    'a half-undone turn after a passed regrip was called off the walk');
  // And a cube that really is off the walk still is.
  cube.move("R' U");
  assert.deepEqual(locate(track, cube.asString(), 2), { kind: 'off' });
});

// Found by a Codex audit, 2026-09-16. Reaching a position carries the cube through the regrips that
// follow it — and "reached by no moves at all" read as a regrip, so a line of narration after a turn was
// walked straight past. Nothing about the cube says a child has heard a line; that is why they move on
// themselves, and it is what this file's own comment has always said.
test('narration after a turn is a position the walk stops at, not one it passes through', () => {
  const track = trackFor(script([{ move: 'R' }, { say: 'now look at the top' }, { move: 'U' }]));
  assert.deepEqual(track.observable, [true, true, true, true], 'a line said over a still cube was skippable');
  const cube = new Cube();
  cube.move('R');
  assert.deepEqual(locate(track, cube.asString(), 0), { kind: 'step', idx: 1 },
    'the turn carried the walk past the line the child had not heard yet');
  // And a trailing REGRIP is still passed through, which is the rule this one sits beside.
  const regrip = trackFor(script([{ move: 'R x2' }]));
  assert.deepEqual(regrip.observable, [true, true, false]);
  assert.deepEqual(locate(regrip, cube.asString(), 0), { kind: 'step', idx: 2 });
});
