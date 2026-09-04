// The app's own promises about failure, motion, focus and invented data — the ones with no
// symptom when they break.
//
// Everything here is an assertion about a state the app must NOT be able to reach: a Solve button
// that comes back after a refusal, a time on the clock that was never stored and never said so, a
// scramble replaced under a running solve, a figure on screen that describes nothing, focus left
// on <body> after a navigation, a search still running for a cube nobody is looking at. Each one
// was reachable before 2026-09-04 and each one is invisible from the outside — which is why they
// are pinned here rather than being left to a careful reader.

import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../lib/app.js', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

let win;
const $ = (sel) => win.document.querySelector(sel);
const all = (sel) => [...win.document.querySelectorAll(sel)];
const go = async (id) => { win.cubusGo(id); await tick(); };
/** When true every localStorage write throws — a private window, or a full quota. Wrapped before
 *  first use, because happy-dom's Storage hands out a bound method on first access. */
let failWrites = false;
/** Stage replacements seen while the app booted — see the observer in `before`. */
let stageMutations = 0;
let bootMutations = 0;

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
  {
    const proto = Object.getPrototypeOf(win.localStorage);
    const orig = proto.setItem;
    proto.setItem = function (...args) {
      if (failWrites) throw new Error('quota exceeded (test)');
      return orig.apply(this, args);
    };
  }
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'sessionStorage', 'customElements', 'HTMLElement', 'CustomEvent',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  // Counted from BEFORE the app is imported, because the thing under test happens during boot:
  // the stage's children are replaced once per render, so a re-render is a second mutation.
  stageMutations = 0;
  const observer = new win.MutationObserver(() => { stageMutations += 1; });
  observer.observe(win.document.querySelector('#stage'), { childList: true });
  await import('../lib/app.js');
  await tick();
  // The solver lands asynchronously; the re-render this test is about came after it.
  await settle(1500);
  bootMutations = stageMutations;
  observer.disconnect();
});

// ---- Boot ------------------------------------------------------------------------------------

// Home mounted, then the solver landed and boot re-rendered it — throwing away the DOM, the
// listeners and the walk that had just been drawn, to show the same thing. Both screens that
// could want the solver already await it inside their own mount.
test('boot renders the landing screen exactly once', () => {
  // Measured across the whole of boot, including the window after the solver resolved — which is
  // where the second render used to be. Nothing changes between the two: both screens that could
  // want the solver already await it inside their own mount, so the rebuild threw away the DOM,
  // the listeners and (on Home) a walk that had just been drawn, to draw the same thing again.
  // The stray 'viewer' in that screen list had not been a route since the cube screen absorbed it.
  assert.equal(bootMutations, 1, `the stage was rebuilt ${bootMutations} times at boot`);
});

// ---- Focus and announcement ------------------------------------------------------------------

test('every navigation moves focus into the new screen, and names it', async () => {
  await go('settings');
  const screen = $('#stage .screen.active');
  assert.equal(win.document.activeElement, screen, 'focus was left on <body> — a navigation nobody was told about');
  assert.equal(screen.getAttribute('tabindex'), '-1', 'focusable, but not a new tab stop');
  assert.equal(screen.getAttribute('role'), 'region');
  assert.equal(screen.getAttribute('aria-label'), 'Settings', 'the region carries the screen name');

  await go('stats');
  assert.equal(win.document.activeElement, $('#stage .screen.active'), 'and again on the next one');
  assert.equal($('#stage .screen.active').getAttribute('aria-label'), 'Stats');
});

test('a REPAINT of the screen you are on does not steal focus', async () => {
  await go('settings');
  const field = $('[data-rename-cube], #macIn, .field');
  if (!field) return; // no cube card on this build state; the toggle below is the general case
  field.focus();
  assert.equal(win.document.activeElement, field, 'precondition: focus is in a control');
  // A toggle re-renders Settings. Focus must not jump to the screen wrapper: the caret would
  // leave whatever was being typed.
  $('[data-toggle="autosolve"]').click();
  await tick();
  assert.notEqual(win.document.activeElement, $('#stage .screen.active'), 'a repaint pulled focus to the screen');
  $('[data-toggle="autosolve"]').click(); // leave the setting as it was
  await tick();
});

