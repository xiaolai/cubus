// The scan screen's chip row on its own — lib/screens/scan/stage-chips.js.
//
// stage-wiring.test.mjs reads the row as source and holds it to WHICH questions it asks and in
// what shape; scan-screen.test.mjs holds it to what it does on the screen, where no worker
// answers. This file holds it to what the chips SAY while replies race a newer scan, a cube turned
// in the hand and a screen that goes away: every reply here is a deferred whose timing the case
// decides.
//
// No case awaits a paint that a wrong answer could leave waiting on a reply that never comes. The
// cases let the replies settle, then assert what is on the row and what was asked.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { Window } from 'happy-dom';

import { OFFERED_TARGETS } from '../lib/stage-targets.js';
import { STAGE_COPY, chipFor } from '../lib/stage-report.js';
import { createStageChips } from '../lib/screens/scan/stage-chips.js';

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

/** What a chip says for `fact`, in the report's own words rather than a copy of them. */
const says = (id, fact) => chipFor({ target: OFFERED_TARGETS.find((x) => x.id === id), ...fact }).text;
const WAITING = OFFERED_TARGETS.map(() => '…');
/** One cube's bounds: a target already reached, one never searched, four at different depths. */
const BOUNDS = { cross: 2, 'first-layer': 0, 'two-layers': 5, 'top-cross': 3, 'corners-home': 4, solved: 7 };

/** A mounted chip row. Every question waits for the case; `state` is the cube in hand, and `env`
 *  holds the screen's verdict. */
function rig() {
  const win = new Window();
  windows.push(win);
  const root = win.document.createElement('div');
  root.innerHTML = '<div id="stageCard" hidden><span id="stageSay"></span><div id="stageChips"></div></div>';
  win.document.body.appendChild(root);
  const abort = new win.AbortController();
  const asked = [];
  const replies = [];
  const went = [];
  const state = { cube: { facelets: 'A' }, stageTarget: 'solved' };
  const env = { refused: false };
  const chips = createStageChips({
    root,
    signal: abort.signal,
    state,
    CHIP_NODE_BUDGET: 7,
    stageAsk: (q) => { asked.push(q); const d = deferred(); replies.push(d); return d.promise; },
    go: (to) => { went.push(to); },
    isRefused: () => env.refused,
  });
  const card = root.querySelector('#stageCard');
  const texts = () => Object.fromEntries([...root.querySelectorAll('[data-target]')]
    .map((el) => [el.dataset.target, el.querySelector('.howfar').textContent]));
  const press = (id) => root.querySelector(`[data-target="${id}"]`)
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  return { root, card, chips, state, env, asked, replies, went, abort, texts, press };
}

test('the row is drawn at once, every chip waiting, before the pool has said anything', () => {
  const r = rig();
  void r.chips.paintStageChips('A');
  assert.equal(r.card.hidden, false, 'the row appears the moment the scan lands');
  assert.equal(r.card.dataset.about, 'A', 'and records the cube it was drawn for');
  assert.deepEqual(Object.values(r.texts()), WAITING, 'every chip waiting, so the layout does not move under the user');
  assert.deepEqual(r.asked, [{ want: 'bounds', facelets: 'A' }], 'the first question is one table read for every target');
});

test('bounds land together, then the searches run cheapest first — never for a target already reached, never for solved', async () => {
  const r = rig();
  void r.chips.paintStageChips('A');
  r.replies[0].resolve({ bounds: BOUNDS });
  await settle();
  assert.deepEqual(r.texts(), {
    cross: says('cross', { bound: 2 }),
    'first-layer': says('first-layer', { bound: 0, atTarget: true }),
    'two-layers': says('two-layers', { bound: 5 }),
    'top-cross': says('top-cross', { bound: 3 }),
    'corners-home': says('corners-home', { bound: 4 }),
    solved: says('solved', { bound: 7 }),
  }, 'every chip its bound, and a target already reached says so');
  for (let i = 1; i <= 4; i += 1) {
    assert.equal(r.asked.length, i + 1, `search ${i} was never asked`);
    r.replies[i].resolve({ moves: BOUNDS[r.asked[i].target], alg: 'x' });
    await settle();
  }
  assert.deepEqual(r.asked.slice(1).map((q) => q.target), ['cross', 'top-cross', 'corners-home', 'two-layers'],
    'the searches were not cheapest first, or searched a target they should not');
  assert.ok(r.asked.slice(1).every((q) => q.want === 'route' && q.facelets === 'A' && q.nodeBudget === 7 && q.maxDepth === 12),
    'each is a budgeted route search about the cube the row is for');
  assert.equal(r.texts().cross, says('cross', { answer: { moves: 2, minimal: true } }), 'an answer upgrades its bound');
  assert.equal(r.texts().solved, says('solved', { bound: 7 }), 'and solved keeps its bound');
});

test('a search that found nothing is a dash and the row goes on; a reply that never came leaves the bounds standing', async () => {
  const r = rig();
  void r.chips.paintStageChips('A');
  r.replies[0].resolve({ bounds: BOUNDS });
  await settle();
  r.replies[1].resolve({ moves: null, alg: null });
  await settle();
  assert.equal(r.texts().cross, says('cross', { answer: { moves: null } }), 'a finished search with nothing is a dash');
  assert.equal(r.asked.length, 3, 'and the next search is asked');
  r.replies[2].resolve(null);
  await settle();
  assert.equal(r.texts()['top-cross'], says('top-cross', { bound: 3 }), 'a reply that never came claimed a dash the search never earned');
  assert.equal(r.asked.length, 3, 'a pool that has gone was asked again');
  assert.equal(r.texts()['corners-home'], says('corners-home', { bound: 4 }));
});

