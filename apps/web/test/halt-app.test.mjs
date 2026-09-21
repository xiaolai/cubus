// `haltApp`: what a boot that failed does to an app that may already have a screen up.
//
// A failure after the first screen is mounted — the solver load, the registry re-parse — replaced the
// stage's text and left the screen's listeners, its camera, and every route back to a screen running under
// it (audit, 2026-09-21). No natural failure reaches that point in a test, so the halt is driven directly,
// over a screen mounted the ordinary way: navigation on, a hash change, a mount that registers a cleanup.

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

let win;
let shellModule;
let hooks;
let state;

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
  shellModule = await import('../lib/screen-shell.js');
  ({ hooks } = await import('../lib/screen-slots.js'));
  ({ state } = await import('../lib/app-state.js'));
});

test('a halt tears down the mounted screen, shows its sentence, and no route leads back to a screen', async () => {
  const { SCREENS, startNavigation, haltApp, renderScreen, refreshScreen } = shellModule;
  let cleaned = 0;
  let mounted = 0;
  // The first screen's mount is still in flight when the app halts, and fails afterwards.
  let failMount;
  const inFlight = new Promise((_, reject) => { failMount = reject; });
  const screen = (id, pending) => () => ({
    html: `<p id="${id}">${id}</p>`,
    mount() { mounted += 1; hooks.cleanup = () => { cleaned += 1; }; return pending; },
  });
  SCREENS.first = screen('first', inFlight);
  SCREENS.second = screen('second');

  startNavigation();
  assert.equal(typeof win.cubusGo, 'function');
  win.location.hash = '#/first';
  await tick();
  assert.ok(win.document.querySelector('#first'), 'precondition: the screen mounted through navigation');

  haltApp('Cubus could not start here.');
  assert.equal(cleaned, 1, "the mounted screen's cleanup never ran");
  assert.equal(win.document.querySelector('#stage').textContent, 'Cubus could not start here.');
  assert.equal(typeof win.cubusGo, 'undefined', 'window.cubusGo outlived the halt');

  const quiet = console.error;
  console.error = () => {};              // the shell's own "screen mount failed" line
  try {
    failMount(new Error('the mount failed after the halt'));
    await tick();
  } finally {
    console.error = quiet;
  }
  assert.equal(win.document.querySelector('#stage').textContent, 'Cubus could not start here.', "a late mount failure drew its card over the halt");

  win.location.hash = '#/second';
  await tick();
  assert.equal(state.screen, 'first', 'a hash change still routed the halted app');
  renderScreen();
  refreshScreen();
  startNavigation();                     // a halted app does not start navigating again
  assert.equal(typeof win.cubusGo, 'undefined', 'navigation started again after the halt');
  win.location.hash = '#/first';
  await tick();
  assert.equal(win.document.querySelector('#stage').textContent, 'Cubus could not start here.', 'a screen was drawn over the halt');
  assert.equal(mounted, 1, 'a screen mounted after the halt');
});
