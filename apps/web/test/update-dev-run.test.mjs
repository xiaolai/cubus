// A `tauri dev` run does not update itself (owner, 2026-10-17).
//
// A dev run is built from source, so the newest release is always on offer to it, and "Install and
// restart" would replace the build being worked on with a download. The desktop shell leaves the
// updater plugin unregistered there and sets one global; this holds the page's half: with that
// global, there is no updater at all — so no launch check and no Settings row, both of which are
// drawn behind appUpdater(). Its own file because appUpdater() is memoised per page.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, before } from 'node:test';

import { Window } from 'happy-dom';

let ui;
const updater = { check: () => { throw new Error('a dev run asked the endpoint for an update'); } };

before(async () => {
  const win = new Window({ url: 'http://localhost/' });
  win.document.documentElement.dataset.platform = 'macos';
  win.__TAURI__ = { updater };
  win.__CUBUS_NO_SELF_UPDATE__ = true;
  for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement']) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  ui = await import('../lib/update-ui.js');
});

test('a dev run has no updater, though the updater API is on the page', () => {
  assert.equal(window.__TAURI__.updater, updater, 'precondition: the API is present, as it is on every desktop build');
  assert.equal(ui.appUpdater(), null, 'a dev run built an updater, so it would check on launch and draw the Settings row');
});

test('the flag the page reads is the one the desktop shell sets', () => {
  const shell = readFileSync(new URL('../../desktop/src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.ok(shell.includes(`window.${ui.NO_SELF_UPDATE_FLAG} = true;`),
    `lib.rs never sets window.${ui.NO_SELF_UPDATE_FLAG}, so a dev run would still offer updates`);
});