test('with no pool at all, every chip is a dash and the row offers the whole solve', async () => {
  const r = rig();
  void r.chips.paintStageChips('A');
  r.replies[0].resolve(null);
  await settle();
  assert.deepEqual(Object.values(r.texts()), OFFERED_TARGETS.map((x) => says(x.id, { answer: { moves: null } })),
    'with no pool, a chip claimed something other than a dash');
  assert.equal(r.root.querySelector('#stageSay').textContent, STAGE_COPY.offerSolve(),
    'with no pool, the row did not offer the whole solve');
  assert.equal(r.asked.length, 1, 'and nothing is searched');
});

test('a newer scan makes every reply to the older one land on nothing', async () => {
  const r = rig();
  void r.chips.paintStageChips('A');
  r.state.cube.facelets = 'B';
  void r.chips.paintStageChips('B');
  r.replies[0].resolve({ bounds: BOUNDS });
  await settle();
  assert.equal(r.card.dataset.about, 'B');
  assert.equal(r.card.hidden, false, "a late reply to the older scan took the newer scan's row away");
  assert.deepEqual(Object.values(r.texts()), WAITING, "a late reply to the older scan painted over the newer scan's row");
  assert.equal(r.asked.filter((q) => q.facelets === 'A').length, 1, 'and the older scan searched on');
});

test('a cube turned under the row takes the row away when the next reply lands', async () => {
  for (const at of ['bounds', 'route']) {
    const r = rig();
    void r.chips.paintStageChips('A');
    if (at === 'route') {
      r.replies[0].resolve({ bounds: BOUNDS });
      await settle();
    }
    r.state.cube.facelets = 'A turned';
    r.replies[r.replies.length - 1].resolve(at === 'bounds' ? { bounds: BOUNDS } : { moves: 2, alg: 'x' });
    await settle();
    assert.equal(r.card.hidden, true, `${at}: a row about a cube nobody is holding stayed on screen`);
    assert.equal(r.asked.length, at === 'bounds' ? 1 : 2, `${at}: the row went on asking about a cube nobody is holding`);
  }
});

test('a row whose screen has gone is neither painted nor searched for', async () => {
  const r = rig();
  void r.chips.paintStageChips('A');
  r.root.remove();
  r.replies[0].resolve({ bounds: BOUNDS });
  await settle();
  assert.deepEqual(Object.values(r.texts()), WAITING, 'a row whose screen had gone was painted');
  assert.equal(r.asked.length, 1, 'a row whose screen had gone searched on');
});

test('a press carries its target home — unless the scan was refused, or the row is about another cube', () => {
  const r = rig();
  void r.chips.paintStageChips('A');
  r.press('two-layers');
  assert.equal(r.state.stageTarget, 'two-layers', 'the press carries its target');
  assert.deepEqual(r.went, ['home'], 'to the screen a walk lives on');
  r.env.refused = true;
  r.press('cross');
  assert.deepEqual(r.went, ['home'], 'a press over a refused read walked');
  r.env.refused = false;
  r.state.cube.facelets = 'B';
  r.press('cross');
  assert.deepEqual(r.went, ['home'], 'a press on a row about another cube walked');
  assert.equal(r.card.hidden, true, 'a press on a row about another cube left the row standing');
  assert.equal(r.state.stageTarget, 'two-layers', 'and neither refused press moved the target');
});

test('a row told its cube has changed takes itself away, and one about the cube in hand stays', async () => {
  const r = rig();
  void r.chips.paintStageChips('A');
  r.replies[0].resolve(null); // no pool: a finished row of dashes, with nothing left to reply
  await settle();
  r.chips.dropIfStale();
  assert.equal(r.card.hidden, false, 'a row about the cube in hand was taken away');
  r.state.cube.facelets = 'A turned';
  r.chips.dropIfStale();
  assert.equal(r.card.hidden, true, 'a finished row outlived the cube it was about');
});

test("a target's name reaches its caption, its tooltip and its chip in the reader's language", async () => {
  const { registerLocale, setLocale } = await import('../lib/i18n.js');
  registerLocale('qa-chip', { cross: '«cross»', 'Take this cube back to the %1': '«back to %1»' });
  setLocale('qa-chip');
  try {
    const r = rig();
    void r.chips.paintStageChips('A');
    const chip = r.root.querySelector('[data-target="cross"]');
    assert.equal(chip.querySelector('.who').textContent, '«cross»', 'the caption kept the English name');
    assert.equal(chip.getAttribute('title'), '«back to «cross»»', 'the tooltip translated around an English name');
    r.replies[0].resolve({ bounds: BOUNDS });
    await settle();
    assert.match(chip.getAttribute('aria-label'), /^«cross»:/, "the chip's accessible name kept the English name");
    assert.equal(chip.dataset.target, 'cross', 'the id is a key, and stays untranslated');
  } finally {
    setLocale('en');
  }
});

test("the press goes with the screen's signal", () => {
  const r = rig();
  void r.chips.paintStageChips('A');
  r.abort.abort();
  r.press('cross');
  assert.deepEqual(r.went, [], "a press after the screen's signal was cut still walked");
});