test('the trust indicator is still a BUTTON, and its live text is a sibling', () => {
  const btn = $('#cubeLive');
  assert.ok(btn, 'the indicator exists');
  assert.equal(btn.tagName, 'BUTTON');
  // role="status" on the button REPLACES the button role: the one control that reaches cube
  // management stopped being announced as a control at all.
  assert.equal(btn.getAttribute('role'), null, 'a status role would take the button role away');
  const say = $('#cubeLiveSay');
  assert.ok(say, 'the live text needs a region of its own');
  assert.equal(say.getAttribute('role'), 'status');
  assert.equal(say.getAttribute('aria-live'), 'polite');
  assert.ok(say.classList.contains('sr-only'), 'and it is said, not shown');
});

test('the pill groups say which one is pressed, not only which one is coloured', async () => {
  await go('settings');
  for (const group of ['[data-set-theme]', '[data-set-tier]', '[data-pal]']) {
    const pills = all(group);
    assert.ok(pills.length >= 2, `${group} is a group of pills`);
    for (const p of pills) {
      assert.match(p.getAttribute('aria-pressed') ?? '', /^(true|false)$/, `${group} is missing aria-pressed`);
      assert.equal(
        p.getAttribute('aria-pressed') === 'true',
        p.classList.contains('on'),
        `${group}: the colour and the announced state disagree`,
      );
    }
    assert.equal(pills.filter((p) => p.getAttribute('aria-pressed') === 'true').length, 1,
      `${group}: exactly one is pressed`);
  }
});

test('pressing a pill moves the pressed state with the colour', async () => {
  await go('settings');
  const pick = (v) => all('[data-pal]').find((b) => b.dataset.pal === v);
  pick('classic').click();
  await tick();
  assert.equal(pick('classic').getAttribute('aria-pressed'), 'true');
  assert.equal(pick('muted').getAttribute('aria-pressed'), 'false');
  pick('muted').click();
  await tick();
  assert.equal(pick('muted').getAttribute('aria-pressed'), 'true');
});

