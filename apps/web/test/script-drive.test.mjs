// The script drivers against an element that records what it is told — plan item 3.3 of
// dev-docs/tutorial-capability-plan.md. The browser corpus runs the same drivers on the real element
// and reads the drawing; this is where the arithmetic of WHEN and HOW is pinned without a browser.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createClockDriver, createElementWriter, createStopDriver, timelineOf } from '../lib/script-drive.js';
import { buildScript, groupsOf, viewAtPosition } from '../lib/script-view.js';
import { parse } from '../lib/cube-notation.js';
import { toFacelets } from '../lib/cube-pieces.js';
import { MANIFEST } from './browser/public-cube.mjs';

/**
 * An element as the manifest describes it and nothing more, recording every call. `stops` is worked
 * out from `alg` by the same rule the element uses, so a stop step lands where the real one would.
 */
function recordingCube() {
  const calls = [];
  const attrs = new Map();
  const target = {
    calls,
    attrs,
    setAttribute(name, value) { calls.push(['set', name, value]); attrs.set(name, value); },
    removeAttribute(name) { calls.push(['remove', name]); attrs.delete(name); },
    get stops() {
      const out = [0];
      let n = 0;
      for (const g of groupsOf(parse(attrs.get('alg') || ''))) { n += g.length; out.push(n); }
      return out;
    },
    animating: false,
  };
  // `turnTo` records like the rest, and answers a promise as the element does: a hold change between two
  // adjacent positions is an animated tumble now (ADR 0003), so it has to be observable here.
  for (const m of ['step', 'stepBack', 'stepStop', 'stepBackStop', 'seek', 'playTo']) target[m] = (...a) => calls.push([m, ...a]);
  target.turnTo = (...a) => { calls.push(['turnTo', ...a]); return Promise.resolve(true); };
  // The proxy half: anything the manifest does not list throws, naming itself.
  const allowed = new Set([...MANIFEST.methods, ...MANIFEST.properties.map((p) => p.name), ...Object.keys(MANIFEST.operations), 'calls', 'attrs']);
  return new Proxy(target, {
    get(t, name) {
      if (typeof name === 'string' && !allowed.has(name)) throw new Error(`the manifest lists no member "${name}"`);
      return t[name];
    },
  });
}
const script = (steps, start = {}) => buildScript({ schema: 2, start, steps });
const transport = (cube) => cube.calls.filter(([c]) => c !== 'set' && c !== 'remove');

// R7 of dev-docs/adr/0004-orientation-notation-and-colour-are-three-things.md, and cubus-im lesson 10 §4.
test('a trailing regrip turns when its time comes, never when its segment loads', () => {
  const built = script([{ say: 'look at the layer', at: 0 }, { say: 'now flip it', at: 3 }, { move: 'x2', at: 6 }], { scramble: "R U R'" });
  const cube = recordingCube();
  const clock = createClockDriver(built, { cube });
  assert.equal(clock.paint(0).moves, 0);
  assert.equal(clock.paint(5.9).moves, 0, 'the regrip was applied before its time');
  assert.deepEqual(transport(cube), [], 'the element was told to move before anything was scheduled to');
  assert.equal(clock.paint(6.01).moves, 1);
  assert.deepEqual(transport(cube), [['step']], 'the regrip was not animated at its time');
  assert.equal(clock.paint(6.01).hold, 'D B');
});

// R2: the element is loaded with the hold at the start of its sequence, and the sequence turns it.
test('the hold is written once, when the segment loads, and a rotation inside the sequence is not written again', () => {
  const built = script([{ move: 'y R', at: 1 }]);
  const cube = recordingCube();
  const clock = createClockDriver(built, { cube });
  for (const t of [0, 0.5, 1, 1.3, 1.6, 2, 5]) clock.paint(t);
  const holds = cube.calls.filter(([c, name]) => c === 'set' && name === 'orientation').map(([, , v]) => v);
  assert.deepEqual(holds, ['U F'], 'the current hold was written on top of a sequence that already turns the cube');
  assert.equal(clock.paint(5).hold, 'U R', 'the view still says how the child is holding it');
  assert.deepEqual(transport(cube), [['step'], ['step']], 'each token animated once, on its schedule');
});

