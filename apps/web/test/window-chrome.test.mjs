// The host window's chrome, driven directly: the caption buttons, the window title, and the
// design-review platform pin.
//
// lib/window-chrome.js reads `window.__TAURI__` when it loads, so this sets a Tauri stub first and
// imports the module under happy-dom; nothing boots lib/app.js. The stub is one window object,
// changed per case. What these pin (the 2026-09-13 audit):
//   * the drawn minimise and close drive the real window, and a control that throws — or whose
//     promise is rejected — is reported rather than thrown at the page;
//   * a browser preview draws the caption buttons and they drive nothing; a plain tab draws none;
//   * only Windows and Linux retitle the native window: a phone has no window title, and the
//     permission is not granted there;
//   * a pinned platform is one the app draws, and a session storage that refuses the write does
//     not lose the pin the URL asked for;
//   * the settings shortcut is promised on the three desktops only.

import assert from 'node:assert/strict';
import { test, before } from 'node:test';

import { Window } from 'happy-dom';

import { isAbsent } from './dom-assert.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const PLATFORMS = ['macos', 'windows', 'linux', 'ios', 'android'];

let win;
let chrome;
const calls = [];
const tauriWindow = {
  minimize: () => { calls.push('min'); },
  close: () => { calls.push('close'); },
  setTitle: async (title) => { calls.push(`title:${title}`); },
};

before(async () => {
  win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = '<div id="tbLead"></div><div id="tbTrail"></div>';
  win.__TAURI__ = { window: { getCurrentWindow: () => tauriWindow } };
  for (const k of ['window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'HTMLElement']) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  chrome = await import('../lib/window-chrome.js');
});

test("a Windows or Linux build's drawn caption buttons minimise and close the real window", async () => {
  for (const platform of ['windows', 'linux']) {
    calls.length = 0;
    chrome.buildChrome(platform);
    win.document.querySelector('[data-win="min"]').click();
    win.document.querySelector('[data-win="close"]').click();
    await tick();
    assert.deepEqual(calls, ['min', 'close'], `${platform}: the only minimise and close the window has`);
  }
});

test('a window control that throws is reported, not thrown at the page', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => { logged.push(args.map(String).join(' ')); });
  const escaped = [];
  const onError = (e) => { escaped.push(String(e.error ?? e.message)); };
  win.addEventListener('error', onError);
  const was = tauriWindow.minimize;
  tauriWindow.minimize = () => { throw new Error('not allowed (test)'); };
  try {
    chrome.buildChrome('windows');
    win.document.querySelector('[data-win="min"]').click();
    await tick();
  } finally {
    tauriWindow.minimize = was;
    win.removeEventListener('error', onError);
  }
  assert.deepEqual(escaped, [], 'the throw escaped the click listener');
  assert.ok(logged.some((line) => /window control failed/.test(line)), 'the failure went unreported');
});

// A Tauri window call answers with a promise, and a missing capability REJECTS it rather than
// throwing: that path was untested (found by verification, 2026-09-14).
test('a window control whose promise is rejected is reported too, and nothing is left unhandled', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => { logged.push(args.map(String).join(' ')); });
  const unhandled = [];
  const onRejection = (reason) => { unhandled.push(String(reason)); };
  process.on('unhandledRejection', onRejection);
  const was = tauriWindow.close;
  tauriWindow.close = async () => { throw new Error('close refused (test)'); };
  try {
    chrome.buildChrome('linux');
    win.document.querySelector('[data-win="close"]').click();
    await tick();
    await tick();
  } finally {
    tauriWindow.close = was;
    process.off('unhandledRejection', onRejection);
  }
  assert.deepEqual(unhandled, [], 'the rejected close was left unhandled');
  assert.ok(logged.some((line) => /window control failed/.test(line) && /close refused/.test(line)),
    'the rejected close went unreported');
});

