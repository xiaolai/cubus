// Following a cube along a walk by its arrangement — plan item 3.3 of dev-docs/tutorial-capability-plan.md.
//
// Every case drives the matcher with ARRANGEMENTS a real cube would report after each quarter turn, and
// asserts both where it lands and that it never calls a legal path "off plan". The arrangements are
// computed by cubejs, which shares no code with the piece model the track is built from.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { locate, trackFor, trackOf, wayBack } from '../lib/script-track.js';
import { lcg, randomAlg } from './fixtures/seeded-scrambles.mjs';
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

// audit-fix 2026-10-18 #30. `near` looks two TURNS either way, and a run of regrips is one place, because no
// report could move a cube along it. Counted in positions, undoing `R` in `R x y U` from position 3 was three
// away and called off the walk — and the drill sounded `off` and offered `R` as the way back.
test('near: distance is counted in turns, so a run of regrips is one place, behind and ahead', () => {
  // Built token by token, as the drill builds its tracks (lib/drill/candidates.js): there a rotation is a
  // position of its own, where a script's walk folds a leading regrip into the turn it leads. The tokens are
  // the cube's own frame, so `y` leaves U where it is.
  const perToken = (alg) => {
    const cube = new Cube();
    const states = [cube.asString()];
    const transitions = alg.split(' ').map((token) => {
      if (!/^[xyz]/.test(token)) cube.move(token);
      states.push(cube.asString());
      return parse(token);
    });
    return trackOf(states, transitions);
  };
  const track = perToken('R y y U');
  assert.deepEqual(track.observable, [true, true, false, false, true]);
  const cube = new Cube();
  cube.move('R');
  assert.deepEqual(locate(track, cube.asString(), 0, { near: true }), { kind: 'step', idx: 3 });
  cube.move("R'");
  assert.deepEqual(locate(track, cube.asString(), 3, { near: true }), { kind: 'step', idx: 0 },
    'undoing R across y y was called off the walk');
  // Two turns back across the run: U then R undone from the end.
  const end = new Cube();
  end.move('R U');
  assert.deepEqual(locate(track, end.asString(), 4, { near: true }), { kind: 'step', idx: 4 });
  end.move("U' R'");
  assert.deepEqual(locate(track, end.asString(), 4, { near: true }), { kind: 'step', idx: 0 });
  // Ahead: R and L' lie on one axis across x x, so a hand may make L' first, and R then lands two turns on,
  // four positions on.
  const ahead = perToken("R x x L'");
  const commuted = new Cube();
  commuted.move("L' R");
  assert.deepEqual(locate(ahead, commuted.asString(), 0, { near: true }), { kind: 'step', idx: 4 },
    'two commuting turns across a regrip were called off the walk');
  // And three turns are still too far: near stays near, however few positions the regrips leave.
  const far = perToken('R y y U F');
  assert.deepEqual(locate(far, far.states[4], 0, { near: true }), { kind: 'step', idx: 4 }, 'two turns ahead');
  assert.deepEqual(locate(far, far.states[5], 0, { near: true }), { kind: 'off' }, 'three turns ahead was taken for near');
  assert.deepEqual(locate(far, far.states[0], 5, { near: true }), { kind: 'off' }, 'three turns behind was taken for near');
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

// ---- the way back onto a walk (owner, 2026-10-15) ---------------------------------------------------
//
// The cube screen shows a child who has turned off the walk the turn that puts them back, and works the
// walk out again when there is no short one. Every arrangement here is cubejs's; the way back is checked
// by applying it with cubejs too, so the search is never its own judge.

/** The arrangement after `alg` from solved, by cubejs. */
const cubeAfter = (alg) => { const c = new Cube(); if (alg) c.move(alg); return c.asString(); };
/** Where `way` takes the cube at `facelets`, by cubejs. */
const takeWay = (facelets, way) => { const c = Cube.fromString(facelets); c.move(way.join(' ')); return c.asString(); };

test('one wrong turn is undone by its inverse, and a wrong half turn by itself', () => {
  const track = trackFor(script([{ move: 'R U F' }]));
  assert.deepEqual(wayBack(track, cubeAfter('R D'), 1), ["D'"]);
  assert.deepEqual(wayBack(track, cubeAfter('R D2'), 1), ['D2'], 'a wrong half turn was undone as two turns');
  assert.deepEqual(wayBack(track, cubeAfter("R B'"), 1), ['B']);
});

test('a turn the walk makes a little later is finished, not taken back', () => {
  // R and L commute: a child who turns L before R has made the walk's third position's arrangement minus R.
  // Undoing the L would be a turn taken back for nothing — R reaches position 2.
  const track = trackFor(script([{ move: 'R L U' }]));
  const f = cubeAfter('L');
  assert.equal(locate(track, f, 0).kind, 'off', 'precondition: L alone is off the walk');
  const way = wayBack(track, f, 0);
  assert.deepEqual(way, ['R']);
  assert.deepEqual(locate(track, takeWay(f, way), 0), { kind: 'step', idx: 2 });
});

test('the way back always lands on the walk, is never longer than the turns off it, and stops at two', () => {
  const rnd = lcg(20261015);
  const QUARTERS = ['U', "U'", 'R', "R'", 'F', "F'", 'D', "D'", 'L', "L'", 'B', "B'"];
  const tally = { 1: 0, 2: 0, 3: 0, none3: 0 };
  for (let i = 0; i < 120; i++) {
    const alg = randomAlg(rnd, 8);
    const track = trackFor(script([{ move: alg }]));
    const k = Math.floor(rnd() * 9);
    const at = cubeAfter(alg.split(' ').slice(0, k).join(' '));
    for (const n of [1, 2, 3]) {
      const wrong = Array.from({ length: n }, () => QUARTERS[Math.floor(rnd() * QUARTERS.length)]);
      const f = takeWay(at, wrong);
      if (locate(track, f, k).kind !== 'off') continue; // turns that cancel, or that ARE the walk
      tally[n] += 1;
      const way = wayBack(track, f, k);
      if (n < 3) assert.ok(way, `${n} turn(s) ${wrong.join(' ')} off "${alg}" at ${k} had no way back`);
      if (way === null) { tally.none3 += 1; continue; }
      assert.ok(way.length <= Math.min(n, 2), `"${way.join(' ')}" is longer than the ${n} turn(s) off the walk`);
      // WHAT MUST NOT HAPPEN: a way back that does not get back. Checked by cubejs, not by the search.
      assert.notEqual(locate(track, takeWay(f, way), k).kind, 'off',
        `"${way.join(' ')}" from ${wrong.join(' ')} off "${alg}" at ${k} did not land on the walk`);
    }
  }
  // A sample that never left the walk, or never went past two, would pass every assertion above.
  assert.ok(tally[1] > 50 && tally[2] > 50 && tally[3] > 50, `too few cases off the walk: ${JSON.stringify(tally)}`);
  assert.ok(tally.none3 > 0, 'three turns off the walk always had a way of two: the bound was never tested');
});

// audit-fix 2026-10-18 r3 #18. `near` decides WHERE the way back may lead, and nothing told the two apart: a way
// back to anywhere on the walk passed every case above. The drill's walk repeats a sequence, so an arrangement
// near the cube is also reached far along it — and a way back to that far place is a shortcut past most of the
// algorithm.
test('near: the way back leads to a place near the cube, never a shortcut to a distant one', () => {
  // (R U R' U') six times is the identity, so the arrangement one `U` from the start is position 23's. From
  // the start, U then F is ONE turn from position 23 and two from the start.
  const track = trackFor(script([{ move: Array(6).fill("R U R' U'").join(' ') }]));
  const f = cubeAfter('U F');
  assert.deepEqual(wayBack(track, f, 0), ["F'"], 'precondition: anywhere on the walk, one turn is a way back');
  assert.deepEqual(locate(track, takeWay(f, ["F'"]), 0), { kind: 'step', idx: 23 }, 'precondition: and it leads to 23');
  const near = wayBack(track, f, 0, 2, { near: true });
  assert.ok(near, 'near, there was no way back within two turns');
  assert.notDeepEqual([...near], ["F'"], 'near, the way back was the shortcut to position 23');
  assert.equal(near.length, 2);
  // Checked by cubejs: it lands within two turns of the start.
  const at = locate(track, takeWay(f, near), 0, { near: true });
  assert.notEqual(at.kind, 'off', `"${near.join(' ')}" did not land near the start`);
  assert.ok(at.idx <= 2, `"${near.join(' ')}" landed at ${at.idx}`);
});
