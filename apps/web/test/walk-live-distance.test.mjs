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
  const live = createLiveDistance({
    root,
    CHIP_NODE_BUDGET: 7,
    stageAsk: (q) => { asked.push(q); const d = deferred(); replies.push(d); return d.promise; },
    chainTrusted: () => env.trusted,
    stageTargetNow: () => env.target,
    modelNow: () => env.model,
  });
  const lineEl = root.querySelector('#stageLive');
  return { live, env, asked, replies, root, lineEl, line: () => lineEl.textContent };
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

test('of two refreshes in flight, only the newer one writes', async () => {
  const r = rig();
  void r.live.refresh();
  await settle();
  r.env.model = model('B');
  void r.live.refresh();
  await settle();
  r.replies[1].resolve({ bounds: { cross: 1 } }); // the newer bound
  await settle();
  const newerBound = r.line();
  assert.match(newerBound, /your cube now/, 'precondition: the newer bound is on the line');
  r.replies[0].resolve({ bounds: { cross: 5 } }); // the older bound, late
  await settle();
  assert.equal(r.line(), newerBound, "the older cube's bound landed over the newer one");
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
