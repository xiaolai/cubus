// The live distance on its own — lib/walk-live-distance.js.
//
// stage-smartcube.test.mjs reads this path as source and holds it to WHICH code the number goes
// through. This file holds it to what the line SAYS while replies race, trust lapses and the screen
// goes away: every reply here is a deferred whose timing the case decides.
//
// No case awaits a refresh that a wrong answer could leave waiting on a reply that never comes. A
// refresh that went on to ask a question it should have dropped would hang there, and the file would
// fail as unfinished — which says something is wrong without saying what. So the cases let the replies
// settle and then assert what is on the line and what was asked.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { Window } from 'happy-dom';

import { t } from '../lib/i18n.js';
import { STAGE_COPY } from '../lib/stage-report.js';
import { createLiveDistance } from '../lib/walk-live-distance.js';

const settle = async (ticks = 3) => {
  for (let i = 0; i < ticks; i += 1) await new Promise((r) => { setTimeout(r, 0); });
};
const deferred = () => {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
};
const windows = [];
after(async () => { for (const win of windows) await win.happyDOM.close(); });

const CROSS = { id: 'cross', name: 'cross' };
/** A follow model as the session holds one: all the live distance asks of it is its arrangement. */
const model = (facelets) => ({ asString: () => facelets });

/** A mounted `#stageLive` line with a live distance on it. Every stage question waits for the case. */
function rig() {
  const win = new Window();
  windows.push(win);
  const root = win.document.createElement('div');
  root.innerHTML = '<div id="stageLive"></div>';
  win.document.body.appendChild(root);
  const asked = [];
  const replies = [];
  const env = { trusted: true, target: CROSS, model: model('A') };
  // The screen's abort, as the walk session hands it over.
  const screen = new AbortController();
  const live = createLiveDistance({
    root,
    CHIP_NODE_BUDGET: 7,
    stageAsk: (q) => { asked.push(q); const d = deferred(); replies.push(d); return d.promise; },
    chainTrusted: () => env.trusted,
    stageTargetNow: () => env.target,
    modelNow: () => env.model,
    signal: screen.signal,
  });
  const lineEl = root.querySelector('#stageLive');
  return { live, env, asked, replies, root, screen, lineEl, line: () => lineEl.textContent };
}

/** A refresh whose bound has landed and whose exact search has been asked for and is still out. */
async function routeInFlight(what) {
  const r = rig();
  void r.live.refresh();
  await settle();
  r.replies[0].resolve({ bounds: { cross: 2 } });
  await settle();
  assert.equal(r.asked.length, 2, `${what}: precondition: the exact search is in flight`);
  assert.equal(r.asked[1].want, 'route');
  return r;
}

test('with nothing to aim at, no model or no trust, the line is cleared and nothing is asked', async () => {
  for (const [what, change] of [
    ['no target', (env) => { env.target = null; }],
    ['no model', (env) => { env.model = null; }],
    ['no trust', (env) => { env.trusted = false; }],
  ]) {
    const r = rig();
    r.lineEl.textContent = 'your cube now: 3 moves';
    change(r.env);
    void r.live.refresh();
    await settle();
    assert.deepEqual(r.asked, [], `${what}: the pool was asked anyway`);
    assert.equal(r.line(), '', `${what}: a number stood over a cube it no longer describes`);
  }
});

test('the old number goes when a new one is asked for, so two unavailable replies leave the line blank', async () => {
  const r = rig();
  r.lineEl.textContent = 'your cube now: 3 moves';
  void r.live.refresh();
  await settle();
  assert.equal(r.line(), '', "the previous cube's number stood while this one was asked about");
  r.replies[0].resolve(null);
  await settle();
  assert.equal(r.asked.length, 2, 'precondition: an unavailable bound still goes on to the exact search');
  r.replies[1].resolve(null);
  await settle();
  assert.equal(r.line(), '');
  assert.deepEqual(r.asked.map((q) => q.want), ['bounds', 'route']);
});

test('the bound shows first and the exact answer replaces it — both asked about the cube as it was', async () => {
  const r = rig();
  void r.live.refresh();
  await settle();
  r.env.model = model('B'); // the cube turns while the replies are in flight
  r.replies[0].resolve({ bounds: { cross: 2 } });
  await settle();
  assert.match(r.line(), /your cube now/, 'the bound was not shown while the exact answer was worked out');
  const bound = r.line();
  assert.equal(r.asked.length, 2, 'precondition: the exact search was asked after the bound');
  assert.deepEqual(r.asked.map((q) => q.facelets), ['A', 'A'],
    'the exact search was asked about a different cube from the bound');
  assert.equal(r.asked[1].target, 'cross');
  assert.equal(r.asked[1].nodeBudget, 7);
  r.replies[1].resolve({ moves: 3 });
  await settle();
  assert.notEqual(r.line(), bound, 'the exact answer did not replace the bound');
});

test('an answer already in flight lands on nothing once the number is dropped', async () => {
  const r = rig();
  void r.live.refresh();
  await settle();
  r.live.drop();
  r.replies[0].resolve({ bounds: { cross: 2 } });
  await settle();
  assert.equal(r.line(), '', 'a reply to a dropped question repainted over the clearing');
  assert.equal(r.asked.length, 1, 'and went on to ask the exact search for nobody');
});

test('trust lapsing while a reply is in flight stops the write', async () => {
  const r = rig();
  void r.live.refresh();
  await settle();
  r.env.trusted = false;
  r.replies[0].resolve({ bounds: { cross: 2 } });
  await settle();
  assert.equal(r.line(), '', 'a number was written for a cube nobody can vouch for any more');
  assert.equal(r.asked.length, 1);
});

