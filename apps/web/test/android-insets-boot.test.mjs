// On Android, the insets the shell holds are on the page BEFORE the first screen is drawn.
//
// The activity also pushes them 800 ms after attach, which is right on an emulator and a guess
// on a slow phone; the pull at boot is what keeps the first paint off that guess.
// os-insets.test.mjs used to pin the order only as source text. Here lib/app.js boots as
// Android with a stub bridge, and the inset properties are read at the moment the stage's
// markup is first replaced: the first render. app.js boots on import, once per process, so
// this file holds this one scenario.

import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

let win;
let atFirstRender = null;

before(async () => {
  win = new Window({
    url: 'http://localhost/?platform=android#/home',
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      fetch: { disableSameOriginPolicy: true },
    },
  });
  win.document.write(html);
  win.cubusInsets = { get: () => '{"t":24,"r":0,"b":48,"l":0}' };

  // Read the inset properties at the stage's first markup replacement, whoever makes it.
  const stage = win.document.querySelector('#stage');
  let proto = Object.getPrototypeOf(stage);
  while (proto && !Object.getOwnPropertyDescriptor(proto, 'innerHTML')) proto = Object.getPrototypeOf(proto);
  const inner = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
  Object.defineProperty(stage, 'innerHTML', {
    configurable: true,
    get() { return inner.get.call(this); },
    set(v) {
      if (atFirstRender === null) {
        const style = win.document.querySelector('.app').style;
        atFirstRender = Object.fromEntries(['t', 'r', 'b', 'l'].map((k) => [k, style.getPropertyValue(`--os-inset-${k}`)]));
      }
      inner.set.call(this, v);
    },
  });

  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'sessionStorage', 'customElements', 'HTMLElement', 'CustomEvent',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  await import('../lib/app.js');
  await tick();
});

test('precondition: the app booted as Android and drew a screen', () => {
  assert.equal(win.document.documentElement.dataset.platform, 'android');
  assert.ok(win.document.querySelector('#stage .screen.active'), 'no screen was drawn');
});

test('the shell\'s insets are on the page before the first screen is drawn', () => {
  assert.deepEqual(atFirstRender, { t: '24px', r: '0px', b: '48px', l: '0px' },
    'the first render happened before the pulled insets were written');
});
