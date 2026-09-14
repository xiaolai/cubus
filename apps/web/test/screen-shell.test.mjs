// The shell every screen goes through: teardown, building, installing, mounting — and the routes.
//
// lib/screen-shell.js is driven directly, with SCREENS (its own test seam) holding screens written
// for each case, so a lifecycle failure is not diagnosed through a real screen's mount. index.html
// supplies the stage; nothing boots lib/app.js, so there is no solver, no camera and no cube here.
//
// What these pin (the 2026-09-13 audit):
//   * a mount that throws, or rejects after an await, leaves no half-mounted screen on the paper:
//     its cleanup runs, its listeners are cut, and the stage says what happened;
//   * a failure arriving from a screen already replaced does NOT tear down the current one;
//   * a repaint of the screen you are on keeps the caret and the draft in the control you were
//     typing in — and one whose markup changed that control does not put a stale draft back;
//   * a repaint leaves the field being typed in before replacing it, so a draft is committed once;
//   * a repaint, or a subject taken in place, that takes the focused control away leaves focus on
//     the element that held it, or on the screen — never on the page;
//   * an alias goes through the router's one parser: decoded, own-property checked, and the
//     address bar ends up naming the screen you landed on;
//   * a held Advanced chord toggles once;
//   * a popover is never placed off the stage, however wide it is.

import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

let win;
let sh; // the module namespace: advancedOpen and screenAbort are live bindings
let state;
let hooks;

before(async () => {
  win = new Window({
    url: 'http://localhost/#/home',
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
    },
  });
  win.document.write(html);
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'sessionStorage', 'customElements', 'HTMLElement', 'CustomEvent', 'KeyboardEvent',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  sh = await import('../lib/screen-shell.js');
  ({ state } = await import('../lib/app-state.js'));
  ({ hooks } = await import('../lib/screen-slots.js'));
  sh.installAdvancedShortcut();
  sh.SCREENS.home = () => ({ html: '<p id="homeBody">home</p>' });
  sh.SCREENS.settings = () => ({ html: '<p id="settingsBody">settings</p>' });
});

const stageText = () => win.document.querySelector('#stage').textContent;
const byId = (id) => win.document.getElementById(id);
// DOM nodes are compared as booleans, never handed to assert.equal: a FAILING equal serialises
// both sides for the report, and a happy-dom node drags the whole document graph with it — the
// runner sat on one such failure for five minutes before reporting anything.
const focusName = () => {
  const on = win.document.activeElement;
  return on ? `${on.tagName.toLowerCase()}${on.id ? `#${on.id}` : ''}` : 'nothing';
};
const render = (id, opts) => { state.screen = id; sh.renderScreen(opts); };

test('a mount that throws leaves no half-mounted screen: its cleanup runs, its listeners are cut', async (t) => {
  t.mock.method(console, 'error', () => {});
  let cleaned = 0;
  let abortAtMount;
  sh.SCREENS.thrower = () => ({
    html: '<p id="throwerBody">thrower</p>',
    mount() {
      hooks.cleanup = () => { cleaned += 1; };
      abortAtMount = sh.screenAbort;
      throw new Error('boom (test)');
    },
  });
  render('thrower', { navigated: true });
  await tick();
  assert.match(stageText(), /did not open|went wrong/i, 'the paper says nothing about the failure');
  assert.ok(byId('throwerBody') === null, 'the half-mounted screen is still on the paper');
  assert.equal(cleaned, 1, "the failed mount's cleanup never ran");
  assert.equal(abortAtMount.signal.aborted, true, 'its listeners were left live');
  assert.ok(win.document.querySelector('[data-go="home"]'), 'the card offers no way out');
});

test('a mount that rejects after an await is the same failure', async (t) => {
  t.mock.method(console, 'error', () => {});
  let cleaned = 0;
  let abortAtMount;
  sh.SCREENS.rejecter = () => ({
    html: '<p id="rejecterBody">rejecter</p>',
    async mount() {
      hooks.cleanup = () => { cleaned += 1; };
      abortAtMount = sh.screenAbort;
      await tick();
      throw new Error('late boom (test)');
    },
  });
  render('rejecter', { navigated: true });
  await tick();
  await tick();
  assert.match(stageText(), /did not open|went wrong/i, 'an async mount failed silently');
  assert.ok(byId('rejecterBody') === null, 'the half-mounted screen is still on the paper');
  assert.equal(cleaned, 1, "the failed mount's cleanup never ran");
  assert.equal(abortAtMount.signal.aborted, true, 'its listeners were left live');
});