test('a jump seeks, and a jump while a turn is in flight re-seats even when the count is the same', () => {
  const built = script([{ move: "R U R'", at: 1 }]);
  const cube = recordingCube();
  const clock = createClockDriver(built, { cube });
  clock.paint(0);
  clock.seek(1.2);
  assert.deepEqual(transport(cube).at(-1), ['seek', 1]);
  const before = transport(cube).length;
  clock.seek(1.2);
  assert.equal(transport(cube).length, before, 'a jump to where the cube already is moved it');
  assert.equal(timelineOf(built).tokenTimes[0].length, 3);
});

// R3: a walk moves by STOPS, so `y R` is one press and one group, and back undoes the group.
test('a walk moves by stops: one press plays a regrip and its turn, and back undoes both', () => {
  for (const alg of ['y R', 'y x R']) {
    const built = script([{ move: alg }]);
    const cube = recordingCube();
    const walk = createStopDriver(built, { cube });
    assert.equal(built.positions.length, 2, `"${alg}" is one stop`);
    walk.next();
    assert.deepEqual(transport(cube).at(-1), ['stepStop'], `"${alg}" was not played as a group`);
    assert.equal(walk.position, 1);
    walk.back();
    assert.deepEqual(transport(cube).at(-1), ['stepBackStop'], `back did not undo "${alg}" as a group`);
    assert.equal(walk.position, 0);
  }
});

test('a walk followed by the cube: a turn along the walk steps, and a jump seeks', () => {
  const built = script([{ move: "R U R' U'" }]);
  const cube = recordingCube();
  const walk = createStopDriver(built, { cube });
  const arrangement = (k) => toFacelets(built.positions[k].cube);
  assert.deepEqual(walk.observe(arrangement(1)), { kind: 'step', position: 1 });
  assert.deepEqual(transport(cube).at(-1), ['stepStop'], 'one turn along the walk was not animated');
  assert.deepEqual(walk.observe(arrangement(4)), { kind: 'step', position: 4 }, 'a cube three turns along was not found');
  assert.deepEqual(transport(cube).at(-1), ['seek', 4], 'a jump was animated turn by turn');
  assert.equal(walk.observe('U'.repeat(54)).kind, 'off');
  assert.equal(walk.position, 4, 'an arrangement off the walk moved it');
});

// A HOLD CHANGE IS A TUMBLE WHEN THE CHILD IS WALKING, AND A CUT WHEN THEY ARE SCRUBBING (plan item 6.5,
// owner's decision 2026-09-17). This case asserted that a hold change always wrote `orientation`, which was
// the behaviour before that decision: ADR 0003 says the cube turns over IN FRONT of the child, and the one
// step where the first layer is finished and the cube goes over is the step that mattered most. A scrub
// still cuts, because a seek cannot animate through every hold it passes.
test('a hold change tumbles on a press and cuts on a seek, and loads the cube either way', () => {
  const built = script([{ move: 'R' }, { hold: 'D B' }, { move: 'U' }]);

  const cube = recordingCube();
  const walk = createStopDriver(built, { cube });
  walk.next();
  const before = transport(cube).length;
  walk.next();
  const sets = cube.calls.filter(([c]) => c === 'set').map(([, n, v]) => `${n}=${v}`);
  assert.deepEqual(transport(cube).filter(([c]) => c === 'turnTo').at(-1), ['turnTo', 'D', 'B'],
    'walking into a new hold did not turn the cube over in front of the child');
  assert.equal(sets.includes('orientation=D B'), false,
    'the hold was also written as an attribute, which states the end of the turn and cancels it');
  assert.ok(sets.some((s) => s.startsWith('facelets=')), 'the tumble did not load the cube in front of the child');
  assert.equal(transport(cube).filter(([c]) => c !== 'turnTo').length, before,
    'the element was asked to animate its sequence across a hold change');

  // A SEEK STILL CUTS. Scrubbing crosses holds it is not showing, and animating each one would make a drag
  // take as long as the walk it is skipping.
  const scrubbed = recordingCube();
  createStopDriver(built, { cube: scrubbed }).seek(2);
  const cutSets = scrubbed.calls.filter(([c]) => c === 'set').map(([, n, v]) => `${n}=${v}`);
  assert.ok(cutSets.includes('orientation=D B'), 'a seek into a new hold never told the element how the cube is held');
  assert.deepEqual(transport(scrubbed).filter(([c]) => c === 'turnTo'), [], 'a seek animated a hold change');

  // Landing cold in the middle of a later segment is a jump into it, never a stop-step from its start.
  const cold = recordingCube();
  createStopDriver(built, { cube: cold }).seek(3);
  assert.deepEqual(transport(cold).filter(([c]) => c !== 'turnTo').at(-1), ['seek', 1],
    'a cold landing past the start of a segment was not a seek');
});

