// A boot that fails part-way stops there: its sentence stays on the stage, and nothing navigates over it.
//
// The layout guard's version of this is `boot-guard.test.mjs`. This is the failure the 2026-09-21 audit
// reproduced one step later: navigation was wired after the guard but before the chrome, so a native window
// API that threw while the toolbar was being built left the hash listener and `window.cubusGo` live — and
// the next navigation to #/course painted "NO COURSE INSTALLED" over the failure's sentence, despite a
// valid course tag, because boot never reached the line that installs the course. app.js boots on import,
// once per process, so this file holds this one scenario.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .replace('</head>', '<meta name="cubus-course" content="course/">\n</head>');
const tick = () => new Promise((r) => setTimeout(r, 0));
const FAILED = /could not start/;

let win;
const unhandled = [];
const onUnhandled = (reason) => { unhandled.push(reason); };
const quiet = console.error;

before(async () => {
  process.on('unhandledRejection', onUnhandled);
  console.error = () => {};   // boot's own "could not start" line, which is the behaviour under test
  // A desktop window whose caption buttons need the native window API — and the API throws.
  win = new Window({
    url: 'http://localhost/?platform=windows#/home',
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      fetch: { disableSameOriginPolicy: true },
    },
  });
  win.document.write(html);
  win.__TAURI__ = { window: { getCurrentWindow() { throw new Error('the native window API is down'); } } };
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'customElements', 'HTMLElement', 'CustomEvent',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  // The layout guard passes: this webview can lay the app out, so the failure is the chrome's.
  Object.defineProperty(globalThis, 'CSS', { value: { supports: () => true }, writable: true, configurable: true });
  await import('../lib/app.js');
  await tick();
  await tick();
});

after(() => {
  process.off('unhandledRejection', onUnhandled);
  console.error = quiet;
});

test('a chrome build that throws leaves its sentence on the stage', () => {
  assert.match(win.document.querySelector('#stage').textContent, FAILED, 'precondition: boot failed and said so');
});

test('a navigation after that failure paints nothing over the sentence', async () => {
  win.location.hash = '#/course';
  await tick();
  await tick();
  const said = win.document.querySelector('#stage').textContent;
  assert.match(said, FAILED, `a hash change rendered a screen over the failure: "${said.trim().slice(0, 80)}"`);
  assert.equal(typeof win.cubusGo, 'undefined', 'window.cubusGo was left installed on a boot that failed');
});

test('the failure is not an unhandled rejection', async () => {
  await tick();
  assert.deepEqual(unhandled.map(String), [], "boot()'s rejection went unhandled");
});
