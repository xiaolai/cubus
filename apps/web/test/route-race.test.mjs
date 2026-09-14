// The route race on its own — lib/screens/cube/route-race.js.
//
// stage-wiring.test.mjs reads the race as source and holds it to the frame crossings it names. This
// file holds it to what it DOES: the cube, the frame renaming, the replay and the race are the real
// ones, and only the three services behind the sources are fakes whose timing each case decides.
//
// Every case asks about a solved cube turned `U` in the scan frame, where white is up: its white
// cross is one turn out and `U'` puts it back. In the METHOD frame, where the engine and the method
// solver work, white is on D and the same repair has another name — which is what lets a case tell
// an answer that crossed the frames from one that did not.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import Cube from '../vendor/cubejs.js';
import { METHOD_FRAME, renameAlg } from '../lib/solving-hold.js';
import { targetById } from '../lib/stage-targets.js';
import { createRouteRace } from '../lib/screens/cube/route-race.js';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const OFF_BY_U = (() => { const c = Cube.fromString(SOLVED); c.move('U'); return c.asString(); })();
const CROSS = targetById('cross');
/** The repair, as the engine and the method solver name it: in the method frame. */
const REPAIR_IN_METHOD_FRAME = renameAlg("U'", METHOD_FRAME);
const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** A race over fakes. `make` receives the case's records and returns the services it overrides. */
function race(make = () => ({})) {
  const asked = [];
  const methodRuns = [];
  const state = { cube: { solution: null } };
  const lastRoute = createRouteRace({
    state,
    cubejs: () => Cube,
    stageAsk: async (q) => { asked.push(q); return null; },
    solveByMethod: (cubie) => {
      methodRuns.push(cubie);
      throw new Error('this case has no method route');
    },
    STAGE_NODE_BUDGET: 4_000_000,
    ...make({ asked, methodRuns }),
  });
  return { lastRoute, asked, methodRuns, state };
}

test('the exact search is asked about the cube as held, with the walk\'s signal', async () => {
  assert.notEqual(REPAIR_IN_METHOD_FRAME, "U'",
    'precondition: the two frames name this repair differently');
  const walk = new AbortController();
  const r = race(({ asked }) => ({
    stageAsk: async (q) => { asked.push(q); return { alg: REPAIR_IN_METHOD_FRAME, moves: 1 }; },
  }));
  const got = await r.lastRoute(CROSS, OFF_BY_U, walk.signal, new Promise(() => {}));
  assert.equal(r.asked.length, 1,
    'the worker was not asked: the race judged the cube in the wrong frame');
  const { signal, ...question } = r.asked[0];
  assert.deepEqual(question, {
    want: 'route', target: 'cross', facelets: OFF_BY_U, nodeBudget: 4_000_000, maxDepth: 12,
  });
  assert.equal(signal, walk.signal, 'the exact search was asked with no way to call it off');
  assert.equal(got.kind, 'exact');
  assert.equal(got.minimal, true);
  assert.equal(got.alg, "U'",
    'the answer left in the method frame, naming a face nobody is turning');
  assert.ok(Object.isFrozen(got));
});

test('the pool source waits for the whole-cube search and renames its solution', async () => {
  let finish;
  const wholeDone = new Promise((resolve) => { finish = resolve; });
  const r = race();
  const racing = r.lastRoute(CROSS, OFF_BY_U, null, wholeDone);
  await tick();
  // Lands after the race began, the way the whole-cube search's answer does.
  r.state.cube.solution = "U'";
  finish();
  const got = await racing;
  assert.equal(got.source, 'pool',
    'the pool source read the solution before the search had produced it');
  assert.equal(got.alg, "U'",
    "the scan-frame solution was scanned on the method frame's cube without being renamed");
});

test('the method route waits a tick, then solves the method frame\'s cube', async () => {
  const r = race(({ methodRuns }) => ({
    solveByMethod: (cubie) => { methodRuns.push(cubie); return { alg: REPAIR_IN_METHOD_FRAME }; },
  }));
  const racing = r.lastRoute(CROSS, OFF_BY_U, null, Promise.resolve());
  assert.equal(r.methodRuns.length, 0,
    'the method solver ran before the race yielded, on the thread the worker message leaves from');
  const got = await racing;
  assert.equal(got.source, 'method');
  assert.equal(got.alg, "U'",
    "the method route's answer was not renamed back to the scan frame");
});

test('a walk called off during the method route\'s tick runs no method solver', async () => {
  const walk = new AbortController();
  const r = race();
  const racing = r.lastRoute(CROSS, OFF_BY_U, walk.signal, Promise.resolve());
  walk.abort(); // superseded — a newer load, or the screen left — before the tick came round
  const got = await racing;
  assert.equal(r.methodRuns.length, 0,
    'a superseded walk ran the method solver for a cube nobody is waiting for');
  assert.equal(got.alg, null, 'a called-off race produced a route');
});

test('a walk already called off asks the worker nothing and solves nothing', async () => {
  const r = race();
  const got = await r.lastRoute(CROSS, OFF_BY_U, AbortSignal.abort(), Promise.resolve());
  assert.deepEqual(r.asked, [], 'a search was asked for a walk that had already gone');
  assert.equal(r.methodRuns.length, 0, 'the method solver ran for a walk that had already gone');
  assert.equal(got.alg, null);
});

test('a race missing a service refuses when it is built, not by answering nothing', () => {
  const whole = {
    state: { cube: {} }, cubejs: () => Cube, stageAsk: async () => null,
    solveByMethod: () => ({ alg: '' }), STAGE_NODE_BUDGET: 1,
  };
  assert.doesNotThrow(() => createRouteRace(whole),
    'precondition: a whole set of services is accepted');
  for (const name of Object.keys(whole)) {
    assert.throws(() => createRouteRace({ ...whole, [name]: undefined }), new RegExp(name),
      `a race with no \`${name}\` was built`);
  }
});