test('the writer touches nothing the manifest omits', () => {
  const cube = recordingCube();
  assert.throws(() => cube._anim, /no member "_anim"/);
  const writer = createElementWriter(cube);
  const built = script([{ move: 'R', hl: 'slot:UR', focus: 'layer:U', ghosts: true, cam: [10, 20], camUp: 'F' }]);
  const walk = createStopDriver(built, { cube });
  walk.next();
  assert.equal(typeof writer.show, 'function');
  const sets = Object.fromEntries(cube.calls.filter(([c]) => c === 'set').map(([, n, v]) => [n, v]));
  assert.equal(sets.highlight, 'slot:UR');
  assert.equal(sets.ghosts, 'floating');
  assert.equal(sets['camera-latitude'], '10');
  assert.equal(sets['camera-up'], 'F');
  assert.match(sets.focus, /^piece:/, 'focus reached the element as a slot, so a seek could re-bind it');
});

// Found by a Codex audit, 2026-09-16, and sharpened by the verify pass over the first fix. Token times are
// worked out per STEP, and two steps can overlap — a step given four seconds for two tokens is still
// turning when the next step's `at` arrives. Playing that as best one can is the wrong answer twice over:
// `U` went a second before its own time, and the position whose cues were in force was about a cube that
// had not been reached. Two move steps turning one cube at once is not a thing a script can mean, so it is
// refused where the numbers are.
test('a timeline that turns two steps at once is refused, not played as best it can be', () => {
  const built = script([{ move: 'R U', at: 1, secs: 4 }, { move: 'F', at: 2 }]);
  assert.deepEqual(built.segments[0].tokens, ['R', 'U', 'F'], 'the segment is not the three tokens this is about');
  assert.throws(() => timelineOf(built), /before token 1 at 3s/);
  assert.throws(() => createClockDriver(built, { cube: recordingCube() }), /a cube is turned in order/);
  // And the ordinary shape of the same script — the second step starting after the first has finished —
  // is timed straight through, one token at a time.
  const fine = script([{ move: 'R U', at: 1, secs: 4 }, { move: 'F', at: 5 }]);
  const clock = createClockDriver(fine, { cube: recordingCube() });
  assert.equal(clock.paint(0.9).moves, 0);
  assert.equal(clock.paint(1.1).moves, 1, 'the first token had not started');
  assert.equal(clock.paint(2.9).moves, 1, 'the second token went before its time');
  assert.equal(clock.paint(3.1).moves, 2);
  assert.equal(clock.paint(5.01).moves, 3, 'the last step did not turn at its own time');
});

