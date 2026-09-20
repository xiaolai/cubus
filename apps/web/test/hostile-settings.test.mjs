// Boot the whole app over a SETTINGS OBJECT NOBODY SANE WROTE, and require every screen to draw.
//
// `localStorage` is untrusted input — anything on the origin can write it, a user can edit it by
// hand, and a half-finished migration can leave a field in a state no code path produces. app.js
// says so in three places and validates the theme and the hidden-nav list accordingly. It did not
// validate the PALETTE, and that one gap was not cosmetic: `NET_COLORS[settings.palette]` was
// indexed with no fallback at three sites, so an unknown value threw on the first property read
// and took Trainer, Drill and the Settings colour swatch down with it.
//
// The second half is what the throw DID. `renderScreen()` called the builder unguarded, so a
// screen that could not be built left the PREVIOUS screen's DOM standing under the new screen's
// title and the new tab highlighted — the app quietly showing you the wrong thing, which is worse
// than an error. Both are fixed; this is what would fail if either came back.
//
// One process, one boot: the settings are on disk before app.js is imported, because that is when
// it reads them.

import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';
import { blockAt } from './app-source.mjs';

import { Window } from 'happy-dom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Every screen the router will resolve, including the ones hidden from the toolbar. */
const SCREENS = ['home', 'scan', 'scramble', 'timer', 'stats', 'trainer', 'drill', 'lessons', 'settings'];

let win;
/** Every boolean setting, taken from the defaults' source — see `before`. */
let hostileFlags;
const errors = [];

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
  // The hostile object. Every field is a value the app's own writes can never produce:
  //   palette   — not one of the three; the defect this file was written for
  //   theme     — not one of the four (the theme migration already handled this; kept so the two
  //               validations are exercised by the same object)
  //   autosolve — the STRING "false", which is truthy, the exact trap app.js names for
  //               proveMinimum
  //   navHidden — a string where a list belongs, and a nav id that is not hideable
  //   solveTier — a rung that does not exist
  //   language  — a number
  // Every boolean the app HAS, read from the defaults' own source rather than from the list the app
  // derives at runtime: a flag added there arrives here as a hostile string, where a list taken from
  // the app itself would have "tested" it by leaving it at its default (audit, 2026-09-19).
  hostileFlags = Object.fromEntries(
    [...blockAt(readFileSync(new URL('../lib/app-settings.js', import.meta.url), 'utf8'), 'DEFAULT_SETTINGS = Object.freeze(')
      .matchAll(/(\w+):\s*(?:true|false)\b/g)].map((m) => [m[1], 'not a boolean']),
  );
  win.localStorage.setItem('cubusSettings', JSON.stringify({
    ...hostileFlags,
    palette: 'chartreuse',
    theme: 'neon',
    autosolve: 'false',
    proveMinimum: 'yes',
    navHidden: 'home',
    navDefaults: 'lots',
    devRandCube: 1,
    language: 7,
    solveTier: 'eleven',
    dragRotate: 'no',
    sounds: 'false',
    devScanView: 'preview',
    cameraId: { nope: true },
  }));
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'sessionStorage', 'customElements', 'HTMLElement', 'CustomEvent',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  // Anything the app throws asynchronously surfaces here rather than being lost.
  win.addEventListener('error', (e) => errors.push(String(e.message ?? e)));
  await import('../lib/app.js');
  await tick();
});

test('an unknown palette is repaired at load, and the repair is saved', async () => {
  const stored = JSON.parse(win.localStorage.getItem('cubusSettings'));
  // Against the app's own constant, not a second copy of the value: the repair's job is to reach
  // the default, and a test that spells the default itself stops being about the repair the day
  // someone changes one of the two.
  const { DEFAULT_PALETTE } = await import('../lib/app.js');
  assert.equal(stored.palette, DEFAULT_PALETTE, 'the stored value is corrected, not merely defaulted at read time');
  // The theme's own migration, which this object also exercises — a value that is not a theme is
  // not a theme, whatever it says.
  assert.equal(stored.theme, 'auto');
  // Every flag the object carries as a string or a number is a real boolean, in memory and in
  // storage. "false" is truthy, and a Settings toggle flips `!settings[k]`, so a stored "false"
  // showed as on — and auto-solve then left a believed scan nobody had asked to leave.
  const { BOOLEAN_SETTINGS, DEFAULT_SETTINGS, settings } = await import('../lib/app-settings.js');
  // Every flag — the app's own derived list, so this cannot leave one out the way a copy did — is back
  // to its DEFAULT when storage held anything but a real boolean: off for most, on for `sounds`.
  assert.ok(BOOLEAN_SETTINGS.includes('sounds') && BOOLEAN_SETTINGS.includes('autosolve'), 'the flag list is not derived from the defaults');
  assert.deepEqual([...BOOLEAN_SETTINGS].sort(), Object.keys(hostileFlags).sort(),
    'the flags the app derives and the flags this file made hostile have drifted apart');
  for (const k of BOOLEAN_SETTINGS) {
    assert.equal(settings[k], DEFAULT_SETTINGS[k], `the hostile ${k} was believed`);
    assert.equal(stored[k], DEFAULT_SETTINGS[k], `the hostile ${k} was not written back as its default`);
  }
  // The study's arm is today's screen or the sticker view, and nothing else — least of all the camera
  // picture, which the owner ruled out (dev-docs/scan-guidance-plan.md, D2).
  assert.equal(settings.devScanView, 'today', 'a study arm that does not exist was believed');
  assert.equal(stored.devScanView, 'today');
});

