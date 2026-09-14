// A webview that cannot lay the app out: the stage says so in words, and nothing paints over it.
//
// Under Tauri, lib/app.js's layout guard (assertStageSupport) writes a sentence onto the stage and
// stops boot when the webview has no container-query units. Two things undid that (the 2026-09-13
// audit): the hash listener and window.cubusGo were installed BEFORE the guard ran, so any
// navigation rendered a screen over the sentence; and boot() was called bare, so the guard's own
// throw became an unhandled rejection. app.js boots on import, once per process, so this file holds
// this one scenario.

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
const GUARD = /cannot lay itself out here/;

let win;
const unhandled = [];
const onUnhandled = (reason) => { unhandled.push(reason); };

before(async () => {
  process.on('unhandledRejection', onUnhandled);
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
  // The guard's own condition: a Tauri webview with no container-query units.
  win.__TAURI__ = {};
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'customElements', 'HTMLElement', 'CustomEvent',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  Object.defineProperty(globalThis, 'CSS', { value: { supports: () => false }, writable: true, configurable: true });
  await import('../lib/app.js');
  await tick();
  await tick();
});

after(() => { process.off('unhandledRejection', onUnhandled); });

test('the layout guard says why, on the stage', () => {
  assert.match(win.document.querySelector('#stage').textContent, GUARD, 'precondition: the guard wrote its sentence');
});

test('a navigation after the guard stopped boot paints nothing over its sentence', async () => {
  win.location.hash = '#/settings';
  await tick();
  assert.match(win.document.querySelector('#stage').textContent, GUARD,
    'a hash change rendered a screen over the layout guard');
  assert.equal(typeof win.cubusGo, 'undefined', 'window.cubusGo was installed although boot stopped at the guard');
});

test('the guard stopping boot is not an unhandled rejection', async () => {
  await tick();
  assert.deepEqual(unhandled.map(String), [], "boot()'s rejection went unhandled");
});
