// THE LOOP SCREEN'S STRUCTURE, and the one decision it makes about a turn.
//
// What a node test may hold here is deliberately narrow. The screen's whole behaviour is the cube —
// the arrow, the turn played by `step()` — and "anything that DRIVES the renderer cannot be asserted
// behaviourally" in a node mount, which exposes a list of browser globals and not a browser. So this
// holds what it can hold honestly: that the screen is registered and routable, that its parts are
// there to be wired, and that `turnWords` says the right thing about each kind of turn. The cube's
// behaviour belongs to a browser suite, which is the full tier and not this one.
//
// `turnWords` is exported FOR THIS. It is the screen's only judgement — what to say about a turn —
// and a judgement reachable only through a mounted screen is a judgement nothing checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';

import { Window } from 'happy-dom';

// THE APP'S OWN BOOT, because a screen is app-level: `app-settings.js` reads its record at import and
// the shell reaches for `window`. Shimming those one at a time would be inventing a smaller app than
// the one the screen actually runs in. Structure only all the same — a node mount exposes a list of
// browser globals, not a browser, so nothing here asserts what the renderer DOES.
let turnWords;
let SCREENS;
let registeredByApp = false;
before(async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const win = new Window({
    url: 'http://localhost/#/home',
    settings: {
      disableJavaScriptFileLoading: true, disableCSSFileLoading: true,
      disableComputedStyleRendering: true, fetch: { disableSameOriginPolicy: true },
    },
  });
  win.document.write(html);
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'customElements',
    'HTMLElement', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  await import('../lib/app.js');
  ({ SCREENS } = await import('../lib/screen-shell.js'));
  // REGISTRATION IS READ BEFORE THIS FILE IMPORTS THE SCREEN ITSELF. Importing `loop.js` registers
  // it as a side effect, so asking afterwards asks whether THIS FILE imported it — and removing the
  // import from `app.js`, which is what makes the route exist for a user, still passed (audit,
  // 2026-10-06). A test must not repair the thing it is testing.
  registeredByApp = typeof SCREENS.loop === 'function';
  ({ turnWords } = await import('../lib/screens/loop.js'));
}, { timeout: 120_000 });

const face = (over) => ({ token: 'F', face: 'F', kind: 'face', turns: 1, hold: ['U', 'F'], stepIndex: 0, remaining: 9, ...over });

test('the loop is registered BY THE APP, so it is routable', () => {
  // The router resolves a hash against `SCREENS`; an id it does not hold falls to home, which is how
  // a screen can exist as a file and be unreachable. Read from the boot, not from this file's own
  // import — see the note in `before`.
  assert.equal(registeredByApp, true, 'app.js does not import the loop screen, so the route does not exist');
});

test('the screen has the three parts its mount wires, and nothing it cannot explain', () => {
  const spec = SCREENS.loop();
  assert.equal(typeof spec.html, 'string');
  assert.equal(typeof spec.mount, 'function');
  for (const id of ['loopCube', 'loopSay', 'loopDone']) {
    assert.match(spec.html, new RegExp(`id="${id}"`), `the mount wires #${id} and the html has no such element`);
  }
  // NO SHELF, NO PROGRESS, NO STAGE NAME (ADR 0008 decision 2). The screen asks the child nothing
  // about their cube's state, and a count of what is left is a progress bar by another name.
  //
  // CHECKED IN THE WORDS AS WELL AS THE MARKUP. This looked only for markup keywords, so
  // `<h2>White cross</h2><div>9 moves left</div>` — a stage name and a move count, both forbidden
  // above — passed (audit, 2026-10-06).
  assert.doesNotMatch(spec.html, /progress|<ol|<ul|data-lesson|data-stage/i,
    'the loop grew a shelf, a list or a progress indicator');
  const words = spec.html.replace(/<[^>]*>/g, ' ');
  assert.doesNotMatch(words, /\b\d+\s*(moves?|turns?|steps?)\b|\bstep\s*\d|\b\d+\s*(of|\/)\s*\d+\b/i,
    'the loop shows a count of what is left, which is a progress bar by another name');
  for (const stage of ['cross', 'first layer', 'middle layer', 'top layer', 'last layer', 'F2L', 'OLL', 'PLL']) {
    assert.doesNotMatch(words, new RegExp(`\\b${stage}\\b`, 'i'), `the loop names the stage "${stage}"`);
  }
});

test('a half turn, a quarter turn, a whole-cube turn and no turn each get their own words', () => {
  const quarter = turnWords(face());
  const half = turnWords(face({ turns: 2 }));
  const regrip = turnWords(face({ kind: 'rotation', face: null }));
  const none = turnWords(null);
  const all = [quarter, half, regrip, none];
  assert.equal(new Set(all).size, 4, 'two of the four cases say the same thing, so one of them is wrong');
  for (const words of all) assert.ok(words.trim().length > 0, 'a case says nothing at all');
  // THE ONE THAT MATTERS: a whole-cube turn must not be described as turning a face, because an
  // arrow on a face would be pointing at a layer nobody is being asked to move.
  assert.doesNotMatch(regrip, /\bface\b/i, 'a whole-cube turn was described as turning a face');
  assert.match(regrip, /whole cube/i);
  // And a half turn says how many, because that is the whole of the difference.
  assert.match(half, /twice/i);
  assert.doesNotMatch(quarter, /twice/i);
  // NO TURN MEANS NO TURN. Distinctness alone let `Nothing to do.` be replaced by
  // `Follow the arrow once more.` — four different strings, one of them instructing a turn that does
  // not exist (audit, 2026-10-06).
  assert.doesNotMatch(none, /\barrow\b|\bturn\b|\btwice\b|\bpick\b/i,
    'the no-turn line instructs a turn');
  assert.match(none, /\bnothing\b|\bdone\b|\bfinished\b/i, 'the no-turn line does not say there is nothing to do');
});