test('a failure from a screen that has already been replaced leaves the current screen alone', async (t) => {
  t.mock.method(console, 'error', () => {});
  let release;
  const gate = new Promise((r) => { release = r; });
  let cleaned = 0;
  sh.SCREENS.slow = () => ({
    html: '<p id="slowBody">slow</p>',
    async mount() {
      hooks.cleanup = () => { cleaned += 1; };
      await gate;
      throw new Error('late boom (test)');
    },
  });
  render('slow', { navigated: true });
  await tick();
  render('home', { navigated: true }); // the user moved on before it failed
  const homeAbort = sh.screenAbort;
  release();
  await tick();
  await tick();
  assert.ok(byId('homeBody'), 'an obsolete failure tore down the screen the user is on');
  assert.equal(homeAbort.signal.aborted, false, "the current screen's listeners were cut by an old failure");
  assert.doesNotMatch(stageText(), /did not open/i, 'an obsolete failure took over the paper');
  assert.equal(cleaned, 1, 'precondition: the replaced screen was torn down once, by the navigation');
});

test('a repaint of the screen you are on keeps the caret in what you were typing', () => {
  sh.SCREENS.form = () => ({ html: '<input id="draft" value="saved"><button id="other">other</button>' });
  render('form', { navigated: true });
  const input = byId('draft');
  input.focus();
  input.value = 'half-typed';
  input.setSelectionRange(4, 4);

  sh.renderScreen(); // the repaint: same screen, new DOM
  const after = byId('draft');
  assert.ok(after !== input, 'precondition: the repaint rebuilt the control');
  assert.ok(win.document.activeElement === after,
    `focus fell off the control that was being typed in, onto ${focusName()}`);
  assert.equal(after.value, 'half-typed', 'the draft was thrown away');
  assert.equal(after.selectionStart, 4, 'the caret moved');
});

test('a repaint that changed the control does not put a stale draft back over it', () => {
  let name = 'saved';
  sh.SCREENS.renamed = () => ({ html: `<input id="draft2" value="${name}">` });
  render('renamed', { navigated: true });
  const input = byId('draft2');
  input.focus();
  input.value = 'half-typed';

  name = 'renamed elsewhere'; // the repaint's cause: this control's own value changed
  sh.renderScreen();
  const after = byId('draft2');
  assert.equal(after.value, 'renamed elsewhere', 'a stale draft was put back over a value that had changed');
  assert.ok(win.document.activeElement === after, `focus should still follow the control, not ${focusName()}`);
});

// A rebuild removes the field being typed in, and the engines differ on what that means for an
// edited field: headless Chromium sent change as it went, headless WebKit sent nothing (measured
// 2026-09-14). Both answer a field being LEFT with a change, played here by the test, since
// happy-dom plays neither engine.
test('a repaint leaves the field being typed in first, so the screen that drew it commits the draft once', () => {
  const commits = [];
  let label = 'saved';
  sh.SCREENS.nick = () => ({
    html: `<input id="nick" value="${label}">`,
    mount(root) {
      const field = root.querySelector('#nick');
      field.onchange = () => { label = field.value; commits.push({ value: field.value, attached: field.isConnected }); };
      field.addEventListener('blur', () => {
        if (field.value !== field.defaultValue) field.dispatchEvent(new win.Event('change'));
      });
    },
  });
  render('nick', { navigated: true });
  const input = byId('nick');
  input.focus();
  input.value = 'half-typed';
  input.setSelectionRange(2, 6);
  sh.renderScreen();
  const after = byId('nick');
  assert.deepEqual(commits, [{ value: 'half-typed', attached: true }],
    'the field was replaced without being left, so its draft reached no handler, as in WebKit');
  assert.ok(after !== input && win.document.activeElement === after, `the caret did not follow the field: ${focusName()}`);
  assert.equal(after.defaultValue, 'half-typed', 'the new screen was built before the draft was committed');
  assert.deepEqual([after.selectionStart, after.selectionEnd], [2, 6], 'the selection was lost');
});

test('a navigation moves focus to the screen region, not to a control inside it', () => {
  render('form', { navigated: true });
  assert.ok(win.document.activeElement === win.document.querySelector('#stage .screen.active'),
    `a screen arrived without being announced as a region: focus is on ${focusName()}`);
});

