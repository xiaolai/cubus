// The Shapes screen, and the menu that leads to it — wired, in the real index.html.
//
// `patterns.test.mjs` holds the CATALOGUE (which pictures, and why those) and
// `shape-recency.test.mjs` holds the five the menu draws. Neither can see the half that fails
// silently: whether the grid is actually reachable, whether a press reaches anything, and whether
// the way through from the menu is a navigation rather than a target press.
//
// THE THREE THINGS THAT WOULD BREAK WITHOUT BREAKING ANYTHING ELSE:
//
//   A card carrying `data-stage`. Every `[data-stage]` in the app is wired and painted by the walk
//   session's one group (`wireGroup` in lib/walk-session.js) and there is no walk session on this
//   screen — so the attribute would be a promise nothing keeps, and the pressed look would be
//   written by nobody. The same mistake in reverse is what left the menu's items unwired on a
//   solved cube (2026-09-27).
//
//   The menu's way through carrying one. `data-stage="shapes"` would set `state.stageTarget` to a
//   string naming no destination, which `stageTargetNow()` resets to `solved` with a console
//   warning — so the press would silently un-choose whatever picture was on.
//
//   And a press that does not RECORD. The fifteen pictures the menu does not hold are chosen here
//   and nowhere else; without the write, a shape found on this screen could never make its way into
//   the menu, and the recency would only ever shuffle the five it started with.
//
// node --test runs each file in its own process, so app.js boots once and the cases share it.

import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';

import { isAbsent } from './dom-assert.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

let win;
let state;
let settings;
let OFFERED_PATTERNS;
let selectionOf;
let RECENT_SHOWN;

before(async () => {
  win = new Window({
    url: 'http://localhost/#/home',
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      fetch: { disableSameOriginPolicy: true },
    },
  });
  win.document.write(html);
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'customElements', 'HTMLElement', 'CustomEvent',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  await import('../lib/app.js');
  ({ state } = await import('../lib/app-state.js'));
  ({ settings } = await import('../lib/app-settings.js'));
  ({ OFFERED_PATTERNS, selectionOf } = await import('../lib/patterns.js'));
  ({ RECENT_SHOWN } = await import('../lib/shape-recency.js'));
  await tick();
});

/**
 * Go to a screen, THROUGH THE APP'S OWN `go` rather than by assigning the hash.
 *
 * Assigning a hash that is already the current one fires no `hashchange`, so nothing re-renders —
 * and several cases below arrive at a screen they are already on, having changed `state` first.
 * `go()` is the function that answers that case in production (`if (!router.go(id)) applyRoute()`),
 * and a helper that does not would be testing a stale DOM. The one case that must prove the HASH
 * reaches the screen sets it directly, below, which is the whole point of that case.
 */
const open = async (id) => { win.cubusGo(id); await tick(); };
const cards = () => [...win.document.querySelectorAll('#shapeGrid [data-shape]')];

test('the screen is addressable, named, and draws every picture the catalogue offers', async () => {
  win.location.hash = '#/shapes';
  await tick();
  assert.equal(state.screen, 'shapes', 'the hash did not reach the screen');
  assert.match(win.document.title, /^Shapes/, `the window is titled "${win.document.title}"`);
  const ids = cards().map((b) => b.dataset.shape);
  assert.deepEqual(ids, OFFERED_PATTERNS.map((p) => selectionOf(p)),
    'the grid is not the catalogue, in the catalogue\'s order');
  // A GRID MUCH LARGER THAN THE MENU is the whole reason this screen exists. Pinned as a relation
  // rather than as the number 20: the catalogue is `patterns.test.mjs`'s to pin, and what matters
  // here is that the screen shows more than the menu could.
  assert.ok(ids.length > RECENT_SHOWN,
    `the screen offers ${ids.length} pictures and the menu holds ${RECENT_SHOWN} — it is not showing more than the menu`);
});