// The browser preview was untested (found by verification, 2026-09-14). `isTauri` is read when the
// module loads, so a second copy is loaded with no Tauri API in the window.
test('a browser preview draws the caption buttons, and pressing them drives nothing; a plain tab draws none', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => { logged.push(args.map(String).join(' ')); });
  const tauri = win.__TAURI__;
  delete win.__TAURI__;
  let browser;
  try {
    browser = await import('../lib/window-chrome.js?browser');
  } finally {
    win.__TAURI__ = tauri;
  }
  assert.equal(browser.isTauri, false, 'precondition: this copy loaded as a browser page');
  const search = win.location.search;
  try {
    win.history.replaceState(null, '', '/?chrome=preview');
    calls.length = 0;
    browser.buildChrome('windows');
    const min = win.document.querySelector('[data-win="min"]');
    const close = win.document.querySelector('[data-win="close"]');
    assert.ok(min && close, 'a preview drew no caption buttons to review');
    min.click();
    close.click();
    await tick();
    assert.deepEqual(calls, [], 'a preview button drove a window');
    assert.deepEqual(logged, [], 'a preview button reported a failure it could not have');
    win.history.replaceState(null, '', '/');
    browser.buildChrome('windows');
    isAbsent(win.document.querySelector('[data-win]'), 'a plain browser tab drew a close that closes nothing');
  } finally {
    win.history.replaceState(null, '', `/${search}`);
  }
});

test('only Windows and Linux retitle the native window; every platform titles the document', async () => {
  for (const [platform, native] of [['ios', false], ['android', false], ['macos', false], ['windows', true], ['linux', true]]) {
    calls.length = 0;
    win.document.documentElement.dataset.platform = platform;
    chrome.setTitle('Settings');
    await tick();
    assert.equal(win.document.title, 'Settings · Cubus', `${platform}: the document title`);
    assert.deepEqual(calls, native ? ['title:Settings · Cubus'] : [],
      `${platform}: ${native ? 'the taskbar name went stale' : 'a window title was asked of a host that has none, or refuses it'}`);
  }
});

test('a platform nobody listed, left in session storage, does not become the platform', () => {
  win.happyDOM.setURL('http://localhost/');
  win.sessionStorage.setItem('cubus.platform', 'bogus');
  try {
    const got = chrome.detectPlatform();
    assert.ok(PLATFORMS.includes(got), `the stored "bogus" came back as "${got}"`);
  } finally {
    win.sessionStorage.removeItem('cubus.platform');
  }
});

test('a session storage that refuses writes does not lose the platform the URL pinned', () => {
  win.happyDOM.setURL('http://localhost/?platform=windows');
  const real = globalThis.sessionStorage;
  const refusing = {
    setItem() { throw new Error('QuotaExceededError (test)'); },
    getItem: () => null,
    removeItem() {},
  };
  Object.defineProperty(globalThis, 'sessionStorage', { value: refusing, configurable: true, writable: true });
  try {
    assert.equal(chrome.detectPlatform(), 'windows', 'the pin was dropped because remembering it failed');
  } finally {
    Object.defineProperty(globalThis, 'sessionStorage', { value: real, configurable: true, writable: true });
    win.happyDOM.setURL('http://localhost/');
  }
});

test('a pinned platform is remembered for the tab, and ?platform=auto lets it go', () => {
  win.happyDOM.setURL('http://localhost/?platform=ios');
  assert.equal(chrome.detectPlatform(), 'ios');
  win.happyDOM.setURL('http://localhost/');
  assert.equal(chrome.detectPlatform(), 'ios', 'the pin did not survive a load without the parameter');
  win.happyDOM.setURL('http://localhost/?platform=auto');
  assert.ok(PLATFORMS.includes(chrome.detectPlatform()));
  assert.equal(win.sessionStorage.getItem('cubus.platform'), null, 'auto did not let the pin go');
  win.happyDOM.setURL('http://localhost/');
});

test('the settings shortcut is promised on the three desktops only', () => {
  for (const [platform, title] of [
    ['macos', 'Settings (⌘,)'], ['windows', 'Settings (Ctrl+,)'], ['linux', 'Settings (Ctrl+,)'],
    ['ios', 'Settings'], ['android', 'Settings'],
  ]) {
    chrome.buildChrome(platform);
    const gear = win.document.querySelector('#tbTrail [aria-label="Settings"]');
    assert.equal(gear.getAttribute('title'), title, `${platform}: the gear's promise`);
  }
});