// The element groups the concatenated sequence — `y R` is one group, because a regrip belongs to the turn
// it leads into — while a script gives every STEP its own position. A step that is only a regrip therefore
// ends INSIDE the element's group, and its arrival was a jump: the one turn D4's "turn the whole cube so
// the gap is in front" exists to show was the one that snapped (Codex audit, 2026-09-16).
test('a step that is only a regrip is turned, not snapped, though the element groups it with the turn after', () => {
  const built = script([{ move: 'y' }, { move: 'R' }]);
  const cube = recordingCube();
  const walk = createStopDriver(built, { cube });
  assert.deepEqual(cube.stops, [0, 2], 'the element no longer groups the regrip with the turn');
  walk.next();
  assert.deepEqual(transport(cube).at(-1), ['playTo', 1], 'the regrip was jumped to rather than turned');
  walk.next();
  assert.deepEqual(transport(cube).at(-1), ['stepStop'], 'the turn after it was not played as a group');
  walk.back();
  assert.deepEqual(transport(cube).at(-1), ['playTo', 1], 'stepping back to the regrip snapped');
  // A scrub is still a jump: seeking is not a walk, however near it lands.
  walk.seek(0);
  assert.deepEqual(transport(cube).at(-1), ['seek', 0]);
});

// Found by the verify pass over that fix, 2026-09-16: it walked a fixed two tokens, and a step may regrip
// more than twice. What makes a gap walkable is what the tokens ARE — a run of regrips moves nothing a
// child can see — not how many of them there are.
test('a step of any size is walked, and a position on the element\'s own stop is still a group', () => {
  const cube = recordingCube();
  const walk = createStopDriver(script([{ move: 'x y z' }, { move: 'R' }]), { cube });
  walk.next();
  // Three regrips is one press and one instruction to the element, which walks them a token at a time.
  // It used to be a fixed two tokens walked from out here, and a third snapped (the verify pass over
  // that fix, 2026-09-16) — the element can walk to any token now, which is what it always needed.
  assert.deepEqual(transport(cube).at(-1), ['playTo', 3], 'a three-regrip step was not walked');
  // Back the other way it lands exactly on the element's own stop 0, so the element walks the group
  // itself — one token at a time, which is the same animation by the shorter road.
  walk.back();
  assert.deepEqual(transport(cube).at(-1), ['stepBackStop'], 'stepping back to the start snapped');
  // Crossing a real turn AND a regrip together is walked too, which the token-count rule could not do.
  const mixed = recordingCube();
  const both = createStopDriver(script([{ move: 'x' }, { move: 'y R' }]), { cube: mixed });
  both.next();
  both.next();
  both.back();
  assert.deepEqual(transport(mixed).at(-1), ['playTo', 1], 'backing across a turn and a regrip snapped');
  // And a position that IS one of the element's stops is still played as a group by the element.
  const far = recordingCube();
  const two = createStopDriver(script([{ move: "R U" }, { move: 'F' }]), { cube: far });
  two.seek(2);
  const before = transport(far).length;
  two.next();
  assert.equal(transport(far).length, before + 1, 'the arrival was made of more than one call');
  assert.equal(transport(far).at(-1)[0], 'stepStop', 'a turn on one of the element\'s own stops is a group');
});