// A repaint puts focus back by id, and a press that takes its own control away (a question
// answered, a cube forgotten) left nothing with that id: focus fell to the page (verification,
// 2026-09-14). It lands on the nearest element around the control that can hold focus and be found
// again, and failing that on the screen.
test('a repaint that takes the focused control away leaves focus on what held it, never on the page', () => {
  let drawn = true;
  sh.SCREENS.asker = () => ({
    html: `<section id="askCard" tabindex="-1"><p>${drawn ? '<button id="answer">yes</button>' : 'answered'}</p></section>
      <div><button class="unnamed">no id</button></div>`,
  });
  render('asker', { navigated: true });
  byId('answer').focus();
  drawn = false;
  sh.renderScreen();
  assert.ok(byId('answer') === null, 'precondition: the repaint took the control away');
  assert.ok(win.document.activeElement === byId('askCard'), `the control went, and focus went to ${focusName()}`);
  win.document.querySelector('#stage .unnamed').focus();
  sh.renderScreen();
  assert.ok(win.document.activeElement === win.document.querySelector('#stage .screen.active'),
    `a control with no id to be found by went, and focus went to ${focusName()}, not to the screen`);
});

test('a subject taken in place that removes the focused control leaves focus in the screen, never on the page', () => {
  sh.SCREENS.retarget = () => ({
    html: '<section id="sheet" tabindex="-1"><div id="ask"><button class="yes">yes</button></div></section>',
    update() { byId('ask').remove(); return true; },
  });
  render('retarget', { navigated: true });
  win.document.querySelector('#stage .yes').focus();
  const root = win.document.querySelector('#stage .screen.active');
  sh.refreshScreen();
  assert.ok(byId('ask') === null && win.document.querySelector('#stage .screen.active') === root,
    'precondition: the subject was taken in place, and the control is gone');
  assert.ok(win.document.activeElement === byId('sheet'), `the control went, and focus went to ${focusName()}`);
});

test("a moved screen's link lands where it went — decoded — and the address bar says so", () => {
  win.location.hash = '#/pair';
  sh.applyRoute();
  assert.equal(state.screen, 'settings', 'the old pairing link did not land on Settings');
  assert.equal(win.location.hash, '#/settings', 'the address bar kept a link to a screen that has moved');

  win.location.hash = '#/%70air';
  sh.applyRoute();
  assert.equal(state.screen, 'settings', 'an encoded alias was not decoded, so it fell to home');
  assert.equal(win.location.hash, '#/settings');
});

test('an inherited property name is not a route, and never reaches the address bar', () => {
  win.location.hash = '#/constructor';
  sh.applyRoute();
  assert.equal(state.screen, 'home', 'a name from Object.prototype was treated as a screen');
  assert.equal(win.location.hash, '#/home', 'a name from Object.prototype was written into the URL');
});

test('a held Advanced chord toggles once, not once a frame', () => {
  render('settings', { navigated: true });
  const chord = (repeat) => win.document.dispatchEvent(new win.KeyboardEvent('keydown', {
    code: 'KeyD', ctrlKey: true, altKey: true, metaKey: true, repeat, bubbles: true,
  }));
  const shut = sh.advancedOpen;
  chord(false);
  assert.equal(sh.advancedOpen, !shut, 'precondition: the chord toggles Advanced');
  chord(true);
  assert.equal(sh.advancedOpen, !shut, 'holding the chord toggled it back and rebuilt Settings');
  chord(false);
  assert.equal(sh.advancedOpen, shut, 'a fresh press must still toggle');
});

test('a popover is never placed off the stage, however wide it is', () => {
  // Right-aligned under its button, with room for it: the place asked for.
  assert.equal(sh.popoverLeft(202, 190, 400), 202);
  // Asked for a place off the left edge: held clear of it.
  assert.equal(sh.popoverLeft(-40, 190, 400), 8);
  // Wider than the stage. Math.min(Math.max(…)) answered -208 here — the menu drew off the left
  // edge, cut off, with its first item unreachable (a 600px camera menu on a 400px stage).
  assert.equal(sh.popoverLeft(-100, 600, 400), 8);
  // And the cap that keeps that rare: a popover may be as wide as the stage minus both margins.
  assert.equal(sh.popoverWidthCap(400), 384);
  assert.equal(sh.popoverWidthCap(10), 0, 'a stage narrower than its margins asks for no width at all');
});