test('every picture is DRAWN, and none of them is a stage press', async () => {
  await open('shapes');
  for (const card of cards()) {
    assert.ok(card.querySelector('svg'),
      `${card.dataset.shape} was offered as text rather than as a picture`);
    // The audience cannot read, so the name is the screen reader's channel and the caption's, never
    // the only way to tell one card from another.
    assert.ok(card.getAttribute('aria-label')?.trim(), `${card.dataset.shape} has no name for a reader`);
    assert.equal(card.dataset.stage, undefined,
      `${card.dataset.shape} carries data-stage — the walk session's group would claim a press no session is here to answer`);
  }
  isAbsent(win.document.querySelector('#shapeGrid [data-stage]'), 'a stage press on a screen with no walk');
});

test('the picture that is on is marked, and a stage being on marks nothing', async () => {
  const was = state.stageTarget;
  try {
    state.stageTarget = 'checkerboard';
    await open('shapes');
    const on = cards().filter((b) => b.getAttribute('aria-pressed') === 'true');
    assert.deepEqual(on.map((b) => b.dataset.shape), ['checkerboard'], 'the chosen picture is not the marked one');

    // A STAGE IS NOT A PICTURE. `patternBySelection` answers null for one, so every card draws
    // unpressed — which is correct, and is the half that a `find` returning the first card would
    // get wrong.
    state.stageTarget = 'cross';
    await open('shapes');
    assert.deepEqual(cards().filter((b) => b.getAttribute('aria-pressed') === 'true'), [],
      'a stage being on marked a picture');
  } finally { state.stageTarget = was; }
});

test('pressing a picture aims the cube at it, records it, and goes to the cube', async () => {
  const was = state.stageTarget;
  const history = [...settings.shapesRecent];
  try {
    settings.shapesRecent = [];
    await open('shapes');
    // One from the far end of the catalogue — a picture the menu does not hold, which is exactly
    // what this screen is for.
    const far = selectionOf(OFFERED_PATTERNS.at(-1));
    const card = cards().find((b) => b.dataset.shape === far);
    assert.ok(card, `the grid does not offer ${far}`);

    card.click();
    await tick();

    assert.equal(state.stageTarget, far, 'the press did not aim the cube anywhere');
    assert.equal(state.screen, 'home', 'the press left the grid standing instead of going to the cube');
    assert.equal(settings.shapesRecent[0], far, 'the choice was not recorded, so the menu can never learn it');
  } finally { state.stageTarget = was; settings.shapesRecent = history; }
});

test('the cube screen\'s menu holds five pictures and one way through to the rest', async () => {
  const history = [...settings.shapesRecent];
  try {
    settings.shapesRecent = [];
    await open('home');
    const button = win.document.querySelector('#patternBtn');
    assert.ok(button, 'the cube screen offers no Shapes button');
    button.click();
    await tick();

    const menu = win.document.querySelector('.pattern-menu');
    assert.ok(menu, 'the menu did not open');
    const pictures = [...menu.querySelectorAll('[role="menuitemradio"]')];
    // FIVE, and that bound is what let the catalogue grow to twenty. A menu is a popover dropped
    // under a corner button and capped to the stage's height; twenty pictures scrolling inside that
    // cap is a grid wearing a menu's clothes.
    assert.equal(pictures.length, RECENT_SHOWN, `the menu offered ${pictures.length} pictures`);
    assert.ok(pictures.every((b) => b.querySelector('svg')), 'a picture was offered as text');
    assert.ok(pictures.every((b) => b.dataset.stage), 'a picture in the menu is not a target press');

    // THE WAY THROUGH. A `menuitem`, so `menu.mark` passes over it — the whole catalogue is not a
    // sixth thing to be aiming at, and a tick that can never be on is a control that lies.
    const more = [...menu.querySelectorAll('[role="menuitem"]')];
    assert.equal(more.length, 1, `the menu holds ${more.length} commands beside its pictures`);
    assert.equal(more[0].dataset.stage, undefined,
      'the way through carries data-stage — pressing it would un-choose the picture that is on');
    assert.ok(more[0].textContent.trim(), 'the way through has no words');
  } finally { settings.shapesRecent = history; }
});