// Found by a Codex audit, 2026-09-16. Two halves of one rule: a position is a whole number, and the
// clock's view is a STOP plus how far into it the element has got.
test('a position is a whole number, and a paint says which stop plus how far into it', () => {
  const built = script([{ move: 'y x R' }, { move: 'U' }]);
  const walk = createStopDriver(built, { cube: recordingCube() });
  walk.seek(0.6);
  assert.equal(walk.position, 1, 'a fractional seek left the driver and the picture in different places');
  assert.equal(walk.view.index ?? walk.position, 1);
  assert.throws(() => walk.seek('the middle'), /is not a position/);
  assert.throws(() => walk.seek(NaN), /is not a position/);
  // And the clock's view while a group animates: the stop's cube and hold, the tokens actually started.
  const clock = createClockDriver(built, { cube: recordingCube() });
  const mid = clock.paint(0.1);
  assert.equal(mid.moves, 1, 'only the first token of the group had started');
  assert.equal(mid.hold, viewAtPosition(built, 1).hold,
    "the stop's hold is in force from the moment its first token starts");
  assert.deepEqual(mid.cube, viewAtPosition(built, 1).cube, 'the view is the stop being animated toward');
  // And the cube those tokens have actually reached, which is what a reader draws: mid-group that is the
  // stop BEFORE this one, because every token in between is a regrip and a regrip moves no piece.
  assert.deepEqual(mid.settled, viewAtPosition(built, 0).cube, 'the settled cube was the turn not yet made');
  assert.notDeepEqual(mid.settled, mid.cube, 'precondition: this group is one the two answers differ in');
  const done = clock.paint(10);
  assert.deepEqual(done.settled, done.cube, 'once the group has landed the two are the same cube');
});

// Found by the verify pass over the overlap fix, 2026-09-16: the reason ordinary scripts overlapped at
// all. A step with no `at` inherited the START of the step before it — right for narration, which is said
// over what is happening, and wrong for a step that turns: two untimed move steps were scheduled to turn
// at the same instant, and the last token of one and the first of the next went together.
test('an untimed step turns after the step before it has finished turning, not while it does', () => {
  const built = script([{ move: "R U" }, { move: 'F' }, { say: 'and there it is' }]);
  const { tokenTimes } = timelineOf(built);
  const times = tokenTimes[0];
  assert.equal(times.length, 3);
  assert.ok(times[2] > times[1], `F was scheduled at ${times[2]}, not after U at ${times[1]}`);
  const clock = createClockDriver(built, { cube: recordingCube() });
  assert.equal(clock.paint(times[1] + 0.01).moves, 2, 'the third token turned with the second');
  assert.equal(clock.paint(times[2] + 0.01).moves, 3);
  // A line said with no time of its own still belongs with what it is said over: it takes the time the
  // moves before it end at, and says nothing about turning.
  const said = timelineOf(script([{ move: 'R', at: 2, secs: 1 }, { say: 'like that' }]));
  assert.equal(said.tokenTimes[0].length, 1);
});

// Found by a Codex audit, 2026-09-16: the rule that a jump RE-SEATS a cube that is still turning had no
// case that ever set `animating`, so the branch was never taken by any test. It exists because the
// element finishes the turn it is on: a listener that scrubs away mid-turn would otherwise have that turn
// land on top of the cube it scrubbed to.
test('a jump to the position already reached re-seats a cube that is still turning, and only then', () => {
  const built = script([{ move: 'R' }, { move: 'U' }]);
  const cube = recordingCube();
  const walk = createStopDriver(built, { cube });
  walk.next();
  const settled = transport(cube).length;
  // Nothing in flight: a jump to where we already are says nothing to the element.
  cube.animating = false;
  walk.seek(1);
  assert.equal(transport(cube).length, settled, 'a jump to the same position moved a settled cube');
  // A turn in flight: the same jump re-seats it, so the turn cannot land after the scrub.
  cube.animating = true;
  walk.seek(1);
  assert.deepEqual(transport(cube).at(-1), ['seek', 1], 'a turn in flight was left to land on the scrubbed cube');
  // And the clock driver's seek does the same, for the same reason.
  const clockCube = recordingCube();
  const clock = createClockDriver(built, { cube: clockCube });
  clock.paint(0.01);
  const at = transport(clockCube).length;
  clockCube.animating = true;
  clock.seek(0.01);
  assert.ok(transport(clockCube).length > at, 'a clock seek left a turn in flight to land');
});