test('every screen renders over hostile settings, and the stage is actually replaced', async () => {
  const seen = new Set();
  for (const id of SCREENS) {
    win.location.hash = `#/${id}`;
    await tick();
    const screen = win.document.querySelector('#stage .screen.active');
    assert.ok(screen, `${id} rendered no screen element`);
    assert.ok(screen.innerHTML.trim().length > 0, `${id} rendered an empty stage`);
    // The frame that must NOT exist: the previous screen's DOM under the new screen's title. Each
    // render replaces the node, so the element identity must differ from the last one — a builder
    // that threw used to leave the old node in place, with the title bar already changed.
    assert.ok(!seen.has(screen), `${id} left the previous screen's DOM on the stage`);
    seen.add(screen);
    assert.equal(win.document.title, `${win.document.title.replace(' · Cubus', '')} · Cubus`);
  }
  assert.deepEqual(errors, [], 'a screen raised while rendering over hostile settings');
});

test('the screens that index a palette draw their colours rather than throwing', async () => {
  // Trainer and Drill read NET_COLORS[palette] for their diagram fills, and Settings paints a
  // six-swatch row from it. These three were the crash sites.
  win.location.hash = '#/trainer';
  await tick();
  assert.ok(win.document.querySelectorAll('#stage .case-grid > *').length > 0, 'trainer drew no cases');

  win.location.hash = '#/drill';
  await tick();
  // The Drill draws a real cube now rather than a colour-well flashcard (plan item 3.2), so what
  // must survive a hostile palette here is the round: its question and the faces to pick from. The
  // renderer takes the palette as an ATTRIBUTE and validates it itself.
  assert.ok(win.document.querySelector('#drillAsk')?.textContent, 'drill asked nothing');
  assert.equal(win.document.querySelectorAll('#stage [data-face]').length, 6, 'drill drew no faces to pick');

  win.location.hash = '#/settings';
  await tick();
  const swatches = [...win.document.querySelectorAll('#palSwatch > div')];
  assert.equal(swatches.length, 6, 'the colour swatch is six faces');
  for (const el of swatches) {
    assert.match(el.getAttribute('style') ?? '', /background:\s*#[0-9a-f]{6}/i, 'a swatch with no colour');
  }
});

// The boundary itself, driven directly: a builder that throws must not be able to leave the old
// screen standing, whatever the reason it threw. `SCREENS.stats` is replaced with a thrower and
// the app is asked to render it.
test('a builder that throws paints an error on the paper and keeps the console loud', async () => {
  const app = await import('../lib/app.js');
  win.location.hash = '#/home';
  await tick();
  const before = win.document.querySelector('#stage .screen.active');
  assert.ok(before, 'precondition: home is on the stage');

  const logged = [];
  const realError = console.error;
  console.error = (...args) => { logged.push(args.map(String).join(' ')); };
  try {
    // The registry app.js renders from is the module's own object, reached through the router's
    // screen map — the same object `makeRouter` was handed, so a key added here is routable.
    app.SCREENS.boom = () => { throw new Error('deliberate: a builder that cannot build'); };
    win.location.hash = '#/boom';
    await tick();
  } finally {
    console.error = realError;
    delete app.SCREENS.boom;
  }

  const after = win.document.querySelector('#stage .screen.active');
  assert.ok(after, 'the stage must not be left empty');
  assert.notEqual(after, before, 'the previous screen was left standing under the new title');
  assert.match(after.textContent, /did not open|went wrong/i, 'the paper must say what happened');
  assert.ok(after.querySelector('[data-go="home"]'), 'and offer a way out');
  assert.ok(logged.some((l) => /boom|could not be built/.test(l)), 'the failure must reach the console');
});