test('the stylesheet answers prefers-reduced-motion, and the renderer reads it too', () => {
  const reduced = /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{([\s\S]*?)\n {6}\}/.exec(html);
  assert.ok(reduced, 'no reduced-motion rule at all — every pulse and settle runs regardless');
  assert.match(reduced[1], /animation-duration:\s*\.001ms\s*!important/, 'the pulses must actually stop');
  assert.match(reduced[1], /transition-duration:\s*\.001ms\s*!important/, 'and the settles with them');
  // The cube's turns are SHORTENED rather than stopped: a solve guide with no turn is a slideshow
  // of positions, and the turn is the thing being taught. That decision lives in the renderer.
  const cube = readFileSync(new URL('../lib/cubus-cube.js', import.meta.url), 'utf8');
  assert.match(cube, /prefers-reduced-motion/, 'the renderer must ask too');
  assert.match(cube, /Math\.min\(dur,/, 'and shorten the turn rather than removing it');
});

// ---- Never invent data -----------------------------------------------------------------------

// Trainer, Drill and Lessons were design layouts carrying invented statistics — "82%", "2.14 …
// 9 reps", "4/4 Done", a queue with due dates. One Advanced toggle away from a beginner who would
// read them as their own, on an app whose central rule is that an uncomputable statistic is a
// dash.
test('the preview screens carry no invented figure', async () => {
  for (const id of ['trainer', 'drill', 'lessons']) {
    await go(id);
    const screen = $('#stage .screen.active');
    assert.match(screen.textContent, /Preview — nothing here is measured yet/,
      `${id} must say plainly that nothing here is measured`);

    // Every text node on the screen, minus the ones that are legitimately numeric: a MOVE (R U2
    // R' — facts about a cube, not about you), a case NAME (OLL 21), and the count of items the
    // screen itself lists. What must not appear is a measurement: a percentage, a time, a
    // score, an "n of m" progress claim.
    const text = screen.textContent.replace(/\s+/g, ' ');
    assert.doesNotMatch(text, /\d+\s*%/, `${id} shows a percentage of something`);
    assert.doesNotMatch(text, /\b\d+\s*\/\s*\d+\b/, `${id} shows an n-of-m progress claim`);
    assert.doesNotMatch(text, /\b\d+\.\d+\b/, `${id} shows a decimal — a time or an average`);
    assert.doesNotMatch(text, /\b\d+\s*(reps|min|minutes|solves)\b/i, `${id} shows a count of something`);
  }
});

test('a preview control that would pretend to work is disabled, not silently inert', async () => {
  await go('trainer');
  for (const b of all('#stage .pill')) {
    assert.equal(b.disabled, true, 'a filter that filters nothing must say so');
  }
  await go('drill');
  const buttons = all('#stage .btn');
  const reveal = buttons.find((b) => /Reveal|Hide/.test(b.textContent));
  assert.ok(reveal && !reveal.disabled, 'Reveal shows a real algorithm and stays live');
  for (const b of buttons.filter((x) => x !== reveal)) {
    assert.equal(b.disabled, true, `"${b.textContent.trim()}" records nothing, so it must not invite a press`);
  }
});

// ---- The Timer -------------------------------------------------------------------------------

test('a solve the browser refused to store says so on the clock', async () => {
  await go('timer');
  const hint = $('#timerHint');
  const clock = $('#clock');
  assert.equal(clock.tagName, 'BUTTON', 'the screen\'s main control must be a real button');
  assert.match(clock.getAttribute('aria-label') ?? '', /timer/i, 'and it must have a name');

  clock.click();            // start
  await tick();
  failWrites = true;
  try {
    clock.click();          // stop — the write fails
    await tick();
  } finally { failWrites = false; }
  assert.match(hint.textContent, /NOT saved/i, 'a time that vanished on reload must be announced when it happens');
});

test('a roll that lands while the clock is running is parked, never put in play', async () => {
  await go('timer');
  const scr = $('#scr');
  const clock = $('#clock');
  // Wait for the screen's own first scramble, so `before` is a real one.
  for (let i = 0; i < 200 && !/^[URFDLB]/.test(scr.textContent || ''); i++) await settle(50);
  const before = scr.textContent;
  assert.match(before, /^[URFDLB]/, 'precondition: a scramble is on screen');

  // Ask for a new one and start the clock inside the same task. `randomScramble` always awaits,
  // so the roll resolves with `running` already true — the window the old code wrote through.
  $('#newScr').click();
  clock.click();
  await settle(200);
  assert.equal($('#scr').textContent, before,
    'the scramble was replaced under a running solve — the time would be filed against one the solver never saw');
  $('#clock').click(); // stop, so the screen is left idle
  await tick();
});

// ---- Superseded searches ---------------------------------------------------------------------

test('a second press of the die aborts the first press\'s search', async () => {
  // The controller is per WALK, and the abort has to happen before the new walk starts or the
  // pool works through a dead search first with the live one queued behind it.
  const seen = [];
  const RealAbortController = win.AbortController ?? globalThis.AbortController;
  class Spy extends RealAbortController {
    constructor() { super(); seen.push(this); }
  }
  const restore = globalThis.AbortController;
  globalThis.AbortController = Spy;
  try {
    await go('scramble');
    await settle(50);
    const before = seen.length;
    const die = $('#randCube');
    assert.ok(die, 'precondition: the scramble screen has a die');
    die.click();
    await settle(10);
    die.click();
    await settle(600);
    const made = seen.slice(before);
    assert.ok(made.length >= 2, `expected a controller per walk, saw ${made.length}`);
    // Everything but the last must have been called off — that is the whole point.
    assert.deepEqual(
      made.slice(0, -1).map((c) => c.signal.aborted),
      made.slice(0, -1).map(() => true),
      'a superseded walk left its search running on every worker in the pool',
    );
  } finally {
    globalThis.AbortController = restore;
  }
});

// ---- The four ways a walk can fail -------------------------------------------------------------

// One sentence used to cover the solver never loading, no scramble, a dead worker and the oracle
// refusing an answer — and it blamed the cube for all four, offering a re-scan as the remedy even
// where re-scanning cannot help. This asserts the four are DISTINCT and that each names its own
// cause; screen-swap.test.mjs drives the cross-check branch end to end in a real browser.
test('a walk that cannot be built says which thing failed', () => {
  const table = /const WALK_FAILURES = \{([\s\S]*?)\};/.exec(appSource);
  assert.ok(table, 'the failure table is gone — check this test still describes the code');
  const messages = [...table[1].matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(messages.length >= 3, `expected a message per cause, found ${messages.length}`);
  assert.equal(new Set(messages).size, messages.length, 'two causes share a sentence');
  for (const m of messages) {
    assert.doesNotMatch(m, /could not work it out/, 'the catch-all must not be reused as a cause');
    // The app may never say a move count is impossible: two-phase cannot prove a minimum, so it
    // cannot prove one absent (AGENTS.md).
    assert.doesNotMatch(m, /impossible|cannot be done|no solution exists/i);
  }
  assert.ok(messages.some((m) => /solver did not load/.test(m)), 'a failure of the APP must not read as a failure of the cube');
  assert.ok(messages.some((m) => /scramble/.test(m)), 'a roll that produced nothing says so');
  assert.ok(messages.some((m) => /check out/.test(m)), 'a refused cross-check says so');
});

test('the Timer offers a working way out when the solver never loads', () => {
  // The retry used to be handed `false` and do nothing at all, leaving "solver loading…" on
  // screen forever with nothing suggesting what to press.
  const retry = /void loadSolver\(\)\.then\(\(ok\) => \{([\s\S]*?)\n {10}\}\);/.exec(appSource);
  assert.ok(retry, 'the Timer no longer retries the solver load — check this test still applies');
  assert.match(retry[1], /if \(ok\)/, 'the success and failure paths must differ');
  assert.match(retry[1], /solver did not load/, 'and the failure must reach the screen');
});

// ---- Undo ---------------------------------------------------------------------------------

// A mis-recorded solve — a fumbled press, a clock a cube started while the cube was only being
// tidied — used to be permanent, and the only remedy for anyone who cared about their averages
// was to edit localStorage by hand.
test('Undo removes the solve it is drawn beside, not the row above it', async () => {
  // A corrupt record ABOVE two readable ones. `recentSolves()` keeps corrupt rows in place on
  // purpose — that is what stops an average quietly reaching further back — so the first row and
  // the first row a person can SEE are different here, which is the case that can go wrong.
  win.localStorage.setItem('cubusSolves', JSON.stringify({
    list: [
      { n: 0, time: '', scramble: '—', at: 0 },
      { n: 3, time: '9.99', scramble: 'R U', at: Date.now() },
      { n: 2, time: '8.88', scramble: 'L D', at: Date.now() - 1000 },
    ],
  }));
  await go('home');
  await go('timer');
  const shown = () => all('#lastFive .num').map((e) => e.textContent);
  assert.deepEqual(shown(), ['9.99', '8.88'], 'precondition: the corrupt row is not drawn');

  const undo = $('#undoLast');
  assert.ok(undo, 'the newest solve carries an undo');
  undo.click();                       // arms
  await tick();
  assert.match(undo.textContent, /Remove it\?/, 'destructive, so it asks once');
  assert.deepEqual(shown(), ['9.99', '8.88'], 'arming alone removes nothing');
  $('#undoLast').click();             // confirms
  await tick();

  assert.deepEqual(shown(), ['8.88'], 'the solve the button was beside is the one that went');
  const list = JSON.parse(win.localStorage.getItem('cubusSolves')).list;
  assert.equal(list.length, 2, 'exactly one record was removed');
  assert.equal(list[0].time, '', 'and the corrupt row keeps its place, so the averages stay honest');
  assert.match($('#timerHint').textContent, /Removed/i, 'and it says so');
});

// ---- The surface app.js adds to the page ------------------------------------------------------

// Two named seams and nothing else. A global is the app's most public API whether anyone meant it
// to be or not — anything on `window` is reachable by every script on the origin, survives every
// render, and is the first thing a future change reaches for instead of a proper argument. Both
// of these exist for a stated reason (driving the app from a test that has no cube and no
// pointer); a third appearing without one is the finding.
test('app.js adds exactly two globals, both of them named test seams', () => {
  const ours = Object.keys(win).filter((k) => /^cubus/i.test(k));
  assert.deepEqual(ours.sort(), ['cubusFeed', 'cubusGo']);
  assert.equal(typeof win.cubusGo, 'function');
  assert.deepEqual(
    Object.keys(win.cubusFeed).sort(),
    ['disconnect', 'facelets', 'move', 'movesLost', 'silence', 'useConnection'],
    'the feed seam is the driver\'s surface, and only that',
  );
});