test('the menu\'s way through opens the Shapes screen, and does not change what the cube aims at', async () => {
  const was = state.stageTarget;
  try {
    state.stageTarget = 'checkerboard';
    await open('home');
    win.document.querySelector('#patternBtn').click();
    await tick();
    const more = win.document.querySelector('.pattern-menu [role="menuitem"]');
    assert.ok(more, 'the menu offers no way through');
    more.click();
    await tick();
    assert.equal(state.screen, 'shapes', 'the way through did not open the screen');
    assert.equal(state.stageTarget, 'checkerboard',
      'opening the catalogue changed what the cube is aiming at — the navigation was read as a target press');
  } finally { state.stageTarget = was; }
});

test('a picture chosen on the screen is in the menu next time it is opened', async () => {
  const was = state.stageTarget;
  const history = [...settings.shapesRecent];
  try {
    settings.shapesRecent = [];
    await open('home');
    win.document.querySelector('#patternBtn').click();
    await tick();
    const far = selectionOf(OFFERED_PATTERNS.at(-1));
    const held = () => [...win.document.querySelectorAll('.pattern-menu [data-stage]')].map((b) => b.dataset.stage);
    assert.ok(!held().includes(far), 'the fixture picked a picture the menu already held');

    await open('shapes');
    cards().find((b) => b.dataset.shape === far).click();
    await tick();

    await open('home');
    win.document.querySelector('#patternBtn').click();
    await tick();
    assert.ok(held().includes(far), 'a picture chosen on the screen never reached the menu');
    assert.equal(held().length, RECENT_SHOWN, 'the menu grew rather than making room');
  } finally { state.stageTarget = was; settings.shapesRecent = history; }
});

// THE MENU'S OWN RECORDING PATH, which nothing reached until 2026-10-04. The cases above press
// pictures on the SCREEN; `shape-recency.test.mjs` calls `rememberShape` directly. Between them sat
// the one line that connects the two — the `rememberShape` call in the menu's item callback — and
// deleting it left all 115 cases across those files green (audit, 2026-10-04). Menu choices could
// have stopped reordering the menu with nothing saying so.
//
// It presses a NON-LEADING picture on purpose: pressing the first one is indistinguishable from a
// history that never changed, which is exactly the no-op a deleted call produces.
test('choosing a picture in the menu records it, persists it, and leads the menu next time', async () => {
  const was = state.stageTarget;
  const history = [...settings.shapesRecent];
  try {
    settings.shapesRecent = [];
    await open('home');
    win.document.querySelector('#patternBtn').click();
    await tick();

    const held = () => [...win.document.querySelectorAll('.pattern-menu [data-stage]')].map((b) => b.dataset.stage);
    const before = held();
    assert.equal(before.length, RECENT_SHOWN, 'the menu did not open with its five pictures');
    const third = before[2];

    win.document.querySelector(`.pattern-menu [data-stage="${third}"]`).click();
    await tick();

    // IN MEMORY…
    assert.equal(settings.shapesRecent[0], third, 'the menu press did not reach the history');
    // …AND ON DISK, which is the half that makes it survive a reload. A history kept only in memory
    // would pass every assertion in this file and be gone the next time the app started.
    const stored = JSON.parse(win.localStorage.getItem('cubusSettings')).shapesRecent;
    assert.equal(stored[0], third, `the choice never reached storage: ${JSON.stringify(stored)}`);

    // AND THE MENU IS REBUILT FROM IT. Not the open menu — that deliberately does not reorder under
    // the finger that just pressed it — but the next mount's.
    await open('shapes');
    await open('home');
    win.document.querySelector('#patternBtn').click();
    await tick();
    const after = held();
    assert.equal(after[0], third, `the picture chosen does not lead the menu: ${after.join(', ')}`);
    assert.equal(after.length, RECENT_SHOWN, 'the menu grew rather than reordering');
    assert.equal(new Set(after).size, RECENT_SHOWN, 'the menu drew one picture twice');
  } finally { state.stageTarget = was; settings.shapesRecent = history; }
});

test('Shapes is not a tab — it is reached from the cube, not from the row', async () => {
  // NAV is the beginner's path to a solved cube; the pictures are the game beside it. A tab would
  // file them as a stop on the way, which is the drift dev-docs/solve-to-state-plan.md §9.6 refused
  // one level down (a pattern must not reach the Restore row either).
  await open('shapes');
  isAbsent(win.document.querySelector('#nav [data-nav="shapes"]'), 'Shapes took a place in the tab row');
});