test('of two refreshes, only the newer one writes', async () => {
  // A refresh while a question is out waits for it rather than sending its own, so the older
  // answer lands first — and must land on nothing, because the cube it describes has turned since.
  const r = rig();
  void r.live.refresh();
  await settle();
  r.env.model = model('B');
  void r.live.refresh();
  await settle();
  r.replies[0].resolve({ bounds: { cross: 5 } }); // the older bound, after the turn
  await settle();
  assert.equal(r.line(), '', "the older cube's bound landed after the cube had turned");
  r.replies[1].resolve({ bounds: { cross: 1 } }); // the newer bound, asked once the older landed
  await settle();
  assert.equal(r.line(), t('your cube now: %1', STAGE_COPY.atLeast(1)), 'the newer bound was not written');
});

test('a line on a screen that has gone is never written', async () => {
  const r = rig();
  void r.live.refresh();
  await settle();
  r.root.remove();
  r.replies[0].resolve({ bounds: { cross: 2 } });
  await settle();
  assert.equal(r.line(), '', 'a screen that had been left was written to');
  assert.equal(r.asked.length, 1);
});

// ---- one question out at a time -----------------------------------------------------------------

test('turns made while a question is out ask once more, about the cube as it is by then', async () => {
  // Every turn refreshes. Each refresh used to send its bound at once, so twenty turns while one
  // reply was out queued twenty questions on the worker every stage question shares.
  for (const [what, start, landed] of [
    ['the bound', async () => { const r = rig(); void r.live.refresh(); await settle(); return r; }, { bounds: { cross: 5 } }],
    ['the exact search', () => routeInFlight('the exact search'), { alg: null, moves: null, exact: false, why: 'stopped' }],
  ]) {
    const r = await start();
    const out = r.asked.length;
    for (let turn = 1; turn <= 20; turn += 1) {
      r.env.model = model(`turn ${turn}`);
      void r.live.refresh();
    }
    await settle();
    assert.equal(r.asked.length - out, 0, `while ${what} was out, twenty turns sent ${r.asked.length - out} more questions`);
    r.replies[out - 1].resolve(landed);
    await settle();
    assert.deepEqual(r.asked.slice(out).map((q) => `${q.want} ${q.facelets}`), ['bounds turn 20'],
      `once ${what} landed, the cube was not asked about once more, as it is now`);
  }
});

test('a question waiting to be asked goes with the number, and is never sent', async () => {
  for (const [what, invalidate] of [
    ['the number dropped', (r) => { r.live.drop(); }],
    ['the screen gone', (r) => { r.screen.abort(); }],
  ]) {
    const r = rig();
    void r.live.refresh();
    await settle();
    r.env.model = model('B');
    void r.live.refresh(); // turned while the bound is out
    invalidate(r);
    r.replies[0].resolve({ bounds: { cross: 2 } });
    await settle();
    assert.deepEqual(r.asked.map((q) => q.facelets), ['A'], `${what}: a question dropped while it waited was asked anyway`);
    assert.equal(r.line(), '', `${what}: the line was written after the number was dropped`);
  }
});

// ---- the exact answer: while it is out, what it says, and calling it off --------------------

test('an exact answer in flight lands on nothing once its cube is gone', async () => {
  // Every case above invalidates while the BOUND is out. This is the check after the exact search,
  // which an audit removed in memory with all of them still passing.
  for (const [what, invalidate] of [
    ['a newer turn', (r) => { r.env.model = model('B'); void r.live.refresh(); }],
    ['the number dropped', (r) => { r.live.drop(); }],
    ['trust lapsing', (r) => { r.env.trusted = false; }],
    ['the screen gone', (r) => { r.root.remove(); }],
  ]) {
    const r = await routeInFlight(what);
    invalidate(r);
    await settle();
    const before = r.line();
    r.replies[1].resolve({ alg: 'R U F', moves: 3, exact: true });
    await settle();
    assert.equal(r.line(), before,
      `${what}: an exact answer about a cube no longer in hand was written`);
  }
});

test('a cube already at the target is told so, and a zero bound is not a distance', async () => {
  const r = rig();
  void r.live.refresh();
  await settle();
  r.replies[0].resolve({ bounds: { cross: 0 } });
  await settle();
  assert.equal(r.line(), '', 'a bound of zero was shown as a distance');
  r.replies[1].resolve({ alg: '', moves: 0, exact: true });
  await settle();
  assert.equal(r.line(), STAGE_COPY.already('cross'),
    'arriving was reported as a route of no moves');
});

test('the exact answer says the shortest way back, or that the search could not', async () => {
  for (const [reply, said] of [
    [{ alg: 'R U F', moves: 3, exact: true }, STAGE_COPY.shortest(3)],
    [{ alg: null, moves: null, exact: false }, STAGE_COPY.unknown()],
  ]) {
    const r = await routeInFlight(`moves ${reply.moves}`);
    r.replies[1].resolve(reply);
    await settle();
    assert.equal(r.line(), t('your cube now: %1', said));
  }
});

test('a turn, a drop or leaving the screen calls off the exact search', async () => {
  for (const [what, invalidate] of [
    ['a newer turn', (r) => { r.env.model = model('B'); void r.live.refresh(); }],
    ['the number dropped', (r) => { r.live.drop(); }],
    ['the screen gone', (r) => { r.screen.abort(); }],
  ]) {
    const r = await routeInFlight(what);
    const { signal } = r.asked[1];
    assert.ok(signal instanceof AbortSignal,
      `${what}: the exact search was asked with no way to call it off`);
    assert.equal(signal.aborted, false,
      `${what}: precondition: a search still wanted is not called off`);
    invalidate(r);
    assert.equal(signal.aborted, true,
      `${what}: a search about a cube no longer in hand was left running`);
    r.replies[1].resolve({ alg: null, moves: null, exact: false });
    await settle();
  }
});