// THE THREE CAPABILITIES PLAN ITEM 6.5 WAS BLOCKED ON, each a design the owner settled on 2026-09-17. The
// cube screen could not become a driver consumer without them, and the item named each: a writer that
// leaves host-owned attributes alone, an animated hold change, and a stop driver that plays.

test('a host keeps the attributes it says it owns, and the writer fills in the rest', () => {
  // The cube screen lets a child tune the view. A writer that put `camera-latitude` back on every position
  // would undo that on every press — which is the first reason the screen could not be a consumer.
  const built = script([{ move: 'R', cam: [10, 20], ghosts: true, camUp: 'D' }, { move: 'U', ghosts: true }]);
  const owned = ['ghosts', 'ghost-elevation', 'camera-latitude', 'camera-longitude', 'camera-up'];

  const free = recordingCube();
  createStopDriver(built, { cube: free }).next();
  const freeNames = new Set(free.calls.filter(([c]) => c === 'set').map(([, n]) => n));
  for (const attr of owned) {
    assert.ok(freeNames.has(attr), `precondition: a writer with no owner set writes ${attr}`);
  }

  const kept = recordingCube();
  createStopDriver(built, { cube: kept, owned }).next();
  const keptNames = new Set(kept.calls.filter(([c]) => c === 'set').map(([, n]) => n));
  for (const attr of owned) {
    assert.equal(keptNames.has(attr), false, `the writer wrote ${attr}, which the host owns`);
  }
  // Everything else still arrives: owning the view does not mean owning the cube.
  for (const attr of ['orientation', 'alg', 'highlight']) {
    assert.ok(keptNames.has(attr), `owning the view stopped the writer saying ${attr}`);
  }
});

test('a driver that plays walks one stop at a time, and anything a person does stops it', () => {
  // The clock is a seam, so the whole walk runs here without waiting for any of it.
  const pending = [];
  const schedule = Object.assign((fn) => { pending.push(fn); return pending.length; },
    { cancel: (id) => { pending[id - 1] = null; } });
  const run = (n) => { for (let i = 0; i < n; i++) { const fn = pending.find(Boolean); if (!fn) return; pending[pending.indexOf(fn)] = null; fn(); } };

  const built = script([{ move: 'R' }, { move: 'U' }, { move: 'F' }]);
  const cube = recordingCube();
  const walk = createStopDriver(built, { cube, schedule });
  assert.equal(walk.playing, false, 'a driver plays before it is asked to');
  walk.play({ every: 10 });
  assert.equal(walk.playing, true);
  run(2);
  assert.equal(walk.position, 2, `playing walked to ${walk.position}, not 2`);

  // It STOPS at the end rather than wrapping, unless asked to repeat.
  run(5);
  assert.equal(walk.position, 3, 'playing ran past the end of the walk');
  assert.equal(walk.playing, false, 'the clock is still running with nowhere to go');

  // With `repeat` it wraps instead.
  const looped = createStopDriver(built, { cube: recordingCube(), schedule });
  looped.play({ every: 10, repeat: true });
  run(5);
  assert.equal(looped.playing, true, 'a repeating walk stopped at the end');
  assert.ok(looped.position < 3, `a repeating walk did not wrap (at ${looped.position})`);

  // AND A PERSON OUTRANKS THE CLOCK — a press, a scrub, a halt, or a cube turned in a hand.
  for (const take of [(d) => d.next(), (d) => d.back(), (d) => d.seek(1), (d) => d.halt()]) {
    const d = createStopDriver(built, { cube: recordingCube(), schedule });
    d.play({ every: 10 });
    assert.equal(d.playing, true, 'precondition: it is playing');
    take(d);
    assert.equal(d.playing, false, 'the walk kept playing under the person driving it');
  }
  const followed = createStopDriver(built, { cube: recordingCube(), schedule });
  followed.play({ every: 10 });
  followed.observe(toFacelets(built.positions[1].cube));
  assert.equal(followed.playing, false, 'a cube turned in a hand did not stop the clock');
});
